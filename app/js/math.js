// TipNet money math. Pure functions only: no DOM, no storage, no globals.
// Definitions:
//   Gross pay: everything earned before deductions.
//   Percentage deductions ("pct"): grow with income (taxes, % retirement).
//   Fixed deductions ("fixed"): the same dollar amount every check.
// Money is rounded to whole cents at each night so totals never drift.

const DAY = 864e5;

/* ---------- small helpers ---------- */
export const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
export const toCents = (x) => Math.round(x * 100 + (x < 0 ? -1e-9 : 1e-9));
export const fromCents = (c) => c / 100;
export const round2 = (x) => fromCents(toCents(x));

/* ---------- calendar-day math on "YYYY-MM-DD" strings (UTC, so DST-safe) ---------- */
const pad = (n) => String(n).padStart(2, '0');
// Years 1000-9998 only: every date keeps a 4-digit year (so ISO strings compare correctly), even one period past the end.
export function parseISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m || +m[1] < 1000 || +m[1] > 9998) return NaN;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(ms); // round-trip: 2026-02-31 would roll over to March, so it is rejected
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return NaN;
  return ms;
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
/** A rate never goes above 100% (or below 0): a mistyped gross like $2 must not give a 16,650% tax. */
export const MAX_RATE = 1;
const clampRate = (x) => (Number.isFinite(x) ? Math.min(MAX_RATE, Math.max(0, x)) : 0);
/*
 * Non-taxable earnings on the stub (profile.nontaxable = [{id, k, name, amount, recurring}]): money like reimbursements
 * that the stub pays without tax. They are left out of the gross the tax rate is worked out from; the recurring ones are
 * also added to every check, untaxed (see computeNight). "Just this once" items only matter for the rate.
 */
const sumNontax = (p, f = () => true) =>
  (Array.isArray(p.nontaxable) ? p.nontaxable : [])
    .filter(f)
    .reduce((s, x) => s + Math.max(0, num(x.amount)), 0);
/** Non-taxable money on that paystub (all of it). */
export const nontaxOnStub = (p) => sumNontax(p);
/** Non-taxable money that comes with every check (one pay period). */
export const nontaxRecurring = (p) => sumNontax(p, (x) => x.recurring !== false);
/**
 * The gross the tax rate is worked out from: gross minus the non-taxable earnings on that stub. If that would leave
 * nothing (a typo, or the non-taxable amounts are more than the gross), the subtraction is ignored and Setup says so.
 */
export function taxableGross(p) {
  const g = num(p.gross);
  const t = g - nontaxOnStub(p);
  return t > 0 ? t : g;
}
/** The paystub's % deductions / taxable gross, NOT clamped (for the Setup warnings). */
export const rawRate = (p) =>
  taxableGross(p) > 0 ? sumDed(p, (d) => d.mode === 'pct') / taxableGross(p) : 0;
export const baseRate = (p) => clampRate(rawRate(p));
export const rate = (p) => (p.rateOverride != null ? clampRate(Number(p.rateOverride)) : baseRate(p));
export const fedRate = (p) =>
  taxableGross(p) > 0 ? clampRate(sumDed(p, (d) => d.mode === 'pct' && d.k === 'fed') / taxableGross(p)) : 0;
/** Gross below this for one paycheck gets a calm "check this" note in Setup. */
export const LOW_GROSS = 50;
/** % deductions at or above this share of gross get a calm "check this" note in Setup. */
export const HIGH_RATE = 0.6;
/**
 * Gentle Setup checks on the paystub numbers (never a block): {lowGross, highRate, capped, share (raw % deductions / gross)}.
 * capped: the raw rate is above 100%, so TipNet uses 100%.
 */
export function stubWarnings(p) {
  const g = num(p.gross);
  const share = rawRate(p);
  return {
    lowGross: g > 0 && g < LOW_GROSS,
    highRate: g > 0 && share >= HIGH_RATE,
    capped: share > MAX_RATE,
    share,
    // the non-taxable amounts are as big as the gross (or bigger): they are not taken out of it
    nontaxIgnored: nontaxOnStub(p) > 0 && g > 0 && g - nontaxOnStub(p) <= 0,
  };
}
export const fixedTotal = (p) => sumDed(p, (d) => d.mode === 'fixed');
/** Bonuses/commissions: swap the regular federal share for the 22% supplemental rate (6.5). */
export const suppRate = (p) => Math.min(MAX_RATE, Math.max(0, rate(p) - fedRate(p)) + 0.22);

