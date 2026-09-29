// TipNet budgeting math. Pure functions only: no DOM, no storage, no globals.
// Money is added up in whole cents so totals never drift. Dates are "YYYY-MM-DD" strings.
//
// Data shape (lives at state.budget):
//   bills:      [{id, name, amount, dueDay (1-31), category?}]   a bill that repeats every month
//   categories: [{id, name, monthly}]                            a monthly spending limit
//   goals:      [{id, name, target, saved, perPaycheck}]         something you are saving toward
//   spends:     [{id, date, amount, categoryId, note?}]          money spent, logged by the user
//   paidBills:  {"<periodIndex>:<billId>": true}                 bills already paid in a pay period
// Everything here is an estimate. It is a planning aid, not financial advice.
import {
  num, toCents, fromCents, round2, parseISO, addDays, dayDiff,
  periodIndex, periodRange, isFinal, periodTotals, shiftsPerPeriod, todayISO,
} from './math.js';

/* ---------- small helpers ---------- */
const pad = (n) => String(n).padStart(2, '0');
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12
const cents = (v) => Math.max(0, toCents(num(v)));
const sumC = (arr, f) => arr.reduce((s, x) => s + f(x), 0);

/* ---------- shape ---------- */
export function emptyBudget() {
  return { bills: [], categories: [], goals: [], spends: [], paidBills: {} };
}
/** A realistic example for a bartender. Fresh copy each call. */
export function exampleBudget() {
  return {
    bills: [
      { id: 'b1', name: 'Rent', amount: 1200, dueDay: 1, category: 'Housing' },
      { id: 'b2', name: 'Phone', amount: 65, dueDay: 15, category: 'Utilities' },
      { id: 'b3', name: 'Car insurance', amount: 140, dueDay: 20, category: 'Transport' },
    ],
    categories: [
      { id: 'c1', name: 'Groceries', monthly: 400 },
      { id: 'c2', name: 'Gas', monthly: 160 },
      { id: 'c3', name: 'Fun', monthly: 150 },
    ],
    goals: [{ id: 'g1', name: 'Emergency fund', target: 1000, saved: 250, perPaycheck: 40 }],
    spends: [],
    paidBills: {},
  };
}

/** Tolerant normalizer: anything in, a valid budget out. Never throws. */
export function migrateBudget(x) {
  const out = emptyBudget();
  if (!x || typeof x !== 'object') return out;
  const list = (v) => (Array.isArray(v) ? v.filter((i) => i && typeof i === 'object') : []);
  const text = (v, d) => (typeof v === 'string' && v.trim() ? v.trim() : d);
  const money = (v) => fromCents(cents(v));
  const id = (v, prefix, i) => (v !== undefined && v !== null && String(v) !== '' ? String(v) : prefix + (i + 1));
  out.bills = list(x.bills).map((b, i) => {
    const day = Math.round(num(b.dueDay));
    const bill = { id: id(b.id, 'b', i), name: text(b.name, 'Bill'), amount: money(b.amount), dueDay: Math.min(31, Math.max(1, day || 1)) };
    if (typeof b.category === 'string' && b.category) bill.category = b.category;
    return bill;
  });
  out.categories = list(x.categories).map((c, i) => ({ id: id(c.id, 'c', i), name: text(c.name, 'Category'), monthly: money(c.monthly) }));
  out.goals = list(x.goals).map((g, i) => ({
    id: id(g.id, 'g', i), name: text(g.name, 'Goal'), target: money(g.target), saved: money(g.saved), perPaycheck: money(g.perPaycheck),
  }));
  out.spends = list(x.spends).filter((s) => Number.isFinite(parseISO(s.date))).map((s, i) => {
    const sp = { id: id(s.id, 's', i), date: s.date, amount: money(s.amount), categoryId: s.categoryId == null ? '' : String(s.categoryId) };
    if (typeof s.note === 'string' && s.note) sp.note = s.note;
    return sp;
  });
  if (x.paidBills && typeof x.paidBills === 'object' && !Array.isArray(x.paidBills)) {
    Object.keys(x.paidBills).forEach((k) => { if (x.paidBills[k] === true) out.paidBills[k] = true; });
  }
  return out;
}

