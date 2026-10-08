// "Check my accuracy" safety: missed shifts, a capped step, and suspiciously large errors are reported, never hidden.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/js/math.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const TODAY = '2026-09-28';
const AFTER = '2026-10-10';
const P = () => M.exampleProfile(TODAY); // 10 shifts entered, rate 16.65%
// Ten identical nights in the example period (09-21..10-04), each with cash.
const TEN = () =>
  Array.from({ length: 10 }, (_, i) => ({
    id: i + 1,
    date: M.addDays('2026-09-21', i),
    total: 400,
    cash: 120,
    pay: { p1: 7 },
    barback: true,
  }));

test('every shift logged and an accurate check: no warnings, nothing capped', () => {
  const p = P();
  const pred = M.calibrate(p, TEN(), 0, 1, AFTER).pred;
  const c = M.calibrate(p, TEN(), 0, pred, AFTER);
  assert.equal(c.nightsLogged, 10);
  assert.equal(c.expectedShifts, 10);
  assert.equal(c.expectedSource, 'entered');
  assert.equal(c.missingNights, 0);
  assert.equal(c.suspect, false);
  assert.equal(c.capped, false);
  near(c.rOld, M.rate(p));
  near(c.rateOverride, c.uncapped);
  near(c.change, c.rateOverride - c.rOld);
});

test('a missed shift is reported and the step is capped at 3 points', () => {
  const p = P();
  const all = TEN();
  const actual = M.calibrate(p, all, 0, 1, AFTER).pred; // the real check, for all 10 shifts
  const nine = all.slice(1); // one shift never logged
  const c = M.calibrate(p, nine, 0, actual, AFTER);
  assert.equal(c.nightsLogged, 9);
  assert.equal(c.expectedShifts, 10);
  assert.equal(c.missingNights, 1);
  assert.ok(c.uncapped < c.rOld - 0.03, 'uncapped, one missing night drags the rate down a lot');
  assert.equal(c.capped, true);
  near(c.rateOverride, c.rOld - 0.03);
  near(c.change, -0.03);
});

test('an error over 25% is flagged as suspect', () => {
  const p = P();
  const pred = M.calibrate(p, TEN(), 0, 1, AFTER).pred;
  assert.equal(M.calibrate(p, TEN(), 0, pred * 1.5, AFTER).suspect, true);
  assert.equal(M.calibrate(p, TEN(), 0, pred * 0.7, AFTER).suspect, true);
  assert.equal(M.calibrate(p, TEN(), 0, pred * 1.1, AFTER).suspect, false);
});

test('expected shifts fall back to the period count when none is entered', () => {
  const p = { ...P(), shifts: 0 };
  const c = M.calibrate(p, TEN().slice(0, 4), 0, 500, AFTER);
  assert.equal(c.expectedSource, 'default'); // the only finished period is the one being checked, so it is not its own average
  assert.equal(c.expectedShifts, 8);
  assert.equal(c.missingNights, 4);
});

test('no shift count entered: the checked period is left out of the history average, so a missed night still warns', () => {
  const p = { ...P(), shifts: 0 };
  const all = [];
  for (let k = -1; k <= 0; k++)
    for (let i = 0; i < 10; i++)
      if (k === 0 && i === 9) continue;
      else
        all.push({
          id: `${k}-${i}`,
          date: M.addDays(M.periodRange(p, k).start, i),
          total: 400,
          cash: 120,
          pay: { p1: 7 },
          barback: true,
        });
  // period -1 has 10 shifts, period 0 has 9
  const c = M.calibrate(p, all, 0, 500, AFTER);
  assert.equal(c.expectedSource, 'history');
  assert.equal(c.expectedShifts, 10);
  assert.equal(c.missingNights, 1);
  // with no other history the ~4-a-week default applies
  const d = M.calibrate(
    p,
    all.filter((n) => n.id.startsWith('0-')),
    0,
    500,
    AFTER,
  );
  assert.equal(d.expectedSource, 'default');
  assert.equal(d.expectedShifts, 8);
});