/* ---------- pay period (6.3) ---------- */
// Fixed lengths: 7, 14, 15, 30 (days). Calendar modes are the strings 'semimonthly' and 'monthly', anchored on the start date's day of month
// (clamped to short months). Lengths for string modes never come from num(p.freq).
const daysInMonthUTC = (y, m0) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
const mkISO = (y, m0, d) => formatISO(Date.UTC(y, m0, Math.min(d, daysInMonthUTC(y, m0))));
/** 'semimonthly' | 'monthly' | null: calendar mode when freq is that string and the start date is valid. */
export function calendarMode(p) {
  if (!p || !Number.isFinite(parseISO(p.periodStart))) return null;
  return p.freq === 'semimonthly' || p.freq === 'monthly' ? p.freq : null;
}
/** First day of calendar period idx (any integer, negative before periodStart). */
function calStart(p, idx, mode) {
  const y0 = +p.periodStart.slice(0, 4),
    m0 = +p.periodStart.slice(5, 7) - 1;
  const A = +p.periodStart.slice(8, 10);
  let mi, day;
  if (mode === 'monthly') {
    mi = y0 * 12 + m0 + idx;
    day = A;
  } else {
    // anchors: A and B = A+15 (A <= 15) or A-15 (A > 15)
    const B = A <= 15 ? A + 15 : A - 15;
    mi = y0 * 12 + m0 + (A <= 15 ? Math.floor(idx / 2) : Math.floor((idx + 1) / 2));
    day = idx % 2 === 0 ? A : B;
  }
  return mkISO(Math.floor(mi / 12), ((mi % 12) + 12) % 12, day);
}
function calIndex(p, dateISO, mode) {
  const d = parseISO(dateISO);
  if (!Number.isFinite(d)) return NaN;
  const dt = new Date(d);
  const md =
    (dt.getUTCFullYear() - +p.periodStart.slice(0, 4)) * 12 +
    dt.getUTCMonth() -
    (+p.periodStart.slice(5, 7) - 1);
  let i = mode === 'monthly' ? md : md * 2;
  // The estimate above is off by a step or two at most; the caps only stop bad data from looping.
  for (let k = 0; k < 8 && calStart(p, i, mode) > dateISO; k++) i--;
  for (let k = 0; k < 8 && calStart(p, i + 1, mode) <= dateISO; k++) i++;
  return i;
}
/** Length in days of period idx (default: the first). Calendar frequencies vary by period; others use dates/frequency. */
export function periodLength(p, idx = 0) {
  const mode = calendarMode(p);
  if (mode) return dayDiff(calStart(p, idx, mode), calStart(p, idx + 1, mode));
  if (p.periodEnd && p.periodStart) {
    const d = dayDiff(p.periodStart, p.periodEnd) + 1;
    if (d > 0 && d <= 62) return d;
  }
  return p.freq === 'semimonthly' ? 15 : p.freq === 'monthly' ? 30 : num(p.freq) || 14; // string modes only reach here with an invalid start date
}
/** True when the end date is what drives the period length (frequency dropdown disabled). Never for calendar frequencies. */
export function lengthFromDates(p) {
  if (calendarMode(p)) return false;
  if (!(p.periodEnd && p.periodStart)) return false;
  const d = dayDiff(p.periodStart, p.periodEnd) + 1;
  return d > 0 && d <= 62;
}
export function periodIndex(p, dateISO) {
  const mode = calendarMode(p);
  if (mode) return calIndex(p, dateISO, mode);
  return Math.floor(dayDiff(p.periodStart, dateISO) / periodLength(p));
}
export function periodRange(p, idx) {
  const mode = calendarMode(p);
  if (mode) return { start: calStart(p, idx, mode), end: addDays(calStart(p, idx + 1, mode), -1) };
  const start = addDays(p.periodStart, idx * periodLength(p));
  return { start, end: addDays(start, periodLength(p) - 1) };
}
/** A period is final once its end date is before today. */
export const isFinal = (p, idx, today = todayISO()) => periodRange(p, idx).end < today;
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

/* ---------- the pay period a night counts toward ---------- */
/*
 * night.periodStart (optional, owner request): the first day of the pay period the night counts toward,
 * picked in the Pay periods editor. A DATE, not an index, so a Setup schedule change can't silently renumber it.
 * It only counts while it is still the first day of a period in this restaurant's schedule (any of the six modes;
 * payday/payDelay never moves period boundaries). Otherwise the night counts by its own date, and nightPeriodStale says so.
 */
function assignedIndex(p, night) {
  const s = night && night.periodStart;
  if (typeof s !== 'string' || !Number.isFinite(parseISO(s))) return null;
  const k = periodIndex(p, s);
  if (!Number.isFinite(k) || periodRange(p, k).start !== s) return null;
  return k;
}
/** The pay period index a night counts toward: its picked pay period (night.periodStart) when valid, else its date's. */
export function nightPeriodIndex(p, night) {
  const k = assignedIndex(p, night);
  return k == null ? periodIndex(p, night.date) : k;
}
/** True when a night has a picked pay period that no longer matches the schedule (so it is counted by its date). */
export const nightPeriodStale = (p, night) =>
  !!night && night.periodStart != null && night.periodStart !== '' && assignedIndex(p, night) == null;
/** True when a night counts toward a pay period other than the one its date falls in. */
export const nightPeriodMoved = (p, night) => nightPeriodIndex(p, night) !== periodIndex(p, night.date);
/** The pay periods the editor offers: [{idx, start, end, own}] for the one before the night's date's, its own, the next. */
export function nightPeriodChoices(p, dateISO) {
  const own = periodIndex(p, dateISO);
  if (!Number.isFinite(own)) return [];
  return [own - 1, own, own + 1].map((idx) => ({ idx, ...periodRange(p, idx), own: idx === own }));
}

/**
 * One pass over the nights: Map of period index -> that period's nights, oldest first (by the period each night
 * counts toward, see nightPeriodIndex). Build it once per screen and pass it down, so nothing rescans every night.
 */
