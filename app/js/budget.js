// TipNet budgeting math. Pure functions only: no DOM, no storage, no globals.
// Money is added up in whole cents so totals never drift. Dates are "YYYY-MM-DD" strings.
//
// Data shape (lives at state.budget):
//   bills:      [{id, name, amount, dueDay (1-31), category?}]   a bill that repeats every month
//   categories: [{id, name, monthly}]                            a monthly spending limit
//   goals:      [{id, name, target, saved, perPaycheck}]         something you are saving toward
//   spends:     [{id, date, amount, categoryId, note?}]          money spent, logged by the user
//   paidBills:  {"<billId>@<due date>": true}                    bills already paid, keyed by the bill and the day it fell due
//                                                                (so changing your pay schedule never un-pays a bill)
//              a goal may also be a big-purchase plan: kind:'purchase', createdAt (date), startSaved (saved when planned),
//              and either targetDate ("I want it by") or a fixed perPaycheck ("I can put aside"), boughtAt (date, once marked bought)
//   income:     [{id, name, amount, freq, nextDate, days?}]    money that does not go through TipNet (a second job, gig work, benefits...), entered once.
//                 freq: 'weekly'|'biweekly'|'twiceMonthly'|'monthly'|'once'. nextDate: the next (or first) date it arrives; it never arrives before it.
//                 days: the day(s) of the month for monthly ([d]) and twiceMonthly ([d1, d2]). Absent when there is none.
//   goalsDone:  {"<goalId>@<payday>": true}                    goals ticked "set aside for this paycheck" (keyed by goal and the payday it was
//                                                                ticked for, so it wears off by itself when the next payday comes)
//   balance:    {amount, asOf} (absent if none)     money you said you had, and when (ISO date and time)
// Everything here is an estimate. It is a planning aid, not financial advice.
import {
  num,
  toCents,
  fromCents,
  round2,
  parseISO,
  addDays,
  dayDiff,
  periodIndex,
  periodRange,
  isFinal,
  periodTotals,
  shiftsPerPeriod,
  todayISO,
  indexNights,
  periodLength,
  computeNight,
  periodFixed,
} from './math.js';

/* ---------- small helpers ---------- */
const pad = (n) => String(n).padStart(2, '0');
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12
const cents = (v) => Math.max(0, toCents(num(v)));
const sumC = (arr, f) => arr.reduce((s, x) => s + f(x), 0);

const isDateStr = (v) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(parseISO(v));

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

/* ---------- paid bills ---------- */
/** The key a "Paid" tick is stored under: the bill and the day it fell due. */
export const paidKey = (billId, dateISO) => billId + '@' + dateISO;
export const isPaid = (budget, bill) => !!(budget.paidBills && budget.paidBills[paidKey(bill.id, bill.date)]);
const OLD_KEY = /^(-?\d+):(.+)$/; // old style "<periodIndex>:<billId>"

/**
 * Turns old "<periodIndex>:<billId>" ticks into "<billId>@<due date>" using the CURRENT pay schedule.
 * A tick is kept only if that bill falls due exactly once in that pay period; anything unclear is dropped.
 * Returns a new paidBills object. New-style keys pass through untouched.
 */
export function convertPaidKeys(paid, bills, profile) {
  const out = {};
  const ok = profile && Number.isFinite(parseISO(profile.periodStart));
  Object.keys(paid || {}).forEach((k) => {
    if (paid[k] !== true) return;
    const m = OLD_KEY.exec(k);
    if (!m) {
      out[k] = true;
      return;
    }
    if (!ok) return;
    const bill = (bills || []).find((b) => b.id === m[2]);
    if (!bill) return;
    const r = periodRange(profile, Number(m[1]));
    const due = billsDue({ bills: [bill] }, r.start, r.end);
    if (due.length === 1) out[paidKey(bill.id, due[0].date)] = true;
  });
  return out;
}
/** True when paidBills still holds old-style keys (so the caller knows to convert and save). */
export const hasOldPaidKeys = (budget) =>
  Object.keys((budget && budget.paidBills) || {}).some((k) => OLD_KEY.test(k));

/* ---------- goals set aside for a paycheck ---------- */
/** The key a "Set aside for this paycheck" tick is stored under: the goal and the payday it was ticked for. */
export const goalKey = (goalId, paydayISO) => goalId + '@' + paydayISO;
export const isGoalDone = (budget, goalId, paydayISO) =>
  !!(budget.goalsDone && budget.goalsDone[goalKey(goalId, paydayISO)]);

