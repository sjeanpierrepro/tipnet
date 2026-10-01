import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/js/math.js';
import * as B from '../app/js/budget.js';

const P = () => M.exampleProfile(TODAY); // period 2026-09-21 .. 2026-10-04
const TODAY = '2026-09-28';
const LONG_AGO = '2000-01-01'; // bills that started long ago: every due date counts
const dates = (list) => list.map((b) => b.id + '@' + b.date);

test('bills due: month rollover', () => {
  const b = B.exampleBudget(LONG_AGO);
  assert.deepEqual(dates(B.billsDue(b, '2026-09-28', '2026-10-16')), ['b1@2026-10-01', 'b2@2026-10-15']);
  assert.deepEqual(dates(B.billsDue(b, '2026-12-25', '2027-01-02')), ['b1@2027-01-01']);
  assert.deepEqual(dates(B.billsDue(b, '2026-09-15', '2026-09-15')), ['b2@2026-09-15']);
  assert.deepEqual(B.billsDue(b, '2026-10-05', '2026-10-01'), []);
});

test('bills due: Feb with dueDay 30/31 and leap years', () => {
  const b = {
    bills: [
      { id: 'x', name: 'X', amount: 10, dueDay: 31 },
      { id: 'y', name: 'Y', amount: 10, dueDay: 30 },
    ],
  };
  assert.deepEqual(dates(B.billsDue(b, '2027-02-01', '2027-02-28')), ['x@2027-02-28', 'y@2027-02-28']);
  assert.deepEqual(dates(B.billsDue(b, '2028-02-01', '2028-02-29')), ['x@2028-02-29', 'y@2028-02-29']); // leap year
  assert.deepEqual(dates(B.billsDue(b, '2028-02-01', '2028-02-28')), []);
  assert.deepEqual(dates(B.billsDue(b, '2026-04-25', '2026-05-02')), ['x@2026-04-30', 'y@2026-04-30']);
});

test('next payday, including across DST changes', () => {
  assert.deepEqual(B.nextPayday(P(), TODAY), { date: '2026-10-05', daysAway: 7 });
  assert.deepEqual(B.nextPayday(P(), '2026-10-04'), { date: '2026-10-05', daysAway: 1 });
  const spring = { freq: 14, periodStart: '2026-03-02' }; // US clocks change 2026-03-08
  assert.deepEqual(B.nextPayday(spring, '2026-03-08'), { date: '2026-03-16', daysAway: 8 });
  const fall = { freq: 14, periodStart: '2026-10-26' }; // US clocks change 2026-11-01
  assert.deepEqual(B.nextPayday(fall, '2026-11-01'), { date: '2026-11-09', daysAway: 8 });
});

test('expected income', () => {
  const inc = B.expectedIncome(P(), M.exampleNights(TODAY), TODAY);
  const t = M.periodTotals(P(), M.exampleNights(TODAY), 0, TODAY);
  assert.equal(inc.cashSoFar, t.cash);
  assert.equal(inc.checkSoFar, t.chk);
  // 4 nights logged of 10 expected: the check estimate scales by 10/4
  assert.equal(inc.projectedCheck, M.round2(t.chk * 2.5));
  assert.equal(inc.projectedFrom, 'nights');
  assert.equal(inc.avgTakeHomePerPeriod, null);
  const none = B.expectedIncome(P(), [], TODAY);
  assert.deepEqual(none, {
    cashSoFar: 0,
    setAsideSoFar: 0,
    checkSoFar: 0,
    projectedCheck: null,
    projectedFrom: null,
    avgCheckPerPeriod: null,
    avgTakeHomePerPeriod: null,
    avgKeptPerPeriod: null,
    projectedKept: null,
  });
  // a finished period gives an average take-home, and an average check when every night has cash entered
  const later = B.expectedIncome(P(), M.exampleNights(TODAY), '2026-10-10');
  const done = M.periodTotals(P(), M.exampleNights(TODAY), 0, '2026-10-10');
  assert.equal(later.avgTakeHomePerPeriod, done.net);
  assert.equal(later.avgCheckPerPeriod, done.allCash ? done.chk : null);
  assert.equal(later.projectedCheck, later.avgCheckPerPeriod); // nothing logged in the new period yet
});

test('expected income: the check projection uses only nights with cash entered', () => {
  const n = (date, cash) => ({ ...M.exampleNights(TODAY)[0], id: date, date, cash });
  const withCash = [n('2026-09-22', 150), n('2026-09-23', 150)];
  const mixed = [...withCash, n('2026-09-24', ''), n('2026-09-25', '')];
  const a = B.expectedIncome(P(), withCash, TODAY),
    b = B.expectedIncome(P(), mixed, TODAY);
  // two nights of check money spread over the same expected shifts give the same projection
  assert.equal(b.checkSoFar, a.checkSoFar);
  assert.equal(b.projectedCheck, a.projectedCheck);
  // no cash entered at all and no history: unknown, not zero
  assert.equal(B.expectedIncome(P(), [n('2026-09-22', '')], TODAY).projectedCheck, null);
  assert.equal(B.safeToSpend(B.emptyBudget(), P(), [], TODAY).after.left, null);
});

