import test from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../app/js/budget.js';

const weekly = { freq: 7, periodStart: '2026-09-21', payDelay: 5 }; // paydays are Fridays: 10-02, 10-09 ...
const src = (over) => ({
  id: 'i1',
  name: 'DoorDash',
  amount: 150,
  freq: 'weekly',
  nextDate: '2026-10-02',
  ...over,
});

test('weekly and every two weeks count from the next date, and never before it', () => {
  assert.deepEqual(B.incomeDates(src(), '2026-09-28', '2026-10-31'), [
    '2026-10-02',
    '2026-10-09',
    '2026-10-16',
    '2026-10-23',
    '2026-10-30',
  ]);
  assert.deepEqual(B.incomeDates(src({ nextDate: '2026-09-04' }), '2026-09-28', '2026-10-10'), [
    '2026-10-02',
    '2026-10-09',
  ]); // an old date keeps rolling forward, so nobody re-enters it
  assert.deepEqual(
    B.incomeDates(src({ freq: 'biweekly', nextDate: '2026-09-04' }), '2026-09-28', '2026-11-01'),
    ['2026-10-02', '2026-10-16', '2026-10-30'],
  );
  assert.deepEqual(B.incomeDates(src(), '2026-09-01', '2026-09-30'), []); // not before nextDate
  assert.deepEqual(B.incomeDates(src(), '2026-10-31', '2026-10-01'), []); // backwards window
});

test('weekly dates stay on the same weekday across daylight saving changes', () => {
  const all = B.incomeDates(src({ nextDate: '2026-10-28' }), '2026-10-28', '2027-03-31');
  assert.equal(all.length, 23);
  all.forEach((d, i) => {
    assert.equal(new Date(d + 'T00:00:00Z').getUTCDay(), 3, d); // always a Wednesday
    if (i) assert.equal((Date.parse(d) - Date.parse(all[i - 1])) / 864e5, 7);
  });
});

test('monthly uses the day of the month, clamped to the last day of short months and leap Februaries', () => {
  const m = src({ freq: 'monthly', nextDate: '2027-01-31', days: [31] });
  assert.deepEqual(B.incomeDates(m, '2027-01-01', '2027-05-01'), [
    '2027-01-31',
    '2027-02-28',
    '2027-03-31',
    '2027-04-30',
  ]);
  assert.deepEqual(B.incomeDates(m, '2028-02-01', '2028-02-29'), ['2028-02-29']);
  assert.deepEqual(
    B.incomeDates(src({ freq: 'monthly', nextDate: '2026-11-15', days: [15] }), '2026-10-01', '2026-12-31'),
    ['2026-11-15', '2026-12-15'],
  );
  assert.deepEqual(B.incomeDates(m, '2026-12-01', '2027-01-30'), [], 'window ends before the day');
});

test('twice a month uses two days, clamped, and never counts the same date twice', () => {
  const t = src({ freq: 'twiceMonthly', nextDate: '2027-01-01', days: [15, 31] });
  assert.deepEqual(B.incomeDates(t, '2027-01-20', '2027-03-01'), ['2027-01-31', '2027-02-15', '2027-02-28']);
  const same = src({ freq: 'twiceMonthly', nextDate: '2027-01-01', days: [30, 31] });
  assert.deepEqual(B.incomeDates(same, '2027-02-01', '2027-02-28'), ['2027-02-28']);
  assert.deepEqual(B.incomeDates(t, '2027-12-01', '2028-01-31'), [
    '2027-12-15',
    '2027-12-31',
    '2028-01-15',
    '2028-01-31',
  ]);
});

test('one time arrives only on its date', () => {
  const o = src({ freq: 'once', nextDate: '2026-10-05' });
  assert.deepEqual(B.incomeDates(o, '2026-10-01', '2026-10-31'), ['2026-10-05']);
  assert.deepEqual(B.incomeDates(o, '2026-10-06', '2026-10-31'), []);
  assert.deepEqual(B.incomeDates(o, '2026-10-01', '2026-10-04'), []);
});