/* ---------- a % of sales tip-out counted $0 because sales are missing (second v38 review) ---------- */
// Runner gets 1.25% of sales through payroll. The real check was worked out with the sales; nights imported without
// them count the runner as $0, so TipNet predicts too much and used to propose a higher tax rate (+3 points) from it.
const RUNNER = { id: 't2', k: 'runner', who: 'Runner', mode: 'pctSales', value: 1.25, from: 'payroll' };
const SALES_TODAY = '2026-10-08';
const salesProfile = () => ({
  ...M.exampleProfile(SALES_TODAY),
  periodStart: '2026-09-07',
  periodEnd: '2026-09-20',
  freq: 14,
  shifts: 8,
  tipout: { on: true, basis: 'before' },
  tipouts: [{ ...RUNNER }],
});
const salesNight = (i, sales) => ({
  id: 'n' + i,
  date: M.addDays('2026-09-08', i),
  total: 500,
  cash: 150,
  pay: { p1: 8 },
  barback: true,
  tipouts: { t2: true },
  ...(sales != null ? { sales } : {}),
});
const EIGHT = [0, 1, 2, 3, 4, 5, 6, 7];

test('Check my accuracy refuses a pay period whose % of sales person has no sales on some nights', () => {
  const p = salesProfile();
  const withSales = M.lockFinishedNights(
    p,
    EIGHT.map((i) => salesNight(i, 3000)),
    SALES_TODAY,
  ).nights;
  const noSales = M.lockFinishedNights(
    p,
    EIGHT.map((i) => salesNight(i)),
    SALES_TODAY,
  ).nights;
  const idx = M.periodIndex(p, '2026-09-10');
  const actual = M.periodTotals(p, withSales, idx, SALES_TODAY).chk;
  assert.equal(actual, 1823.92, 'the real check (with the sales)');
  assert.equal(M.periodTotals(p, noSales, idx, SALES_TODAY).chk, 2074, 'what TipNet predicts without them');
  // with the sales the check matches: nothing to change
  const right = M.calibrate(p, withSales, idx, actual, SALES_TODAY);
  assert.equal(right.ok, true);
  assert.equal(right.matched, true);
  // without them: refused like missing cash, naming the nights and who isn't counted (no rate proposed)
  const c = M.calibrate(p, noSales, idx, actual, SALES_TODAY);
  assert.equal(c.ok, false);
  assert.equal(c.reason, 'missingSales');
  assert.equal(c.missingCash, 0);
  assert.equal(c.missingSales, 8);
  assert.deepEqual(
    c.salesNights.map((x) => x.date),
    EIGHT.map((i) => M.addDays('2026-09-08', i)),
  );
  assert.deepEqual(c.salesNights[0].who, ['Runner']);
  assert.equal(c.rateOverride, undefined, 'no rate is proposed');
  // one night without sales is enough; a night where the runner wasn't ticked needs none
  const one = withSales.map((n, i) => (i === 3 ? { ...n, sales: '' } : n));
  const r1 = M.calibrate(p, one, idx, actual, SALES_TODAY);
  assert.equal(r1.reason, 'missingSales');
  assert.deepEqual(
    r1.salesNights.map((x) => x.date),
    ['2026-09-11'],
  );
  const unticked = withSales.map((n, i) => (i === 3 ? { ...n, sales: '', tipouts: { t2: false } } : n));
  assert.equal(M.calibrate(p, unticked, idx, actual, SALES_TODAY).ok, true);
  // missing cash is still reported first (the same refusal as before)
  const noCash = noSales.map((n, i) => (i === 0 ? { ...n, cash: '' } : n));
  const r2 = M.calibrate(p, noCash, idx, actual, SALES_TODAY);
  assert.equal(r2.reason, 'missingCash');
  assert.equal(r2.missingCash, 1);
});

test('Check my accuracy: a % of sales person who is not counted on the night (tip-outs after, or off) needs no sales', () => {
  const p = { ...salesProfile(), tipout: { on: true, basis: 'after' } };
  const ns = M.lockFinishedNights(
    p,
    EIGHT.map((i) => salesNight(i)),
    SALES_TODAY,
  ).nights;
  const idx = M.periodIndex(p, '2026-09-10');
  assert.equal(M.calibrate(p, ns, idx, 2000, SALES_TODAY).ok, true);
});
