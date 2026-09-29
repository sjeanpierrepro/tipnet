import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/js/math.js';
import * as B from '../app/js/budget.js';

const P = () => M.exampleProfile(); // period 2026-09-21 .. 2026-10-04
const TODAY = '2026-09-28';
const dates = (list) => list.map((b) => b.id + '@' + b.date);

test('bills due: month rollover', () => {
  const b = B.exampleBudget();
  assert.deepEqual(dates(B.billsDue(b, '2026-09-28', '2026-10-16')), ['b1@2026-10-01', 'b2@2026-10-15']);
  assert.deepEqual(dates(B.billsDue(b, '2026-12-25', '2027-01-02')), ['b1@2027-01-01']);
  assert.deepEqual(dates(B.billsDue(b, '2026-09-15', '2026-09-15')), ['b2@2026-09-15']);
  assert.deepEqual(B.billsDue(b, '2026-10-05', '2026-10-01'), []);
});

test('bills due: Feb with dueDay 30/31 and leap years', () => {
  const b = { bills: [{ id: 'x', name: 'X', amount: 10, dueDay: 31 }, { id: 'y', name: 'Y', amount: 10, dueDay: 30 }] };
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
  const inc = B.expectedIncome(P(), M.exampleNights(), TODAY);
  const t = M.periodTotals(P(), M.exampleNights(), 0, TODAY);
  assert.equal(inc.cashSoFar, t.cash);
  assert.equal(inc.checkSoFar, t.chk);
  // 4 nights logged of 10 expected: the check estimate scales by 10/4
  assert.equal(inc.projectedCheck, M.round2(t.chk * 2.5));
  assert.equal(inc.avgTakeHomePerPeriod, null);
  const none = B.expectedIncome(P(), [], TODAY);
  assert.deepEqual(none, { cashSoFar: 0, checkSoFar: 0, projectedCheck: null, avgCheckPerPeriod: null, avgTakeHomePerPeriod: null });
  // a finished period gives an average take-home, and an average check when every night has cash entered
  const later = B.expectedIncome(P(), M.exampleNights(), '2026-10-10');
  const done = M.periodTotals(P(), M.exampleNights(), 0, '2026-10-10');
  assert.equal(later.avgTakeHomePerPeriod, done.net);
  assert.equal(later.avgCheckPerPeriod, done.allCash ? done.chk : null);
  assert.equal(later.projectedCheck, later.avgCheckPerPeriod); // nothing logged in the new period yet
});

test('expected income: the check projection uses only nights with cash entered', () => {
  const n = (date, cash) => ({ ...M.exampleNights()[0], id: date, date, cash });
  const withCash = [n('2026-09-22', 150), n('2026-09-23', 150)];
  const mixed = [...withCash, n('2026-09-24', ''), n('2026-09-25', '')];
  const a = B.expectedIncome(P(), withCash, TODAY), b = B.expectedIncome(P(), mixed, TODAY);
  // two nights of check money spread over the same expected shifts give the same projection
  assert.equal(b.checkSoFar, a.checkSoFar);
  assert.equal(b.projectedCheck, a.projectedCheck);
  // no cash entered at all and no history: unknown, not zero
  assert.equal(B.expectedIncome(P(), [n('2026-09-22', '')], TODAY).projectedCheck, null);
  assert.equal(B.safeToSpend(B.emptyBudget(), P(), [], TODAY).after.left, null);
});

const budgetWithSpends = () => {
  const b = B.exampleBudget();
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
  assert.deepEqual(B.goalProgress({ target: 1000, saved: 250, perPaycheck: 40 }), { pct: 25, remaining: 750, paychecksToGo: 19 });
  assert.equal(B.goalProgress({ target: 1000, saved: 1200, perPaycheck: 40 }).paychecksToGo, 0);
  assert.equal(B.goalProgress({ target: 1000, saved: 0, perPaycheck: 0 }).paychecksToGo, null);
  assert.equal(B.goalProgress({ target: 0, saved: 0, perPaycheck: 0 }).pct, 0);
});