/* ---------- saved balance ---------- */
/** Keeps a balance only if it has a real amount and a real date-time. */
export function cleanBalance(b) {
  if (!b || typeof b !== 'object') return null;
  const amount = parseFloat(b.amount);
  if (!Number.isFinite(amount) || typeof b.asOf !== 'string' || !Number.isFinite(Date.parse(b.asOf)))
    return null;
  return { amount: round2(amount), asOf: b.asOf };
}
export const BALANCE_STALE_DAYS = 3;
/** True when the saved balance is more than about 3 days old. No balance is never "stale". */
export function balanceIsStale(balance, now = new Date()) {
  if (!balance) return false;
  return now.getTime() - Date.parse(balance.asOf) > BALANCE_STALE_DAYS * 864e5;
}
/** A spend counts against the saved balance if it is dated on or after the balance day and was logged after the balance. */
function spentSinceBalance(spends, balance, today) {
  const asOfDay = todayISO(new Date(balance.asOf));
  const at = Date.parse(balance.asOf);
  return sumC(
    (spends || []).filter(
      (s) =>
        s.date <= today && (s.loggedAt ? s.date >= asOfDay && Date.parse(s.loggedAt) > at : s.date > asOfDay),
    ),
    (s) => toCents(num(s.amount)),
  );
}

/**
 * Tolerant normalizer: anything in, a valid budget out. Never throws.
 * Pass the profile so old "<periodIndex>:<billId>" paid ticks can be converted to due dates (see convertPaidKeys);
 * without it they are kept as they are until something that has the profile converts them.
 */
