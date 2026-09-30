import test from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../app/js/budget.js';

// Weekly periods Mon-Sun, check arrives 5 days after the period ends (Fri)
const profile = { freq: 7, periodStart: '2026-09-21', payDelay: 5 };
const budget = () =>
  B.migrateBudget({
    bills: [{ id: 'rent', name: 'Internet', amount: 65, dueDay: 25 }],
    categories: [],
    goals: [],
  });

test('lastPayday: the most recent payday on or before today', () => {
  assert.equal(B.lastPayday(profile, '2026-09-28'), '2026-09-25'); // period 9-14..9-20 paid 9-25
  assert.equal(B.lastPayday(profile, '2026-10-02'), '2026-10-02'); // payday today
  assert.equal(B.lastPayday(profile, '2026-10-01'), '2026-09-25');
});

test('an unpaid bill keeps counting until paid when the check arrives after the period ends', () => {
  for (const day of ['2026-09-26', '2026-09-27', '2026-09-28']) {
    const r = B.safeToSpend(budget(), profile, [], day, { cashOnHand: 500 });
    assert.equal(r.payday, '2026-10-02', day);
    assert.deepEqual(
      r.bills.map((b) => b.id + '@' + b.date),
      ['rent@2026-09-25'],
      'listed on ' + day,
    );
    assert.equal(r.billsTotal, 65);
  }
  // once paid it drops out
  const b = budget();
  b.paidBills[B.paidKey('rent', '2026-09-25')] = true;
  assert.equal(B.safeToSpend(b, profile, [], '2026-09-28', { cashOnHand: 500 }).bills.length, 0);
});