export function indexNights(p, nights) {
  const map = new Map();
  nights.forEach((n) => {
    const i = nightPeriodIndex(p, n);
    const list = map.get(i);
    if (list) list.push(n);
    else map.set(i, [n]);
  });
  map.forEach((list) => list.sort(byDate));
  return map;
}
/** Nights in period idx, oldest first. Pass a prebuilt `index` (from indexNights) to skip the full scan. */
export const nightsInPeriod = (p, nights, idx, index) =>
  index ? (index.get(idx) || []).slice() : nights.filter((n) => nightPeriodIndex(p, n) === idx).sort(byDate);

/* ---------- shifts per period (6.2) ---------- */
/**
 * Returns {n, source: 'entered'|'history'|'default'}. Pass `index` (from indexNights) when you have one.
 * 'entered' and 'history' do not depend on idx, so a loop over many periods can compute this once.
 */
export function shiftsPerPeriod(p, nights = [], today = todayISO(), idx, index) {
  if (num(p.shifts) > 0) return { n: num(p.shifts), source: 'entered' };
  let count = 0,
    total = 0;
  (index || indexNights(p, nights)).forEach((list, i) => {
    if (isFinal(p, i, today)) {
      count++;
      total += list.length;
    }
  });
  if (count) return { n: Math.max(1, total / count), source: 'history' };
  const at = idx !== undefined ? idx : Number.isFinite(parseISO(p.periodStart)) ? periodIndex(p, today) : 0;
  return { n: Math.max(1, Math.round((periodLength(p, at) * 4) / 7)), source: 'default' };
}
export const SHIFT_SOURCE_TEXT = {
  entered: 'the shift count you entered',
  history: 'your average from past pay periods',
  default: 'about 4 shifts a week over your pay period dates',
};

/* ---------- locked nights (snapshots) ---------- */
/*
 * A night can carry `snap`: the Setup numbers it was worked out with, so a later raise or a new deduction
 * never rewrites a finished pay period. Nights without one are "unlocked" and follow the current Setup.
 *   snap = {v:1, r, rf, fixed, nontax?, n, pay:[{id, rate, unit, usual?, supp?, diff?, nontax?}], tipout:{on, mode, value, basis, from}}
 *   r: tax rate used (paystub rate or the calibrated one), rf: federal share, fixed: fixed deductions per period,
 *   n: shifts the fixed deductions were spread over, pay: pay types (usual only matters for the first), tipout: settings.
 */
/**
 * snapshotFor(profile, shifts?) -> a snapshot to store on a night as `night.snap`.
 * shifts: the shift count used for that night's period (shiftsPerPeriod().n). Default: the entered count, else about 4 a week.
 */
export function snapshotFor(p, shifts) {
  const to = p.tipout || {};
  const s = {
    v: 1,
    r: rate(p),
    rf: fedRate(p),
    fixed: round2(fixedTotal(p)),
    n: shifts > 0 ? shifts : shiftsPerPeriod(p, [], todayISO()).n,
    pay: (p.payTypes || []).map((t, i) => {
      const o = { id: t.id, rate: num(t.rate), unit: t.unit };
      if (i === 0) o.usual = num(t.usual);
      if (t.supp) o.supp = 1;
      if (t.nontax) o.nontax = 1;
      if (t.k === 'diff' || t.diff) o.diff = 1;
      return o;
    }),
    tipout: {
      on: !!to.on,
      mode: to.mode === 'flat' ? 'flat' : 'pct',
      value: num(to.value),
      basis: to.basis || 'before',
      from: to.from || 'cash',
    },
  };
  // recurring non-taxable money per check (only written when there is some, so older snapshots look the same)
  const nt = round2(nontaxRecurring(p));
  if (nt > 0) s.nontax = nt;
  return s;
}
export const isLocked = (night) => !!(night && night.snap);
/**
 * Lock every night in a FINISHED pay period that has no snapshot yet, with the Setup it is shown with right now.
 * A night locks when its pay period ENDS (not when it is saved), so Setup fixes still apply to the current period.
 * Pure: returns {nights, stamped}; nights that got a snapshot are copies, the rest are the same objects.
 */
export function lockFinishedNights(profile, nights, today = todayISO()) {
  if (!nights.some((n) => !n.snap)) return { nights, stamped: 0 };
  const index = indexNights(profile, nights);
  const base = shiftsPerPeriod(profile, nights, today, undefined, index);
  const snaps = new Map();
  index.forEach((list, idx) => {
    if (!isFinal(profile, idx, today) || list.every((n) => n.snap)) return;
    // Some nights there are locked already (a night added or moved in later): the newcomers get the period's own
    // snapshot, so its fixed deductions and non-taxable money (periodSnap) stay what they were.
    const have = periodSnap(list);
    if (have) return snaps.set(idx, have);
    const shifts = base.source === 'default' ? shiftsPerPeriod(profile, nights, today, idx, index).n : base.n;
    snaps.set(idx, snapshotFor(profile, shifts));
  });
  if (!snaps.size) return { nights, stamped: 0 };
  let stamped = 0;
  const out = nights.map((n) => {
    if (n.snap) return n;
    const s = snaps.get(nightPeriodIndex(profile, n)); // a night locks when the period it counts toward ends
    if (!s) return n;
    stamped++;
    const locked = { ...n, snap: JSON.parse(JSON.stringify(s)) };
    // Typed tips: the stored total becomes tips + pay at the rates it is now locked with (the rates it was shown with).
    if (hasTips(n)) locked.total = totalFromTips(n.tips, locked, profile);
    return locked;
  });
  return { nights: out, stamped };
}
/** The numbers one night is worked out with: its snapshot when locked, else the current Setup. */
function termsOf(night, p, shifts) {
  const s = night && night.snap;
  if (s)
    return {
      r: s.r,
      rf: s.rf,
      fixed: s.fixed,
      nontax: num(s.nontax), // older snapshots have none
      n: s.n,
      payTypes: s.pay || [],
      tipout: s.tipout || { on: false },
    };
  return {
    r: rate(p),
    rf: fedRate(p),
    fixed: fixedTotal(p),
    nontax: nontaxRecurring(p),
    payTypes: p.payTypes || [],
    tipout: p.tipout || { on: false },
    n: shifts > 0 ? shifts : shiftsPerPeriod(p, [], todayISO()).n,
  };
}
/**
 * The snapshot a pay period's check is worked out with (its fixed deductions and recurring non-taxable money): the
 * newest locked night's in ns (oldest first, as nightsInPeriod returns them), else null. Every way a night is locked
 * INTO a period that already has locked nights (lockFinishedNights, a move in the night editor) copies this snapshot,
 * so adding a night to a finished period never changes what the period's check carries.
 */