const budgetWithSpends = () => {
  const b = B.exampleBudget(LONG_AGO);
  b.spends = [
    { id: 's1', date: '2026-09-10', amount: 60, categoryId: 'c2' },
    { id: 's2', date: '2026-09-12', amount: 25.5, categoryId: 'c2' },
    { id: 's3', date: '2026-10-02', amount: 99, categoryId: 'c2' }, // other month
  ];
  return b;
};

test('category status: spent, remaining, pct', () => {
  const s = B.categoryStatus(budgetWithSpends(), '2026-09');
  assert.deepEqual(s[0], { id: 'c1', name: 'Groceries', monthly: 400, spent: 0, remaining: 400, pct: 0 });
  assert.deepEqual(s[1], { id: 'c2', name: 'Gas', monthly: 160, spent: 85.5, remaining: 74.5, pct: 53 });
  assert.equal(B.categoryStatus(budgetWithSpends(), '2026-10')[1].spent, 99);
});

test('goal progress', () => {
  assert.deepEqual(B.goalProgress({ target: 1000, saved: 250, perPaycheck: 40 }), {
    pct: 25,
    remaining: 750,
    paychecksToGo: 19,
  });
  assert.equal(B.goalProgress({ target: 1000, saved: 1200, perPaycheck: 40 }).paychecksToGo, 0);
  assert.equal(B.goalProgress({ target: 1000, saved: 0, perPaycheck: 0 }).paychecksToGo, null);
  assert.equal(B.goalProgress({ target: 0, saved: 0, perPaycheck: 0 }).pct, 0);
});

test('safe to spend: hand-computed example', () => {
  // Cash on hand 2000. Bills in this period (09-21..10-04): only rent, due 10-01 = 1200.
  // Goal this paycheck = 40. Categories left in September: groceries 400, gas 160-85.50 = 74.50, fun 150.
  // Payday 10-05 is 7 days away: 3 September days (of 30) and Oct 1-4 (4 of 31 days).
  // Sep: 710 x 3/30 = 71 (each category's share is below what it has left: 40 + 16 + 15). Oct: 400 x 4/31 = 51.61, 160 x 4/31 = 20.65, 150 x 4/31 = 19.35 = 91.61.
  // Reserved 71 + 91.61 = 162.61. Safe = 2000 - 1200 - 40 - 162.61 = 597.39, or 85.34 a day.
  const r = B.safeToSpend(budgetWithSpends(), P(), M.exampleNights(TODAY), TODAY, { cashOnHand: 2000 });
  assert.equal(r.income.source, 'entered');
  assert.equal(r.income.amount, 2000);
  assert.equal(r.billsTotal, 1200);
  assert.deepEqual(dates(r.bills), ['b1@2026-10-01']);
  assert.equal(r.goalsTotal, 40);
  assert.equal(r.categoriesTotal, 162.61);
  assert.equal(r.safe, 597.39);
  assert.equal(r.perDay, 85.34);
  assert.equal(r.daysAway, 7);
  // After payday: next period 10-05..10-18 has phone (10-15) = 65.
  const t = M.periodTotals(P(), M.exampleNights(TODAY), 0, TODAY);
  assert.deepEqual(dates(r.after.bills), ['b2@2026-10-15']);
  assert.equal(r.after.projectedCheck, M.round2(t.chk * 2.5));
  // Cash tips likely kept in the 14-day window: the typical cash per 14-day pay period (take-home - check), x 14 / 14.
  const th = B.typicalTakeHome(P(), M.exampleNights(TODAY), TODAY);
  assert.ok(th.cash > 0);
  assert.equal(r.after.cashExpectedTotal, th.cash);
  assert.equal(r.after.left, M.round2(M.round2(t.chk * 2.5) + th.cash - 65 - 40 - 320.65));
  assert.equal(r.after.categoriesTotal, 320.65); // 710 x 14 / 31 for 10-05..10-18
});

test('safe to spend uses cash from nights when no cash on hand is entered', () => {
  const nights = M.exampleNights(TODAY);
  const r = B.safeToSpend(B.emptyBudget(), P(), nights, TODAY);
  assert.equal(r.income.source, 'cash');
  assert.equal(r.income.amount, M.periodTotals(P(), nights, 0, TODAY).cash);
  assert.equal(r.safe, r.income.amount);
});