test('safe to spend: hand-computed example', () => {
  // Cash on hand 2000. Bills in this period (09-21..10-04): only rent, due 10-01 = 1200.
  // Goal this paycheck = 40. Categories left in September: groceries 400, gas 160-85.50 = 74.50, fun 150.
  // Payday 10-05 is 7 days away and September has 3 days left, so the whole amount is reserved: 624.50.
  // Safe = 2000 - 1200 - 40 - 624.50 = 135.50, or 19.36 a day.
  const r = B.safeToSpend(budgetWithSpends(), P(), M.exampleNights(), TODAY, { cashOnHand: 2000 });
  assert.equal(r.income.source, 'entered');
  assert.equal(r.income.amount, 2000);
  assert.equal(r.billsTotal, 1200);
  assert.deepEqual(dates(r.bills), ['b1@2026-10-01']);
  assert.equal(r.goalsTotal, 40);
  assert.equal(r.categoriesTotal, 624.5);
  assert.equal(r.safe, 135.5);
  assert.equal(r.perDay, 19.36);
  assert.equal(r.daysAway, 7);
  // After payday: next period 10-05..10-18 has phone (10-15) = 65.
  const t = M.periodTotals(P(), M.exampleNights(), 0, TODAY);
  assert.deepEqual(dates(r.after.bills), ['b2@2026-10-15']);
  assert.equal(r.after.projectedCheck, M.round2(t.chk * 2.5));
  assert.equal(r.after.left, M.round2(M.round2(t.chk * 2.5) - 65 - 40));
});

test('safe to spend uses cash from nights when no cash on hand is entered', () => {
  const nights = M.exampleNights();
  const r = B.safeToSpend(B.emptyBudget(), P(), nights, TODAY);
  assert.equal(r.income.source, 'cash');
  assert.equal(r.income.amount, M.periodTotals(P(), nights, 0, TODAY).cash);
  assert.equal(r.safe, r.income.amount);
});

test('paid bills are excluded', () => {
  const b = budgetWithSpends();
  b.paidBills = { '0:b1': true };
  const r = B.safeToSpend(b, P(), M.exampleNights(), TODAY, { cashOnHand: 2000 });
  assert.equal(r.billsTotal, 0);
  assert.equal(r.safe, 1335.5);
});

test('category money is pro-rated when payday is before month end', () => {
  // Period 09-01..09-14, today 09-05: payday 09-15 is 10 days away, 26 days left in September.
  const p = { freq: 14, periodStart: '2026-09-01', shifts: 6, payTypes: [], deductions: [] };
  const b = { ...B.emptyBudget(), categories: [{ id: 'c', name: 'Fun', monthly: 260 }] };
  const r = B.safeToSpend(b, p, [], '2026-09-05', { cashOnHand: 300 });
  assert.equal(r.daysAway, 10);
  assert.equal(r.categories[0].reserved, 100); // 260 x 10/26
  assert.equal(r.safe, 200);
});

test('a goal never sets aside more than it still needs', () => {
  const b = { ...B.emptyBudget(), goals: [{ id: 'g', name: 'G', target: 100, saved: 90, perPaycheck: 40 }] };
  assert.equal(B.safeToSpend(b, P(), [], TODAY, { cashOnHand: 50 }).goalsTotal, 10);
});