export function periodSnap(ns) {
  for (let i = ns.length - 1; i >= 0; i--) if (ns[i] && ns[i].snap) return ns[i].snap;
  return null;
}
/** Fixed deductions a period's check carries: from its snapshot (periodSnap), else the current Setup. */
export function periodFixed(p, ns) {
  const s = periodSnap(ns);
  return s ? s.fixed : fixedTotal(p);
}
/** Recurring non-taxable money a period's check carries: from its snapshot (periodSnap), else the current Setup. */
export function periodNontax(p, ns) {
  const s = periodSnap(ns);
  return s ? num(s.nontax) : nontaxRecurring(p);
}

/* ---------- one night (6.4) ---------- */
/**
 * Amount for a pay type on a night. Old nights (saved before every amount was stored) fall back to the main type's
 * usual amount; a night with typed tips never does (it was saved with its pay, and an empty pay means none).
 */
export function payAmount(night, t, i) {
  if (night.pay && night.pay[t.id] !== undefined && night.pay[t.id] !== '' && night.pay[t.id] !== null)
    return num(night.pay[t.id]);
  return i === 0 && !hasTips(night) ? num(t.usual) : 0;
}
/** Pay from pay types for one night (uses the night's snapshot when it has one). */
export function basePay(night, p) {
  return basePayWith(night, termsOf(night, p, 1));
}
/**
 * Tips-only entry: the stored total for a night where `tips` (cash + card) was typed. Adds the hourly and per-shift pay for
 * the night's amounts (its snapshot's rates when it has one), rounded to cents exactly as computeNight rounds base pay.
 * Flat "(on top)" amounts are not part of total, as always.
 */
export const totalFromTips = (tips, night, p) =>
  fromCents(toCents(num(tips)) + toCents(basePay(night, p).pay));
/**
 * night.tips: the tips typed in tips mode (saved next to total). An UNLOCKED night with tips follows the current pay
 * rates: its total is tips + today's base pay, so fixing a rate in Setup never turns tips into wages. A locked night
 * (snap) keeps its stored total. Nights without tips (typed as totals, imported, older saves) use total as always.
 */
export const hasTips = (night) =>
  !!night && typeof night.tips === 'number' && Number.isFinite(night.tips) && night.tips >= 0;
/** Everything made on a night (tips + hourly/per-shift pay), as the math uses it. */
export const nightTotal = (night, p) =>
  !night.snap && hasTips(night) ? totalFromTips(night.tips, night, p) : num(night.total);
/** The reverse: the tips inside a night's total (can be below 0 for an old night typed below its hourly pay). */
export const tipsFromTotal = (night, p) =>
  !night.snap && hasTips(night)
    ? night.tips
    : fromCents(toCents(num(night.total)) - toCents(basePay(night, p).pay));
function basePayWith(night, T) {
  let pay = 0,
    hours = 0,
    extra = 0,
    extraTax = 0,
    nontax = 0;
  const r = T.r,
    rs = Math.max(0, T.r - T.rf) + 0.22; // supplemental rate (6.5)
  T.payTypes.forEach((t, i) => {
    const a = payAmount(night, t, i);
    // a non-taxable amount (a reimbursement for that night): no withholding, not tips, not wages
    if (t.unit === 'amt' && t.nontax) nontax += Math.max(0, a);
    else if (t.unit === 'amt') {
      extra += a;
      extraTax += a * (t.supp ? rs : r);
    } else {
      pay += a * num(t.rate);
      if (t.unit === 'hr' && t.k !== 'diff' && !t.diff) hours += a;
    }
  });
  return { pay, hours, extra, extraTax, nontax };
}
/**
 * computeNight(night, profile, shifts)
 * shifts: number of shifts to spread fixed deductions over (use shiftsPerPeriod().n).
 * A locked night (night.snap) uses its snapshot's rates, pay types, tip-out, fixed total and shift count instead.
 * Returns dollars rounded to cents:
 * {total, basePay, hours, extra, extraTax, tips, tipout, kept, tax, fixedPerShift, net,
 *  fromCash, cashInHand (null if no cash entered), onCheck (null), fedOnTips, r, locked,
 *  cashOffPayroll (true when the night is marked and cash is entered), cashTipsKept, taxOnCashToSetAside}
 * night.cashOffPayroll: the cash tips were not run through payroll, so no withholding was taken out of them. Payroll
 * withholding then applies to (kept - cashTipsKept); cashTipsKept is the cash in hand, never more than the tips kept
 * (hourly wages are always taxed). taxOnCashToSetAside = cashTipsKept x r: an estimate of what to put aside.
 */
