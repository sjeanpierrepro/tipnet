// Pay periods goal card maths (budget.js): pay periods a year, monthly -> per pay period, the extra goal (a month or a
// week), and the budget's monthly needs (bills + savings goals). Everything to the cent.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  periodsPerYear,
  perPeriodC,
  monthlyFromPerPeriodC,
  extraGoalC,
  monthlyNeeds,
  migrateBudget,
  emptyBudget,
} from '../app/js/budget.js';

const TODAY = '2026-10-22';
const weekly = { periodStart: '2026-10-19', freq: 7 };
const biweekly = { periodStart: '2026-10-12', freq: 14 };
const twiceMonth = { periodStart: '2026-10-01', freq: 'semimonthly' };
const monthly = { periodStart: '2026-10-01', freq: 'monthly' };
const tenDays = { periodStart: '2026-10-20', periodEnd: '2026-10-29', freq: 14 }; // the dates make it 10 days

test('pay periods a year: 52, 26, 24, 12, and 364 / days for any other length', () => {
  assert.equal(periodsPerYear(weekly, TODAY), 52);
  assert.equal(periodsPerYear(biweekly, TODAY), 26);
  assert.equal(periodsPerYear(twiceMonth, TODAY), 24);
  assert.equal(periodsPerYear(monthly, TODAY), 12);
  assert.equal(periodsPerYear(tenDays, TODAY), 36.4);
  assert.equal(periodsPerYear({ periodStart: '2026-10-01', freq: 30 }, TODAY), 364 / 30);
});

test('a month converted to one pay period: x 12 / pay periods a year, exact cents', () => {
  assert.equal(perPeriodC(280000, biweekly, TODAY), 129231); // $2,800 a month = $1,292.31 every two weeks
  assert.equal(perPeriodC(280000, weekly, TODAY), 64615); // $646.15 a week
  assert.equal(perPeriodC(280000, twiceMonth, TODAY), 140000); // $1,400.00 twice a month
  assert.equal(perPeriodC(280000, monthly, TODAY), 280000);
  assert.equal(perPeriodC(280000, tenDays, TODAY), 92308); // 2800 x 12 / 36.4 = 923.0769...
  assert.equal(perPeriodC(0, biweekly, TODAY), 0);
});

test('a per-paycheck amount converted to a month: x pay periods a year / 12, exact cents', () => {
  assert.equal(monthlyFromPerPeriodC(5000, biweekly, TODAY), 10833); // $50 x 26 / 12
  assert.equal(monthlyFromPerPeriodC(4000, weekly, TODAY), 17333); // $40 x 52 / 12
  assert.equal(monthlyFromPerPeriodC(5000, twiceMonth, TODAY), 10000);
  assert.equal(monthlyFromPerPeriodC(5000, monthly, TODAY), 5000);
});

test('extra goal: a month or a week, per pay period or per month, exact cents', () => {
  const m200 = { amount: 200, per: 'month' };
  const w100 = { amount: 100, per: 'week' };
  assert.equal(extraGoalC(m200, biweekly, TODAY), 9231); // $200 x 12 / 26 = $92.31
  assert.equal(extraGoalC(m200, weekly, TODAY), 4615);
  assert.equal(extraGoalC(m200, twiceMonth, TODAY), 10000);
  assert.equal(extraGoalC(m200, monthly, TODAY), 20000);
  assert.equal(extraGoalC(m200), 20000, 'per month: as typed');
  // a week x 52 / pay periods a year: weekly x1, every two weeks x2, twice a month x 52/24, monthly x 52/12
  assert.equal(extraGoalC(w100, weekly, TODAY), 10000);
  assert.equal(extraGoalC(w100, biweekly, TODAY), 20000);
  assert.equal(extraGoalC(w100, twiceMonth, TODAY), 21667);
  assert.equal(extraGoalC(w100, monthly, TODAY), 43333);
  assert.equal(extraGoalC(w100), 43333, 'per month: x 52 / 12');
  assert.equal(extraGoalC(null, biweekly, TODAY), 0);
  assert.equal(extraGoalC({ amount: 'abc', per: 'week' }, biweekly, TODAY), 0);
});

const src = (id, profile) => ({ id, name: id, profile, nights: [] });

test('monthly needs: bills a month + each savings goal at its own job’s pace', () => {
  const b = emptyBudget();
  b.bills = [
    { id: 'b1', name: 'Rent', amount: 1200, dueDay: 1 },
    { id: 'b2', name: 'Phone', amount: 65.5, dueDay: 15 },
  ];
  b.goals = [
    { id: 'g1', name: 'Trip', target: 1000, saved: 0, perPaycheck: 40, fundedBy: 'w' }, // weekly: 40 x 52 / 12
    { id: 'g2', name: 'Car', target: 500, saved: 0, perPaycheck: 50, fundedBy: 'b' }, // every two weeks: 50 x 26 / 12
    // only $10 left: the month counts $10.00, never 10 x 26 / 12 = $21.67 (it finishes within the month)
    { id: 'g3', name: 'Almost', target: 100, saved: 90, perPaycheck: 40, fundedBy: 'b' },
    { id: 'g4', name: 'Bought', target: 100, saved: 0, perPaycheck: 40, boughtAt: '2026-10-01' },
    { id: 'g5', name: 'No pace', target: 100, saved: 0, perPaycheck: 0 },
  ];
  const n = monthlyNeeds(b, [src('w', weekly), src('b', biweekly)], TODAY);
  assert.equal(n.bills, 1265.5);
  assert.deepEqual(
    n.goalList.map((g) => [g.id, g.monthly]),
    [
      ['g1', 173.33],
      ['g2', 108.33],
      ['g3', 10],
      ['g5', 0],
    ],
  );
  assert.equal(n.goals, 291.66);
  assert.equal(n.amount, 1557.16);
});

test('monthly needs: $10 left at $40 a week counts $10.00 a month, not $43.33; per pay period follows', () => {
  const b = emptyBudget();
  b.goals = [{ id: 'g', name: 'Almost', target: 100, saved: 90, perPaycheck: 40, fundedBy: 'w' }];
  const n = monthlyNeeds(b, [src('w', weekly)], TODAY);
  assert.equal(n.goals, 10);
  assert.equal(n.amount, 10);
  assert.equal(perPeriodC(1000, weekly, TODAY), 231, '$10.00 x 12 / 52 = $2.31 a week');
});

test('extra goal storage: amount and unit kept, anything odd cleaned or dropped', () => {
  const mb = (extraGoal) => migrateBudget({ ...emptyBudget(), extraGoal }, null, TODAY).extraGoal;
  assert.deepEqual(mb({ amount: 200, per: 'month' }), { amount: 200, per: 'month' });
  assert.deepEqual(mb({ amount: '100.5', per: 'week' }), { amount: 100.5, per: 'week' });
  assert.deepEqual(mb({ amount: 50, per: 'year' }), { amount: 50, per: 'month' }, 'unknown unit: a month');
  assert.equal(mb({ amount: 0, per: 'week' }), undefined);
  assert.equal(mb({ amount: -5, per: 'week' }), undefined);
  assert.equal(mb(200), undefined, 'not an object');
  assert.equal(mb(undefined), undefined);
});
