// Recurring non-taxable money (a mileage or allowance line on the stub) is part of every check, so Budget must see it:
// typical take-home, what is expected after payday, and the "safe to spend" window.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/js/math.js';
import * as B from '../app/js/budget.js';

const TODAY = '2026-10-10'; // the example period 09-21..10-04 is finished; its check has arrived by 10-09 or so
const profileWith = (amount) => {
  const p = M.exampleProfile(TODAY);
  p.nontaxable = amount ? [{ id: 'mile', k: 'expense', name: 'Mileage', amount, recurring: true }] : [];
  return p;
};
const NIGHTS = () =>
  ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-22', '2026-09-23', '2026-09-24'].map((date, i) => ({
    id: 'n' + i,
    date,
    total: 400,
    cash: 100,
    pay: { p1: 6 },
    barback: true,
  }));
const budget = () => B.migrateBudget({ bills: [], categories: [], goals: [] }, undefined, '2000-01-01');
// the untaxed 100 is added in full per check; the tax rate rises a little because the taxable gross is 100 lower
const inRange = (d) => assert.ok(d > 85 && d <= 100.01, 'delta ' + d);

test('budget: recurring non-taxable money raises typical take-home and the check (nearly) by that amount', () => {
  const base = B.typicalTakeHome(profileWith(0), NIGHTS(), TODAY);
  const more = B.typicalTakeHome(profileWith(100), NIGHTS(), TODAY);
  assert.ok(base.amount != null && more.amount != null);
  inRange(more.amount - base.amount);
  inRange(more.check - base.check);
  // the cash kept is unchanged
  assert.ok(Math.abs(more.cash - base.cash) < 0.02);
});

test('budget: after payday and safe to spend count the untaxed money', () => {
  const run = (amount) => B.safeToSpend(budget(), profileWith(amount), NIGHTS(), TODAY, { cashOnHand: 50 });
  const base = run(0);
  const more = run(100);
  assert.ok(base.after.projectedCheck != null);
  inRange(more.after.projectedCheck - base.after.projectedCheck);
  inRange(more.after.left - base.after.left);
  // money from a check is not counted until payday: today's safe amount is unchanged by it
  assert.equal(more.safe, base.safe);
  const aside = (amount) => B.possibleAside(budget(), profileWith(amount), NIGHTS(), TODAY).possible;
  assert.ok(aside(100) >= aside(0));
});