test('paid bills are excluded', () => {
  const b = budgetWithSpends();
  b.paidBills = { 'b1@2026-10-01': true };
  const r = B.safeToSpend(b, P(), M.exampleNights(TODAY), TODAY, { cashOnHand: 2000 });
  assert.equal(r.billsTotal, 0);
  assert.equal(r.safe, 1797.39); // 597.39 + the 1200 rent that is paid
});

test('category money is a day-based allowance when payday is before month end', () => {
  // Period 09-01..09-14, today 09-05: payday 09-15 is 10 days away. September has 30 days.
  const p = { freq: 14, periodStart: '2026-09-01', shifts: 6, payTypes: [], deductions: [] };
  const b = { ...B.emptyBudget(), categories: [{ id: 'c', name: 'Fun', monthly: 260 }] };
  const r = B.safeToSpend(b, p, [], '2026-09-05', { cashOnHand: 300 });
  assert.equal(r.daysAway, 10);
  assert.equal(r.categories[0].reserved, 86.67); // 260 x 10/30
  assert.equal(r.safe, 213.33); // 300 - 86.67
});

test('a goal never sets aside more than it still needs', () => {
  const b = { ...B.emptyBudget(), goals: [{ id: 'g', name: 'G', target: 100, saved: 90, perPaycheck: 40 }] };
  assert.equal(B.safeToSpend(b, P(), [], TODAY, { cashOnHand: 50 }).goalsTotal, 10);
});

test('migrateBudget handles garbage', () => {
  assert.deepEqual(B.migrateBudget(null), B.emptyBudget());
  assert.deepEqual(B.migrateBudget('nope'), B.emptyBudget());
  assert.deepEqual(B.migrateBudget({ bills: 5, goals: 'x', paidBills: [] }), B.emptyBudget());
  const m = B.migrateBudget(
    {
      bills: [
        null,
        { name: '', amount: 'abc', dueDay: 99 },
        { id: 'k', name: 'Gym', amount: '19.999', dueDay: -3 },
      ],
      categories: [{ monthly: -5 }],
      goals: [{ target: 'x' }],
      spends: [
        { date: 'bad', amount: 5 },
        { date: '2026-09-01', amount: '12.5', categoryId: 7, note: 'tacos' },
      ],
      paidBills: { '0:b1': true, '1:b1': 'yes' },
    },
    undefined,
    '2026-09-28',
  );
  assert.deepEqual(m.bills, [
    { id: 'b1', name: 'Bill', amount: 0, dueDay: 31, since: '2026-09-28' },
    { id: 'k', name: 'Gym', amount: 20, dueDay: 1, since: '2026-09-28' },
  ]);
  assert.deepEqual(m.categories, [{ id: 'c1', name: 'Category', monthly: 0 }]);
  assert.deepEqual(m.goals, [{ id: 'g1', name: 'Goal', target: 0, saved: 0, perPaycheck: 0 }]);
  assert.deepEqual(m.spends, [
    { id: 's1', date: '2026-09-01', amount: 12.5, categoryId: '7', note: 'tacos' },
  ]);
  assert.deepEqual(m.paidBills, { '0:b1': true });
  assert.deepEqual(B.migrateBudget(B.exampleBudget()), B.exampleBudget());
});

test('without an entered balance, spending logged this period comes out of the cash tips', () => {
  const nights = M.exampleNights(TODAY);
  const cash = M.periodTotals(P(), nights, 0, TODAY).cash;
  const b = { ...B.emptyBudget(), categories: [{ id: 'c', name: 'Fun', monthly: 100 }], spends: [] };
  const before = B.safeToSpend(b, P(), nights, TODAY);
  b.spends = [
    { id: 's', date: '2026-09-25', amount: 30, categoryId: 'c' },
    { id: 'old', date: '2026-09-01', amount: 99, categoryId: 'x' },
  ];
  const after = B.safeToSpend(b, P(), nights, TODAY);
  assert.equal(after.income.cash, cash);
  assert.equal(after.income.spent, 30); // the 09-01 spend was before this period
  assert.equal(after.income.amount, M.round2(cash - 30));
  // Fun: 100 a month, 30 spent so 70 left. Window 7 days = 100 x 3/30 (10) + 100 x 4/31 (12.90) = 22.90, less than 70 either way.
  assert.equal(before.categoriesTotal, 22.9);
  assert.equal(after.categoriesTotal, 22.9);
  assert.equal(after.safe, M.round2(before.safe - 30)); // the money spent leaves the money you have; the day allowance is unchanged
});

