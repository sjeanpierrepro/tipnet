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
