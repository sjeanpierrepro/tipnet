// TipNet money math. Pure functions only: no DOM, no storage, no globals.
// Definitions:
//   Gross pay: everything earned before deductions.
//   Percentage deductions ("pct"): grow with income (taxes, % retirement).
//   Fixed deductions ("fixed"): the same dollar amount every check.
// Money is rounded to whole cents at each night so totals never drift.

const DAY = 864e5;

/* ---------- small helpers ---------- */
export const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
export const toCents = (x) => Math.round(x * 100 + (x < 0 ? -1e-9 : 1e-9));
export const fromCents = (c) => c / 100;
export const round2 = (x) => fromCents(toCents(x));

/* ---------- calendar-day math on "YYYY-MM-DD" strings (UTC, so DST-safe) ---------- */
const pad = (n) => String(n).padStart(2, '0');
export function parseISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}
export function formatISO(ms) {
  const d = new Date(ms);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}
export const addDays = (s, n) => formatISO(parseISO(s) + n * DAY);
export const dayDiff = (a, b) => Math.round((parseISO(b) - parseISO(a)) / DAY);
/** Local calendar date of "now" as YYYY-MM-DD. */
export function todayISO(now = new Date()) {
  return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
}
/** Day of week for an ISO date: 0 = Monday ... 6 = Sunday. */
export const weekdayMon0 = (s) => (new Date(parseISO(s)).getUTCDay() + 6) % 7;

/* ---------- rates from the stub (6.1) ---------- */
const sumDed = (p, f) => (p.deductions || []).filter(f).reduce((s, d) => s + num(d.amount), 0);
export const baseRate = (p) => (num(p.gross) > 0 ? sumDed(p, (d) => d.mode === 'pct') / num(p.gross) : 0);
export const rate = (p) => (p.rateOverride != null ? p.rateOverride : baseRate(p));
export const fedRate = (p) => (num(p.gross) > 0 ? sumDed(p, (d) => d.mode === 'pct' && d.k === 'fed') / num(p.gross) : 0);
export const fixedTotal = (p) => sumDed(p, (d) => d.mode === 'fixed');
/** Bonuses/commissions: swap the regular federal share for the 22% supplemental rate (6.5). */
export const suppRate = (p) => Math.max(0, rate(p) - fedRate(p)) + 0.22;

/* ---------- pay period (6.3) ---------- */
/** Length in days: from start/end dates if valid (1-62), else the frequency. */
export function periodLength(p) {
  if (p.periodEnd && p.periodStart) {
    const d = dayDiff(p.periodStart, p.periodEnd) + 1;
    if (d > 0 && d <= 62) return d;
  }
  return num(p.freq) || 14;
}
/** True when the end date is what drives the period length (frequency dropdown disabled). */
export function lengthFromDates(p) {
  if (!(p.periodEnd && p.periodStart)) return false;
  const d = dayDiff(p.periodStart, p.periodEnd) + 1;
  return d > 0 && d <= 62;
}
export const periodIndex = (p, dateISO) => Math.floor(dayDiff(p.periodStart, dateISO) / periodLength(p));
export function periodRange(p, idx) {
  const start = addDays(p.periodStart, idx * periodLength(p));
  return { start, end: addDays(start, periodLength(p) - 1) };
}
/** A period is final once its end date is before today. */
export const isFinal = (p, idx, today = todayISO()) => periodRange(p, idx).end < today;
export const nightsInPeriod = (p, nights, idx) =>
  nights.filter((n) => periodIndex(p, n.date) === idx).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

/* ---------- shifts per period (6.2) ---------- */
/** Returns {n, source: 'entered'|'history'|'default'}. */
export function shiftsPerPeriod(p, nights = [], today = todayISO()) {
  if (num(p.shifts) > 0) return { n: num(p.shifts), source: 'entered' };
  const done = [...new Set(nights.map((n) => periodIndex(p, n.date)))].filter((i) => isFinal(p, i, today));
  if (done.length) {
    const avg = done.reduce((s, i) => s + nightsInPeriod(p, nights, i).length, 0) / done.length;
    return { n: Math.max(1, avg), source: 'history' };
  }
  return { n: Math.max(1, Math.round((periodLength(p) * 4) / 7)), source: 'default' };
}
export const SHIFT_SOURCE_TEXT = {
  entered: 'the shift count you entered',
  history: 'your average from past pay periods',
  default: 'about 4 shifts a week over your pay period dates',
};