test('payDelay: default is 1 and clamps to 0-21', () => {
  assert.equal(B.payDelayOf({}), 1);
  assert.equal(B.payDelayOf({ payDelay: '' }), 1);
  assert.equal(B.payDelayOf({ payDelay: null }), 1);
  assert.equal(B.payDelayOf({ payDelay: 0 }), 0);
  assert.equal(B.payDelayOf({ payDelay: 99 }), 21);
  assert.equal(B.payDelayOf({ payDelay: -3 }), 0);
  assert.equal(B.hasPayDelay({}), false);
  assert.equal(B.hasPayDelay({ payDelay: 0 }), true);
  assert.deepEqual(B.nextPayday({ ...P(), payDelay: 1 }, TODAY), B.nextPayday(P(), TODAY));
});

test('payDelay 4: payday is end + 4, same period while inside it', () => {
  const p = { ...P(), payDelay: 4 }; // period 09-21..10-04
  const np = B.paydayInfo(p, TODAY);
  assert.equal(np.date, '2026-10-08');
  assert.equal(np.daysAway, 10);
  assert.equal(np.periodIndex, 0);
});

test('payDelay 4: between period end and payday, next payday is for the previous period', () => {
  const p = { ...P(), payDelay: 4 };
  const today = '2026-10-06'; // period 10-05..10-18 has begun; check for 09-21..10-04 arrives 10-08
  const np = B.paydayInfo(p, today);
  assert.equal(np.date, '2026-10-08');
  assert.equal(np.daysAway, 2);
  assert.equal(np.periodIndex, 0);
  assert.equal(B.nextPayday(p, '2026-10-08').date, '2026-10-22'); // on payday itself the next one is the following
  const b = {
    ...B.emptyBudget(),
    bills: [
      { id: 'a', name: 'A', amount: 100, dueDay: 7 }, // 10-07: before payday, counts now
      { id: 'c', name: 'C', amount: 50, dueDay: 10 }, // 10-10: after payday
      { id: 'd', name: 'D', amount: 25, dueDay: 8 }, // 10-08: on payday, comes out of that check
    ],
  };
  const nights = M.exampleNights(TODAY);
  const r = B.safeToSpend(b, p, nights, today, { cashOnHand: 500 });
  assert.equal(r.payday, '2026-10-08');
  assert.deepEqual(dates(r.bills), ['a@2026-10-07']);
  assert.equal(r.billsTotal, 100);
  assert.equal(r.safe, 400);
  assert.equal(r.after.periodStart, '2026-10-08');
  assert.equal(r.after.periodEnd, '2026-10-21'); // following payday is 10-22
  assert.deepEqual(dates(r.after.bills), ['d@2026-10-08', 'c@2026-10-10']);
  // Projected check is the finished period's check estimate, not the current period's.
  assert.equal(r.after.projectedCheck, M.periodTotals(p, nights, 0, today).chk);
  assert.equal(r.after.left, M.round2(r.after.projectedCheck + r.after.cashExpectedTotal - 75));
  assert.ok(r.after.cashExpectedTotal > 0, 'cash tips in the window count too');
});

test('payDelay 0: check arrives on the last day of the period', () => {
  const p = { ...P(), payDelay: 0 };
  assert.deepEqual(B.nextPayday(p, TODAY), { date: '2026-10-04', daysAway: 6 });
  assert.equal(B.nextPayday(p, '2026-10-04').date, '2026-10-18'); // payday today counts as paid
  assert.equal(B.nextPayday(p, '2026-10-05').date, '2026-10-18');
  const r = B.safeToSpend(B.exampleBudget(LONG_AGO), p, M.exampleNights(TODAY), TODAY, { cashOnHand: 2000 });
  // due before 10-04; b3 (9-20) fell on the last payday and is still unpaid, so it still counts
  assert.deepEqual(dates(r.bills), ['b3@2026-09-20', 'b1@2026-10-01']);
  assert.equal(r.after.periodStart, '2026-10-04');
});

test('semimonthly paydays use payDelay, short months and pre-start dates', () => {
  const p = { freq: 'semimonthly', periodStart: '2027-02-01', payDelay: 3 };
  // 1st-15th pays Feb 18; 16th-28th (13 days) pays Mar 3
  assert.deepEqual(B.nextPayday(p, '2027-02-10'), { date: '2027-02-18', daysAway: 8 });
  assert.deepEqual(B.nextPayday(p, '2027-02-18'), { date: '2027-03-03', daysAway: 13 });
  const info = B.paydayInfo(p, '2027-02-16');
  assert.equal(info.periodStart, '2027-02-01');
  assert.equal(info.periodEnd, '2027-02-15');
  // before the start date (negative periods)
  assert.deepEqual(B.nextPayday(p, '2027-01-10'), { date: '2027-01-18', daysAway: 8 });
  // default delay of 1 day, anchor 16
  const q = { freq: 'semimonthly', periodStart: '2026-09-16' };
  assert.deepEqual(B.nextPayday(q, '2026-09-20'), { date: '2026-10-01', daysAway: 11 });
  assert.deepEqual(B.nextPayday(q, '2026-10-01'), { date: '2026-10-16', daysAway: 15 });
});