test('monthly equivalent: weekly x52/12, every two weeks x26/12, twice a month x2, monthly x1, one time left out', () => {
  assert.equal(B.incomeMonthlyC(src({ amount: 120 })), 52000);
  assert.equal(B.incomeMonthlyC(src({ amount: 120, freq: 'biweekly' })), 26000);
  assert.equal(B.incomeMonthlyC(src({ amount: 120, freq: 'twiceMonthly' })), 24000);
  assert.equal(B.incomeMonthlyC(src({ amount: 120, freq: 'monthly' })), 12000);
  assert.equal(B.incomeMonthlyC(src({ amount: 120, freq: 'once' })), 0);
  const b = B.migrateBudget({
    income: [
      src({ amount: 120 }),
      src({ id: 'i2', amount: 100, freq: 'monthly', days: [1] }),
      src({ id: 'i3', amount: 999, freq: 'once' }),
    ],
  });
  assert.equal(B.otherIncomeMonthly(b), 620);
  // spread over a two-week pay period: 620 x 12 x 14 / 365
  assert.equal(B.otherIncomePerPaycheck(b, { freq: 14, periodStart: '2026-09-21' }, '2026-09-28'), 285.37);
  assert.equal(B.otherIncomePerPaycheck(B.migrateBudget({}), weekly, '2026-09-28'), 0);
});

test('migrateBudget keeps old budgets valid, cleans other income and drops what cannot be used', () => {
  const none = B.migrateBudget({ bills: [] });
  assert.equal('income' in none, false);
  assert.equal('income' in B.migrateBudget(null), false);
  const b = B.migrateBudget({
    income: [
      { id: 'a', name: '  Gig  ', amount: '75.555', freq: 'monthly', nextDate: '2026-10-20', days: ['9'] },
      { id: 'b', name: 'Support', amount: 300, freq: 'twiceMonthly', nextDate: '2026-10-03', days: [31, 1] },
      { id: 'c', amount: 'lots', freq: 'weekly', nextDate: '2026-10-03' },
      { id: 'd', name: 'Bad freq', amount: 5, freq: 'daily', nextDate: '2026-10-03' },
      { id: 'e', name: 'Bad date', amount: 5, freq: 'weekly', nextDate: '2026-02-31x' },
      'junk',
      null,
      { name: 'No date', amount: 5, freq: 'once' },
    ],
  });
  assert.deepEqual(
    b.income.map((s) => s.id),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(b.income[0], {
    id: 'a',
    name: 'Gig',
    amount: 75.56,
    freq: 'monthly',
    nextDate: '2026-10-20',
    days: [9],
  });
  assert.deepEqual(b.income[1].days, [1, 31]);
  assert.equal(b.income[2].amount, 0);
  assert.equal(b.income[2].name, 'Other income');
  assert.equal('days' in b.income[2], false);
  assert.deepEqual(
    B.migrateBudget(JSON.parse(JSON.stringify(b))).income,
    b.income,
    'stable through a backup',
  );
  assert.doesNotThrow(() => B.migrateBudget({ income: 'x' }));
  assert.doesNotThrow(() => B.migrateBudget({ income: { a: 1 } }));
});

test('safe to spend adds only the other income arriving from today to the day before payday', () => {
  const budget = B.migrateBudget({
    income: [
      src({ id: 'w', name: 'DoorDash', amount: 150, nextDate: '2026-09-30' }), // Wed: 09-30, then 10-07
      src({ id: 'p', name: 'Payday side gig', amount: 40, freq: 'once', nextDate: '2026-10-02' }), // on payday
      src({ id: 'o', name: 'Old', amount: 60, freq: 'once', nextDate: '2026-09-27' }), // yesterday
    ],
  });
  const plain = B.safeToSpend(B.migrateBudget({}), weekly, [], '2026-09-28', { cashOnHand: 500 });
  const r = B.safeToSpend(budget, weekly, [], '2026-09-28', { cashOnHand: 500 });
  assert.equal(r.payday, '2026-10-02');
  assert.deepEqual(
    r.otherIncome.map((o) => o.id + '@' + o.date),
    ['w@2026-09-30'],
  );
  assert.equal(r.otherIncomeTotal, 150);
  assert.equal(r.safe, plain.safe + 150);
  // after payday (10-02 to 10-08): the payday one-time and the 10-07 weekly
  assert.deepEqual(
    r.after.otherIncome.map((o) => o.id + '@' + o.date),
    ['p@2026-10-02', 'w@2026-10-07'],
  );
  assert.equal(r.after.otherIncomeTotal, 190);
  assert.equal(plain.after.otherIncomeTotal, 0);
  if (plain.after.left != null) assert.equal(r.after.left, plain.after.left + 190);
});
