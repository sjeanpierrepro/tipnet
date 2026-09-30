import test from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../app/js/budget.js';

const weekly = { freq: 7, periodStart: '2026-09-21', payDelay: 5 }; // paydays are Fridays: 09-25, 10-02, 10-09, 10-16, 10-23 ...
const TODAY = '2026-09-28'; // the check you are in came on 09-25
const CHECK = '2026-09-25';
const goal = (over) => ({
  id: 'p1',
  name: 'Car down payment',
  kind: 'purchase',
  target: 400,
  saved: 0,
  startSaved: 0,
  perPaycheck: 0,
  createdAt: TODAY,
  ...over,
});
const at = '2026-09-28T12:00:00.000Z';

test('recordPayday is the most recent payday on or before today', () => {
  assert.equal(B.recordPayday(weekly, TODAY), CHECK);
  assert.equal(B.recordPayday(weekly, '2026-10-02'), '2026-10-02');
  assert.equal(B.recordPayday(weekly, '2026-10-01'), CHECK);
});

test('recording a contribution adds to saved and stops the set-aside until the next payday', () => {
  const b = {
    ...B.emptyBudget(),
    goals: [{ id: 'g1', name: 'Fund', target: 1000, saved: 10, perPaycheck: 40 }],
  };
  const r0 = B.safeToSpend(b, weekly, [], TODAY, { cashOnHand: 500 });
  assert.equal(r0.goalsTotal, 40);
  const res = B.recordContribution(b.goals[0], CHECK, 25.5, { planned: 40, recordedAt: at });
  assert.deepEqual(res, { ok: true, edited: false, index: 0 });
  assert.equal(b.goals[0].saved, 35.5);
  assert.deepEqual(b.goals[0].contributions, [{ payday: CHECK, amount: 25.5, planned: 40, recordedAt: at }]);
  const r1 = B.safeToSpend(b, weekly, [], TODAY, { cashOnHand: 500 });
  assert.equal(r1.goalsTotal, 0);
  assert.equal(r1.goals[0].done, true);
  assert.equal(r1.safe, 500);
  assert.equal(r1.after.goalsTotal, 40);
  // the next payday comes: the amount recorded for the old check no longer applies
  const next = B.safeToSpend(b, weekly, [], '2026-10-02', { cashOnHand: 500 });
  assert.equal(next.goalsTotal, 40);
  // an extra (no payday) never stops the set-aside
  const c = { ...b, goals: [{ id: 'g1', name: 'Fund', target: 1000, saved: 0, perPaycheck: 40 }] };
  B.recordContribution(c.goals[0], null, 30);
  assert.equal(B.safeToSpend(c, weekly, [], TODAY, { cashOnHand: 500 }).goalsTotal, 40);
  assert.equal(c.goals[0].saved, 30);
});

test('0 is allowed, negative and unreadable amounts are refused, more than planned is allowed', () => {
  const g = goal({ saved: 5 });
  assert.equal(B.recordContribution(g, CHECK, 0).ok, true);
  assert.equal(g.saved, 5);
  assert.equal(B.isGoalDone(g, CHECK), true);
  const h = goal({ saved: 5 });
  for (const bad of [-1, '-0.01', '', 'abc', null, undefined, NaN])
    assert.equal(B.recordContribution(h, CHECK, bad).ok, false, String(bad));
  assert.equal(h.contributions, undefined);
  assert.equal(h.saved, 5);
  assert.equal(B.recordContribution(h, CHECK, 999).ok, true);
  assert.equal(h.saved, 1004);
});

test('entering again for the same payday edits it and moves saved by the difference', () => {
  const g = goal();
  B.recordContribution(g, CHECK, 150);
  const res = B.recordContribution(g, CHECK, 100);
  assert.equal(res.edited, true);
  assert.equal(g.contributions.length, 1);
  assert.equal(g.contributions[0].amount, 100);
  assert.equal(g.saved, 100);
  B.recordContribution(g, CHECK, 120.25);
  assert.equal(g.saved, 120.25);
});