/* ---------- paydays and bills ---------- */
/** Days after a pay period ends that the check arrives: whole number 0-21. Unset/blank/garbage = 1 (day after). */
export function payDelayOf(profile) {
  const v = profile && profile.payDelay;
  if (v === undefined || v === null || v === '' || !Number.isFinite(Number(v))) return 1;
  return Math.min(21, Math.max(0, Math.round(Number(v))));
}
/** True when the profile has a payDelay the user actually set. */
export const hasPayDelay = (profile) => !!profile && profile.payDelay !== undefined && profile.payDelay !== null && profile.payDelay !== '' && Number.isFinite(Number(profile.payDelay));

/**
 * The next payday is the first pay date after today. A period's check arrives payDelay days after it ends,
 * so between a period's end and its payday the next payday belongs to that finished period.
 * paydayInfo returns {date, daysAway, periodIndex (the period this check pays for), periodStart, periodEnd}.
 */
export function paydayInfo(profile, today = todayISO()) {
  const delay = payDelayOf(profile);
  const idx = periodIndex(profile, today);
  for (let k = idx - 4; ; k++) {
    const r = periodRange(profile, k);
    const date = addDays(r.end, delay);
    if (date > today) return { date, daysAway: dayDiff(today, date), periodIndex: k, periodStart: r.start, periodEnd: r.end };
  }
}
/** {date, daysAway} of the next payday. */
export function nextPayday(profile, today = todayISO()) {
  const { date, daysAway } = paydayInfo(profile, today);
  return { date, daysAway };
}

/**
 * Bills whose due date falls in [fromDate, toDate], oldest first.
 * A bill due on the 31st is due on the last day of shorter months (Feb 28/29, Apr 30...).
 * Returns [{id, name, amount, category?, dueDay, date}].
 */