export function computeNight(night, p, shifts) {
  const T = termsOf(night, p, shifts);
  const n = T.n > 0 ? T.n : 1;
  const r = T.r;
  const bp = basePayWith(night, T);
  const total = toCents(nightTotal(night, p));
  const baseC = toCents(bp.pay);
  const extraC = toCents(bp.extra);
  const tipsC = Math.max(0, total - baseC);
  const to = T.tipout;
  const useTO = !!(to.on && night.barback && to.basis === 'before');
  let tipoutC = 0;
  if (useTO) {
    tipoutC = to.mode === 'pct' ? toCents(((tipsC / 100) * num(to.value)) / 100) : toCents(num(to.value));
    tipoutC = Math.min(tipoutC, tipsC);
  }
  const keptC = total - tipoutC;
  const extraTaxC = toCents(bp.extraTax);
  let fromCashC = 0,
    cashInHandC = null,
    cashKeptC = 0;
  const hasCash = night.cash !== '' && night.cash != null && Number.isFinite(parseFloat(night.cash));
  if (hasCash) {
    const c = toCents(num(night.cash));
    fromCashC = useTO && to.from === 'cash' ? Math.min(c, tipoutC) : 0;
    cashInHandC = c - fromCashC;
    // cash not run through payroll: never more than the tips kept, so hourly wages are always taxed
    if (night.cashOffPayroll) cashKeptC = Math.max(0, Math.min(cashInHandC, tipsC - tipoutC));
  }
  const taxC = toCents(((keptC - cashKeptC) / 100) * r) + extraTaxC;
  const fixedC = toCents(T.fixed / n);
  // non-taxable money: the night's own amounts, plus its share of what comes with every check (spread like fixed deductions)
  const nontaxC = toCents(bp.nontax);
  const nontaxShareC = toCents(num(T.nontax) / n);
  const netC = keptC + extraC + nontaxC + nontaxShareC - taxC - fixedC;
  // federal tax on tips that was actually withheld (none on cash that skipped payroll)
  const fedOnTipsC = toCents((Math.max(0, tipsC - tipoutC - cashKeptC) / 100) * T.rf);
  const onCheckC = hasCash ? netC - cashInHandC : null;
  const d = fromCents;
  return {
    total: d(total),
    basePay: d(baseC),
    hours: bp.hours,
    extra: d(extraC),
    extraTax: d(extraTaxC),
    tips: d(tipsC),
    tipout: d(tipoutC),
    kept: d(keptC),
    tax: d(taxC),
    fixedPerShift: d(fixedC),
    nontax: d(nontaxC),
    nontaxPerShift: d(nontaxShareC),
    net: d(netC),
    fromCash: d(fromCashC),
    cashInHand: cashInHandC == null ? null : d(cashInHandC),
    onCheck: onCheckC == null ? null : d(onCheckC),
    fedOnTips: d(fedOnTipsC),
    cashOffPayroll: hasCash && !!night.cashOffPayroll,
    cashTipsKept: d(cashKeptC),
    taxOnCashToSetAside: d(toCents((cashKeptC / 100) * r)),
    r,
    locked: !!night.snap,
  };
}

/* ---------- period totals (6.6) ---------- */
/**
 * periodTotals(profile, nights, idx, today?, shifts?, index?) ->  (index: optional indexNights() result, for speed)
 * {ns, net, hrs, chk, kept, cash, setAside (taxes to set aside on cash that skipped payroll), allCash, exact}
 * When the period is final and has nights, the sum of per-shift fixed shares is replaced by the
 * exact fixed total (applied to net and expected check). Locked nights use their own snapshot, and the exact
 * total then comes from the period's snapshots (periodFixed), so a later Setup change leaves the period as it was.
 */
export function periodTotals(p, nights, idx, today = todayISO(), shifts, index) {
  const ns = nightsInPeriod(p, nights, idx, index);
  const n = shifts > 0 ? shifts : shiftsPerPeriod(p, nights, today, idx, index).n;
  let net = 0,
    hrs = 0,
    chk = 0,
    kept = 0,
    cash = 0,
    setAside = 0,
    fixedShares = 0,
    nontaxShares = 0,
    allCash = ns.length > 0;
  ns.forEach((night) => {
    const c = computeNight(night, p, n);
    net += toCents(c.net);
    hrs += c.hours;
    kept += toCents(c.kept);
    fixedShares += toCents(c.fixedPerShift);
    nontaxShares += toCents(c.nontaxPerShift);
    setAside += toCents(c.taxOnCashToSetAside);
    if (c.onCheck == null) allCash = false;
    else {
      chk += toCents(c.onCheck);
      cash += toCents(c.cashInHand);
    }
  });
  const exact = ns.length > 0 && isFinal(p, idx, today);
  if (exact) {
    // and the per-shift shares of recurring non-taxable money by the exact amount on that check
    const adj = fixedShares - toCents(periodFixed(p, ns)) + toCents(periodNontax(p, ns)) - nontaxShares;
    net += adj;
    chk += adj;
  }
  return {
    ns,
    net: fromCents(net),
    hrs,
    chk: fromCents(chk),
    kept: fromCents(kept),
    cash: fromCents(cash),
    setAside: fromCents(setAside),
    allCash,
    exact,
  };
}

