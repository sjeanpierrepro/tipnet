import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/js/math.js';
import * as B from '../app/js/budget.js';

const TODAY = '2026-09-28';
const P = () => M.exampleProfile(TODAY); // 14-day periods: 09-21..10-04, paydays 10-05, 10-19 ...
const nights = () => M.exampleNights(TODAY);
// No finished period yet, so this period's projected take-home (check + cash kept).
const check = () => B.typicalTakeHome(P(), nights(), TODAY).amount;
const budget = (over = {}) => ({ ...B.emptyBudget(), ...over });

test('possibleAside: a check with no bills, spending, goals or other income is all there is to put aside', () => {
  const pa = B.possibleAside(budget(), P(), nights(), TODAY);
  assert.equal(pa.known, true);
  assert.equal(pa.checkFrom, 'projected');
  assert.equal(pa.check, check());
  assert.equal(pa.possible, check());
  assert.deepEqual([pa.other, pa.bills, pa.spending, pa.goals], [0, 0, 0, 0]);
  assert.equal(pa.periodDays, 14);
});

test('possibleAside: bills, spending, other goals and other income, with exact numbers', () => {
  const b = budget({
    bills: [
      { id: 'b1', name: 'Rent', amount: 1200, dueDay: 1 },
      { id: 'b2', name: 'Phone', amount: 65, dueDay: 15 },
    ],
    categories: [
      { id: 'w', name: 'Groceries', monthly: 100, freq: 'weekly' },
      { id: 'm', name: 'Gas', monthly: 400 },
    ],
    goals: [
      { id: 'g1', name: 'Fund', target: 1000, saved: 0, perPaycheck: 40 },
      { id: 'g2', name: 'Almost done', target: 100, saved: 90, perPaycheck: 40 }, // needs only 10 more
      {
        id: 'g3',
        name: 'Bought',
        kind: 'purchase',
        target: 500,
        saved: 0,
        perPaycheck: 80,
        boughtAt: '2026-09-01',
      },
    ],
    income: [{ id: 'i', name: 'Side gig', amount: 50, freq: 'weekly', nextDate: '2026-10-01' }],
  });
  const pa = B.possibleAside(b, P(), nights(), TODAY);
  // Bills: 1265 x 12 x 14 / 365 = 582.25. Spending: (100 x 52 + 400 x 12) x 14 / 365 = 383.56.
  // Goals: 40 + min(40, 10) = 50 (a bought one does not count). Other income: 50 a week = 216.67 a month x 12 x 14 / 365 = 99.73.
  assert.equal(pa.bills, 582.25);
  assert.equal(pa.spending, 383.56);
  assert.equal(pa.goals, 50);
  assert.equal(pa.other, 99.73);
  assert.deepEqual(
    pa.goalList.map((g) => [g.id, g.amount]),
    [
      ['g1', 40],
      ['g2', 10],
    ],
  );
  assert.equal(pa.possible, M.round2(Math.max(0, check() + 99.73 - 582.25 - 383.56 - 50)));
});

test('possibleAside: the goal being edited is left out, and a plan counts at its own per-paycheck amount', () => {
  const plan = {
    id: 'p',
    name: 'Car',
    kind: 'purchase',
    target: 2400,
    saved: 0,
    startSaved: 0,
    perPaycheck: 100,
    createdAt: TODAY,
  };
  const b = budget({ goals: [plan] });
  assert.equal(B.possibleAside(b, P(), nights(), TODAY).goals, 100);
  const own = B.possibleAside(b, P(), nights(), TODAY, { excludeId: 'p' });
  assert.equal(own.goals, 0);
  assert.equal(own.possible, check());
});

test('possibleAside: never below zero', () => {
  const b = budget({ bills: [{ id: 'b', name: 'Rent', amount: 9000, dueDay: 1 }] });
  const pa = B.possibleAside(b, P(), nights(), TODAY);
  assert.equal(pa.known, true);
  assert.equal(pa.possible, 0);
  assert.ok(pa.bills > pa.check);
});

