import test from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../app/js/budget.js';

const weekly = { freq: 7, periodStart: '2026-09-21', payDelay: 5 }; // paydays are Fridays: 10-02, 10-09, 10-16, 10-23 ...
const biweekly = { freq: 14, periodStart: '2026-09-21' }; // 10-05, 10-19, 11-02 ...
const semi = { freq: 'semimonthly', periodStart: '2026-09-01' }; // 10-01, 10-16, 11-01 ...
const monthly = { freq: 'monthly', periodStart: '2026-09-01' }; // 10-01, 11-01, 12-01 ...
const TODAY = '2026-09-28';
const plan = (over) => ({
  id: 'p1',
  name: 'Car',
  kind: 'purchase',
  target: 400,
  saved: 0,
  startSaved: 0,
  perPaycheck: 0,
  createdAt: TODAY,
  ...over,
});

test('paychecks are counted from the next payday up to and including the last one on or before the date', () => {
  assert.equal(B.paychecksUntil(weekly, '2026-10-23', TODAY), 4);
  assert.equal(B.paychecksUntil(weekly, '2026-10-22', TODAY), 3);
  assert.equal(B.paychecksUntil(weekly, '2026-10-01', TODAY), 0);
  assert.equal(B.paychecksUntil(biweekly, '2026-11-02', TODAY), 3);
  assert.equal(B.paychecksUntil(biweekly, '2026-11-01', TODAY), 2);
  assert.equal(B.paychecksUntil(semi, '2026-11-16', TODAY), 4);
  assert.equal(B.paychecksUntil(semi, '2026-11-15', TODAY), 3);
  assert.equal(B.paychecksUntil(monthly, '2026-12-01', TODAY), 3);
  assert.equal(B.paychecksUntil(monthly, '2026-11-30', TODAY), 2);
});

test('payDelay moves the paydays that are counted', () => {
  assert.deepEqual(B.paydaysBetween({ ...semi, payDelay: 3 }, TODAY, '2026-11-03'), [
    '2026-10-03',
    '2026-10-18',
    '2026-11-03',
  ]);
  assert.equal(B.paychecksUntil({ ...monthly, payDelay: 0 }, '2026-10-31', TODAY), 2); // 09-30 and 10-31
  assert.equal(B.paychecksUntil({ ...monthly, payDelay: 0 }, '2026-10-30', TODAY), 1);
  assert.equal(B.paychecksUntil({ ...weekly, payDelay: 6 }, '2026-10-23', TODAY), 3); // paydays move to Saturdays
});

test('by a date: per paycheck is rounded UP to the cent', () => {
  const p = B.purchasePlan(plan({ target: 1000, targetDate: '2026-10-16' }), weekly, TODAY); // 3 paychecks
  assert.equal(p.mode, 'date');
  assert.equal(p.paychecksLeft, 3);
  assert.equal(p.perPaycheck, 333.34);
  assert.equal(p.readyBy, '2026-10-16');
  const q = B.purchasePlan(
    plan({ target: 1000, saved: 100, startSaved: 100, targetDate: '2026-11-13' }),
    weekly,
    TODAY,
  ); // 7 paychecks
  assert.equal(q.paychecksLeft, 7);
  assert.equal(q.perPaycheck, 128.58); // 900 / 7 = 128.571...
});

test('by a date with no paychecks left says so and needs the whole amount', () => {
  const p = B.purchasePlan(plan({ targetDate: '2026-10-01' }), weekly, TODAY);
  assert.equal(p.noPaychecks, true);
  assert.equal(p.paychecksLeft, 0);
  assert.equal(p.readyBy, null);
  assert.equal(p.perPaycheck, 400);
});

test('a fixed amount works out the paychecks and the payday it is reached', () => {
  const p = B.purchasePlan(plan({ target: 1000, perPaycheck: 110 }), weekly, TODAY);
  assert.equal(p.mode, 'fixed');
  assert.equal(p.paychecksLeft, 10); // 1000 / 110 = 9.09
  assert.equal(p.readyBy, '2026-12-04'); // 10-02 is the first, so the tenth is 9 weeks later
  assert.equal(p.perPaycheck, 110);
  const none = B.purchasePlan(plan({ perPaycheck: 0 }), weekly, TODAY);
  assert.equal(none.paychecksLeft, null);
  assert.equal(none.readyBy, null);
});

test('the amount is worked out again each payday: falling behind raises it, getting ahead lowers it', () => {
  const g = plan({ target: 400, targetDate: '2026-10-23' }); // made 09-28: 4 paychecks, 100 each
  assert.equal(B.purchasePlan(g, weekly, TODAY).perPaycheck, 100);
  const day = '2026-10-09'; // two paydays have passed, two are left
  const behind = B.purchasePlan({ ...g, saved: 0 }, weekly, day);
  assert.equal(behind.paychecksLeft, 2);
  assert.equal(behind.perPaycheck, 200);
  assert.equal(behind.onTrack, false);
  assert.equal(behind.behind, 200);
  const even = B.purchasePlan({ ...g, saved: 200 }, weekly, day);
  assert.equal(even.perPaycheck, 100);
  assert.equal(even.onTrack, true);
  assert.equal(even.behind, 0);
  const ahead = B.purchasePlan({ ...g, saved: 300 }, weekly, day);
  assert.equal(ahead.perPaycheck, 50);
  assert.equal(ahead.onTrack, true);
});