/* ---------- calibration (6.7) ---------- */
/** One "Check my accuracy" run never moves the tax rate more than this (3 percentage points). */
export const MAX_RATE_STEP = 0.03;
/** An error bigger than this (25%) usually means a missing night or a mistyped check amount. */
export const SUSPECT_ERROR = 0.25;
/** A prediction within this (0.5%) of the check already matches: calibrate proposes no change. */
export const MATCH_ERROR = 0.005;
/** ...and only when the rate that check implies is within this (0.05 points) of the rate it would change. */
export const MATCH_RATE = 0.0005;
/**
 * calibrate(profile, nights, idx, actual, today?, shifts?)
 * Does not mutate. Returns {ok:false, reason:'nonights'|'noactual'|'notFinal'|'missingCash', missingCash}
 * or {ok:true, pred, actual, err, rNew, rOld, rateOverride, uncapped, capped, change,
 *     nightsLogged, expectedShifts, expectedSource, missingNights, suspect, T, C, F}.
 *   rNew: the rate the check implies, within 0..MAX_RATE (always computed). matched: |err| < MATCH_ERROR and
 *   |rNew - rOld| < MATCH_RATE, and then nothing moves (uncapped = rateOverride = rOld, change 0). Both are needed:
 *   the prediction uses the nights' locked rates, so a check can match it while implying a rate other than rOld.
 *   rOld: the current rate. uncapped: (rOld + rNew) / 2. rateOverride: that, kept within MAX_RATE_STEP of rOld (capped says so).
 *   expectedShifts: the entered shift count if set, else the period's expected count (shiftsPerPeriod); missingNights is
 *   how many fewer nights were logged than that (0 if none). suspect: |err| > SUSPECT_ERROR.
 * Nothing is applied here: the screen shows old -> new and asks first. On "Apply", the caller stores
 * {label, pred, actual, err} in calib and sets profile.rateOverride = rateOverride (which only moves unlocked nights).
 */
export function calibrate(p, nights, idx, actual, today = todayISO(), shifts, rateBase) {
  const ns = nightsInPeriod(p, nights, idx);
  const A = num(actual);
  if (!ns.length) return { ok: false, reason: 'nonights', missingCash: 0 };
  if (!(A > 0)) return { ok: false, reason: 'noactual', missingCash: 0 };
  // A paycheck only exists for a finished pay period; comparing a half-worked one would drag the tax rate down.
  if (!isFinal(p, idx, today)) return { ok: false, reason: 'notFinal', missingCash: 0 };
  // The expected count must not include the period being checked: a missed night would pull its own average down.
  const others = nights.filter((n) => nightPeriodIndex(p, n) !== idx);
  const sp = shifts > 0 ? { n: shifts, source: 'entered' } : shiftsPerPeriod(p, others, today, idx);
  const n = sp.n;
  // same test computeNight uses, so junk like "abc" counts as missing instead of silently being $0
  const cs = ns.map((night) => computeNight(night, p, n));
  const missing = cs.filter((c) => c.cashInHand == null).length;
  if (missing) return { ok: false, reason: 'missingCash', missingCash: missing };
  let T = 0,
    Tt = 0,
    C = 0,
    N = 0,
    predC = 0;
  cs.forEach((c) => {
    T += toCents(c.kept) + toCents(c.extra); // non-taxable money is not in here: it is never taxed
    Tt += toCents(c.kept) + toCents(c.extra) - toCents(c.cashTipsKept); // the part payroll really taxed
    C += toCents(c.cashInHand);
    N += toCents(c.nontax); // the nights' own non-taxable amounts
    predC += toCents(c.onCheck) + toCents(c.fixedPerShift) - toCents(c.nontaxPerShift);
  });
  const F = toCents(periodFixed(p, ns));
  const NR = toCents(periodNontax(p, ns)); // recurring non-taxable money on that check, exactly
  predC += NR - F;
  N += NR;
  const pred = fromCents(predC);
  const err = (pred - A) / A;
  const rOld = typeof rateBase === 'number' && Number.isFinite(rateBase) ? rateBase : rate(p); // rateBase: the rate in effect before this period was first adjusted (Replace)
  // The rate the check implies, always computed: pred uses the nights' locked rates, not rOld.
  const rNew =
    Tt > 0
      ? clampRate((fromCents(T) - (A + fromCents(F) + fromCents(C) - fromCents(N))) / fromCents(Tt))
      : rOld;
  // matched: the estimate already matches AND the check implies the rate it would change, so nothing to adjust
  const matched = Math.abs(err) < MATCH_ERROR && Math.abs(rNew - rOld) < MATCH_RATE;
  const uncapped = matched ? rOld : (rOld + rNew) / 2; // blend to avoid overreacting to one check
  const rateOverride = matched
    ? rOld
    : clampRate(Math.min(rOld + MAX_RATE_STEP, Math.max(rOld - MAX_RATE_STEP, uncapped)));
  const expectedShifts = Math.max(1, Math.round(n));
  return {
    ok: true,
    pred,
    actual: A,
    err,
    matched,
    rNew,
    rOld,
    rateOverride,
    uncapped,
    capped: Math.abs(uncapped - rateOverride) > 1e-12,
    change: rateOverride - rOld,
    nightsLogged: ns.length,
    expectedShifts,
    expectedSource: sp.source,
    missingNights: Math.max(0, expectedShifts - ns.length),
    suspect: Math.abs(err) > SUSPECT_ERROR,
    T: fromCents(T),
    C: fromCents(C),
    F: fromCents(F),
  };
}