test('possibleAside: with no finished check or projection it says it does not know', () => {
  const pa = B.possibleAside(
    budget({ bills: [{ id: 'b', name: 'Rent', amount: 100, dueDay: 1 }] }),
    P(),
    [],
    TODAY,
  );
  assert.equal(pa.known, false);
  assert.equal(pa.possible, 0);
  assert.equal(pa.checkFrom, null);
  assert.equal(pa.bills, 46.03); // pieces are still worked out
});

test('possibleAside: the average finished check is used before the projected one', () => {
  const later = '2026-10-10'; // period 09-21..10-04 is finished
  const pa = B.possibleAside(budget(), P(), nights(), later);
  const inc = B.expectedIncome(P(), nights(), later);
  assert.equal(pa.checkFrom, 'average');
  assert.equal(pa.check, inc.avgKeptPerPeriod);
  assert.equal(
    pa.check,
    M.periodTotals(P(), nights(), 0, later).net,
    'check + cash kept of the finished period',
  );
});

test('roundDownStep, roundUpStep and asideRange (the slider only goes as high as the budget leaves)', () => {
  assert.equal(B.roundDownStep(152.5), 150);
  assert.equal(B.roundDownStep(149.99), 145);
  assert.equal(B.roundDownStep(0), 0);
  assert.equal(B.roundDownStep(5), 5);
  assert.equal(B.roundUpStep(101), 105);
  assert.equal(B.roundUpStep(100), 100);
  assert.equal(B.roundUpStep(0.01), 5);
  // max = what is possible, rounded down to $5; start = max, or less when a smaller amount finishes the goal in one paycheck
  assert.deepEqual(B.asideRange(152.5, 900), { capped: true, max: 150, start: 150, disabled: false });
  assert.deepEqual(B.asideRange(152.5, 42), { capped: true, max: 150, start: 45, disabled: false });
  assert.deepEqual(B.asideRange(152.5, 0), { capped: true, max: 150, start: 150, disabled: false });
  // nothing left: the slider is off
  assert.deepEqual(B.asideRange(3, 500), { capped: true, max: 0, start: 0, disabled: true });
  // income unknown: no cap and no slider (the amount is typed and marked an estimate)
  assert.deepEqual(B.asideRange(0, 12000, false), { capped: false, max: null, start: null, disabled: false });
});

test('live ready-by date follows the pay schedule: weekly, biweekly, semimonthly', () => {
  const goal = (per) => ({
    kind: 'purchase',
    target: 900,
    saved: 0,
    startSaved: 0,
    perPaycheck: per,
    createdAt: TODAY,
  });
  const weekly = { freq: 7, periodStart: '2026-09-21', payDelay: 5 }; // Fridays: 10-02, 10-09 ...
  const biweekly = { freq: 14, periodStart: '2026-09-21' }; // 10-05, 10-19, 11-02 ...
  const semi = { freq: 'semimonthly', periodStart: '2026-09-01' }; // 10-01, 10-16, 11-01 ...
  // $150 a paycheck: 6 paychecks. The check you are in (paid 09-25 on the weekly schedule) counts as the first.
  const w = B.purchasePlan(goal(150), weekly, TODAY);
  assert.equal(w.paychecksLeft, 6);
  assert.equal(w.readyBy, '2026-10-30');
  const bw = B.purchasePlan(goal(150), biweekly, TODAY);
  assert.equal(bw.paychecksLeft, 6);
  assert.equal(bw.readyBy, '2026-11-30');
  const sm = B.purchasePlan(goal(150), semi, TODAY);
  assert.equal(sm.paychecksLeft, 6);
  assert.equal(sm.readyBy, '2026-12-01');
  // A bigger amount is quicker, a smaller one slower.
  assert.equal(B.purchasePlan(goal(300), biweekly, TODAY).paychecksLeft, 3);
  assert.equal(B.purchasePlan(goal(50), biweekly, TODAY).paychecksLeft, 18);
  assert.ok(B.purchasePlan(goal(300), biweekly, TODAY).readyBy < bw.readyBy);
});