test('history: edit and remove adjust saved, and undo puts it back exactly', () => {
  const g = goal();
  B.recordContribution(g, CHECK, 100);
  B.recordContribution(g, '2026-10-02', 60);
  B.recordContribution(g, null, 50);
  assert.equal(g.saved, 210);
  assert.equal(B.editContribution(g, 1, 80).ok, true);
  assert.equal(g.saved, 230);
  assert.equal(B.editContribution(g, 1, -5).ok, false);
  assert.equal(g.saved, 230);
  const u = B.removeContribution(g, 0);
  assert.equal(g.saved, 130);
  assert.equal(g.contributions.length, 2);
  B.restoreContribution(g, u);
  assert.equal(g.saved, 230);
  assert.deepEqual(
    g.contributions.map((c) => c.amount),
    [100, 80, 50],
  );
  B.removeContribution(g, 2);
  B.removeContribution(g, 1);
  B.removeContribution(g, 0);
  assert.equal(g.contributions, undefined);
  assert.equal(g.saved, 0);
  assert.equal(B.removeContribution(g, 0).ok, false);
});

test('date plan: a check below plan raises the next amounts, above plan lowers them (exact numbers)', () => {
  const base = goal({ targetDate: '2026-10-23' }); // the check in hand + 4 more: 80 each
  assert.equal(B.purchasePlan(base, weekly, TODAY).perPaycheck, 80);
  const low = goal({ targetDate: '2026-10-23' });
  B.recordContribution(low, CHECK, 50);
  const a = B.purchasePlan(low, weekly, TODAY);
  assert.equal(a.paychecksLeft, 4);
  assert.equal(a.perPaycheck, 87.5); // 350 / 4
  assert.equal(a.perBefore, 80);
  assert.equal(a.perChange, 7.5);
  assert.equal(a.recorded, 50);
  const high = goal({ targetDate: '2026-10-23' });
  B.recordContribution(high, CHECK, 100);
  const c = B.purchasePlan(high, weekly, TODAY);
  assert.equal(c.perPaycheck, 75); // 300 / 4
  assert.equal(c.perChange, -5);
  const zero = goal({ targetDate: '2026-10-23' });
  B.recordContribution(zero, CHECK, 0);
  assert.equal(B.purchasePlan(zero, weekly, TODAY).perPaycheck, 100);
  // exactly on plan: nothing changes
  const on = goal({ targetDate: '2026-10-23' });
  B.recordContribution(on, CHECK, 80);
  const o = B.purchasePlan(on, weekly, TODAY);
  assert.equal(o.perPaycheck, 80);
  assert.equal(o.perChange, 0);
});

test('fixed plan: the ready-by date moves with what you put in', () => {
  const g = goal({ target: 1000, perPaycheck: 110 });
  assert.equal(B.purchasePlan(g, weekly, TODAY).readyBy, '2026-11-27');
  const none = goal({ target: 1000, perPaycheck: 110 });
  B.recordContribution(none, CHECK, 0);
  const a = B.purchasePlan(none, weekly, TODAY);
  assert.equal(a.paychecksLeft, 10);
  assert.equal(a.readyBy, '2026-12-04');
  assert.equal(a.readyByWas, '2026-11-27');
  assert.equal(a.shiftDays, 7); // one week later
  const exact = goal({ target: 1000, perPaycheck: 110 });
  B.recordContribution(exact, CHECK, 110);
  assert.equal(B.purchasePlan(exact, weekly, TODAY).shiftDays, 0);
  const more = goal({ target: 1000, perPaycheck: 110 });
  B.recordContribution(more, CHECK, 210);
  const m = B.purchasePlan(more, weekly, TODAY);
  assert.equal(m.paychecksLeft, 8);
  assert.equal(m.readyBy, '2026-11-20');
  assert.equal(m.shiftDays, -7);
});

test('a plain goal with a per-paycheck amount and a start date is tracked like a fixed plan', () => {
  const g = {
    id: 'g1',
    name: 'Fund',
    target: 500,
    saved: 0,
    startSaved: 0,
    perPaycheck: 100,
    createdAt: TODAY,
  };
  assert.equal(B.purchasePlan(g, weekly, TODAY).paychecksLeft, 5);
  B.recordContribution(g, CHECK, 100);
  const p = B.purchasePlan(g, weekly, TODAY);
  assert.equal(p.paychecksLeft, 4);
  assert.equal(p.remaining, 400);
  assert.equal(p.onTrack, true);
});

