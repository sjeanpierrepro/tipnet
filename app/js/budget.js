// TipNet budgeting math. Pure functions only: no DOM, no storage, no globals.
// Money is added up in whole cents so totals never drift. Dates are "YYYY-MM-DD" strings.
//
// Data shape (lives at state.budget):
//   bills:      [{id, name, amount, dueDay (1-31), category?, since}]   a bill that repeats every month
//                 since: the first day it counts (ISO). Due dates before it never show as owed. Set when the bill is added
//                 (its due date this month when that already passed, so "Already paid this month?" can tick it);
//                 bills saved before this existed get the day the app was updated.
//   categories: [{id, name, monthly, freq?, anchor?}]            a spending limit. "monthly" is the amount per period (the name is old).
//                 freq: 'weekly' (resets Mon-Sun) | 'biweekly' (every 14 days counted from anchor) | absent = monthly (calendar month).
//                 anchor: the date the category started (ISO), used for biweekly.
//   goals:      [{id, name, target, saved, perPaycheck}]         something you are saving toward
//   spends:     [{id, date, amount, categoryId, note?}]          money spent, logged by the user
//   paidBills:  {"<billId>@<due date>": true}                    bills already paid, keyed by the bill and the day it fell due
//                                                                (so changing your pay schedule never un-pays a bill)
//              a goal may also be a big-purchase plan: kind:'purchase', createdAt (date), startSaved (saved when planned),
//              and either targetDate ("I want it by") or a fixed perPaycheck ("I can put aside"), boughtAt (date, once marked bought)
//   income:     [{id, name, amount, freq, nextDate, days?}]    money that does not go through TipNet (a second job, gig work, benefits...), entered once.
//                 freq: 'weekly'|'biweekly'|'twiceMonthly'|'monthly'|'once'. nextDate: the next (or first) date it arrives; it never arrives before it.
//                 days: the day(s) of the month for monthly ([d]) and twiceMonthly ([d1, d2]). Absent when there is none.
//   a goal may also carry contributions: [{payday (ISO date of the check it came from, or null for extra money), amount (>= 0),
//                 planned? (the amount asked for at the time), recordedAt (ISO date and time)}], newest last, at most 200. goal.saved includes them.
//                 One per payday per goal. Once one exists for the current check, that goal is no longer set aside from the money you have
//                 until the next payday. (The old goalsDone ticks are dropped on load; saved is never changed by that.)
//                 Any goal may have createdAt and startSaved (the schedule it is measured against).
//   balance:    {amount, asOf, example?} (absent if none)  money you said you had, and when (ISO date and time); example: the made-up one
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
  periodTotals,
  todayISO,
  indexNights,
  periodLength,
  calendarMode,
  weekdayMon0,
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
/**
 * A realistic example for a bartender. Fresh copy each call. Its bills start today, and any that fall due today are
 * marked paid, and it has a balance of $2,400 as of today, so safe-to-spend is positive on any day of the month.
 */
export function exampleBudget(today = todayISO()) {
  const b = exampleBudgetBase(today);
  b.balance = { amount: 2400, asOf: today + 'T12:00:00', example: true };
  billsDue(b, today, today).forEach((x) => {
    b.paidBills[paidKey(x.id, x.date)] = true;
  });
  return b;
}
function exampleBudgetBase(today) {
  return {
    bills: [
      { id: 'b1', name: 'Rent', amount: 1200, dueDay: 1, category: 'Housing', since: today },
      { id: 'b2', name: 'Phone', amount: 65, dueDay: 15, category: 'Utilities', since: today },
      { id: 'b3', name: 'Car insurance', amount: 140, dueDay: 20, category: 'Transport', since: today },
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
    const due = billsDue({ bills: [{ ...bill, since: null }] }, r.start, r.end); // every due date, so no tick is lost
    if (due.length === 1) out[paidKey(bill.id, due[0].date)] = true;
  });
  return out;
}
/** True when paidBills still holds old-style keys (so the caller knows to convert and save). */
export const hasOldPaidKeys = (budget) =>
  Object.keys((budget && budget.paidBills) || {}).some((k) => OLD_KEY.test(k));

/* ---------- what you put toward a goal (contributions) ---------- */
export const MAX_CONTRIBUTIONS = 200;
export const contributionsOf = (goal) =>
  goal && Array.isArray(goal.contributions) ? goal.contributions : [];
/** The payday a contribution made today belongs to: the most recent payday on or before today, or the next payday if there is none yet. */
export function recordPayday(profile, today = todayISO()) {
  const np = paydayInfo(profile, today);
  if (!Number.isFinite(np.periodIndex)) return np.date;
  const d = addDays(periodRange(profile, np.periodIndex - 1).end, payDelayOf(profile));
  return d <= today ? d : np.date;
}
/** Index of the contribution recorded for that payday, or -1. */
export const contributionIndex = (goal, paydayISO) =>
  paydayISO ? contributionsOf(goal).findIndex((c) => c.payday === paydayISO) : -1;
/** True when an amount is recorded for this goal from that payday's check (it is then not set aside until the next payday). */
export const isGoalDone = (goal, paydayISO) => contributionIndex(goal, paydayISO) >= 0;

const setSaved = (goal, savedC) => {
  goal.saved = fromCents(Math.max(0, savedC));
};
const amountOf = (v) => {
  const raw = typeof v === 'string' ? v.trim() : v;
  const n = raw === '' || raw === null || raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? toCents(n) : null;
};
/**
 * Record what was put toward a goal. paydayISO is the check it came from, or null for extra money any time.
 * One per payday: recording again for the same payday edits it, and saved moves by the difference.
 * Returns {ok:false} for a bad or negative amount, else {ok:true, edited, index}.
 */
