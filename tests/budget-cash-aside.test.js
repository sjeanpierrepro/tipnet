// "Room to put aside" counts what a person actually brings home: the check plus the cash tips they keep.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/js/math.js';
import * as B from '../app/js/budget.js';

const TODAY = '2026-10-04'; // last day of the biweekly pay period 09-21..10-04, with its 10 nights logged
const P = () => M.exampleProfile('2026-09-28');
/** Two pay periods of 10 nights each: $300 made, $220 of it cash. */
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

test('mostly-cash nights: the logged take-home is check + cash kept, not the small check', () => {
  const th = B.loggedTakeHome(P(), cashNights(), TODAY);
  assert.deepEqual(th, { amount: 2440.5, from: 'logged', check: 240.5, cash: 2200, noCash: 0, setAside: 0 });
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
    short: false,
  });
});

test('cash that skipped payroll: the taxes to set aside on it come off the take-home', () => {
  const p = { ...P(), cashOffPayroll: true };
  const nights = cashNights(p, true);
  const done = M.periodTotals(p, nights, 0, TODAY);
  assert.ok(done.setAside > 0);
  const th = B.loggedTakeHome(p, nights, TODAY);
  assert.equal(th.amount, M.round2(done.net - done.setAside));
  assert.equal(B.possibleAside(B.emptyBudget(), p, nights, TODAY).possible, th.amount);
});

test('several establishments: a mostly-cash second job counts its cash too, as logged', () => {
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
  const tB = B.loggedTakeHome(second, sNights, TODAY);
  assert.ok(tB.cash > tB.check, 'the second job is mostly cash');
  const pa = B.possibleAside(rentAndFood(), null, null, TODAY, { sources, funderId: 'A' });
  // as logged in its current pay period (15 days), shared over Main's 14 days, never scaled up
  assert.equal(pa.otherChecks, Math.round((M.toCents(tB.amount) * 14) / 15) / 100);
  // From the second job: its own take-home (check + cash) caps what one of its checks can put aside, not its small check.
  const pb = B.possibleAside(rentAndFood(), null, null, TODAY, { sources, funderId: 'B' });
  assert.equal(pb.check, tB.amount);
  assert.ok(pb.possible > tB.check, 'more than the small check alone');
  assert.ok(pb.possible <= tB.amount + 0.001);
});

test('after payday: future cash tips are not counted, only the check from the logged nights', () => {
  const r = B.safeToSpend(rentAndFood(), P(), cashNights(), TODAY, { cashOnHand: 500 });
  assert.equal(r.after.periodStart, '2026-10-05');
  assert.equal(r.after.cashExpectedTotal, undefined);
  assert.equal(r.after.checksTotal, M.periodTotals(P(), cashNights(), 0, TODAY).chk);
  assert.equal(
    r.after.left,
    M.round2(
      r.after.checksTotal +
        r.after.otherIncomeTotal -
        r.after.billsTotal -
        r.after.goalsTotal -
        r.after.categoriesTotal,
    ),
  );
});

test('the take-home split equals Pay periods: check and cash as periodTotals, a no-cash night and taxes on cash shown apart', () => {
  const p = P();
  const nights = [
    { id: 'a', date: '2026-09-22', total: 300, cash: 120, pay: {}, barback: false },
    { id: 'b', date: '2026-09-23', total: 280, cash: '', pay: {}, barback: false }, // no cash entered
    { id: 'c', date: '2026-09-24', total: 250, cash: 150, pay: {}, barback: false, cashOffPayroll: true },
  ];
  const t = M.periodTotals(p, nights, 0, TODAY);
  assert.ok(t.setAside > 0, 'the off-payroll night has taxes to set aside');
  const th = B.loggedTakeHome(p, nights, TODAY);
  assert.equal(th.check, t.chk, 'Check = On your check so far');
  assert.equal(th.cash, t.cash, 'Cash you keep = Cash you keep so far');
  assert.equal(th.setAside, t.setAside);
  const noCashNight = M.computeNight(nights[1], p, M.shiftsPerPeriod(p, nights, TODAY, 0).n).net;
  assert.equal(th.noCash, noCashNight, 'the no-cash night is its own line, not counted as cash');
  // the rows add up to the amount the room math uses, to the cent
  assert.equal(
    M.toCents(th.check) + M.toCents(th.cash) + M.toCents(th.noCash) - M.toCents(th.setAside),
    M.toCents(th.amount),
  );
  assert.equal(th.amount, M.round2(t.net - t.setAside));
  const pa = B.possibleAside(B.emptyBudget(), p, nights, TODAY);
  assert.equal(pa.cash, t.cash);
  assert.equal(pa.noCash, th.noCash);
  assert.equal(pa.setAside, t.setAside);
});
