// "Room to put aside" counts what a person actually brings home: the check plus the cash tips they keep.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/js/math.js';
import * as B from '../app/js/budget.js';

const TODAY = '2026-10-10'; // biweekly 09-21..10-04 and 09-07..09-20 are finished
const P = () => M.exampleProfile('2026-09-28');
/** Two finished pay periods of 10 nights each: $300 made, $220 of it cash. */
const cashNights = (p = P(), cashOffPayroll) => {
  const out = [];
  [-1, 0].forEach((k) => {
    const r = M.periodRange(p, k);
    for (let i = 0; i < 10; i++) {
      const n = {
        id: 'n' + k + '-' + i,
        date: M.addDays(r.start, i),
        total: 300,
        cash: 220,
        pay: {},
        barback: false,
      };
      if (cashOffPayroll !== undefined) n.cashOffPayroll = cashOffPayroll;
      out.push(n);
    }
  });
  return out;
};
const rentAndFood = () => ({
  ...B.emptyBudget(),
  bills: [{ id: 'r', name: 'Rent', amount: 1200, dueDay: 1 }],
  categories: [{ id: 'g', name: 'Groceries', monthly: 300 }],
});

test('mostly-cash nights: the typical take-home is check + cash kept, not the small check', () => {
  const th = B.typicalTakeHome(P(), cashNights(), TODAY);
  assert.deepEqual(th, { amount: 2440.5, from: 'average', check: 240.5, cash: 2200 });
});

test('mostly-cash nights (review repro): there is real room to put aside', () => {
  const pa = B.possibleAside(rentAndFood(), P(), cashNights(), TODAY);
  assert.equal(pa.known, true);
  assert.equal(pa.check, 2440.5);
  assert.equal(pa.paycheck, 240.5);
  assert.equal(pa.cash, 2200);
  // Rent 1200 x 12 x 14 / 365 = 552.33; groceries 300 x 12 x 14 / 365 = 138.08.
  assert.equal(pa.bills, 552.33);
  assert.equal(pa.spending, 138.08);
  assert.equal(pa.possible, 1750.09);
  assert.deepEqual(B.asideRange(pa.possible, 5000), {
    capped: true,
    max: 1750,
    start: 1750,
    disabled: false,
  });
});

test('cash that skipped payroll: the taxes to set aside on it come off the take-home', () => {
  const p = { ...P(), cashOffPayroll: true };
  const nights = cashNights(p, true);
  const done = M.periodTotals(p, nights, 0, TODAY);
  assert.ok(done.setAside > 0);
  const th = B.typicalTakeHome(p, nights, TODAY);
  assert.equal(th.amount, M.round2(done.net - done.setAside));
  assert.equal(B.possibleAside(B.emptyBudget(), p, nights, TODAY).possible, th.amount);
});

test('several restaurants: a mostly-cash second job counts its cash too, scaled to the same days', () => {
  const A = { ...P(), id: 'A' };
  const second = { ...P(), freq: 'semimonthly', periodStart: '2026-09-01', periodEnd: '2026-09-15' };
  const sNights = [];
  ['2026-09-16', '2026-09-20', '2026-09-24', '2026-09-28', '2026-10-02', '2026-10-06'].forEach((d, i) =>
    sNights.push({ id: 's' + i, date: d, total: 200, cash: 180, pay: {}, barback: false }),
  );
  const sources = [
    { id: 'A', name: 'Main', profile: A, nights: cashNights() },
    { id: 'B', name: 'Second', profile: second, nights: sNights },
  ];
  const tB = B.typicalTakeHome(second, sNights, TODAY);
  assert.ok(tB.cash > tB.check, 'the second job is mostly cash');
  const pa = B.possibleAside(rentAndFood(), null, null, TODAY, { sources, funderId: 'A' });
  const lenB = M.periodLength(second, M.periodIndex(second, TODAY));
  assert.equal(pa.otherChecks, Math.round((M.toCents(tB.amount) * 14) / lenB) / 100);
  // From the second job: its own take-home (check + cash) caps what one of its checks can put aside, not its small check.
  const pb = B.possibleAside(rentAndFood(), null, null, TODAY, { sources, funderId: 'B' });
  assert.equal(pb.check, tB.amount);
  assert.ok(pb.possible > tB.check, 'more than the small check alone');
  assert.ok(pb.possible <= tB.amount + 0.001);
});

test('after payday: cash tips you will likely keep in that window are counted', () => {
  const r = B.safeToSpend(rentAndFood(), P(), cashNights(), TODAY, { cashOnHand: 500 });
  // Window 10-19..11-01 is 14 days, one full pay period: 2200 of cash.
  assert.equal(r.after.periodStart, '2026-10-19');
  assert.equal(r.after.cashExpectedTotal, 2200);
  assert.equal(
    r.after.left,
    M.round2(
      r.after.projectedCheck +
        2200 +
        r.after.otherIncomeTotal -
        r.after.billsTotal -
        r.after.goalsTotal -
        r.after.categoriesTotal,
    ),
  );
  assert.ok(r.after.left > 1000);
});