test('safeToSpend on semimonthly counts bills up to payday and in the following half', () => {
  const b = B.migrateBudget(
    {
      bills: [
        { id: 'b1', name: 'Rent', amount: 100, dueDay: 12 },
        { id: 'b2', name: 'Phone', amount: 40, dueDay: 20 },
      ],
    },
    undefined,
    LONG_AGO,
  );
  const p = { freq: 'semimonthly', periodStart: '2026-09-01', shifts: 6, payTypes: [], deductions: [] };
  const r = B.safeToSpend(b, p, [], '2026-09-10');
  assert.equal(r.payday, '2026-09-16');
  assert.deepEqual(
    r.bills.map((x) => x.id + '@' + x.date),
    ['b1@2026-09-12'],
  );
  assert.deepEqual(
    r.after.bills.map((x) => x.id + '@' + x.date),
    ['b2@2026-09-20'],
  );
});

test('between period end and payday: projected check scales from nights with cash, never uses a partial raw total', () => {
  const p = { ...P(), payDelay: 4 };
  const today = '2026-10-06'; // check for 09-21..10-04 arrives 10-08
  const all = M.exampleNights(TODAY);
  const full = B.safeToSpend(B.emptyBudget(), p, all, today).after;
  assert.equal(full.checkFrom, 'finished');
  assert.equal(full.projectedCheck, M.periodTotals(p, all, 0, today).chk);
  // half the nights lose their cash: scale the rest up to all nights, then take off the fixed deductions once
  const half = all.map((n, i) => (i % 2 ? { ...n, cash: '' } : n));
  const n = M.shiftsPerPeriod(p, half, today, 0).n;
  const withCash = M.nightsInPeriod(p, half, 0)
    .map((x) => M.computeNight(x, p, n))
    .filter((c) => c.onCheck != null);
  const N = M.nightsInPeriod(p, half, 0).length;
  const sumC = withCash.reduce((s, c) => s + M.toCents(c.onCheck) + M.toCents(c.fixedPerShift), 0);
  const want = M.fromCents(Math.round((sumC * N) / withCash.length) - M.toCents(M.fixedTotal(p)));
  const r = B.safeToSpend(B.emptyBudget(), p, half, today).after;
  assert.equal(r.checkFrom, 'finished');
  assert.equal(r.projectedCheck, want);
  assert.ok(r.projectedCheck > M.periodTotals(p, half, 0, today).chk); // not the raw partial sum
  // no cash on any night and no past average: unknown, never a negative made-up number
  const none = all.map((x) => ({ ...x, cash: '' }));
  const u = B.safeToSpend(B.emptyBudget(), p, none, today).after;
  assert.equal(u.projectedCheck, null);
  assert.equal(u.checkFrom, null);
  assert.equal(u.left, null);
});

test('paydayInfo: short periods with a long pay delay pick the earliest check still to come', () => {
  const w = { freq: 7, periodStart: '2026-09-07', payDelay: 21 }; // 09-07..09-13 pays 10-04
  assert.deepEqual(B.nextPayday(w, '2026-09-28'), { date: '2026-10-04', daysAway: 6 });
  assert.equal(B.paydayInfo(w, '2026-09-28').periodIndex, 0);
  assert.equal(B.nextPayday(w, '2026-10-04').date, '2026-10-11');
  const two = { periodStart: '2026-09-01', periodEnd: '2026-09-02', payDelay: 21 }; // 2-day periods
  const info = B.paydayInfo(two, '2026-09-28');
  assert.equal(info.date, '2026-09-29');
  assert.equal(info.periodStart, '2026-09-07');
  const semi = { freq: 'semimonthly', periodStart: '2026-09-01', payDelay: 21 }; // 09-01..09-15 pays 10-06
  assert.equal(B.nextPayday(semi, '2026-09-28').date, '2026-10-06');
  const mon = { freq: 'monthly', periodStart: '2026-09-01', payDelay: 21 }; // 09-01..09-30 pays 10-21
  assert.equal(B.nextPayday(mon, '2026-10-05').date, '2026-10-21');
  assert.equal(B.nextPayday(mon, '2026-10-21').date, '2026-11-21');
  const r = B.safeToSpend(B.emptyBudget(), semi, [], '2026-09-28');
  assert.equal(r.payday, '2026-10-06');
  assert.equal(r.after.projectedCheck, null);
});

