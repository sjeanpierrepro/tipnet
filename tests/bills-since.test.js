// Bills count from the day they were added ("since"), never from before.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../app/js/budget.js';
import { migrate, seedState } from '../app/js/storage.js';

const dates = (list) => list.map((b) => b.id + '@' + b.date);

test('bills: due dates before a bill’s start date are never listed', () => {
  const b = { bills: [{ id: 'r', name: 'Rent', amount: 900, dueDay: 1, since: '2026-09-15' }] };
  assert.deepEqual(dates(B.billsDue(b, '2026-08-01', '2026-11-30')), ['r@2026-10-01', 'r@2026-11-01']);
  // on its start date it counts
  const c = { bills: [{ id: 'p', name: 'Phone', amount: 50, dueDay: 15, since: '2026-09-15' }] };
  assert.deepEqual(dates(B.billsDue(c, '2026-09-01', '2026-09-30')), ['p@2026-09-15']);
});

test('bills: old bills get the day of the update as their start, so no old due date suddenly shows as owed', () => {
  const m = B.migrateBudget(
    { bills: [{ id: 'r', name: 'Rent', amount: 900, dueDay: 1 }] },
    null,
    '2026-10-12',
  );
  assert.equal(m.bills[0].since, '2026-10-12');
  assert.deepEqual(dates(B.billsDue(m, '2026-10-01', '2026-11-05')), ['r@2026-11-01']);
  // a start date already saved is kept
  const k = B.migrateBudget(
    { bills: [{ id: 'r', dueDay: 1, amount: 1, since: '2026-01-02' }] },
    null,
    '2026-10-12',
  );
  assert.equal(k.bills[0].since, '2026-01-02');
  // through the whole-state migration too
  const S = migrate(
    { ...seedState(), budget: { bills: [{ id: 'r', dueDay: 1, amount: 1 }] } },
    { today: '2026-10-12' },
  );
  assert.equal(S.budget.bills[0].since, '2026-10-12');
});

test('bills: the example budget starts today, so it never opens with overdue bills', () => {
  const today = '2026-10-25';
  const ex = B.exampleBudget(today);
  assert.ok(ex.bills.every((b) => b.since === today));
  const profile = {
    freq: 14,
    periodStart: '2026-10-12',
    payDelay: 5,
    shifts: 4,
    payTypes: [],
    deductions: [],
  };
  const r = B.safeToSpend(ex, profile, [], today, { cashOnHand: 1000 });
  assert.ok(
    r.bills.every((b) => b.date >= today),
    'nothing before today: ' + dates(r.bills),
  );
});

test('bills: the example budget opens with a positive safe-to-spend on any day (1st, 14th, 26th-31st, leap day, new year)', async () => {
  const M = await import('../app/js/math.js');
  const days = [
    '2026-10-01',
    '2026-10-04',
    '2026-10-05',
    '2026-10-14',
    '2026-10-31',
    '2027-01-01',
    '2028-02-29',
  ];
  const real = M.todayISO();
  for (let i = 0; i < 400; i++) days.push(M.addDays(real, i));
  for (let i = 0; i < 400; i++) days.push(M.addDays('2026-10-01', i));
  days.forEach((d) => {
    const p = { ...M.exampleProfile(d), entryMode: 'tips' };
    const ex = B.exampleBudget(d);
    const r = B.safeToSpend(ex, p, M.exampleNights(d), d);
    assert.ok(r.safe >= 0, 'safe to spend on ' + d + ' is ' + r.safe);
    assert.ok(
      B.billsDue(ex, d, d).every((x) => ex.paidBills[B.paidKey(x.id, x.date)]),
      'a bill due ' + d + ' is already paid',
    );
  });
});