/* ---------- one night (6.4) ---------- */
/** Amount for a pay type on a night; the main (first) type falls back to its usual amount. */
export function payAmount(night, t, i) {
  if (night.pay && night.pay[t.id] !== undefined && night.pay[t.id] !== '' && night.pay[t.id] !== null) return num(night.pay[t.id]);
  return i === 0 ? num(t.usual) : 0;
}
export function basePay(night, p) {
  let pay = 0, hours = 0, extra = 0, extraTax = 0;
  const r = rate(p), rs = suppRate(p);
  (p.payTypes || []).forEach((t, i) => {
    const a = payAmount(night, t, i);
    if (t.unit === 'amt') {
      extra += a;
      extraTax += a * (t.supp ? rs : r);
    } else {
      pay += a * num(t.rate);
      if (t.unit === 'hr' && t.k !== 'diff' && !t.diff) hours += a;
    }
  });
  return { pay, hours, extra, extraTax };
}
/**
 * computeNight(night, profile, shifts)
 * shifts: number of shifts to spread fixed deductions over (use shiftsPerPeriod().n).
 * Returns dollars rounded to cents:
 * {total, basePay, hours, extra, extraTax, tips, tipout, kept, tax, fixedPerShift, net,
 *  fromCash, cashInHand (null if no cash entered), onCheck (null), fedOnTips, r}
 */
export function computeNight(night, p, shifts) {
  const n = shifts > 0 ? shifts : shiftsPerPeriod(p, [], todayISO()).n;
  const r = rate(p);
  const bp = basePay(night, p);
  const total = toCents(num(night.total));
  const baseC = toCents(bp.pay);
  const extraC = toCents(bp.extra);
  const tipsC = Math.max(0, total - baseC);
  const to = p.tipout || { on: false };
  const useTO = !!(to.on && night.barback && to.basis === 'before');
  let tipoutC = 0;
  if (useTO) {
    tipoutC = to.mode === 'pct' ? toCents((tipsC / 100) * num(to.value) / 100) : toCents(num(to.value));
    tipoutC = Math.min(tipoutC, tipsC);
  }
  const keptC = total - tipoutC;
  const extraTaxC = toCents(bp.extraTax);
  const taxC = toCents((keptC / 100) * r) + extraTaxC;
  const fixedC = toCents(fixedTotal(p) / n);
  const netC = keptC + extraC - taxC - fixedC;
  const fedOnTipsC = toCents((Math.max(0, tipsC - tipoutC) / 100) * fedRate(p));
  let fromCashC = 0, cashInHandC = null, onCheckC = null;
  const hasCash = night.cash !== '' && night.cash != null && Number.isFinite(parseFloat(night.cash));
  if (hasCash) {
    const c = toCents(num(night.cash));
    fromCashC = useTO && to.from === 'cash' ? Math.min(c, tipoutC) : 0;
    cashInHandC = c - fromCashC;
    onCheckC = netC - cashInHandC;
  }
  const d = fromCents;
  return {
    total: d(total), basePay: d(baseC), hours: bp.hours, extra: d(extraC), extraTax: d(extraTaxC),
    tips: d(tipsC), tipout: d(tipoutC), kept: d(keptC), tax: d(taxC), fixedPerShift: d(fixedC), net: d(netC),
    fromCash: d(fromCashC), cashInHand: cashInHandC == null ? null : d(cashInHandC),
    onCheck: onCheckC == null ? null : d(onCheckC), fedOnTips: d(fedOnTipsC), r,
  };
}

/* ---------- period totals (6.6) ---------- */
/**
 * periodTotals(profile, nights, idx, today?, shifts?) ->
 * {ns, net, hrs, chk, kept, cash, allCash, exact}
 * When the period is final and has nights, the sum of per-shift fixed shares is replaced by the
 * exact fixed total (applied to net and expected check).
 */