test('on track / behind for a fixed amount, counted from paychecks since it was made', () => {
  const g = plan({ target: 1000, startSaved: 50, saved: 50, perPaycheck: 100 });
  const day = '2026-10-16'; // paydays 10-02, 10-09, 10-16 have passed
  const p = B.purchasePlan({ ...g, saved: 200 }, weekly, day);
  assert.equal(p.elapsed, 3);
  assert.equal(p.expected, 350);
  assert.equal(p.behind, 150);
  assert.equal(p.onTrack, false);
  assert.equal(B.purchasePlan({ ...g, saved: 350 }, weekly, day).onTrack, true);
  assert.equal(B.purchasePlan(g, weekly, TODAY).onTrack, true); // nothing has elapsed yet
});

test('saved at or above the cost is ready to buy', () => {
  const p = B.purchasePlan(plan({ saved: 400, perPaycheck: 50 }), weekly, TODAY);
  assert.equal(p.ready, true);
  assert.equal(p.pct, 100);
  assert.equal(p.remaining, 0);
  assert.equal(p.paychecksLeft, 0);
  assert.equal(B.purchasePlan(plan({ saved: 500, targetDate: '2026-10-23' }), weekly, TODAY).ready, true);
});

test('planShare compares to a typical check and flags only a big share', () => {
  assert.deepEqual(B.planShare(110, 800), { pct: 14, big: false });
  assert.deepEqual(B.planShare(300, 800), { pct: 38, big: true });
  assert.deepEqual(B.planShare(280, 800), { pct: 35, big: false });
  assert.equal(B.planShare(110, null), null);
  assert.equal(B.planShare(110, 0), null);
});

test('migrateBudget keeps old goals as they were and cleans plan fields', () => {
  const old = B.migrateBudget({
    goals: [{ id: 'g1', name: 'Fund', target: 1000, saved: 250, perPaycheck: 40 }],
  });
  assert.deepEqual(old.goals, [{ id: 'g1', name: 'Fund', target: 1000, saved: 250, perPaycheck: 40 }]);
  const good = B.migrateBudget({
    goals: [plan({ targetDate: '2026-10-23', boughtAt: '2026-10-25', startSaved: '12.345' })],
  }).goals[0];
  assert.equal(good.kind, 'purchase');
  assert.equal(good.targetDate, '2026-10-23');
  assert.equal(good.createdAt, TODAY);
  assert.equal(good.boughtAt, '2026-10-25');
  assert.equal(good.startSaved, 12.35);
  const bad = B.migrateBudget({
    goals: [
      {
        id: 'x',
        name: 'A',
        target: 'lots',
        saved: -5,
        kind: 'purchase',
        targetDate: '2026-13-45',
        createdAt: 'yesterday',
        boughtAt: 7,
        startSaved: 'abc',
      },
      { id: 'y', name: 'B', target: 10, kind: 'weird', targetDate: '2026-10-23' },
      { id: 'z', name: 'C', target: 10, kind: 'purchase', targetDate: { a: 1 }, createdAt: null },
    ],
  }).goals;
  assert.equal(bad[0].kind, 'purchase');
  assert.equal(bad[0].target, 0);
  assert.equal(bad[0].saved, 0);
  assert.equal(bad[0].startSaved, 0);
  for (const k of ['targetDate', 'createdAt', 'boughtAt']) assert.equal(k in bad[0], false, k);
  assert.equal('kind' in bad[1], false);
  assert.equal('targetDate' in bad[1], false);
  assert.equal('targetDate' in bad[2], false);
  assert.equal('createdAt' in bad[2], false);
  // garbage never throws and a plan with bad fields still computes
  assert.doesNotThrow(() => B.purchasePlan(bad[0], weekly, TODAY));
  assert.doesNotThrow(() => B.purchasePlan({ kind: 'purchase' }, weekly, TODAY));
});

test('safe to spend subtracts the current per-paycheck amount of a plan until it is ticked; a bought plan is left out', () => {
  const budget = B.migrateBudget({ goals: [plan({ target: 400, targetDate: '2026-10-23' })] });
  const r = B.safeToSpend(budget, weekly, [], TODAY, { cashOnHand: 1000 });
  assert.equal(r.goalsTotal, 100);
  assert.equal(r.goals[0].due, 100);
  const behind = B.safeToSpend(budget, weekly, [], '2026-10-09', { cashOnHand: 1000 }); // nothing saved, two paychecks left
  assert.equal(behind.goalsTotal, 200);
  budget.goalsDone = { [B.goalKey('p1', r.payday)]: true };
  const ticked = B.safeToSpend(budget, weekly, [], TODAY, { cashOnHand: 1000 });
  assert.equal(ticked.goalsTotal, 0);
  assert.equal(ticked.after.goalsTotal, 100); // the next paycheck still sets it aside
  budget.goalsDone = {};
  budget.goals[0].boughtAt = '2026-10-01';
  const bought = B.safeToSpend(budget, weekly, [], TODAY, { cashOnHand: 1000 });
  assert.equal(bought.goalsTotal, 0);
  assert.equal(bought.goals.length, 0);
});