test('on track, behind and ahead are measured against the schedule made when the plan started', () => {
  const day = '2026-10-09'; // checks 09-25, 10-02, 10-09 have arrived; the plan is 80 a paycheck
  const g = goal({ targetDate: '2026-10-23' });
  B.recordContribution(g, CHECK, 80);
  B.recordContribution(g, '2026-10-02', 80);
  let p = B.purchasePlan(g, weekly, day); // nothing recorded for the 10-09 check yet: it is not expected yet
  assert.equal(p.onTrack, true);
  assert.equal(p.behind, 0);
  assert.equal(p.ahead, 0);
  assert.equal(p.expected, 160);
  B.recordContribution(g, '2026-10-09', 40); // below plan
  p = B.purchasePlan(g, weekly, day);
  assert.equal(p.expected, 240);
  assert.equal(p.saved, 200);
  assert.equal(p.onTrack, false);
  assert.equal(p.behind, 40);
  B.recordContribution(g, '2026-10-09', 140);
  p = B.purchasePlan(g, weekly, day);
  assert.equal(p.saved, 300);
  assert.equal(p.onTrack, true);
  assert.equal(p.ahead, 60);
  assert.equal(p.hasSchedule, true);
  // a goal with no start date has no schedule to be behind
  const old = { id: 'o', name: 'Old', target: 400, saved: 10, perPaycheck: 50 };
  const q = B.purchasePlan(old, weekly, day);
  assert.equal(q.hasSchedule, false);
  assert.equal(q.onTrack, true);
});

test('migrateBudget: old goalsDone dropped, contributions validated and capped, old goals unchanged', () => {
  const m = B.migrateBudget({
    goalsDone: { 'g1@2026-10-02': true },
    goals: [
      {
        id: 'g1',
        name: 'A',
        target: 100,
        saved: 30,
        perPaycheck: 10,
        createdAt: '2026-09-01',
        startSaved: 5,
        contributions: [
          { payday: '2026-09-25', amount: '12.345', planned: 10, recordedAt: at },
          { payday: '2026-09-25', amount: 99 }, // a second one for the same payday
          { payday: '2026-13-45', amount: 5 },
          { payday: '2026-10-02', amount: -3 },
          { payday: '2026-10-02', amount: 'x' },
          { payday: null, amount: 7 },
          'junk',
        ],
      },
      { id: 'g2', name: 'B', target: 10, saved: 1, perPaycheck: 1 },
    ],
  });
  assert.equal('goalsDone' in m, false);
  assert.equal(m.goals[0].saved, 30);
  assert.equal(m.goals[0].createdAt, '2026-09-01');
  assert.equal(m.goals[0].startSaved, 5);
  assert.deepEqual(m.goals[0].contributions, [
    { payday: '2026-09-25', amount: 12.35, planned: 10, recordedAt: at },
    { payday: null, amount: 7, recordedAt: '1970-01-01T12:00:00.000Z' },
  ]);
  assert.deepEqual(m.goals[1], { id: 'g2', name: 'B', target: 10, saved: 1, perPaycheck: 1 });
  const many = Array.from({ length: 260 }, (_, i) => ({ payday: null, amount: i, recordedAt: at }));
  const capped = B.migrateBudget({ goals: [{ id: 'g', name: 'G', target: 1, contributions: many }] })
    .goals[0];
  assert.equal(capped.contributions.length, 200);
  assert.equal(capped.contributions[199].amount, 259);
  assert.doesNotThrow(() => B.migrateBudget({ goals: [{ id: 'g', contributions: 'nope' }] }));
  // recording past the cap keeps only the newest
  const g = goal();
  for (let i = 0; i < 205; i++) B.recordContribution(g, null, 1);
  assert.equal(g.contributions.length, 200);
  // the result survives a round trip
  assert.deepEqual(B.migrateBudget(JSON.parse(JSON.stringify(m))), m);
});