export function migrateBudget(x, profile) {
  const out = emptyBudget();
  if (!x || typeof x !== 'object') return out;
  const list = (v) => (Array.isArray(v) ? v.filter((i) => i && typeof i === 'object') : []);
  const text = (v, d) => (typeof v === 'string' && v.trim() ? v.trim() : d);
  const money = (v) => fromCents(cents(v));
  const id = (v, prefix, i) =>
    v !== undefined && v !== null && String(v) !== '' ? String(v) : prefix + (i + 1);
  out.bills = list(x.bills).map((b, i) => {
    const day = Math.round(num(b.dueDay));
    const bill = {
      id: id(b.id, 'b', i),
      name: text(b.name, 'Bill'),
      amount: money(b.amount),
      dueDay: Math.min(31, Math.max(1, day || 1)),
    };
    if (typeof b.category === 'string' && b.category) bill.category = b.category;
    return bill;
  });
  out.categories = list(x.categories).map((c, i) => ({
    id: id(c.id, 'c', i),
    name: text(c.name, 'Category'),
    monthly: money(c.monthly),
  }));
  out.goals = list(x.goals).map((g, i) => {
    const goal = {
      id: id(g.id, 'g', i),
      name: text(g.name, 'Goal'),
      target: money(g.target),
      saved: money(g.saved),
      perPaycheck: money(g.perPaycheck),
    };
    if (g.kind === 'purchase') {
      goal.kind = 'purchase';
      if (isDateStr(g.targetDate)) goal.targetDate = g.targetDate;
      if (isDateStr(g.createdAt)) goal.createdAt = g.createdAt;
      if (g.startSaved !== undefined && g.startSaved !== null && g.startSaved !== '')
        goal.startSaved = money(g.startSaved);
      if (isDateStr(g.boughtAt)) goal.boughtAt = g.boughtAt;
    }
    return goal;
  });
  out.spends = list(x.spends)
    .filter((s) => Number.isFinite(parseISO(s.date)))
    .map((s, i) => {
      const sp = {
        id: id(s.id, 's', i),
        date: s.date,
        amount: money(s.amount),
        categoryId: s.categoryId == null ? '' : String(s.categoryId),
      };
      if (typeof s.note === 'string' && s.note) sp.note = s.note;
      if (typeof s.loggedAt === 'string' && Number.isFinite(Date.parse(s.loggedAt))) sp.loggedAt = s.loggedAt;
      return sp;
    });
  if (x.paidBills && typeof x.paidBills === 'object' && !Array.isArray(x.paidBills)) {
    Object.keys(x.paidBills).forEach((k) => {
      if (x.paidBills[k] === true) out.paidBills[k] = true;
    });
    if (profile && hasOldPaidKeys(out)) out.paidBills = convertPaidKeys(out.paidBills, out.bills, profile);
  }
  // Old data has no goalsDone: it stays valid (nothing ticked), and the field only appears once a tick exists. Keys look like "<goalId>@<YYYY-MM-DD>".
  if (x.goalsDone && typeof x.goalsDone === 'object' && !Array.isArray(x.goalsDone)) {
    Object.keys(x.goalsDone).forEach((k) => {
      if (x.goalsDone[k] === true && /@\d{4}-\d{2}-\d{2}$/.test(k)) (out.goalsDone ||= {})[k] = true;
    });
  }
  // Other income: a source with a bad frequency or date is dropped; everything else is cleaned. The field only appears once one exists.
  list(x.income).forEach((s, i) => {
    if (!INCOME_FREQS.includes(s.freq) || !isDateStr(s.nextDate)) return;
    const src = {
      id: id(s.id, 'i', i),
      name: text(s.name, 'Other income'),
      amount: money(s.amount),
      freq: s.freq,
      nextDate: s.nextDate,
    };
    const dom = (v, d) => Math.min(31, Math.max(1, Math.round(num(v)) || d));
    const first = +s.nextDate.slice(8, 10);
    if (s.freq === 'monthly') src.days = [dom(Array.isArray(s.days) ? s.days[0] : s.days, first)];
    if (s.freq === 'twiceMonthly') {
      const d = Array.isArray(s.days) ? s.days : [];
      src.days = [dom(d[0], 1), dom(d[1], 15)].sort((a, b) => a - b);
    }
    (out.income ||= []).push(src);
  });
  const bal = cleanBalance(x.balance);
  if (bal) out.balance = bal;
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
export const hasPayDelay = (profile) =>
  !!profile &&
  profile.payDelay !== undefined &&
  profile.payDelay !== null &&
  profile.payDelay !== '' &&
  Number.isFinite(Number(profile.payDelay));

/**
 * The next payday is the first pay date after today. A period's check arrives payDelay days after it ends,
 * so between a period's end and its payday the next payday belongs to that finished period.
 * paydayInfo returns {date, daysAway, periodIndex (the period this check pays for), periodStart, periodEnd}.
 */
export function paydayInfo(profile, today = todayISO()) {
  const delay = payDelayOf(profile);
  const payOf = (k) => addDays(periodRange(profile, k).end, delay);
  // Paydays only move forward with k. Step back to the earliest period whose check has not arrived yet
  // (short periods with a long delay can have several checks still to come), then return that one.
  let k0 = periodIndex(profile, today);
  const none = { date: today, daysAway: 0, periodIndex: 0, periodStart: today, periodEnd: today };
  if (!Number.isFinite(k0)) return none; // no valid start date
  // Both loops are capped so bad data can never freeze the screen (real schedules need only a few steps).
  for (let i = 0; i < 400 && payOf(k0 - 1) > today; i++) k0--;
  for (let k = k0; k < k0 + 400; k++) {
    const r = periodRange(profile, k);
    const date = addDays(r.end, delay);
    if (date > today)
      return { date, daysAway: dayDiff(today, date), periodIndex: k, periodStart: r.start, periodEnd: r.end };
  }
  return none;
}
/** The most recent payday on or before today (the check before the next one). Unpaid bills since then still count. */
export function lastPayday(profile, today = todayISO()) {
  const np = paydayInfo(profile, today);
  const d = addDays(periodRange(profile, np.periodIndex - 1).end, payDelayOf(profile));
  return Number.isFinite(np.periodIndex) && d <= today
    ? d
    : periodRange(profile, periodIndex(profile, today)).start;
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
  const from = parseISO(fromDate),
    to = parseISO(toDate);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return [];
  const a = new Date(from),
    b = new Date(to);
  let y = a.getUTCFullYear(),
    m = a.getUTCMonth() + 1;
  const endY = b.getUTCFullYear(),
    endM = b.getUTCMonth() + 1;
  const found = [];
  while (y < endY || (y === endY && m <= endM)) {
    const last = daysInMonth(y, m);
    (budget.bills || []).forEach((bill) => {
      const day = Math.min(Math.max(1, Math.round(num(bill.dueDay)) || 1), last);
      const date = y + '-' + pad(m) + '-' + pad(day);
      if (date >= fromDate && date <= toDate) found.push({ ...bill, date });
    });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
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
 *  projectedFrom: 'nights' (this period's nights with cash) | 'average' | null,
 *  avgTakeHomePerPeriod: from finished periods or null}
 * The check can only be worked out for nights with cash entered (check = take-home - cash in hand), so the
 * projection scales from those nights only. With none this period it falls back to the average past check.
 */
export function expectedIncome(profile, nights, today = todayISO(), index = indexNights(profile, nights)) {
  const idx = periodIndex(profile, today);
  // Worked out once: with a history or an entered count it is the same for every period, and with neither there are no past periods.
  const expected = shiftsPerPeriod(profile, nights, today, undefined, index).n;
  const t = periodTotals(profile, nights, idx, today, expected, index);
  const done = [...index.keys()].filter((i) => isFinal(profile, i, today));
  const past = done.map((i) => periodTotals(profile, nights, i, today, expected, index));
  const mean = (list, f) =>
    list.length ? fromCents(Math.round(list.reduce((s, x) => s + toCents(f(x)), 0) / list.length)) : null;
  const avg = mean(past, (x) => x.net);
  const avgChk = mean(
    past.filter((x) => x.allCash),
    (x) => x.chk,
  );
  const withCash = t.ns.filter(hasCash).length;
  let projected;
  // never scale down what is already earned
  if (withCash > 0) projected = round2(t.chk * Math.max(1, Math.max(expected, t.ns.length) / withCash));
  else projected = avgChk;
  const projectedFrom = withCash > 0 ? 'nights' : avgChk == null ? null : 'average';
  return {
    cashSoFar: t.cash,
    checkSoFar: t.chk,
    projectedCheck: projected,
    projectedFrom,
    avgCheckPerPeriod: avgChk,
    avgTakeHomePerPeriod: avg,
  };
}

/**
 * Estimated check {c (cents or null), from} for a finished period whose check has not arrived yet (or null if unknown).
 * Every night has cash: the period's check as worked out. Some do: scale the nights with cash up to all N nights,
 * (sum of onCheck + fixed share) x N / withCash - fixed deductions. None do: the average past check, else null.
 */
function finishedCheckC(profile, nights, k, today, avgCheck, index) {
  const n = shiftsPerPeriod(profile, nights, today, k, index).n;
  const t = periodTotals(profile, nights, k, today, n, index);
  if (t.allCash) return { c: toCents(t.chk), from: 'finished' };
  const withCash = t.ns.map((night) => computeNight(night, profile, n)).filter((c) => c.onCheck != null);
  if (withCash.length) {
    const sumC = withCash.reduce((s, c) => s + toCents(c.onCheck) + toCents(c.fixedPerShift), 0);
    return {
      c: Math.round((sumC * t.ns.length) / withCash.length) - toCents(periodFixed(profile, t.ns)),
      from: 'finished',
    };
  }
  return { c: avgCheck == null ? null : toCents(avgCheck), from: avgCheck == null ? null : 'average' };
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
      id: c.id,
      name: c.name,
      monthly: fromCents(monthlyC),
      spent: fromCents(spentC),
      remaining: fromCents(monthlyC - spentC),
      pct: monthlyC > 0 ? Math.round((spentC / monthlyC) * 100) : spentC > 0 ? 100 : 0,
    };
  });
}
/** {pct (0-100), remaining, paychecksToGo (null if perPaycheck is 0 and goal not met)}. */
export function goalProgress(goal) {
  const targetC = toCents(num(goal.target)),
    savedC = toCents(num(goal.saved)),
    per = toCents(num(goal.perPaycheck));
  const remC = Math.max(0, targetC - savedC);
  const pct = targetC > 0 ? Math.min(100, Math.floor((savedC / targetC) * 100)) : 0;
  const paychecksToGo = remC === 0 ? 0 : per > 0 ? Math.ceil(remC / per) : null;
  return { pct, remaining: fromCents(remC), paychecksToGo };
}