test('paydayInfo never hangs on a missing or broken start date; a restore leaves it blank for Setup', async () => {
  const B = await import('../app/js/budget.js');
  const S = await import('../app/js/storage.js');
  for (const bad of [
    {},
    { periodStart: 'garbage', freq: 14 },
    { periodStart: '', freq: 'semimonthly', payDelay: 21 },
  ]) {
    const r = B.paydayInfo(bad, '2026-09-29');
    assert.equal(typeof r.date, 'string');
  }
  const restored = S.decodeBackup(S.encodeBackup({ profile: {}, nights: [] }));
  // a real profile never gets an invented start date: it stays blank, and TipNet is not set up until Setup has it
  assert.equal(restored.workplaces[0].profile.periodStart, '');
  assert.equal(S.isSetUp(restored), false);
  assert.equal(typeof B.paydayInfo(restored.workplaces[0].profile, '2026-09-29').date, 'string');
});

/* ---------- review fixes ---------- */
test('paid ticks are keyed by bill id and due date', () => {
  assert.equal(B.paidKey('b1', '2026-10-01'), 'b1@2026-10-01');
  const b = budgetWithSpends();
  b.paidBills = { 'b1@2026-10-01': true };
  assert.equal(B.safeToSpend(b, P(), M.exampleNights(TODAY), TODAY, { cashOnHand: 2000 }).billsTotal, 0);
  // Changing the pay schedule moves period numbers around, but the same due date is still paid.
  const weekly = { ...P(), freq: 7, periodStart: '2026-09-28', periodEnd: '' };
  const r = B.safeToSpend(b, weekly, [], TODAY, { cashOnHand: 2000 });
  assert.ok(!r.bills.concat(r.after.bills).some((x) => x.id === 'b1' && x.date === '2026-10-01'));
  // A different month of the same bill is not paid.
  assert.equal(B.isPaid(b, { id: 'b1', date: '2026-11-01' }), false);
});

test('old period-number ticks are converted with the current profile, or dropped', () => {
  const bills = B.exampleBudget().bills; // b1 rent on the 1st, b2 phone on the 15th, b3 car on the 20th
  const old = { '0:b1': true, '1:b2': true, '0:b3': true, '5:b3': true, '0:gone': true, '0:b2': true };
  // period 0 = 09-21..10-04 (rent 10-01 only); period 1 = 10-05..10-18 (phone 10-15); '0:b3' has no due date in period 0; '5:b3' (11-30..12-13) has none either
  const out = B.convertPaidKeys(old, bills, P());
  assert.deepEqual(out, { 'b1@2026-10-01': true, 'b2@2026-10-15': true });
  // Same old keys, but the schedule changed to weekly starting 09-28: period 0 = 09-28..10-04, period 1 = 10-05..10-11.
  const weekly = { ...P(), freq: 7, periodStart: '2026-09-28', periodEnd: '' };
  assert.deepEqual(B.convertPaidKeys({ '0:b1': true, '1:b2': true }, bills, weekly), {
    'b1@2026-10-01': true,
  }); // phone is not due in 10-05..10-11
  // Two due dates in one period is ambiguous: dropped
  const long = { freq: 30, periodStart: '2026-09-01', periodEnd: '' };
  const twice = [{ id: 'x', name: 'X', amount: 1, dueDay: 30 }];
  assert.deepEqual(B.convertPaidKeys({ '0:x': true }, twice, long), { 'x@2026-09-30': true });
  // migrateBudget converts when given a profile, keeps old keys when not
  const raw = { bills, paidBills: { '0:b1': true, 'b2@2026-10-15': true } };
  assert.deepEqual(B.migrateBudget(raw, P()).paidBills, { 'b1@2026-10-01': true, 'b2@2026-10-15': true });
  assert.deepEqual(B.migrateBudget(raw).paidBills, { '0:b1': true, 'b2@2026-10-15': true });
  assert.equal(B.hasOldPaidKeys(B.migrateBudget(raw)), true);
  assert.equal(B.hasOldPaidKeys(B.migrateBudget(raw, P())), false);
  assert.deepEqual(B.migrateBudget(raw, { periodStart: 'nope' }).paidBills, { 'b2@2026-10-15': true }); // no usable schedule: unresolvable ticks dropped
});

test('saved balance: kept by migrate, junk dropped', () => {
  const asOf = '2026-09-28T21:40:00.000Z';
  assert.deepEqual(B.migrateBudget({ balance: { amount: '1234.567', asOf } }).balance, {
    amount: 1234.57,
    asOf,
  });
  assert.equal('balance' in B.migrateBudget({ balance: { amount: 'x', asOf } }), false);
  assert.equal('balance' in B.migrateBudget({ balance: { amount: 5, asOf: 'yesterday-ish' } }), false);
  assert.equal('balance' in B.migrateBudget({}), false);
  assert.deepEqual(B.migrateBudget({ balance: { amount: -20, asOf } }).balance.amount, -20); // overdrawn is allowed
});