export function recordContribution(goal, paydayISO, amount, opts = {}) {
  const amtC = amountOf(amount);
  if (amtC === null) return { ok: false };
  const list = (goal.contributions = contributionsOf(goal));
  const at = contributionIndex(goal, paydayISO);
  const when = opts.recordedAt || new Date().toISOString();
  if (at >= 0) {
    setSaved(goal, toCents(num(goal.saved)) - toCents(list[at].amount) + amtC);
    list[at].amount = fromCents(amtC);
    list[at].recordedAt = when;
    return { ok: true, edited: true, index: at };
  }
  const entry = { payday: paydayISO || null, amount: fromCents(amtC) };
  if (opts.planned !== undefined && opts.planned !== null) entry.planned = fromCents(cents(opts.planned));
  entry.recordedAt = when;
  list.push(entry);
  while (list.length > MAX_CONTRIBUTIONS) list.shift();
  setSaved(goal, toCents(num(goal.saved)) + amtC);
  return { ok: true, edited: false, index: list.length - 1 };
}
/** Change one history entry's amount; saved moves by the difference. {ok:false} if the index or amount is bad. */
export function editContribution(goal, index, amount) {
  const list = contributionsOf(goal);
  const amtC = amountOf(amount);
  if (!list[index] || amtC === null) return { ok: false };
  setSaved(goal, toCents(num(goal.saved)) - toCents(list[index].amount) + amtC);
  list[index].amount = fromCents(amtC);
  return { ok: true };
}
/** Remove one history entry; saved goes down by its amount. Returns what undo needs: {ok, entry, index, savedBefore}. */
export function removeContribution(goal, index) {
  const list = contributionsOf(goal);
  if (!list[index]) return { ok: false };
  const savedBefore = goal.saved;
  const [entry] = list.splice(index, 1);
  setSaved(goal, toCents(num(goal.saved)) - toCents(entry.amount));
  if (!list.length) delete goal.contributions;
  return { ok: true, entry, index, savedBefore };
}
/** Put a removed entry back exactly where it was, with saved as it was. */
export function restoreContribution(goal, undo) {
  const list = (goal.contributions = contributionsOf(goal));
  list.splice(Math.min(undo.index, list.length), 0, undo.entry);
  goal.saved = undo.savedBefore;
}

/* ---------- saved balance ---------- */
/** Keeps a balance only if it has a real amount and a real date-time. */
export function cleanBalance(b) {
  if (!b || typeof b !== 'object') return null;
  const amount = parseFloat(b.amount);
  if (!Number.isFinite(amount) || typeof b.asOf !== 'string' || !Number.isFinite(Date.parse(b.asOf)))
    return null;
  const out = { amount: round2(amount), asOf: b.asOf };
  if (b.example === true) out.example = true; // the made-up example balance, until the person types their own
  return out;
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
export function migrateBudget(x, profile, today = todayISO()) {
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
    // A bill from before "since" existed starts today, so its earlier due dates don't suddenly show as overdue.
    bill.since = isDateStr(b.since) ? b.since : today;
    return bill;
  });
  out.categories = list(x.categories).map((c, i) => {
    const cat = { id: id(c.id, 'c', i), name: text(c.name, 'Category'), monthly: money(c.monthly) };
    // Only weekly and every-two-weeks are written down; anything else (or missing) stays monthly.
    if (c.freq === 'weekly' || c.freq === 'biweekly') {
      cat.freq = c.freq;
      if (isDateStr(c.anchor)) cat.anchor = c.anchor;
      else if (c.freq === 'biweekly') cat.anchor = today;
    }
    return cat;
  });
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
      if (isDateStr(g.boughtAt)) goal.boughtAt = g.boughtAt;
    }
    // The restaurant whose paychecks it is saved from (a workplace id; storage drops it when that restaurant is gone).
    if (typeof g.fundedBy === 'string' && g.fundedBy) goal.fundedBy = g.fundedBy.slice(0, 40);
    if (isDateStr(g.createdAt)) goal.createdAt = g.createdAt;
    if (g.startSaved !== undefined && g.startSaved !== null && g.startSaved !== '')
      goal.startSaved = money(g.startSaved);
    // What was put toward it: bad dates and negative or unreadable amounts are dropped; one per payday; the newest MAX_CONTRIBUTIONS are kept.
    const hist = [];
    const seen = new Set();
    list(g.contributions).forEach((c) => {
      const amt = Number(c.amount);
      if (!(c.payday === null || isDateStr(c.payday)) || !Number.isFinite(amt) || amt < 0) return;
      if (c.payday) {
        if (seen.has(c.payday)) return;
        seen.add(c.payday);
      }
      const e = { payday: c.payday, amount: money(amt) };
      const pl = Number(c.planned);
      if (c.planned !== undefined && c.planned !== null && Number.isFinite(pl) && pl >= 0)
        e.planned = money(pl);
      const okAt = typeof c.recordedAt === 'string' && Number.isFinite(Date.parse(c.recordedAt));
      e.recordedAt = okAt ? c.recordedAt : (c.payday || '1970-01-01') + 'T12:00:00.000Z';
      hist.push(e);
    });
    if (hist.length) goal.contributions = hist.slice(-MAX_CONTRIBUTIONS);
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
  // Old "set aside for this paycheck" ticks (goalsDone) are dropped: they only meant "done for that payday", and saved is not changed.
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
  // "Extra goal" (Pay periods): {amount, per: 'month' | 'week'}, added on top of the budget's needs on that card only
  // (no Budget number uses it). Only a positive amount is kept (anything else per counts as a month); clearing it removes it.
  const eg = x.extraGoal && typeof x.extraGoal === 'object' ? x.extraGoal : null;
  const extra = eg ? cents(eg.amount) : 0;
  if (extra > 0) out.extraGoal = { amount: fromCents(extra), per: eg.per === 'week' ? 'week' : 'month' };
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
      if (date >= fromDate && date <= toDate && !(isDateStr(bill.since) && date < bill.since))
        found.push({ ...bill, date });
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
 * What the nights you logged bring in for the current pay period. Estimates from logged nights only; nothing is scaled up.
 * {cashSoFar: cash in hand this period, checkSoFar: on-check estimate from the nights with cash entered,
 *  keptSoFar: take-home of the logged nights less the taxes to set aside on cash that skipped payroll,
 *  setAsideSoFar, loggedNights: nights logged this period, checkNights: how many of them have cash entered}
 * The check can only be worked out for nights with cash entered (check = take-home - cash in hand).
 */
export function loggedIncome(profile, nights, today = todayISO(), index = indexNights(profile, nights)) {
  const idx = periodIndex(profile, today);
  // periodTotals' own shift count for this period: the one Pay periods uses, so both show the same numbers
  const t = periodTotals(profile, nights, idx, today, undefined, index);
  return {
    cashSoFar: t.cash,
    setAsideSoFar: t.setAside,
    checkSoFar: t.chk,
    keptSoFar: fromCents(toCents(t.net) - toCents(t.setAside)),
    loggedNights: t.ns.length,
    checkNights: t.ns.filter(hasCash).length,
  };
}