export function periodTotals(p, nights, idx, today = todayISO(), shifts) {
  const ns = nightsInPeriod(p, nights, idx);
  const n = shifts > 0 ? shifts : shiftsPerPeriod(p, nights, today).n;
  let net = 0, hrs = 0, chk = 0, kept = 0, cash = 0, fixedShares = 0, allCash = ns.length > 0;
  ns.forEach((night) => {
    const c = computeNight(night, p, n);
    net += toCents(c.net); hrs += c.hours; kept += toCents(c.kept); fixedShares += toCents(c.fixedPerShift);
    if (c.onCheck == null) allCash = false;
    else { chk += toCents(c.onCheck); cash += toCents(c.cashInHand); }
  });
  const exact = ns.length > 0 && isFinal(p, idx, today);
  if (exact) {
    const adj = fixedShares - toCents(fixedTotal(p));
    net += adj; chk += adj;
  }
  return { ns, net: fromCents(net), hrs, chk: fromCents(chk), kept: fromCents(kept), cash: fromCents(cash), allCash, exact };
}

/* ---------- calibration (6.7) ---------- */
/**
 * calibrate(profile, nights, idx, actual, today?, shifts?)
 * Does not mutate. Returns {ok:false, reason:'nonights'|'noactual'|'missingCash', missingCash}
 * or {ok:true, pred, actual, err, rNew, rateOverride, T, C, F}.
 * The caller stores {label, pred, actual, err} in calib and sets profile.rateOverride = rateOverride.
 */
export function calibrate(p, nights, idx, actual, today = todayISO(), shifts) {
  const ns = nightsInPeriod(p, nights, idx);
  const A = num(actual);
  if (!ns.length) return { ok: false, reason: 'nonights', missingCash: 0 };
  if (!(A > 0)) return { ok: false, reason: 'noactual', missingCash: 0 };
  const missing = ns.filter((n) => n.cash == null || n.cash === '').length;
  if (missing) return { ok: false, reason: 'missingCash', missingCash: missing };
  const n = shifts > 0 ? shifts : shiftsPerPeriod(p, nights, today).n;
  let T = 0, C = 0, predC = 0;
  ns.forEach((night) => {
    const c = computeNight(night, p, n);
    T += toCents(c.kept) + toCents(c.extra);
    C += toCents(c.cashInHand);
    predC += toCents(c.onCheck) + toCents(c.fixedPerShift);
  });
  const F = toCents(fixedTotal(p));
  predC -= F;
  const pred = fromCents(predC);
  const err = (pred - A) / A;
  const rNew = T > 0 ? Math.min(0.45, Math.max(0.02, 1 - (A + fromCents(F) + fromCents(C)) / fromCents(T))) : rate(p);
  return { ok: true, pred, actual: A, err, rNew, rateOverride: (rate(p) + rNew) / 2, T: fromCents(T), C: fromCents(C), F: fromCents(F) };
}

/* ---------- weekly hours for the overtime nudge (7.1) ---------- */
/** Hours logged Monday-Sunday for the week containing dateISO. */
export function weeklyHours(p, nights, dateISO, threshold = 40) {
  const start = addDays(dateISO, -weekdayMon0(dateISO));
  const end = addDays(start, 6);
  let hours = 0;
  nights.forEach((night) => {
    if (night.date >= start && night.date <= end) hours += basePay(night, p).hours;
  });
  return { weekStart: start, weekEnd: end, hours, over: hours > threshold };
}

/* ---------- Setup summary box (5.5) ---------- */
export function summary(p, nights = [], today = todayISO()) {
  const r = rate(p), si = shiftsPerPeriod(p, nights, today), fixed = fixedTotal(p);
  return {
    r, taxPer100: round2(100 * r), keepPer100: round2(100 * (1 - r)),
    fixed, fixedPerShift: round2(fixed / si.n), shifts: si.n, shiftSource: si.source,
    shiftSourceText: SHIFT_SOURCE_TEXT[si.source], periodLength: periodLength(p),
    fromDates: lengthFromDates(p), adjusted: p.rateOverride != null,
  };
}