test('migrateBudget handles garbage', () => {
  assert.deepEqual(B.migrateBudget(null), B.emptyBudget());
  assert.deepEqual(B.migrateBudget('nope'), B.emptyBudget());
  assert.deepEqual(B.migrateBudget({ bills: 5, goals: 'x', paidBills: [] }), B.emptyBudget());
  const m = B.migrateBudget({
    bills: [null, { name: '', amount: 'abc', dueDay: 99 }, { id: 'k', name: 'Gym', amount: '19.999', dueDay: -3 }],
    categories: [{ monthly: -5 }],
    goals: [{ target: 'x' }],
    spends: [{ date: 'bad', amount: 5 }, { date: '2026-09-01', amount: '12.5', categoryId: 7, note: 'tacos' }],
    paidBills: { '0:b1': true, '1:b1': 'yes' },
  });
  assert.deepEqual(m.bills, [{ id: 'b1', name: 'Bill', amount: 0, dueDay: 31 }, { id: 'k', name: 'Gym', amount: 20, dueDay: 1 }]);
  assert.deepEqual(m.categories, [{ id: 'c1', name: 'Category', monthly: 0 }]);
  assert.deepEqual(m.goals, [{ id: 'g1', name: 'Goal', target: 0, saved: 0, perPaycheck: 0 }]);
  assert.deepEqual(m.spends, [{ id: 's1', date: '2026-09-01', amount: 12.5, categoryId: '7', note: 'tacos' }]);
  assert.deepEqual(m.paidBills, { '0:b1': true });
  assert.deepEqual(B.migrateBudget(B.exampleBudget()), B.exampleBudget());
});

test('without an entered balance, spending logged this period comes out of the cash tips', () => {
  const nights = M.exampleNights();
  const cash = M.periodTotals(P(), nights, 0, TODAY).cash;
  const b = { ...B.emptyBudget(), categories: [{ id: 'c', name: 'Fun', monthly: 100 }], spends: [] };
  const before = B.safeToSpend(b, P(), nights, TODAY);
  b.spends = [{ id: 's', date: '2026-09-25', amount: 30, categoryId: 'c' }, { id: 'old', date: '2026-09-01', amount: 99, categoryId: 'x' }];
  const after = B.safeToSpend(b, P(), nights, TODAY);
  assert.equal(after.income.cash, cash);
  assert.equal(after.income.spent, 30); // the 09-01 spend was before this period
  assert.equal(after.income.amount, M.round2(cash - 30));
  assert.equal(after.safe, before.safe); // logging spending never makes safe to spend go up
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
  const b = { ...B.emptyBudget(), bills: [
    { id: 'a', name: 'A', amount: 100, dueDay: 7 },   // 10-07: before payday, counts now
    { id: 'c', name: 'C', amount: 50, dueDay: 10 },   // 10-10: after payday
    { id: 'd', name: 'D', amount: 25, dueDay: 8 },    // 10-08: on payday, comes out of that check
  ] };
  const nights = M.exampleNights();
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
  assert.equal(r.after.left, M.round2(r.after.projectedCheck - 75));
});

test('payDelay 0: check arrives on the last day of the period', () => {
  const p = { ...P(), payDelay: 0 };
  assert.deepEqual(B.nextPayday(p, TODAY), { date: '2026-10-04', daysAway: 6 });
  assert.equal(B.nextPayday(p, '2026-10-04').date, '2026-10-18'); // payday today counts as paid
  assert.equal(B.nextPayday(p, '2026-10-05').date, '2026-10-18');
  const r = B.safeToSpend(B.exampleBudget(), p, M.exampleNights(), TODAY, { cashOnHand: 2000 });
  assert.deepEqual(dates(r.bills), ['b1@2026-10-01']); // due before 10-04
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
  const b = B.migrateBudget({ bills: [{ id: 'b1', name: 'Rent', amount: 100, dueDay: 12 }, { id: 'b2', name: 'Phone', amount: 40, dueDay: 20 }] });
  const p = { freq: 'semimonthly', periodStart: '2026-09-01', shifts: 6, payTypes: [], deductions: [] };
  const r = B.safeToSpend(b, p, [], '2026-09-10');
  assert.equal(r.payday, '2026-09-16');
  assert.deepEqual(r.bills.map((x) => x.id + '@' + x.date), ['b1@2026-09-12']);
  assert.deepEqual(r.after.bills.map((x) => x.id + '@' + x.date), ['b2@2026-09-20']);
});