/* ---------- other income (money that arrives outside TipNet) ---------- */
export const INCOME_FREQS = ['weekly', 'biweekly', 'twiceMonthly', 'monthly', 'once'];
export const INCOME_FREQ_LABEL = {
  weekly: 'every week',
  biweekly: 'every two weeks',
  twiceMonthly: 'twice a month',
  monthly: 'once a month',
  once: 'one time',
};

/**
 * The dates one other-income source arrives on, from fromISO to toISO (both included), oldest first.
 * Pure: it only needs the source and the window, so the same call works for any window (and later for any number of pay sources).
 * weekly / biweekly count from nextDate in whole days (no clock, so daylight saving never shifts a date).
 * monthly / twiceMonthly use the chosen day(s) of the month; a day past the end of a short month is the last day of that month, like bills.
 * Nothing arrives before nextDate. "once" arrives only on nextDate.
 */
export function incomeDates(src, fromISO, toISO) {
  const out = [];
  if (!src || !isDateStr(src.nextDate) || !isDateStr(fromISO) || !isDateStr(toISO) || toISO < fromISO)
    return out;
  const start = src.nextDate;
  const lo = fromISO > start ? fromISO : start;
  if (lo > toISO) return out;
  if (src.freq === 'once') return start >= fromISO && start <= toISO ? [start] : [];
  if (src.freq === 'weekly' || src.freq === 'biweekly') {
    const step = src.freq === 'weekly' ? 7 : 14;
    let d = addDays(start, Math.ceil(dayDiff(start, lo) / step) * step);
    for (let i = 0; d <= toISO && i < 4000; i++, d = addDays(d, step)) out.push(d);
    return out;
  }
  const first = +start.slice(8, 10);
  const days = (Array.isArray(src.days) && src.days.length ? src.days : [first]).slice(
    0,
    src.freq === 'monthly' ? 1 : 2,
  );
  let y = +lo.slice(0, 4),
    m = +lo.slice(5, 7);
  const endY = +toISO.slice(0, 4),
    endM = +toISO.slice(5, 7);
  for (let i = 0; (y < endY || (y === endY && m <= endM)) && i < 4000; i++) {
    const last = daysInMonth(y, m);
    const here = new Set(
      days.map((d) => y + '-' + pad(m) + '-' + pad(Math.min(Math.max(1, Math.round(num(d)) || 1), last))),
    );
    [...here].sort().forEach((date) => {
      if (date >= lo && date <= toISO) out.push(date);
    });
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}
/** Other income arriving from fromISO to toISO: [{id, name, amount, freq, date}], oldest first. */
export function incomeInWindow(budget, fromISO, toISO) {
  const found = [];
  (budget.income || []).forEach((src) =>
    incomeDates(src, fromISO, toISO).forEach((date) =>
      found.push({ id: src.id, name: src.name, amount: fromCents(cents(src.amount)), freq: src.freq, date }),
    ),
  );
  return found.sort((p, q) => (p.date < q.date ? -1 : p.date > q.date ? 1 : p.name < q.name ? -1 : 0));
}
/** What one source comes to in a month, in cents: weekly x 52/12, every two weeks x 26/12, twice a month x 2, monthly x 1. One time is 0. */
export function incomeMonthlyC(src) {
  const c = cents(src.amount);
  return src.freq === 'weekly'
    ? Math.round((c * 52) / 12)
    : src.freq === 'biweekly'
      ? Math.round((c * 26) / 12)
      : src.freq === 'twiceMonthly'
        ? c * 2
        : src.freq === 'monthly'
          ? c
          : 0;
}
/** The monthly equivalent of all regular (not one-time) other income, in dollars. */
export const otherIncomeMonthly = (budget) => fromCents(sumC(budget.income || [], incomeMonthlyC));
/** Regular other income spread over one pay period of the profile (a paycheck's worth), in dollars. */
export function otherIncomePerPaycheck(budget, profile, today = todayISO()) {
  const len = periodLength(profile, periodIndex(profile, today));
  return fromCents(Math.round((sumC(budget.income || [], incomeMonthlyC) * 12 * len) / 365));
}

/* ---------- big-purchase plans (a goal with kind 'purchase') ---------- */
export const isPlan = (g) => !!g && g.kind === 'purchase';
/** Above about this share of a typical check, the plan gets a gentle note. */
export const PLAN_BIG_SHARE = 35;

/**
 * Paydays after fromExclusive, up to and including throughISO (or just the first `max` of them), oldest first.
 * Follows the real pay schedule: weekly, biweekly, semimonthly and monthly calendar periods, and payDelay.
 * Capped so bad data can never freeze the screen.
 */
export function paydaysBetween(profile, fromExclusive, throughISO, max = 1500) {
  const out = [];
  if (!Number.isFinite(parseISO(fromExclusive))) return out;
  const delay = payDelayOf(profile);
  const k0 = paydayInfo(profile, fromExclusive).periodIndex;
  for (let k = k0, i = 0; i < Math.min(max, 1500); k++, i++) {
    const date = addDays(periodRange(profile, k).end, delay);
    if (date <= fromExclusive) continue;
    if (throughISO && date > throughISO) break;
    out.push(date);
  }
  return out;
}
/** How many paychecks arrive after today, up to and including dateISO. */
export const paychecksUntil = (profile, dateISO, today = todayISO()) =>
  Number.isFinite(parseISO(dateISO)) ? paydaysBetween(profile, today, dateISO).length : 0;

/**
 * Where a big-purchase plan stands today. Everything is an estimate.
 * Mode "by a date" (targetDate): what is needed each paycheck is worked out again from what is still missing and the paychecks
 * still to come, so falling behind raises it and getting ahead lowers it. Mode "fixed" (no targetDate): perPaycheck stays as set.
 * Returns {mode:'date'|'fixed', cost, saved, remaining, pct, ready, perPaycheck, paychecksLeft (null when it cannot be worked out),
 *  readyBy (date of the payday that finishes it, or null), noPaychecks (true when a dated plan has none left), elapsed (paydays since it was made),
 *  expected (saved you should have by now), behind (0 when on track), onTrack}
 */
export function purchasePlan(goal, profile, today = todayISO()) {
  const costC = cents(goal.target),
    savedC = cents(goal.saved);
  const remC = Math.max(0, costC - savedC);
  const dated = isDateStr(goal.targetDate);
  const out = {
    mode: dated ? 'date' : 'fixed',
    cost: fromCents(costC),
    saved: fromCents(savedC),
    remaining: fromCents(remC),
    pct: costC > 0 ? Math.min(100, Math.floor((savedC / costC) * 100)) : 0,
    ready: costC > 0 && remC === 0,
    perPaycheck: 0,
    paychecksLeft: null,
    readyBy: null,
    noPaychecks: false,
    elapsed: 0,
    expected: fromCents(savedC),
    behind: 0,
    onTrack: true,
  };
  if (remC === 0) {
    out.paychecksLeft = 0;
    return out;
  }
  let planC; // per paycheck as first planned (cents), for the on-track check
  const startC = Math.min(costC, goal.startSaved === undefined ? savedC : cents(goal.startSaved));
  const made = isDateStr(goal.createdAt) ? goal.createdAt : null;
  if (dated) {
    const days = paydaysBetween(profile, today, goal.targetDate);
    const n = days.length;
    out.paychecksLeft = n;
    out.noPaychecks = n === 0;
    out.perPaycheck = fromCents(n > 0 ? Math.ceil(remC / n) : remC);
    out.readyBy = n > 0 ? days[n - 1] : null;
    if (made) {
      const total = paydaysBetween(profile, made, goal.targetDate).length;
      const need = Math.max(0, costC - startC);
      planC = total > 0 ? Math.ceil(need / total) : need;
    }
  } else {
    const per = cents(goal.perPaycheck);
    out.perPaycheck = fromCents(per);
    if (per > 0) {
      const n = Math.ceil(remC / per);
      out.paychecksLeft = n;
      out.readyBy = paydaysBetween(profile, today, null, n)[n - 1] || null;
    }
    planC = per;
  }
  if (made && planC != null) {
    const elapsed = paydaysBetween(profile, made, today).length;
    out.elapsed = elapsed;
    const expC = Math.min(costC, startC + elapsed * planC);
    out.expected = fromCents(expC);
    out.behind = fromCents(Math.max(0, expC - savedC));
    out.onTrack = expC - savedC <= 0;
  }
  return out;
}

/** How big the per-paycheck amount is next to a typical check: {pct (whole number), big} or null when the check is not known. */
export function planShare(perPaycheck, typicalCheck) {
  const base = toCents(num(typicalCheck));
  if (!(base > 0) || !(num(perPaycheck) > 0)) return null;
  const pct = Math.round((toCents(num(perPaycheck)) / base) * 100);
  return { pct, big: pct > PLAN_BIG_SHARE };
}

/* ---------- safe to spend ---------- */
/**
 * Money to put toward goals this paycheck (never more than a goal still needs), in cents.
 * done: the goal is ticked "set aside for this paycheck" for this payday, so it is no longer taken out of the money you have now.
 */
function goalPieces(budget, payday, profile, today) {
  return (budget.goals || [])
    .filter((g) => !g.boughtAt) // a purchase already bought no longer needs money set aside
    .map((g) => {
      const remC = Math.max(0, toCents(num(g.target)) - toCents(num(g.saved)));
      const per = isPlan(g) ? toCents(purchasePlan(g, profile, today).perPaycheck) : cents(g.perPaycheck);
      return { id: g.id, name: g.name, amountC: Math.min(per, remC), done: isGoalDone(budget, g.id, payday) };
    });
}

/**
 * How much you can spend before your next payday, with every piece shown so the UI can explain it.
 * Money you have: options.cashOnHand if given, else the saved balance (budget.balance) minus spending logged since it was saved,
 * else the cash tips TipNet adds up from this pay period's nights (minus spending logged this pay period).
 * options.index: an indexNights() result to reuse.
 * Money from the check is NOT counted until payday. Category money is set aside by the day: for each month the days until
 * payday touch, min(what is left of that month's allowance, monthly / days in that month x the days in the window in that month).
 * Goals ticked done for this payday (isGoalDone) are not subtracted from the money you have now; the next paycheck still counts them.
 * Paid bills are looked up by paidKey(bill id, due date).
 * Returns {payday, daysAway, income:{source:'entered'|'balance'|'cash', amount, cash, spent (logged since the balance / this period; 0 for 'entered')}, bills:[...], billsTotal,
 *  goals:[{id,name,amount (0 once done),due (full amount),done}], goalsTotal (goals not done only), categories:[{id,name,remaining,reserved}], categoriesTotal,
 *  safe (can be negative), perDay,
 *  (payday = first pay date after today; bills counted are unpaid ones due up to the day before it)
 *  after:{projectedCheck (null if unknown), checkFrom ('current'|'finished'|'average'|null), bills, billsTotal, goalsTotal, left, periodStart, periodEnd}}
 */
export function safeToSpend(budget, profile, nights, today = todayISO(), options = {}) {
  const idx = periodIndex(profile, today);
  const range = periodRange(profile, idx);
  const np = paydayInfo(profile, today);
  const { date: payday, daysAway } = np;
  const delay = payDelayOf(profile);
  const index = options.index || indexNights(profile, nights);
  const inc = expectedIncome(profile, nights, today, index);
  const co = options.cashOnHand;
  const entered = co !== undefined && co !== null && co !== '' && Number.isFinite(parseFloat(co));
  const saved = entered ? null : cleanBalance(budget.balance);
  // Money you have: what you typed, or your saved balance minus what you logged spending since, or cash tips this period
  // minus what you logged spending this period. Money already spent also counts against its category below.
  let spentC = 0,
    cashC;
  if (entered) cashC = toCents(num(co));
  else if (saved) {
    cashC = toCents(saved.amount);
    spentC = spentSinceBalance(budget.spends, saved, today);
  } else {
    cashC = toCents(inc.cashSoFar);
    spentC = sumC(
      (budget.spends || []).filter((s) => s.date >= range.start && s.date <= today),
      (s) => toCents(num(s.amount)),
    );
  }
  const incomeC = cashC - spentC;

  // Unpaid bills in a date range. Earlier unpaid bills in this period still count: you still owe them.
  const unpaid = (from, to) => billsDue(budget, from, to).filter((b) => !isPaid(budget, b));
  const bills = unpaid(lastPayday(profile, today), addDays(payday, -1));
  const billsC = sumC(bills, (b) => toCents(num(b.amount)));

  const goals = goalPieces(budget, payday, profile, today);
  const goalsAllC = sumC(goals, (g) => g.amountC); // what the next paycheck sets aside
  const goalsC = sumC(
    goals.filter((g) => !g.done),
    (g) => g.amountC,
  ); // what still has to come out of the money you have now

  // Category money to set aside for the days until payday. Each month the window touches: a day-based allowance
  // (monthly / days in that month x window days in that month), never more than what is left of that month's allowance.
  // This month's remaining = monthly - spent (never below 0); later months have their full monthly to draw on.
  const y = +today.slice(0, 4),
    m = +today.slice(5, 7),
    d = +today.slice(8, 10);
  const monthDaysLeft = daysInMonth(y, m) - d + 1;
  const thisMonthDays = Math.min(daysAway, monthDaysLeft);
  const later = []; // {n days, dim days in that month} for each later month in the window
  for (let left = daysAway - thisMonthDays, mm = m, yy = y; left > 0;) {
    mm++;
    if (mm > 12) {
      mm = 1;
      yy++;
    }
    const dim = daysInMonth(yy, mm),
      n = Math.min(left, dim);
    later.push({ n, dim });
    left -= n;
  }
  const cats = categoryStatus(budget, today.slice(0, 7)).map((c) => {
    const remC = Math.max(0, toCents(c.remaining)),
      monthlyC = toCents(c.monthly);
    let reservedC = Math.min(remC, Math.round((monthlyC * thisMonthDays) / daysInMonth(y, m)));
    for (const L of later) reservedC += Math.min(monthlyC, Math.round((monthlyC * L.n) / L.dim));
    return { id: c.id, name: c.name, remaining: fromCents(remC), reservedC };
  });
  const catsC = sumC(cats, (c) => c.reservedC);

  // Other income that arrives before payday: from today up to the day before it.
  const otherItems = incomeInWindow(budget, today, addDays(payday, -1));
  const otherC = sumC(otherItems, (o) => toCents(o.amount));

  const safeC = incomeC + otherC - billsC - goalsC - catsC;

  // After payday: bills from payday until the following payday come out of the check that arrives on payday.
  // That check pays for period np.periodIndex: the current one, or (between its end and payday) the finished one.
  const nextR = periodRange(profile, np.periodIndex + 1);
  const afterStart = payday,
    afterEnd = addDays(nextR.end, delay - 1);
  const nextBills = unpaid(afterStart, afterEnd);
  const nextBillsC = sumC(nextBills, (b) => toCents(num(b.amount)));
  const afterOther = incomeInWindow(budget, afterStart, afterEnd);
  const afterOtherC = sumC(afterOther, (o) => toCents(o.amount));
  let projC, checkFrom;
  if (np.periodIndex === idx) {
    projC = inc.projectedCheck == null ? null : toCents(inc.projectedCheck);
    checkFrom = inc.projectedFrom === 'nights' ? 'current' : inc.projectedFrom;
  } else
    ({ c: projC, from: checkFrom } = finishedCheckC(
      profile,
      nights,
      np.periodIndex,
      today,
      inc.avgCheckPerPeriod,
      index,
    ));

  return {
    payday,
    daysAway,
    income: {
      source: entered ? 'entered' : saved ? 'balance' : 'cash',
      amount: fromCents(incomeC),
      cash: fromCents(cashC),
      spent: fromCents(spentC),
    },
    bills,
    billsTotal: fromCents(billsC),
    otherIncome: otherItems,
    otherIncomeTotal: fromCents(otherC),
    goals: goals.map((g) => ({
      id: g.id,
      name: g.name,
      amount: fromCents(g.done ? 0 : g.amountC),
      due: fromCents(g.amountC),
      done: g.done,
    })),
    goalsTotal: fromCents(goalsC),
    categories: cats.map((c) => ({
      id: c.id,
      name: c.name,
      remaining: c.remaining,
      reserved: fromCents(c.reservedC),
    })),
    categoriesTotal: fromCents(catsC),
    safe: fromCents(safeC),
    perDay: fromCents(Math.round(safeC / Math.max(1, daysAway))),
    after: {
      projectedCheck: projC == null ? null : fromCents(projC),
      checkFrom,
      bills: nextBills,
      billsTotal: fromCents(nextBillsC),
      goalsTotal: fromCents(goalsAllC),
      otherIncome: afterOther,
      otherIncomeTotal: fromCents(afterOtherC),
      left: projC == null ? null : fromCents(projC + afterOtherC - nextBillsC - goalsAllC),
      periodStart: afterStart,
      periodEnd: afterEnd,
    },
  };
}