/**
 * The plain line that says what a check is made from: "from 3 nights logged so far" while the pay period runs,
 * "from the nights you logged" once it is over, and "No nights logged for this check yet." with none.
 * logged: every night logged for that pay period (nights counts only the ones with cash in hand entered, which a check
 * is worked out from). When some have no cash entered the line says so, so it never reads as fewer nights than Pay periods lists.
 */
export function loggedCheckLine(nights, state, logged = nights) {
  const noCash = Math.max(0, (logged || 0) - (nights || 0));
  if (!(nights > 0))
    return noCash > 0
      ? 'No cash in hand entered for this check’s nights yet.'
      : 'No nights logged for this check yet.';
  const base =
    state === 'ended'
      ? 'from the nights you logged'
      : 'from ' +
        nights +
        (nights === 1 ? ' night' : ' nights') +
        ' logged' +
        (state === 'running' ? ' so far' : '');
  return noCash > 0
    ? base + '; ' + noCash + ' more ' + (noCash === 1 ? 'has' : 'have') + ' no cash in hand entered'
    : base;
}

/**
 * The check for one pay period, worked out from the nights logged for it (nothing scaled up, no average of other periods):
 * {c (cents, 0 when nothing is logged), nights (logged nights with cash entered, which the check is made from),
 *  logged (every night logged for it), state ('running' | 'ended' | 'later': the period runs now, is over, or has not started)}.
 * Not clamped at $0: it is periodTotals' check, the amount Pay periods shows ("On your check so far", and the nights'
 * "on check" lines plus the exact-amounts line), even when cash in hand makes it negative.
 */
function loggedCheckC(profile, nights, k, today, index) {
  const idx = periodIndex(profile, today);
  const t = periodTotals(profile, nights, k, today, undefined, index);
  const withCash = t.ns.filter(hasCash).length;
  return {
    c: withCash ? toCents(t.chk) : 0,
    nights: withCash,
    logged: t.ns.length,
    state: k === idx ? 'running' : k < idx ? 'ended' : 'later',
  };
}

/* ---------- categories and goals ---------- */
export const CAT_FREQS = ['weekly', 'biweekly', 'monthly'];
export const CAT_FREQ_LABEL = { weekly: 'per week', biweekly: 'per two weeks', monthly: 'per month' };
export const CAT_PERIOD_WORDS = { weekly: 'this week', biweekly: 'these two weeks', monthly: 'this month' };
/** 'weekly' | 'biweekly' | 'monthly' (anything unknown is monthly). */
export const catFreq = (cat) =>
  cat && (cat.freq === 'weekly' || cat.freq === 'biweekly') ? cat.freq : 'monthly';
const BIWEEK_FALLBACK = '1970-01-05'; // a Monday, used only when a biweekly category has no readable anchor

/**
 * The spending period a date falls in for a category: {start, end (inclusive), len (days)}.
 * Weekly is Monday to Sunday (the app's week). Every two weeks is 14-day blocks counted from the category's anchor date.
 * Monthly is the calendar month.
 */
export function catPeriod(cat, dateISO) {
  const f = catFreq(cat);
  if (f === 'weekly') {
    const start = addDays(dateISO, -weekdayMon0(dateISO));
    return { start, end: addDays(start, 6), len: 7 };
  }
  if (f === 'biweekly') {
    const anchor = isDateStr(cat.anchor) ? cat.anchor : BIWEEK_FALLBACK;
    const start = addDays(anchor, Math.floor(dayDiff(anchor, dateISO) / 14) * 14);
    return { start, end: addDays(start, 13), len: 14 };
  }
  const y = +dateISO.slice(0, 4),
    m = +dateISO.slice(5, 7),
    dim = daysInMonth(y, m);
  return { start: y + '-' + pad(m) + '-01', end: y + '-' + pad(m) + '-' + pad(dim), len: dim };
}
/** What one category comes to in a month, in cents: weekly x 52/12, every two weeks x 26/12. */
export function catMonthlyC(cat) {
  const c = cents(cat.monthly),
    f = catFreq(cat);
  return f === 'weekly' ? Math.round((c * 52) / 12) : f === 'biweekly' ? Math.round((c * 26) / 12) : c;
}
/** The monthly equivalent of all spending categories, in dollars. */
export const spendingMonthly = (budget) => fromCents(sumC(budget.categories || [], catMonthlyC));
/** What the spending categories come to over one pay period of the profile, in dollars (their per-day allowance x the days in the period). */
export function spendingPerPaycheck(budget, profile, today = todayISO()) {
  const len = periodLength(profile, periodIndex(profile, today));
  const yearC = sumC(budget.categories || [], (c) => {
    const f = catFreq(c);
    return cents(c.monthly) * (f === 'weekly' ? 52 : f === 'biweekly' ? 26 : 12);
  });
  return fromCents(Math.round((yearC * len) / 365));
}

/**
 * Spending per category for the period around a date (or a month "YYYY-MM"): [{id, name, monthly (the amount per period), spent, remaining, pct}].
 * pct may pass 100. Weekly and every-two-weeks categories also carry freq, periodStart and periodEnd.
 * Spending counts against the period its date falls in.
 */