/* ---------- weekly hours for the overtime nudge (7.1) ---------- */
/**
 * Hours logged Monday-Sunday for the week containing dateISO. By the dates worked, never by the pay period a night
 * counts toward (night.periodStart): overtime is counted by the calendar week the hours were worked.
 */
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
  const r = rate(p),
    si = shiftsPerPeriod(p, nights, today),
    fixed = fixedTotal(p);
  return {
    r,
    taxPer100: round2(100 * r),
    keepPer100: round2(100 * (1 - r)),
    fixed,
    fixedPerShift: round2(fixed / si.n),
    nontax: round2(nontaxRecurring(p)),
    nontaxOnStub: round2(nontaxOnStub(p)),
    taxableGross: round2(taxableGross(p)),
    shifts: si.n,
    shiftSource: si.source,
    shiftSourceText: SHIFT_SOURCE_TEXT[si.source],
    periodLength: periodLength(p, Number.isFinite(parseISO(p.periodStart)) ? periodIndex(p, today) : 0),
    calendar: calendarMode(p),
    fromDates: lengthFromDates(p),
    adjusted: p.rateOverride != null,
  };
}

/* ---------- presets (5.4, 5.5) ---------- */
/*
 * Pay presets come in two kinds (see payKind below):
 *   job:   a job you clock in as, paid per hour or per shift. Tonight asks which job(s) you worked and for how long.
 *   other: extra pay: overtime/holiday/differential/PTO hours, or flat amounts like a bonus (added on top).
 * g is the group shown in the Setup dropdown.
 */
export const PAY_PRESETS = [
  { k: 'bartender', name: 'Bartender', unit: 'hr', kind: 'job', g: 'Jobs' },
  { k: 'server', name: 'Server', unit: 'hr', kind: 'job', g: 'Jobs' },
  { k: 'barback', name: 'Barback', unit: 'hr', kind: 'job', g: 'Jobs' },
  { k: 'lead', name: 'Supervisor / shift lead', unit: 'hr', kind: 'job', g: 'Jobs' },
  { k: 'prep', name: 'Prep', unit: 'hr', kind: 'job', g: 'Jobs' },
  { k: 'training', name: 'Training', unit: 'hr', kind: 'job', g: 'Jobs' },
  { k: 'host', name: 'Host', unit: 'hr', kind: 'job', g: 'Jobs' },
  { k: 'event', name: 'Private event / banquet', unit: 'shift', kind: 'job', g: 'Jobs' },
  { k: 'otherjob', name: 'Other job', unit: 'hr', kind: 'job', g: 'Jobs' },
  { k: 'hourly', name: 'Hourly', unit: 'hr', kind: 'job', g: 'General pay' },
  { k: 'shift', name: 'Flat shift pay', unit: 'shift', kind: 'job', g: 'General pay' },
  {
    k: 'ot',
    name: 'Overtime',
    unit: 'hr',
    kind: 'other',
    g: 'Extra hours',
    rateMultiplier: 1.5,
    notes: 'Overtime is usually 1.5x your main job’s rate for hours past 40 in a week.',
  },
  { k: 'holiday', name: 'Holiday pay', unit: 'hr', kind: 'other', g: 'Extra hours' },
  {
    k: 'diff',
    name: 'Shift lead / supervisor differential',
    unit: 'hr',
    kind: 'other',
    g: 'Extra hours',
    diff: 1,
    notes:
      'Enter the extra per hour on top of your base rate. These hours do not count twice toward your hours worked.',
  },
  { k: 'pto', name: 'Paid time off / sick pay', unit: 'hr', kind: 'other', g: 'Extra hours' },
  {
    k: 'bonus',
    name: 'Bonus',
    unit: 'amt',
    supp: 1,
    kind: 'other',
    g: 'On top',
    notes: 'Federal tax is estimated at the 22% bonus rate.',
  },
  {
    k: 'commission',
    name: 'Commission / sales incentive',
    unit: 'amt',
    supp: 1,
    kind: 'other',
    g: 'On top',
    notes: 'Federal tax is estimated at the 22% bonus rate.',
  },
  {
    k: 'autograt',
    name: 'Service charge / auto-gratuity',
    unit: 'amt',
    kind: 'other',
    g: 'On top',
    notes:
      'Auto-gratuities are taxed as wages, not tips, so they do not count toward the federal tip deduction.',
  },
  { k: 'other', name: 'Other', unit: 'amt', kind: 'other', g: 'On top' },
  // Non-taxable amounts for one night (a reimbursement): added to the check with no tax; not tips, not wages.
  ...[
    ['ntexpense', 'Expense reimbursement'],
    ['ntmileage', 'Mileage reimbursement'],
    ['ntuniform', 'Uniform / tool allowance'],
    ['ntmeal', 'Meal allowance / per diem'],
    ['ntother', 'Other non-taxable'],
  ].map(([k, name]) => ({
    k,
    name,
    unit: 'amt',
    nontax: 1,
    kind: 'other',
    g: 'Non-taxable',
    notes: 'Added to your check without tax. It doesn’t count as tips or wages.',
  })),
];
/** Non-taxable earnings on a paystub (Setup), the same kinds. "other" asks for a name. */
export const NONTAX_PRESETS = [
  { k: 'expense', name: 'Expense reimbursement' },
  { k: 'mileage', name: 'Mileage reimbursement' },
  { k: 'uniform', name: 'Uniform / tool allowance' },
  { k: 'meal', name: 'Meal allowance / per diem' },
  { k: 'other', name: 'Other non-taxable' },
];
export const findNontaxPreset = (k) => NONTAX_PRESETS.find((x) => x.k === k);
/** Presets that pay for extra hours on top of a job: never a job, whatever their unit. */
const EXTRA_HOUR_KEYS = ['ot', 'holiday', 'diff', 'pto'];
/**
 * 'job' or 'other' for pay type t at position i of profile.payTypes. Nothing extra is stored: the kind follows from the
 * data, so old profiles need no migration. The first pay type is always the main job. Otherwise per-hour and per-shift
 * pay is a job unless its preset is overtime, holiday, differential or paid time off; a flat amount is always other pay.
 */