test('safe to spend uses the saved balance minus spending logged since', () => {
  const day = new Date(2026, 8, 27, 21, 40); // local Sun 09-27 9:40 pm
  const asOf = day.toISOString();
  const b = B.exampleBudget();
  b.balance = { amount: 1000, asOf };
  b.spends = [
    {
      id: 'a',
      date: '2026-09-27',
      amount: 10,
      categoryId: 'c1',
      loggedAt: new Date(2026, 8, 27, 20, 0).toISOString(),
    }, // logged before the balance: already in it
    {
      id: 'b',
      date: '2026-09-27',
      amount: 20,
      categoryId: 'c1',
      loggedAt: new Date(2026, 8, 27, 22, 0).toISOString(),
    }, // after: counts
    {
      id: 'c',
      date: '2026-09-28',
      amount: 5.5,
      categoryId: 'c2',
      loggedAt: new Date(2026, 8, 28, 9, 0).toISOString(),
    }, // counts
    {
      id: 'd',
      date: '2026-09-20',
      amount: 99,
      categoryId: 'c2',
      loggedAt: new Date(2026, 8, 28, 9, 0).toISOString(),
    }, // backdated to before the balance: not counted
    { id: 'e', date: '2026-09-28', amount: 4, categoryId: 'c2' }, // no time recorded, later day: counts
    { id: 'f', date: '2026-09-27', amount: 3, categoryId: 'c2' }, // no time recorded, same day: assumed already in the balance
  ];
  const r = B.safeToSpend(b, P(), M.exampleNights(TODAY), TODAY);
  assert.equal(r.income.source, 'balance');
  assert.equal(r.income.cash, 1000);
  assert.equal(r.income.spent, 29.5);
  assert.equal(r.income.amount, 970.5);
  // an explicitly entered amount still wins
  const e = B.safeToSpend(b, P(), M.exampleNights(TODAY), TODAY, { cashOnHand: 50 });
  assert.equal(e.income.source, 'entered');
  assert.equal(e.income.amount, 50);
  // no balance: unchanged behaviour (cash tips)
  delete b.balance;
  assert.equal(B.safeToSpend(b, P(), M.exampleNights(TODAY), TODAY).income.source, 'cash');
});

test('a balance older than 3 days is stale', () => {
  const now = new Date(2026, 8, 30, 12, 0);
  const at = (d, h) => ({ amount: 1, asOf: new Date(2026, 8, d, h, 0).toISOString() });
  assert.equal(B.balanceIsStale(at(28, 13), now), false);
  assert.equal(B.balanceIsStale(at(27, 12), now), false); // exactly 3 days
  assert.equal(B.balanceIsStale(at(27, 11), now), true);
  assert.equal(B.balanceIsStale(undefined, now), false);
});

test('spends keep a valid loggedAt through migrate', () => {
  const m = B.migrateBudget({
    spends: [
      { date: '2026-09-01', amount: 1, loggedAt: '2026-09-01T10:00:00.000Z' },
      { date: '2026-09-02', amount: 1, loggedAt: 'nope' },
    ],
  });
  assert.equal(m.spends[0].loggedAt, '2026-09-01T10:00:00.000Z');
  assert.equal('loggedAt' in m.spends[1], false);
});

test('category money: a window that crosses a month end reserves a per-day allowance for each month', () => {
  // Payday 2026-10-05, today 09-28: 3 days left in September, then Oct 1-4.
  const b = {
    ...B.emptyBudget(),
    categories: [{ id: 'c', name: 'Fun', monthly: 310 }],
    spends: [{ id: 's', date: '2026-09-10', amount: 100, categoryId: 'c' }],
  };
  const r = B.safeToSpend(b, P(), [], TODAY, { cashOnHand: 1000 });
  assert.equal(r.daysAway, 7);
  // Sep: min(210 left, 310 x 3/30 = 31) = 31. Oct: 310 x 4/31 = 40. Total 71.
  assert.equal(r.categories[0].reserved, 31 + 40);
  // One September day more (09-27, 8 days): 310 x 4/30 = 41.33 + 40. One less (09-29, 6 days): 310 x 2/30 = 20.67 + 40. It moves about 10.33 a day.
  const r2 = B.safeToSpend(b, P(), [], '2026-09-27', { cashOnHand: 1000 });
  assert.equal(r2.categories[0].reserved, 81.33);
  const r3 = B.safeToSpend(b, P(), [], '2026-09-29', { cashOnHand: 1000 });
  assert.equal(r3.categories[0].reserved, 60.67);
});