export function billsDue(budget, fromDate, toDate) {
  const from = parseISO(fromDate), to = parseISO(toDate);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return [];
  const a = new Date(from), b = new Date(to);
  let y = a.getUTCFullYear(), m = a.getUTCMonth() + 1;
  const endY = b.getUTCFullYear(), endM = b.getUTCMonth() + 1;
  const found = [];
  while (y < endY || (y === endY && m <= endM)) {
    const last = daysInMonth(y, m);
    (budget.bills || []).forEach((bill) => {
      const day = Math.min(Math.max(1, Math.round(num(bill.dueDay)) || 1), last);
      const date = y + '-' + pad(m) + '-' + pad(day);
      if (date >= fromDate && date <= toDate) found.push({ ...bill, date });
    });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return found.sort((p, q) => (p.date < q.date ? -1 : p.date > q.date ? 1 : 0));
}

/* ---------- income ---------- */
const hasCash = (n) => n.cash !== '' && n.cash != null && Number.isFinite(parseFloat(n.cash));
/**
 * What TipNet expects you to bring in for the current pay period. All estimates.
 * {cashSoFar: cash in hand this period, checkSoFar: on-check estimate so far (nights with cash entered),
 *  projectedCheck: estimated check if you work your expected shifts, or null when TipNet cannot tell yet,
 *  avgCheckPerPeriod: average check from finished periods where every night has cash entered, or null,
 *  avgTakeHomePerPeriod: from finished periods or null}
 * The check can only be worked out for nights with cash entered (check = take-home - cash in hand), so the
 * projection scales from those nights only. With none this period it falls back to the average past check.
 */
export function expectedIncome(profile, nights, today = todayISO()) {
  const idx = periodIndex(profile, today);
  const t = periodTotals(profile, nights, idx, today);
  const expected = shiftsPerPeriod(profile, nights, today).n;
  const done = [...new Set(nights.map((n) => periodIndex(profile, n.date)))].filter((i) => isFinal(profile, i, today));
  const past = done.map((i) => periodTotals(profile, nights, i, today));
  const mean = (list, f) => (list.length ? fromCents(Math.round(list.reduce((s, x) => s + toCents(f(x)), 0) / list.length)) : null);
  const avg = mean(past, (x) => x.net);
  const avgChk = mean(past.filter((x) => x.allCash), (x) => x.chk);
  const withCash = t.ns.filter(hasCash).length;
  let projected;
  // never scale down what is already earned
  if (withCash > 0) projected = round2(t.chk * Math.max(1, Math.max(expected, t.ns.length) / withCash));
  else projected = avgChk;
  return { cashSoFar: t.cash, checkSoFar: t.chk, projectedCheck: projected, avgCheckPerPeriod: avgChk, avgTakeHomePerPeriod: avg };
}

/* ---------- categories and goals ---------- */
/** Spending per category for a month ("YYYY-MM"): [{id, name, monthly, spent, remaining, pct}]. pct may pass 100. */
export function categoryStatus(budget, month) {
  return (budget.categories || []).map((c) => {
    const spentC = (budget.spends || [])
      .filter((s) => s.categoryId === c.id && String(s.date).slice(0, 7) === month)
      .reduce((sum, s) => sum + toCents(num(s.amount)), 0);
    const monthlyC = toCents(num(c.monthly));
    return {
      id: c.id, name: c.name, monthly: fromCents(monthlyC), spent: fromCents(spentC), remaining: fromCents(monthlyC - spentC),
      pct: monthlyC > 0 ? Math.round((spentC / monthlyC) * 100) : (spentC > 0 ? 100 : 0),
    };
  });
}
/** {pct (0-100), remaining, paychecksToGo (null if perPaycheck is 0 and goal not met)}. */
export function goalProgress(goal) {
  const targetC = toCents(num(goal.target)), savedC = toCents(num(goal.saved)), per = toCents(num(goal.perPaycheck));
  const remC = Math.max(0, targetC - savedC);
  const pct = targetC > 0 ? Math.min(100, Math.floor((savedC / targetC) * 100)) : 0;
  const paychecksToGo = remC === 0 ? 0 : per > 0 ? Math.ceil(remC / per) : null;
  return { pct, remaining: fromCents(remC), paychecksToGo };
}

/* ---------- safe to spend ---------- */
/** Money set aside for goals this paycheck (never more than a goal still needs), in cents. */
function goalPieces(budget) {
  return (budget.goals || []).map((g) => {
    const remC = Math.max(0, toCents(num(g.target)) - toCents(num(g.saved)));
    return { id: g.id, name: g.name, amountC: Math.min(Math.max(0, toCents(num(g.perPaycheck))), remC) };
  });
}

/**
 * How much you can spend before your next payday, with every piece shown so the UI can explain it.
 * options.cashOnHand: cash you actually have (overrides the cash TipNet adds up from your nights).
 * Money from the check is NOT counted until payday. Category money left is pro-rated:
 * (left in category) x (days until payday / days left in the month, capped at 1).
 * Bills are matched to the pay period their due date lands in, so paidBills keys are "<periodIndex>:<billId>".
 * Returns {payday, daysAway, income:{source:'entered'|'cash', amount, cash, spent (logged this period, 'cash' only)}, bills:[...], billsTotal,
 *  goals:[{id,name,amount}], goalsTotal, categories:[{id,name,remaining,reserved}], categoriesTotal,
 *  safe (can be negative), perDay,
 *  (payday = first pay date after today; bills counted are unpaid ones due up to the day before it)
 *  after:{projectedCheck (null if unknown), bills, billsTotal, goalsTotal, left, periodStart, periodEnd}}
 */
export function safeToSpend(budget, profile, nights, today = todayISO(), options = {}) {
  const idx = periodIndex(profile, today);
  const range = periodRange(profile, idx);
  const np = paydayInfo(profile, today);
  const { date: payday, daysAway } = np;
  const delay = payDelayOf(profile);
  const inc = expectedIncome(profile, nights, today);
  const co = options.cashOnHand;
  const entered = co !== undefined && co !== null && co !== '' && Number.isFinite(parseFloat(co));
  // Without an entered balance: cash tips this period, minus what you logged spending this period
  // (that money is gone, and it already counts against its category below).
  const spentC = entered ? 0 : sumC((budget.spends || []).filter((s) => s.date >= range.start && s.date <= today), (s) => toCents(num(s.amount)));
  const cashC = entered ? toCents(num(co)) : toCents(inc.cashSoFar);
  const incomeC = cashC - spentC;

  // Unpaid bills in a date range. Earlier unpaid bills in this period still count: you still owe them.
  const paid = budget.paidBills || {};
  const unpaid = (from, to) => billsDue(budget, from, to).filter((b) => !paid[periodIndex(profile, b.date) + ':' + b.id]);
  const bills = unpaid(range.start, addDays(payday, -1));
  const billsC = sumC(bills, (b) => toCents(num(b.amount)));

  const goals = goalPieces(budget);
  const goalsC = sumC(goals, (g) => g.amountC);

  // Category money still to spend, scaled to the days left until payday.
  const y = +today.slice(0, 4), m = +today.slice(5, 7), d = +today.slice(8, 10);
  const daysLeft = daysInMonth(y, m) - d + 1;
  const share = Math.min(1, daysAway / daysLeft);
  const cats = categoryStatus(budget, today.slice(0, 7)).map((c) => {
    const remC = Math.max(0, toCents(c.remaining));
    return { id: c.id, name: c.name, remaining: fromCents(remC), reservedC: Math.round(remC * share) };
  });
  const catsC = sumC(cats, (c) => c.reservedC);

  const safeC = incomeC - billsC - goalsC - catsC;

  // After payday: bills from payday until the following payday come out of the check that arrives on payday.
  // That check pays for period np.periodIndex: the current one, or (between its end and payday) the finished one.
  const nextR = periodRange(profile, np.periodIndex + 1);
  const afterStart = payday, afterEnd = addDays(nextR.end, delay - 1);
  const nextBills = unpaid(afterStart, afterEnd);
  const nextBillsC = sumC(nextBills, (b) => toCents(num(b.amount)));
  let projC;
  if (np.periodIndex === idx) projC = inc.projectedCheck == null ? null : toCents(inc.projectedCheck);
  else {
    const t = periodTotals(profile, nights, np.periodIndex, today);
    projC = t.ns.length > 0 ? toCents(t.chk) : (inc.avgCheckPerPeriod == null ? null : toCents(inc.avgCheckPerPeriod));
  }

  return {
    payday, daysAway,
    income: { source: entered ? 'entered' : 'cash', amount: fromCents(incomeC), cash: fromCents(cashC), spent: fromCents(spentC) },
    bills, billsTotal: fromCents(billsC),
    goals: goals.map((g) => ({ id: g.id, name: g.name, amount: fromCents(g.amountC) })), goalsTotal: fromCents(goalsC),
    categories: cats.map((c) => ({ id: c.id, name: c.name, remaining: c.remaining, reserved: fromCents(c.reservedC) })),
    categoriesTotal: fromCents(catsC),
    safe: fromCents(safeC),
    perDay: fromCents(Math.round(safeC / Math.max(1, daysAway))),
    after: {
      projectedCheck: projC == null ? null : fromCents(projC), bills: nextBills, billsTotal: fromCents(nextBillsC), goalsTotal: fromCents(goalsC),
      left: projC == null ? null : fromCents(projC - nextBillsC - goalsC), periodStart: afterStart, periodEnd: afterEnd,
    },
  };
}
