// Recurring non-taxable money (a mileage or allowance line on the stub) is part of every check, so Budget must see it:
// the take-home logged this pay period, the check after payday, and the "safe to spend" window.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/js/math.js';
import * as B from '../app/js/budget.js';

const TODAY = '2026-10-10'; // the example period 09-21..10-04 is finished; with payDelay 7 its check arrives 10-11
const LAST_DAY = '2026-10-04'; // the last day of that period, while it still runs
const profileWith = (amount) => {
  const p = M.exampleProfile('2026-09-28'); // pay periods 09-21..10-04, 10-05..10-18
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
// (while the period runs the untaxed money counts per logged night, so it is a share of that amount)
const some = (d) => assert.ok(d > 0 && d <= 100.01, 'delta ' + d);
const inRange = (d) => assert.ok(d > 85 && d <= 100.01, 'delta ' + d);

test('budget: recurring non-taxable money raises the logged take-home and the check (nearly) by that amount', () => {
  const base = B.loggedTakeHome(profileWith(0), NIGHTS(), LAST_DAY);
  const more = B.loggedTakeHome(profileWith(100), NIGHTS(), LAST_DAY);
  assert.ok(base.amount != null && more.amount != null);
  some(more.amount - base.amount);
  some(more.check - base.check);
  // the cash kept is unchanged
  assert.ok(Math.abs(more.cash - base.cash) < 0.02);
});

test('budget: after payday and safe to spend count the untaxed money', () => {
  const run = (amount) => {
    const p = profileWith(amount);
    p.payDelay = 7;
    return B.safeToSpend(budget(), p, NIGHTS(), TODAY, { cashOnHand: 50 });
  };
  const base = run(0);
  const more = run(100);
  assert.equal(base.after.checkState, 'ended');
  assert.ok(base.after.checkNights > 0);
  inRange(more.after.checksTotal - base.after.checksTotal);
  inRange(more.after.left - base.after.left);
  // money from a check is not counted until payday: today's safe amount is unchanged by it
  assert.equal(more.safe, base.safe);
  const aside = (amount) => B.possibleAside(budget(), profileWith(amount), NIGHTS(), LAST_DAY).possible;
  assert.ok(aside(100) >= aside(0));
});