/* ---------- presets (5.4, 5.5) ---------- */
export const PAY_PRESETS = [
  { k: 'hourly', name: 'Hourly', unit: 'hr', g: 'Hourly' },
  { k: 'training', name: 'Training', unit: 'hr', g: 'Hourly' },
  { k: 'ot', name: 'Overtime', unit: 'hr', g: 'Hourly', rateMultiplier: 1.5,
    notes: 'Overtime is usually 1.5x your hourly rate for hours past 40 in a week.' },
  { k: 'holiday', name: 'Holiday pay', unit: 'hr', g: 'Hourly' },
  { k: 'diff', name: 'Shift lead / supervisor differential', unit: 'hr', g: 'Hourly', diff: 1,
    notes: 'Enter the extra per hour on top of your base rate. These hours do not count twice toward your hours worked.' },
  { k: 'pto', name: 'Paid time off / sick pay', unit: 'hr', g: 'Hourly' },
  { k: 'event', name: 'Private event / banquet', unit: 'shift', g: 'Per shift' },
  { k: 'shift', name: 'Flat shift pay', unit: 'shift', g: 'Per shift' },
  { k: 'bonus', name: 'Bonus', unit: 'amt', supp: 1, g: 'Flat amount',
    notes: 'Federal tax is estimated at the 22% bonus rate.' },
  { k: 'commission', name: 'Commission / sales incentive', unit: 'amt', supp: 1, g: 'Flat amount',
    notes: 'Federal tax is estimated at the 22% bonus rate.' },
  { k: 'autograt', name: 'Service charge / auto-gratuity', unit: 'amt', g: 'Flat amount',
    notes: 'Auto-gratuities are taxed as wages, not tips, so they do not count toward the federal tip deduction.' },
  { k: 'other', name: 'Other', unit: 'hr', g: 'Other' },
];
const PRETAX_NOTE = 'Your stub’s taxes already account for this, so nothing else to enter.';
export const DEDUCTION_PRESETS = [
  { k: 'fed', name: 'Federal income tax', mode: 'pct', g: 'Taxes' },
  { k: 'ss', name: 'Social Security', mode: 'pct', g: 'Taxes' },
  { k: 'med', name: 'Medicare', mode: 'pct', g: 'Taxes' },
  { k: 'state', name: 'State income tax', mode: 'pct', g: 'Taxes' },
  { k: 'local', name: 'Local / city tax', mode: 'pct', g: 'Taxes' },
  { k: 'sdi', name: 'State disability / paid family leave', mode: 'pct', g: 'Taxes' },
  { k: 'health', name: 'Health insurance', mode: 'fixed', g: 'Benefits' },
  { k: 'dental', name: 'Dental insurance', mode: 'fixed', g: 'Benefits' },
  { k: 'vision', name: 'Vision insurance', mode: 'fixed', g: 'Benefits' },
  { k: 'life', name: 'Life insurance', mode: 'fixed', g: 'Benefits' },
  { k: 'disab', name: 'Disability insurance', mode: 'fixed', g: 'Benefits' },
  { k: 'hsa', name: 'HSA / FSA', mode: 'fixed', g: 'Benefits', notes: PRETAX_NOTE },
  { k: 'supppre', name: 'Supplemental (pre-tax)', mode: 'fixed', g: 'Benefits', notes: PRETAX_NOTE },
  { k: 'supppost', name: 'Supplemental (post-tax)', mode: 'fixed', g: 'Benefits' },
  { k: 'k401', name: '401(k) / retirement', mode: 'pct', g: 'Retirement' },
  { k: 'roth', name: 'Roth 401(k)', mode: 'pct', g: 'Retirement' },
  { k: 'uniform', name: 'Uniform', mode: 'fixed', g: 'Other' },
  { k: 'meals', name: 'Employee meals', mode: 'fixed', g: 'Other' },
  { k: 'parking', name: 'Parking / transit', mode: 'fixed', g: 'Other' },
  { k: 'union', name: 'Union dues', mode: 'fixed', g: 'Other' },
  { k: 'advance', name: 'Pay advance repayment', mode: 'fixed', g: 'Other' },
  { k: 'garnish', name: 'Garnishment / child support', mode: 'fixed', g: 'Other' },
  { k: 'misc', name: 'Miscellaneous', mode: 'fixed', g: 'Other' },
  { k: 'other', name: 'Other', mode: 'fixed', g: 'Other' },
];
export const PRESETS = { pay: PAY_PRESETS, deductions: DEDUCTION_PRESETS };
export const findPayPreset = (k) => PAY_PRESETS.find((x) => x.k === k);
export const findDeductionPreset = (k) => DEDUCTION_PRESETS.find((x) => x.k === k);