test('category money: a window spanning two month boundaries', () => {
  // 60-day period: today 09-25, payday 11-19. Window = 6 Sep days + all 31 Oct days + 18 Nov days.
  // Sep 310 x 6/30 = 62; Oct 310 x 31/31 = 310 (its full allowance); Nov 310 x 18/30 = 186. Total 558.
  const p = { freq: 60, periodStart: '2026-09-20', shifts: 6, payTypes: [], deductions: [] };
  const b = { ...B.emptyBudget(), categories: [{ id: 'c', name: 'Fun', monthly: 310 }] };
  const r = B.safeToSpend(b, p, [], '2026-09-25', { cashOnHand: 5000 });
  assert.equal(r.daysAway, 55);
  assert.equal(r.categories[0].reserved, 62 + 310 + 186);
});

test("category money: an overspent category reserves 0 this month but still next month's days", () => {
  const b = {
    ...B.emptyBudget(),
    categories: [{ id: 'c', name: 'Fun', monthly: 310 }],
    spends: [{ id: 's', date: '2026-09-10', amount: 400, categoryId: 'c' }],
  };
  const r = B.safeToSpend(b, P(), [], TODAY, { cashOnHand: 1000 });
  assert.equal(r.categories[0].reserved, 40); // 0 for September, 310 x 4/31 for Oct 1-4
});

test("a finished period awaiting its check uses its own locked fixed total, not today's Setup", () => {
  const p = { ...P(), payDelay: 4 };
  const today = '2026-10-06';
  const half = M.exampleNights(TODAY).map((n, i) => ({
    ...n,
    snap: M.snapshotFor(p, 10),
    ...(i % 2 ? { cash: '' } : {}),
  }));
  const before = B.safeToSpend(B.emptyBudget(), p, half, today).after.projectedCheck;
  const p2 = {
    ...p,
    deductions: [...p.deductions, { id: 'd9', k: 'dental', name: 'Dental', amount: 40, mode: 'fixed' }],
  };
  assert.equal(B.safeToSpend(B.emptyBudget(), p2, half, today).after.projectedCheck, before);
});

test('month end: the last days before payday set aside a day-based allowance, not the whole month', () => {
  // Today 09-30 (1 day left in Sep), payday 10-05 is 5 days away: Sep 30 is 1 day, Oct 1-4 are 4 days.
  // Groceries 400 (nothing spent): Sep 400 x 1/30 = 13.33, Oct 400 x 4/31 = 51.61 = 64.94. Fun 150 with 145 spent: Sep min(5, 5) = 5, Oct 150 x 4/31 = 19.35 = 24.35.
  const b = {
    ...B.emptyBudget(),
    categories: [
      { id: 'g', name: 'Groceries', monthly: 400 },
      { id: 'f', name: 'Fun', monthly: 150 },
    ],
    spends: [{ id: 's', date: '2026-09-12', amount: 145, categoryId: 'f' }],
  };
  const r = B.safeToSpend(b, P(), [], '2026-09-30', { cashOnHand: 2000 });
  assert.equal(r.daysAway, 5);
  assert.equal(r.categories[0].reserved, 64.94);
  assert.equal(r.categories[1].reserved, 24.35);
  assert.equal(r.categoriesTotal, 89.29);
  assert.equal(r.safe, 1910.71);
});

test('goals: a goal ticked for this payday is not subtracted; the next paycheck still counts it', () => {
  const b = {
    ...B.emptyBudget(),
    goals: [{ id: 'g1', name: 'Fund', target: 1000, saved: 0, perPaycheck: 40 }],
  };
  const r0 = B.safeToSpend(b, P(), [], TODAY, { cashOnHand: 500 });
  assert.equal(r0.goalsTotal, 40);
  assert.equal(r0.safe, 460);
  B.recordContribution(b.goals[0], B.recordPayday(P(), TODAY), 0);
  const r1 = B.safeToSpend(b, P(), [], TODAY, { cashOnHand: 500 });
  assert.equal(r1.goalsTotal, 0);
  assert.equal(r1.goals[0].done, true);
  assert.equal(r1.safe, 500);
  assert.equal(r1.after.goalsTotal, 40); // next paycheck still sets it aside
  // After the payday passes the tick no longer applies (it was for the old payday).
  const later = B.safeToSpend(b, P(), [], r0.payday, { cashOnHand: 500 });
  assert.equal(later.goalsTotal, 40);
});

test('migrateBudget: old goalsDone ticks are dropped and saved is left alone', () => {
  const m = B.migrateBudget({
    goals: [{ id: 'g1', name: 'Fund', target: 1000, saved: 120, perPaycheck: 40 }],
    goalsDone: { 'g1@2026-10-05': true, junk: true },
  });
  assert.equal('goalsDone' in m, false);
  assert.equal(m.goals[0].saved, 120);
  assert.equal('contributions' in m.goals[0], false);
});