export function payKind(t, i) {
  if (i === 0) return 'job';
  if (!t || t.unit === 'amt') return 'other';
  if (EXTRA_HOUR_KEYS.includes(t.k) || t.diff) return 'other';
  return 'job';
}
/** The jobs in a profile, main job first. */
export const jobsOf = (p) => ((p && p.payTypes) || []).filter((t, i) => payKind(t, i) === 'job');
/** Everything else: overtime/holiday/differential/PTO hours and flat amounts. */
export const otherPayOf = (p) => ((p && p.payTypes) || []).filter((t, i) => payKind(t, i) === 'other');
export const JOB_PRESETS = PAY_PRESETS.filter((x) => x.kind === 'job');
export const OTHER_PAY_PRESETS = PAY_PRESETS.filter((x) => x.kind === 'other');
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
  const blankName = pr.k === 'other' || pr.k === 'otherjob' || pr.k === 'ntother';
  const out = { ...t, k: pr.k, name: blankName ? '' : pr.name, unit: pr.unit, supp: pr.supp ? 1 : 0 };
  if (pr.nontax) out.nontax = 1;
  else delete out.nontax;
  if (pr.rateMultiplier && mainRate) out.rate = +(num(mainRate) * pr.rateMultiplier).toFixed(2);
  if (pr.unit === 'amt') {
    out.rate = 0;
    out.usual = 0;
  }
  return out;
}
/** Social Security and Medicare from gross (6.2% and 1.45%). Returns a new deductions array. */
export function fillFica(p) {
  const g = num(p.gross);
  const deds = (p.deductions || []).map((d) => ({ ...d }));
  [
    ['ss', 'Social Security', 0.062],
    ['med', 'Medicare', 0.0145],
  ].forEach(([k, name, r], i) => {
    let d = deds.find((x) => x.k === k);
    if (!d) {
      d = { id: 'd' + Date.now() + i, k, name, mode: 'pct' };
      deds.push(d);
    }
    d.amount = +(g * r).toFixed(2);
  });
  return deds;
}

/* ---------- example profile and nights (5.8) ---------- */
// Built around "today" so the example always shows a live pay period: it started 7 days ago (a 14-day period),
// and the four nights sit at 7, 4, 2 and 1 days ago. Pass a fixed date in tests.
const EXAMPLE_DEDUCTIONS = [
  { id: 'd1', k: 'fed', name: 'Federal income tax', amount: 180, mode: 'pct' },
  { id: 'd2', k: 'ss', name: 'Social Security', amount: 124, mode: 'pct' },
  { id: 'd3', k: 'med', name: 'Medicare', amount: 29, mode: 'pct' },
  { id: 'd4', k: 'health', name: 'Health insurance', amount: 60, mode: 'fixed' },
];
const EXAMPLE_PAY_TYPES = [
  { id: 'p1', k: 'bartender', name: 'Bartender', rate: 12, unit: 'hr', usual: 7 },
  { id: 'p2', k: 'training', name: 'Training', rate: 15, unit: 'hr', usual: 0 },
  { id: 'p3', k: 'bonus', name: 'Bonus', rate: 0, unit: 'amt', usual: 0, supp: 1 },
];
const clone = (o) => JSON.parse(JSON.stringify(o));
/** Fresh example profile whose pay period contains `today`. */
export function exampleProfile(today = todayISO()) {
  const start = addDays(today, -7);
  return {
    freq: 14,
    periodStart: start,
    periodEnd: addDays(start, 13),
    shifts: 10,
    gross: 2000,
    rateOverride: null,
    deductions: clone(EXAMPLE_DEDUCTIONS),
    payTypes: clone(EXAMPLE_PAY_TYPES),
    tipout: { on: true, mode: 'pct', value: 15, basis: 'before', from: 'cash' },
  };
}
/** Fresh example nights in the last week (the night of $585, 8 hours, $210 cash was 2 days ago). */
export function exampleNights(today = todayISO()) {
  const day = (ago) => addDays(today, -ago);
  return [
    { id: 1, date: day(7), total: 310, cash: 90, pay: { p1: 6 }, barback: true },
    { id: 2, date: day(4), total: 420, cash: 140, pay: { p1: 7 }, barback: true },
    { id: 3, date: day(2), total: 585, cash: 210, pay: { p1: 8 }, barback: true },
    { id: 4, date: day(1), total: 365, cash: 100, pay: { p1: 5, p2: 2 }, barback: false },
  ];
}
