// "Update this pay period to today's Setup" (Pay periods, finished pay periods): math.periodToSetup gives every night in
// the period a fresh snapshot of today's Setup, carries who was tipped out over to today's people, takes "I tip out" from
// today's Setup and keeps every night's tips; nothing outside the period changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/js/math.js';

const today = '2026-10-08';
const clone = (o) => JSON.parse(JSON.stringify(o));
const BARBACK = { id: 't1', k: 'barback', who: 'Barback', mode: 'pctTips', value: 15, from: 'cash' };
const RUNNER = { id: 't2', k: 'runner', who: 'Runner', mode: 'flat', value: 10, from: 'payroll' };
// 14-day pay periods from Sep 7: Sep 7-20 and Sep 21 - Oct 4 have ended, Oct 5-18 is running.
const setup = (patch = {}) => ({
  ...M.exampleProfile(today),
  periodStart: '2026-09-07',
  periodEnd: '2026-09-20',
  freq: 14,
  shifts: 10,
  tipout: { on: true },
  tipouts: [{ ...BARBACK }],
  ...patch,
});
// Locked with the old Setup: $10/h, $60 fixed, the barback 15% from cash.
const OLD = setup({ payTypes: setup().payTypes.map((t) => (t.id === 'p1' ? { ...t, rate: 10 } : t)) });
const night = (id, date, extra = {}) => ({
  id,
  date,
  total: 480,
  tips: 400,
  cash: 150,
  pay: { p1: 8 },
  barback: true,
  tipouts: { t1: true },
  tipoutOn: true,
  workplaceId: 'w1',
  ...extra,
});
const lockedAll = (nights) =>
  M.lockFinishedNights(
    OLD,
    nights.map((n) => JSON.parse(JSON.stringify(n))), // tips: null means typed as one total (no tips)
    today,
  ).nights;
const SEP = M.periodIndex(OLD, '2026-09-10');

test('every night in the finished pay period gets today’s Setup; its tips stay, its total follows the new rates', () => {
  const nights = lockedAll([
    night('a', '2026-09-08'),
    night('b', '2026-09-12', { tipouts: { t1: false }, barback: false }),
    night('c', '2026-09-15', { total: 380, tips: null }), // typed as one total: $300 of tips at $10/h
    night('d', '2026-09-25'), // the next pay period: untouched
    night('e', '2026-10-06'), // the running one: untouched
  ]);
  assert.ok(nights.slice(0, 4).every((n) => n.snap && n.snap.pay[0].rate === 10));
  const now = setup({
    tipouts: [{ ...BARBACK, value: 20 }, { ...RUNNER }],
    deductions: [...setup().deductions, { id: 'd9', k: 'dental', name: 'Dental', amount: 20, mode: 'fixed' }],
  });
  const before = clone(nights);
  const r = M.periodToSetup(now, nights, SEP, today);
  assert.deepEqual(nights, before, 'pure: nothing changed in place');
  assert.deepEqual(
    r.before.map((n) => n.id),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(
    r.after.map((n) => n.id),
    ['a', 'b', 'c'],
  );
  const [a, b, c] = r.after;
  const fresh = M.snapshotFor(now, 10);
  for (const n of r.after) {
    assert.deepEqual(n.snap, fresh, n.id + ': today’s Setup');
    assert.equal(n.tipoutOn, true);
  }
  // tips kept, total = tips + 8 h at today's $12
  assert.equal(a.tips, 400);
  assert.equal(a.total, 496);
  assert.equal(a.cash, 150);
  assert.equal(c.tips, 300, 'a total night gets its tips worked out at its old rate');
  assert.equal(c.total, 396);
  // ticks: the barback as it was, the runner (not on the night before) not ticked
  assert.deepEqual(a.tipouts, { t1: true, t2: false });
  assert.deepEqual(b.tipouts, { t1: false, t2: false });
  assert.equal(a.barback, true);
  assert.equal(b.barback, false);
  // the money: 20% for the barback now, today's fixed deductions ($80) on the period's check, exactly
  const after = nights.map((n) => r.after.find((x) => x.id === n.id) || n);
  assert.equal(M.computeNight(a, now, 10).tipout, 80);
  const t = M.periodTotals(now, after, SEP, today);
  assert.equal(t.exact, true);
  assert.equal(M.periodFixed(now, t.ns), 80);
  const was = M.periodTotals(now, nights, SEP, today);
  assert.notEqual(t.net, was.net);
  // the other pay periods are the same objects as before
  assert.equal(after[3], nights[3]);
  assert.equal(after[4], nights[4]);
});

test('"I tip out" comes from today’s Setup; a barback row added again in Setup keeps the night’s tick', () => {
  const nights = lockedAll([night('a', '2026-09-08'), night('b', '2026-09-09', { tipoutOn: false })]);
  const off = M.periodToSetup(setup({ tipout: { on: false } }), nights, SEP, today);
  assert.deepEqual(
    off.after.map((n) => [n.tipoutOn, M.computeNight(n, setup(), 10).tipout]),
    [
      [false, 0],
      [false, 0],
    ],
  );
  const again = M.periodToSetup(setup({ tipouts: [{ ...BARBACK, id: 't9' }] }), nights, SEP, today);
  assert.deepEqual(again.after[0].tipouts, { t1: true, t9: true }, 'the same barback: its tick carried over');
  assert.equal(again.after[1].tipoutOn, true, 'today’s switch');
  assert.equal(M.computeNight(again.after[0], setup(), 10).tipout, 60);
});

test('a job removed from Setup since keeps its old rate on the nights worked at it; snap.period is dropped', () => {
  const OLD2 = {
    ...OLD,
    payTypes: [...OLD.payTypes, { id: 'p9', k: 'server', name: 'Server', rate: 9, unit: 'hr' }],
  };
  const nights = M.lockFinishedNights(
    OLD2,
    [night('a', '2026-09-08', { total: 498, pay: { p1: 8, p9: 2 } }), night('b', '2026-09-09')],
    today,
  ).nights;
  nights[1].snap.period = { fixed: 50, nontax: 0 }; // recalculated by an older version
  const r = M.periodToSetup(setup(), nights, SEP, today);
  const p9 = r.after[0].snap.pay.find((t) => t.id === 'p9');
  assert.deepEqual(p9, { id: 'p9', rate: 9, unit: 'hr' });
  assert.equal(r.after[0].total, 400 + 96 + 18);
  assert.equal(
    r.after[1].snap.pay.find((t) => t.id === 'p9'),
    undefined,
    'not worked: not added',
  );
  assert.equal('period' in r.after[1].snap, false);
  assert.equal(M.periodFixed(setup(), r.after), 60);
});

test('a pay period already on today’s Setup comes back the same', () => {
  const nights = M.lockFinishedNights(setup(), [night('a', '2026-09-08', { total: 496 })], today).nights;
  const r = M.periodToSetup(setup(), nights, SEP, today);
  assert.deepEqual(r.after, r.before);
  assert.deepEqual(r.before, nights);
});