/** Returns a new deduction with name/mode taken from the preset. */
export function applyDeductionPreset(d, k) {
  const pr = findDeductionPreset(k) || DEDUCTION_PRESETS[DEDUCTION_PRESETS.length - 1];
  return { ...d, k: pr.k, name: pr.name, mode: pr.mode };
}
/** Returns a new pay type from the preset; `mainRate` supplies the overtime multiple. */
export function applyPayPreset(t, k, mainRate = 0) {
  const pr = findPayPreset(k) || PAY_PRESETS[PAY_PRESETS.length - 1];
  const out = { ...t, k: pr.k, name: pr.k === 'other' ? '' : pr.name, unit: pr.unit, supp: pr.supp ? 1 : 0 };
  if (pr.rateMultiplier && mainRate) out.rate = +(num(mainRate) * pr.rateMultiplier).toFixed(2);
  if (pr.unit === 'amt') { out.rate = 0; out.usual = 0; }
  return out;
}
/** Social Security and Medicare from gross (6.2% and 1.45%). Returns a new deductions array. */
export function fillFica(p) {
  const g = num(p.gross);
  const deds = (p.deductions || []).map((d) => ({ ...d }));
  [['ss', 'Social Security', 0.062], ['med', 'Medicare', 0.0145]].forEach(([k, name, r], i) => {
    let d = deds.find((x) => x.k === k);
    if (!d) { d = { id: 'd' + Date.now() + i, k, name, mode: 'pct' }; deds.push(d); }
    d.amount = +(g * r).toFixed(2);
  });
  return deds;
}

/* ---------- example profile and nights (5.8) ---------- */
export const EXAMPLE_PROFILE = {
  freq: 14, periodStart: '2026-09-21', periodEnd: '2026-10-04', shifts: 10, gross: 2000, rateOverride: null,
  deductions: [
    { id: 'd1', k: 'fed', name: 'Federal income tax', amount: 180, mode: 'pct' },
    { id: 'd2', k: 'ss', name: 'Social Security', amount: 124, mode: 'pct' },
    { id: 'd3', k: 'med', name: 'Medicare', amount: 29, mode: 'pct' },
    { id: 'd4', k: 'health', name: 'Health insurance', amount: 60, mode: 'fixed' },
  ],
  payTypes: [
    { id: 'p1', k: 'hourly', name: 'Bartending', rate: 12, unit: 'hr', usual: 7 },
    { id: 'p2', k: 'training', name: 'Training', rate: 15, unit: 'hr', usual: 0 },
    { id: 'p3', k: 'bonus', name: 'Bonus', rate: 0, unit: 'amt', usual: 0, supp: 1 },
  ],
  tipout: { on: true, mode: 'pct', value: 15, basis: 'before', from: 'cash' },
};
export const EXAMPLE_NIGHTS = [
  { id: 1, date: '2026-09-21', total: 310, cash: 90, pay: { p1: 6 }, barback: true },
  { id: 2, date: '2026-09-24', total: 420, cash: 140, pay: { p1: 7 }, barback: true },
  { id: 3, date: '2026-09-26', total: 585, cash: 210, pay: { p1: 8 }, barback: true },
  { id: 4, date: '2026-09-27', total: 365, cash: 100, pay: { p1: 5, p2: 2 }, barback: false },
];
/** Fresh deep copies, safe to mutate. */
export const exampleProfile = () => JSON.parse(JSON.stringify(EXAMPLE_PROFILE));
export const exampleNights = () => JSON.parse(JSON.stringify(EXAMPLE_NIGHTS));