export function categoryStatus(budget, when) {
  const day = String(when).length === 7 ? when + '-01' : String(when);
  return (budget.categories || []).map((c) => {
    const per = catPeriod(c, day);
    const spentC = (budget.spends || [])
      .filter((s) => s.categoryId === c.id && s.date >= per.start && s.date <= per.end)
      .reduce((sum, s) => sum + toCents(num(s.amount)), 0);
    const monthlyC = toCents(num(c.monthly));
    const out = {
      id: c.id,
      name: c.name,
      monthly: fromCents(monthlyC),
      spent: fromCents(spentC),
      remaining: fromCents(monthlyC - spentC),
      pct: monthlyC > 0 ? Math.round((spentC / monthlyC) * 100) : spentC > 0 ? 100 : 0,
    };
    if (catFreq(c) !== 'monthly')
      Object.assign(out, { freq: catFreq(c), periodStart: per.start, periodEnd: per.end });
    return out;
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
/** Above about this share of the take-home you logged this pay period, the plan gets a gentle note. */
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
 * The paychecks still available to put money from, oldest first, as dates. They are the paydays after today up to throughISO (or the first
 * `max`), and the check you are in the middle of counts too (dated today) until something is recorded for it.
 */
function checkSlots(profile, today, throughISO, recorded, max = 1500) {
  const rp = recordPayday(profile, today);
  const upcoming = paydaysBetween(profile, today, throughISO, max + 1);
  let slots;
  if (rp <= today) slots = recorded ? upcoming : [today, ...upcoming];
  else slots = recorded ? upcoming.slice(1) : upcoming;
  return slots;
}
/** Paychecks that have arrived from when a goal was made up to today (the first one counts if it had already arrived when it was made). */
function checksSince(profile, made, today) {
  return (recordPayday(profile, made) <= made ? 1 : 0) + paydaysBetween(profile, made, today).length;
}

/**
 * Where a goal (a plain savings goal or a big-purchase plan) stands today. Everything is an estimate.
 * The check you are in (the most recent payday) counts as one of the paychecks left until something is recorded for it.
 * Mode "by a date" (targetDate): what is needed each paycheck is worked out again from what is still missing and the paychecks
 * still to come, so falling behind raises it and getting ahead lowers it. Otherwise (no targetDate) perPaycheck stays as set and the
 * ready-by date moves instead.
 * Returns {mode:'date'|'fixed', cost, saved, remaining, pct, ready, perPaycheck, paychecksLeft (null when it cannot be worked out),
 *  readyBy (date of the paycheck that finishes it, or null), noPaychecks (true when a dated plan has none left), elapsed (paychecks since it was made),
 *  expected (saved you should have by now; only with createdAt), behind (0 when not behind), ahead (0 when not ahead), onTrack (false only when behind),
 *  hasSchedule (createdAt known), payday (the current check), recorded (amount recorded for it or null),
 *  perBefore (date plans: what was needed before this check was recorded, or null), perChange (perPaycheck - perBefore, cents-exact, or null),
 *  readyByWas (when it was first planned to be ready, or null), shiftDays (readyBy - readyByWas in days, or null)}
 */
export function purchasePlan(goal, profile, today = todayISO()) {
  const costC = cents(goal.target),
    savedC = cents(goal.saved);
  const remC = Math.max(0, costC - savedC);
  const dated = isDateStr(goal.targetDate);
  const payday = recordPayday(profile, today);
  const cur = contributionIndex(goal, payday);
  const recorded = cur >= 0;
  const curC = recorded ? cents(contributionsOf(goal)[cur].amount) : 0;
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
    ahead: 0,
    onTrack: true,
    hasSchedule: false,
    payday,
    recorded: recorded ? fromCents(curC) : null,
    perBefore: null,
    perChange: null,
    readyByWas: null,
    shiftDays: null,
  };
  if (remC === 0) {
    out.paychecksLeft = 0;
    return out;
  }
  let planC; // per paycheck as first planned (cents), for the on-track check
  const startC = Math.min(costC, goal.startSaved === undefined ? savedC : cents(goal.startSaved));
  const made = isDateStr(goal.createdAt) ? goal.createdAt : null;
  if (dated) {
    const live = goal.targetDate > today;
    const slots = live ? checkSlots(profile, today, goal.targetDate, recorded) : [];
    const n = slots.length;
    out.paychecksLeft = n;
    out.noPaychecks = n === 0;
    out.perPaycheck = fromCents(n > 0 ? Math.ceil(remC / n) : remC);
    out.readyBy = n > 0 ? slots[n - 1] : null;
    if (recorded && live) {
      // What this paycheck would have been before the amount was recorded (same maths, one more check, the recorded money still to go).
      const before = Math.ceil((remC + curC) / (n + 1));
      out.perBefore = fromCents(before);
      out.perChange = fromCents(toCents(out.perPaycheck) - before);
    }
    if (made) {
      const total = checkSlots(profile, made, goal.targetDate, false, 1500).length;
      const need = Math.max(0, costC - startC);
      planC = total > 0 ? Math.ceil(need / total) : need;
    }
  } else {
    const per = cents(goal.perPaycheck);
    out.perPaycheck = fromCents(per);
    if (per > 0) {
      const n = Math.ceil(remC / per);
      out.paychecksLeft = n;
      out.readyBy = checkSlots(profile, today, null, recorded, n)[n - 1] || null;
      if (made) {
        const n0 = Math.ceil(Math.max(0, costC - startC) / per);
        if (n0 > 0) {
          const was = checkSlots(profile, made, null, false, n0)[n0 - 1] || null;
          if (was && out.readyBy) {
            out.readyByWas = was;
            out.shiftDays = dayDiff(was, out.readyBy);
          }
        }
      }
    }
    planC = per;
  }
  if (made && planC != null) {
    out.hasSchedule = true;
    // Checks that have come since it was made. The one you are in is not expected yet while nothing is recorded for it.
    const elapsed = Math.max(0, checksSince(profile, made, today) - (recorded ? 0 : 1));
    out.elapsed = elapsed;
    const expC = Math.min(costC, startC + elapsed * planC);
    out.expected = fromCents(expC);
    out.behind = fromCents(Math.max(0, expC - savedC));
    out.ahead = fromCents(Math.max(0, savedC - expC));
    out.onTrack = expC - savedC <= 0;
  }
  return out;
}

/** How big the per-paycheck amount is next to the take-home logged this pay period: {pct (whole number), big} or null when the check is not known. */
export function planShare(perPaycheck, loggedBase) {
  const base = toCents(num(loggedBase));
  if (!(base > 0) || !(num(perPaycheck) > 0)) return null;
  const pct = Math.round((toCents(num(perPaycheck)) / base) * 100);
  return { pct, big: pct > PLAN_BIG_SHARE };
}

/* ---------- several restaurants (pay sources) ---------- */
/*
 * The budget counts the paychecks of every restaurant. A source is one restaurant: {id, name, profile, nights, index?}
 * (index: an indexNights() result to reuse). Screens pass one per restaurant that is set up. Every function below also
 * works with just one source, and then gives exactly the single-paycheck numbers.
 */
const hasSchedule = (p) => !!p && Number.isFinite(parseISO(p.periodStart));
/** How many paydays a restaurant has in the year from today (0 without a pay schedule). */
export function paydaysPerYear(profile, today = todayISO()) {
  return hasSchedule(profile) ? paydaysBetween(profile, today, addDays(today, 365)).length : 0;
}
/** The restaurant that pays most often (a tie goes to the first one listed): where goals are saved from unless one is picked. */
export function defaultFunder(sources, today = todayISO()) {
  let best = null,
    bestN = -1;
  (sources || []).forEach((s) => {
    const n = paydaysPerYear(s.profile, today);
    if (n > bestN) {
      best = s;
      bestN = n;
    }
  });
  return best;
}
/** The restaurant a goal is saved from: its fundedBy when that restaurant is listed, else the default (see defaultFunder). */
export const funderOf = (goal, sources, today = todayISO()) =>
  (goal && (sources || []).find((s) => s.id === goal.fundedBy)) || defaultFunder(sources, today);
/**
 * What the nights you logged this pay period bring home at one restaurant: the check plus the cash you keep (less the taxes
 * to set aside on cash that skipped payroll). Nothing is scaled up and no past periods are averaged.
 * {amount (null when no night is logged this pay period), from ('logged'|null), and its parts, the same as Pay periods
 *  shows them (null when nothing is logged): check ("On your check so far"), cash ("Cash you keep so far"),
 *  noCash (the take-home of nights with no cash entered, which have no check/cash split yet), setAside (the taxes to set
 *  aside on cash that skipped payroll, taken off)}. amount = check + cash + noCash - setAside, to the cent.
 */
export function loggedTakeHome(profile, nights, today = todayISO(), index) {
  return takeHomeOf(loggedIncome(profile, nights, today, index || indexNights(profile, nights)));
}
/** loggedTakeHome from a loggedIncome() result. */
function takeHomeOf(inc) {
  if (!inc.loggedNights)
    return { amount: null, from: null, check: null, cash: null, noCash: null, setAside: null };
  const amount = inc.keptSoFar;
  return {
    amount,
    from: 'logged',
    check: inc.checkSoFar,
    cash: inc.cashSoFar,
    noCash: fromCents(
      toCents(amount) + toCents(inc.setAsideSoFar) - toCents(inc.checkSoFar) - toCents(inc.cashSoFar),
    ),
    setAside: inc.setAsideSoFar,
  };
}
const lenNow = (profile, today) => periodLength(profile, periodIndex(profile, today));
/** cents scaled from one pay period length to another (days). */
const scaleC = (c, fromLen, toLen) => (fromLen > 0 ? Math.round((c * toLen) / fromLen) : c);
/** What one goal takes from each of its paychecks (never more than it still needs), in cents. funder: its source. */
function goalPerC(g, funder, today) {
  const remC = Math.max(0, cents(g.target) - cents(g.saved));
  const per = isPlan(g) ? toCents(purchasePlan(g, funder.profile, today).perPaycheck) : cents(g.perPaycheck);
  return Math.min(per, remC);
}

/* ---------- what is possible to put aside ---------- */
export const ASIDE_STEP = 5;
/** Round a dollar amount down to a whole step (default $5). */
export const roundDownStep = (v, step = ASIDE_STEP) =>
  Math.floor((Math.round(num(v) * 100) + 1e-6) / (step * 100)) * step;
/** Round a dollar amount up to a whole step (default $5). */
export const roundUpStep = (v, step = ASIDE_STEP) =>
  Math.ceil((Math.round(num(v) * 100) - 1e-6) / (step * 100)) * step;
/**
 * What there is room to put aside from each paycheck of one restaurant, from the budget. In dollars, over
 * that restaurant's pay period (periodDays):
 *   its take-home logged this pay period (check + cash you keep; see loggedTakeHome)
 *   + the other restaurants' take-home logged in their current pay periods (as logged, never scaled up; a longer pay
 *     period's is shared over these days, logged x periodDays / its days, so it is not counted again at every paycheck)
 *   + regular other income over the same days
 *   - bills over the same days (monthly bills x 12 x days / 365) - spending categories (their per-day allowance x the days)
 *   - what the other active goals already take over the same days (each from its own restaurant's paychecks, scaled the same way).
 * Never below 0, and never more than this restaurant's take-home + other income - the goals already saved from its checks
 * (one check can't pay more than it brings). With one restaurant that cap never binds, so it is the plain single-paycheck sum.
 * Pass profile and nights for one restaurant; for several, opts.sources (see above) and opts.funderId (default: defaultFunder).
 * opts.excludeId leaves one goal out (the one being made or edited). opts.index: indexNights() of profile/nights.
 * (The cap uses take-home + other income, not the paycheck alone: cash tips you keep are money you can put aside.)
 * Returns {known (false when TipNet can't tell what this restaurant brings home yet), possible, check (the take-home logged
 *  this pay period: check + cash kept), checkFrom ('logged'|null), paycheck, cash, noCash, setAside (its parts, see loggedTakeHome; null when unknown),
 *  otherChecks, otherChecksList:[{id,name,amount,known,logged (as logged, or null),days (its pay period's),shared (amount is logged x periodDays / days)}], other, bills, spending, goals, periodDays, funderId, funderName,
 *  goalList:[{id,name,amount}]}. When not known, possible is 0 and the pieces are still worked out.
 */
export function possibleAside(budget, profile, nights, today = todayISO(), opts = {}) {
  const sources =
    opts.sources && opts.sources.length
      ? opts.sources
      : [{ id: opts.funderId || '', name: '', profile, nights, index: opts.index }];
  const f = sources.find((s) => s.id === opts.funderId) || defaultFunder(sources, today) || sources[0];
  const len = lenNow(f.profile, today);
  const tc = loggedTakeHome(f.profile, f.nights, today, f.index);
  const checkC = tc.amount == null ? 0 : toCents(tc.amount);
  const others = sources
    .filter((s) => s !== f && hasSchedule(s.profile))
    .map((s) => {
      const t = loggedTakeHome(s.profile, s.nights, today, s.index);
      // A longer pay period's logged money is shared over this restaurant's days (14 days logged, 7-day paycheck: half), so
      // the same money is not counted again at each of this restaurant's paychecks. Never scaled up: that would add money
      // for days nobody logged.
      const sLen = lenNow(s.profile, today);
      const shared = t.amount != null && sLen > len;
      const c = t.amount == null ? 0 : shared ? scaleC(toCents(t.amount), sLen, len) : toCents(t.amount);
      return {
        id: s.id,
        name: s.name,
        amountC: c,
        known: t.amount != null,
        logged: t.amount,
        days: sLen,
        shared,
      };
    });
  const othersC = sumC(others, (o) => o.amountC);
  const otherC = toCents(otherIncomePerPaycheck(budget, f.profile, today));
  const billsC = Math.round((sumC(budget.bills || [], (b) => cents(b.amount)) * 12 * len) / 365);
  const spendC = toCents(spendingPerPaycheck(budget, f.profile, today));
  const goalList = (budget.goals || [])
    .filter((g) => !g.boughtAt && g.id !== opts.excludeId)
    .map((g) => {
      const gf = funderOf(g, sources, today) || f;
      const own = gf === f;
      const c = goalPerC(g, gf, today);
      return { id: g.id, name: g.name, amountC: own ? c : scaleC(c, lenNow(gf.profile, today), len), own };
    })
    .filter((g) => g.amountC > 0);
  const goalsC = sumC(goalList, (g) => g.amountC);
  const ownGoalsC = sumC(
    goalList.filter((g) => g.own),
    (g) => g.amountC,
  );
  const known = tc.amount != null;
  const freeC = checkC + othersC + otherC - billsC - spendC - goalsC;
  const capC = checkC + otherC - ownGoalsC;
  return {
    known,
    possible: known ? fromCents(Math.max(0, Math.min(freeC, capC))) : 0,
    check: fromCents(checkC),
    checkFrom: tc.from,
    paycheck: tc.check,
    cash: tc.cash,
    noCash: tc.noCash,
    setAside: tc.setAside,
    otherChecks: fromCents(othersC),
    otherChecksList: others.map((o) => ({
      id: o.id,
      name: o.name,
      amount: fromCents(o.amountC),
      known: o.known,
      logged: o.logged,
      days: o.days,
      shared: o.shared,
    })),
    other: fromCents(otherC),
    bills: fromCents(billsC),
    spending: fromCents(spendC),
    goals: fromCents(goalsC),
    periodDays: len,
    funderId: f.id,
    funderName: f.name,
    goalList: goalList.map((g) => ({ id: g.id, name: g.name, amount: fromCents(g.amountC) })),
  };
}
/**
 * The put-aside slider for one goal (owner rule: it only goes as high as the budget leaves).
 * max: what is possible each paycheck, rounded down to the $5 step. start: max, or less when a smaller amount finishes the
 * goal in one paycheck (that amount rounded up to the step, never above max). capped: false when there is nothing to
 * suggest from: then there is no slider and the amount is typed, with no cap. short: that is because the take-home logged
 * so far does not cover the pay period's bills, spending and other goals yet (owner decision: let them type it), not
 * because nothing is logged.
 */
export function asideRange(possible, needed, known = true, step = ASIDE_STEP) {
  const max = known ? roundDownStep(Math.max(0, num(possible)), step) : 0;
  if (!(max > 0)) return { capped: false, max: null, start: null, short: !!known };
  const one = roundUpStep(Math.max(0, num(needed)), step);
  const start = one > 0 ? Math.min(max, one) : max;
  return { capped: true, max, start, short: false };
}

/* ---------- safe to spend ---------- */
/* ---------- Pay periods goal card: the budget's steady monthly needs ---------- */
/**
 * Pay periods in a year for a pay schedule: 52 every week, 26 every two weeks, 24 twice a month, 12 once a month. Any other
 * length of L days (from the dates or the frequency, as periodLength works it out): 364 / L, the same 52-week year, so
 * 7 and 14 days give exactly 52 and 26.
 */
export function periodsPerYear(profile, today = todayISO()) {
  const mode = calendarMode(profile);
  if (mode === 'semimonthly') return 24;
  if (mode === 'monthly') return 12;
  const len = periodLength(profile, periodIndex(profile, today));
  return len > 0 ? 364 / len : 26;
}
/** A monthly amount (cents) spread evenly over one pay period of the profile: monthly x 12 / periods per year, to the cent. */
export function perPeriodC(monthlyC, profile, today = todayISO()) {
  return Math.round((monthlyC * 12) / periodsPerYear(profile, today));
}
/** A per-paycheck amount (cents) of the profile as a monthly amount: x periods per year / 12, to the cent. */
export function monthlyFromPerPeriodC(perC, profile, today = todayISO()) {
  return Math.round((perC * periodsPerYear(profile, today)) / 12);
}
/**
 * The extra goal ({amount, per: 'month' | 'week'}) in cents: per pay period of the profile (a week x 52 / periods per
 * year, a month x 12 / periods per year) or, with no profile, per month (a week x 52 / 12). 0 without one.
 */
export function extraGoalC(extra, profile = null, today = todayISO()) {
  const c = extra && typeof extra === 'object' ? cents(extra.amount) : 0;
  if (!c) return 0;
  const perYear = extra.per === 'week' ? 52 : 12;
  return Math.round((c * perYear) / (profile ? periodsPerYear(profile, today) : 12));
}
/**
 * What the budget needs each month, at a steady pace (Pay periods goal card). Bills are monthly (each is due one day a
 * month), so a bill counts its amount. Each savings goal not bought yet counts what it takes from each paycheck of its own
 * restaurant (goalPerC: its per-paycheck amount, or a dated plan's, never more than it still needs) x that restaurant's
 * pay periods per year / 12, and that monthly amount is never more than the goal still needs (a goal that finishes within
 * the month counts only what is left). Spending categories are not counted. sources: every restaurant (see below).
 * {bills, goals, amount (both added), goalList:[{id, name, monthly}]}, in dollars.
 */
export function monthlyNeeds(budget, sources, today = todayISO()) {
  const billsC = sumC(budget.bills || [], (b) => cents(b.amount));
  const goalList = (budget.goals || [])
    .filter((g) => !g.boughtAt)
    .map((g) => {
      const f = funderOf(g, sources, today);
      const leftC = Math.max(0, cents(g.target) - cents(g.saved));
      const c = f ? Math.min(monthlyFromPerPeriodC(goalPerC(g, f, today), f.profile, today), leftC) : 0;
      return { id: g.id, name: g.name, monthlyC: c };
    });
  const goalsC = sumC(goalList, (g) => g.monthlyC);
  return {
    bills: fromCents(billsC),
    goals: fromCents(goalsC),
    amount: fromCents(billsC + goalsC),
    goalList: goalList.map((g) => ({ id: g.id, name: g.name, monthly: fromCents(g.monthlyC) })),
  };
}

/**
 * Money to put toward goals this paycheck (never more than a goal still needs), in cents. Each goal follows its own
 * restaurant (funderOf): its paydays and plan. done: an amount is recorded for that restaurant's current check, so it is no
 * longer taken out of the money you have now. funderId: the restaurant it is saved from.
 */
function goalPieces(budget, sources, today) {
  return (budget.goals || [])
    .filter((g) => !g.boughtAt) // a purchase already bought no longer needs money set aside
    .map((g) => {
      const f = funderOf(g, sources, today);
      return {
        id: g.id,
        name: g.name,
        amountC: goalPerC(g, f, today),
        done: isGoalDone(g, recordPayday(f.profile, today)),
        funderId: f.id,
      };
    });
}

/**
 * Cents to set aside for one category over `days` days starting at fromISO, by the day (amount / days in each period).
 * The period that today falls in is capped at what is left of it (u.remC, less u.c already reserved); every other period uses its full per-day allowance.
 */
function reserveC(cat, today, fromISO, days, u) {
  const amtC = toCents(num(cat.monthly));
  const cur = catPeriod(cat, today);
  let total = 0,
    cursor = fromISO,
    left = days;
  for (let i = 0; left > 0 && i < 800; i++) {
    const per = catPeriod(cat, cursor);
    const n = Math.min(left, dayDiff(cursor, per.end) + 1);
    let c = Math.round((amtC * n) / per.len);
    if (per.start === cur.start) {
      c = Math.max(0, Math.min(c, u.remC - u.c));
      u.c += c;
    }
    total += c;
    cursor = addDays(per.end, 1);
    left -= n;
  }
  return total;
}

/**
 * How much you can spend before your next payday, with every piece shown so the UI can explain it. One restaurant.
 * See safeToSpendAll for the pieces; this is the same with a single source.
 */
export function safeToSpend(budget, profile, nights, today = todayISO(), options = {}) {
  return safeToSpendAll(
    budget,
    [{ id: '', name: '', profile, nights, index: options.index }],
    today,
    options,
  );
}

/**
 * How much you can spend until the next money arrives from any restaurant (its payday), with every piece shown so the UI
 * can explain it. sources: one per restaurant (see above); restaurants without a pay schedule are left out.
 * Money you have: options.cashOnHand if given, else the saved balance (budget.balance) minus spending logged since it was saved,
 * else the cash tips TipNet adds up from every restaurant's current pay period (minus spending logged since the earliest of
 * those periods started).
 * Money from a check is NOT counted until its payday. Category money is set aside by the day: for each spending period (week, two weeks or month)
 * the days until payday touch, min(what is left of today's period, amount / days in that period x the days in the window in that period);
 * periods after today's use the full per-day allowance. The after-payday window uses the same rule.
 * Goals with an amount recorded for their restaurant's current check (isGoalDone) are not subtracted from the money you have now; the next paycheck still counts them.
 * Paid bills are looked up by paidKey(bill id, due date).
 * Returns {payday (the next money arriving), daysAway, paydaySource:{id,name} (the restaurant whose check that is),
 *  sources:[{id, name, payday, daysAway, check (from the nights logged for it; 0 when none; can be below 0 like Pay periods), checkNights, checkLogged, checkState}] (each restaurant's next check, soonest first),
 *  income:{source:'entered'|'balance'|'cash', amount, cash, spent (logged since the balance / this period; 0 for 'entered')}, bills:[...], billsTotal,
 *  goals:[{id,name,amount (0 once done),due (full amount),done,funderId}], goalsTotal (goals not done only), categories:[{id,name,remaining,reserved}], categoriesTotal,
 *  taxAside:[{id,name,amount}] + taxAsideTotal (this pay period's estimated taxes to set aside on cash that skipped payroll, subtracted),
 *  safe (can be negative), perDay,
 *  (bills counted are unpaid ones due from the earliest restaurant's last payday up to the day before payday)
 *  after:{checks:[{id,name,date,amount (from the nights logged for it; 0 when none),nights,logged,state}] (every check arriving from payday until the day before that restaurant's following payday),
 *   checksTotal (the checks added up), checkNights + checkLogged + checkState (the first check's),
 *   bills, billsTotal, goalsTotal (goals saved from a check in the window),
 *   left, periodStart, periodEnd}}
 */
export function safeToSpendAll(budget, sources, today = todayISO(), options = {}) {
  let list = (sources || []).filter((s) => hasSchedule(s.profile));
  if (!list.length) list = (sources || []).slice(0, 1);
  const src = list.map((s, order) => {
    const index = s.index || indexNights(s.profile, s.nights);
    const np = paydayInfo(s.profile, today);
    const idx = periodIndex(s.profile, today);
    return {
      s,
      order,
      index,
      np,
      idx,
      range: periodRange(s.profile, idx),
      inc: loggedIncome(s.profile, s.nights, today, index),
    };
  });
  /** The check (cents) for the payday on date, worked out from the nights logged for its pay period: {c, nights, logged, state}. */
  const checkAt = (x, date) => {
    const k = date === x.np.date ? x.np.periodIndex : paydayInfo(x.s.profile, addDays(date, -1)).periodIndex;
    return loggedCheckC(x.s.profile, x.s.nights, k, today, x.index);
  };
  // The next money arriving: the soonest payday of any restaurant (a tie keeps the Setup order).
  const bySoonest = src
    .slice()
    .sort((a, b) => (a.np.date < b.np.date ? -1 : a.np.date > b.np.date ? 1 : a.order - b.order));
  const next = bySoonest[0];
  const { date: payday, daysAway } = next.np;
  const co = options.cashOnHand;
  const entered = co !== undefined && co !== null && co !== '' && Number.isFinite(parseFloat(co));
  const saved = entered ? null : cleanBalance(budget.balance);
  // Money you have: what you typed, or your saved balance minus what you logged spending since, or cash tips this period
  // (every restaurant's) minus what you logged spending this period. Money already spent also counts against its category below.
  let spentC = 0,
    cashC;
  if (entered) cashC = toCents(num(co));
  else if (saved) {
    cashC = toCents(saved.amount);
    spentC = spentSinceBalance(budget.spends, saved, today);
  } else {
    cashC = sumC(src, (x) => toCents(x.inc.cashSoFar));
    const from = src.reduce((m, x) => (x.range.start < m ? x.range.start : m), src[0].range.start);
    spentC = sumC(
      (budget.spends || []).filter((s) => s.date >= from && s.date <= today),
      (s) => toCents(num(s.amount)),
    );
  }
  const incomeC = cashC - spentC;

  // Unpaid bills in a date range. Earlier unpaid bills still count: you still owe them. They count from the earliest
  // restaurant's last payday, so a bill is never dropped just because another restaurant paid in between.
  const unpaid = (from, to) => billsDue(budget, from, to).filter((b) => !isPaid(budget, b));
  const since = src.reduce(
    (m, x) => {
      const d = lastPayday(x.s.profile, today);
      return d < m ? d : m;
    },
    lastPayday(src[0].s.profile, today),
  );
  const bills = unpaid(since, addDays(payday, -1));
  const billsC = sumC(bills, (b) => toCents(num(b.amount)));

  const sourceList = list;
  const goals = goalPieces(budget, sourceList, today);
  const goalsC = sumC(
    goals.filter((g) => !g.done),
    (g) => g.amountC,
  ); // what still has to come out of the money you have now

  // Category money to set aside for the days until payday, by the day: a category's amount divided by the days in its period
  // (7, 14, or the days in the month) for each day, never more than what is left of today's period. Later periods use the full per-day allowance.
  const used = new Map(); // category id -> cents of today's-period money already reserved (so the window after payday never counts it twice)
  const status = categoryStatus(budget, today);
  const cats = (budget.categories || []).map((c, i) => {
    const st = status[i];
    const u = { c: 0, remC: Math.max(0, toCents(st.remaining)) };
    used.set(c.id, u);
    return {
      id: c.id,
      name: c.name,
      remaining: fromCents(u.remC),
      reservedC: reserveC(c, today, today, daysAway, u),
    };
  });
  const catsC = sumC(cats, (c) => c.reservedC);

  // Other income that arrives before payday: from today up to the day before it.
  const otherItems = incomeInWindow(budget, today, addDays(payday, -1));
  const otherC = sumC(otherItems, (o) => toCents(o.amount));

  // Taxes to set aside on cash that skipped payroll, this pay period, each restaurant (an estimate)
  const taxAside = src
    .map((x) => ({ id: x.s.id, name: x.s.name, amountC: toCents(x.inc.setAsideSoFar || 0) }))
    .filter((x) => x.amountC > 0);
  const taxAsideC = sumC(taxAside, (x) => x.amountC);

  const safeC = incomeC + otherC - billsC - goalsC - catsC - taxAsideC;

  // After payday: from the next money arriving until the day before that restaurant's following payday. Every check that
  // arrives in that window (from any restaurant) is counted; bills, spending and goals in it come out of them.
  const nextR = periodRange(next.s.profile, next.np.periodIndex + 1);
  const afterStart = payday,
    afterEnd = addDays(nextR.end, payDelayOf(next.s.profile) - 1);
  const checks = [];
  src.forEach((x) => {
    paydaysBetween(x.s.profile, addDays(afterStart, -1), afterEnd).forEach((date) => {
      const { c, nights, logged, state } = checkAt(x, date);
      checks.push({ id: x.s.id, name: x.s.name, date, c, nights, logged, state, order: x.order });
    });
  });
  checks.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order));
  const nextBills = unpaid(afterStart, afterEnd);
  const nextBillsC = sumC(nextBills, (b) => toCents(num(b.amount)));
  const afterOther = incomeInWindow(budget, afterStart, afterEnd);
  const afterOtherC = sumC(afterOther, (o) => toCents(o.amount));
  const afterDays = Math.max(0, dayDiff(afterStart, afterEnd) + 1);
  const afterCatsC = sumC(budget.categories || [], (c) =>
    reserveC(c, today, afterStart, afterDays, used.get(c.id)),
  );
  // Goals are saved from their own restaurant's checks: each counts once if one of its checks arrives in the window.
  const paidIn = new Set(checks.map((k) => k.id));
  const goalsAllC = sumC(
    goals.filter((g) => paidIn.has(g.funderId)),
    (g) => g.amountC,
  );
  const checksC = sumC(checks, (k) => k.c);
  const first = checks[0] || { nights: 0, logged: 0, state: null };

  return {
    payday,
    daysAway,
    paydaySource: { id: next.s.id, name: next.s.name },
    sources: bySoonest.map((x) => {
      const { c, nights, logged, state } = checkAt(x, x.np.date);
      return {
        id: x.s.id,
        name: x.s.name,
        payday: x.np.date,
        daysAway: x.np.daysAway,
        check: fromCents(c),
        checkNights: nights,
        checkLogged: logged,
        checkState: state,
      };
    }),
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
      funderId: g.funderId,
    })),
    goalsTotal: fromCents(goalsC),
    categories: cats.map((c) => ({
      id: c.id,
      name: c.name,
      remaining: c.remaining,
      reserved: fromCents(c.reservedC),
    })),
    categoriesTotal: fromCents(catsC),
    taxAside: taxAside.map((x) => ({ id: x.id, name: x.name, amount: fromCents(x.amountC) })),
    taxAsideTotal: fromCents(taxAsideC),
    safe: fromCents(safeC),
    perDay: fromCents(Math.round(safeC / Math.max(1, daysAway))),
    after: {
      checks: checks.map((k) => ({
        id: k.id,
        name: k.name,
        date: k.date,
        amount: fromCents(k.c),
        nights: k.nights,
        logged: k.logged,
        state: k.state,
      })),
      checksTotal: fromCents(checksC),
      checkNights: first.nights,
      checkLogged: first.logged,
      checkState: first.state,
      bills: nextBills,
      billsTotal: fromCents(nextBillsC),
      goalsTotal: fromCents(goalsAllC),
      categoriesTotal: fromCents(afterCatsC),
      otherIncome: afterOther,
      otherIncomeTotal: fromCents(afterOtherC),
      left: fromCents(checksC + afterOtherC - nextBillsC - goalsAllC - afterCatsC),
      periodStart: afterStart,
      periodEnd: afterEnd,
    },
  };
}
