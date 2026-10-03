// Picking the pay period a night counts toward (night.periodStart): math helper, totals, locking, calibration.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/js/math.js';
import * as B from '../app/js/budget.js';

const prof = (freq, periodStart, extra = {}) => ({
  ...M.exampleProfile('2026-09-28'),
  freq,
  periodStart,
  periodEnd: '',
  ...extra,
});
const night = (date, periodStart, extra = {}) => ({
  id: 'n' + date,
  date,
  total: 300,
  cash: 100,
  pay: { p1: 6 },
  barback: false,
  ...(periodStart === undefined ? {} : { periodStart }),
  ...extra,
});

test('nightPeriodIndex follows a valid picked pay period in all six schedules', () => {
  const cases = [
    [7, '2026-09-07', '2026-09-23'],
    [14, '2026-09-07', '2026-09-23'],
    [15, '2026-09-07', '2026-09-23'],
    [30, '2026-09-07', '2026-09-23'],
    ['semimonthly', '2026-09-05', '2026-09-23'],
    ['monthly', '2026-09-05', '2026-09-23'],
  ];
  for (const [freq, start, date] of cases) {
    const p = prof(freq, start);
    const own = M.periodIndex(p, date);
    assert.equal(M.nightPeriodIndex(p, night(date)), own, freq + ': no pick -> its date');
    for (const k of [own - 1, own + 1, own + 3]) {
      const s = M.periodRange(p, k).start;
      assert.equal(M.nightPeriodIndex(p, night(date, s)), k, freq + ': picked ' + s);
      assert.equal(M.nightPeriodMoved(p, night(date, s)), true);
      assert.equal(M.nightPeriodStale(p, night(date, s)), false);
    }
    // the night's own period start is not "moved"
    const ownStart = M.periodRange(p, own).start;
    assert.equal(M.nightPeriodIndex(p, night(date, ownStart)), own);
    assert.equal(M.nightPeriodMoved(p, night(date, ownStart)), false);
  }
});

test('semimonthly and monthly calendar starts (short months clamped) are accepted', () => {
  const semi = prof('semimonthly', '2026-01-15'); // anchors 15th and 30th (clamped to Feb 28)
  assert.equal(M.periodRange(semi, M.periodIndex(semi, '2026-03-01')).start, '2026-02-28');
  assert.equal(
    M.nightPeriodIndex(semi, night('2026-03-10', '2026-02-28')),
    M.periodIndex(semi, '2026-02-28'),
  );
  const mon = prof('monthly', '2026-01-31');
  assert.equal(M.nightPeriodIndex(mon, night('2026-03-10', '2026-02-28')), M.periodIndex(mon, '2026-02-28'));
  // a day that is not a calendar anchor falls back
  assert.equal(M.nightPeriodIndex(mon, night('2026-03-10', '2026-02-27')), M.periodIndex(mon, '2026-03-10'));
});

test('payDelay does not change which starts are valid', () => {
  const p = prof(14, '2026-09-07', { payDelay: 5 });
  assert.equal(M.nightPeriodIndex(p, night('2026-09-23', '2026-09-07')), 0);
  assert.equal(
    M.nightPeriodIndex(p, night('2026-09-23', '2026-09-12')),
    1,
    '5 days after a start is not a start',
  );
});

test('invalid or mismatched picks fall back to the night date and are reported stale', () => {
  const p = prof(14, '2026-09-07');
  const own = M.periodIndex(p, '2026-09-23');
  for (const bad of ['2026-09-08', '2026-02-31', 'nope', '', 7, null, '2026-9-7', '0999-01-01']) {
    assert.equal(M.nightPeriodIndex(p, night('2026-09-23', bad)), own, String(bad));
    assert.equal(M.nightPeriodMoved(p, night('2026-09-23', bad)), false);
  }
  assert.equal(M.nightPeriodStale(p, night('2026-09-23', '2026-09-08')), true);
  assert.equal(M.nightPeriodStale(p, night('2026-09-23')), false);
  // after a schedule change the old pick no longer starts a period
  const moved = night('2026-09-23', '2026-09-07');
  const weekly = prof(7, '2026-09-09');
  assert.equal(M.nightPeriodStale(weekly, moved), true);
  assert.equal(M.nightPeriodIndex(weekly, moved), M.periodIndex(weekly, '2026-09-23'));
});

test('nightPeriodChoices offers the period before, its own and the next', () => {
  const p = prof(14, '2026-09-07');
  const cs = M.nightPeriodChoices(p, '2026-09-23');
  assert.deepEqual(
    cs.map((c) => [c.start, c.end, c.own]),
    [
      ['2026-09-07', '2026-09-20', false],
      ['2026-09-21', '2026-10-04', true],
      ['2026-10-05', '2026-10-18', false],
    ],
  );
  assert.deepEqual(M.nightPeriodChoices(prof(14, 'bad'), '2026-09-23'), []);
});

test('indexNights, nightsInPeriod and periodTotals follow the assignment', () => {
  const p = prof(14, '2026-09-07');
  const a = night('2026-09-22'); // period 1 (09-21..10-04)
  const b = night('2026-09-23', '2026-09-07'); // moved to period 0
  const ns = [a, b];
  const index = M.indexNights(p, ns);
  assert.deepEqual(
    index.get(0).map((x) => x.id),
    [b.id],
  );
  assert.deepEqual(
    index.get(1).map((x) => x.id),
    [a.id],
  );
  assert.deepEqual(
    M.nightsInPeriod(p, ns, 0).map((x) => x.id),
    [b.id],
  );
  const today = '2026-09-25';
  const t0 = M.periodTotals(p, ns, 0, today, 10);
  const t1 = M.periodTotals(p, ns, 1, today, 10);
  assert.equal(t0.ns.length, 1);
  assert.equal(t1.ns.length, 1);
  const one = M.computeNight(b, p, 10).net;
  assert.equal(t1.net, M.computeNight(a, p, 10).net);
  // period 0 is finished, so its fixed deductions become exact: one night carries the whole period's fixed total
  assert.ok(t0.exact);
  assert.ok(Math.abs(t0.net - (one + M.computeNight(b, p, 10).fixedPerShift - M.fixedTotal(p))) < 0.011);
});

test('a night locks when the period it counts toward ends, not its date', () => {
  const p = prof(14, '2026-09-07');
  const forward = night('2026-09-20', '2026-09-21'); // dated in period 0, counted in period 1
  const back = night('2026-09-22', '2026-09-07'); // dated in period 1, counted in period 0
  const plain = night('2026-09-19');
  const r = M.lockFinishedNights(p, [forward, back, plain], '2026-09-25');
  const [f2, b2, p2] = r.nights;
  assert.equal(r.stamped, 2);
  assert.equal(!!f2.snap, false, 'period 1 has not ended');
  assert.equal(!!b2.snap, true, 'period 0 has ended');
  assert.equal(!!p2.snap, true);
  assert.equal(b2.periodStart, '2026-09-07', 'the pick is kept when locking');
  const later = M.lockFinishedNights(p, r.nights, '2026-10-06');
  assert.equal(!!later.nights[0].snap, true);
});

test('calibration uses the nights counted in that period, and expected shifts from the others', () => {
  const p = prof(14, '2026-09-07', { shifts: 0 });
  const ns = [
    night('2026-09-08'),
    night('2026-09-10'),
    night('2026-09-22', '2026-09-07'), // counted in period 0
    night('2026-09-25'),
  ];
  const today = '2026-10-06';
  const r = M.calibrate(p, ns, 0, 500, today);
  assert.equal(r.ok, true);
  assert.equal(r.nightsLogged, 3);
  // the expected count comes from the other finished periods: period 1 has one night
  assert.equal(r.expectedShifts, 1);
  const r1 = M.calibrate(p, ns, 1, 500, today);
  assert.equal(r1.nightsLogged, 1);
  assert.equal(r1.expectedShifts, 3);
});

test('shift history averages count nights by their assigned period', () => {
  const p = prof(14, '2026-09-07', { shifts: 0 });
  const ns = [night('2026-09-08'), night('2026-09-22', '2026-09-07'), night('2026-09-23')];
  // both periods finished: 2 nights in period 0, 1 in period 1 -> average 1.5
  assert.equal(M.shiftsPerPeriod(p, ns, '2026-10-06').n, 1.5);
  // only period 0 finished: 2 nights there (the moved one counts)
  assert.equal(M.shiftsPerPeriod(p, ns, '2026-09-25').n, 2);
});

test('weekly overtime hours stay by the calendar week worked', () => {
  const p = prof(14, '2026-09-07');
  const ns = [
    night('2026-09-21', '2026-09-07', { pay: { p1: 30 } }),
    night('2026-09-22', undefined, { pay: { p1: 15 } }),
  ];
  assert.equal(M.weeklyHours(p, ns, '2026-09-22').hours, 45);
});

/* ---------- Budget follows the pay period a night counts toward ---------- */

test('Budget: cash this period, set-aside on off-payroll cash and checks follow the assignment', () => {
  const p = prof(14, '2026-09-07', { shifts: 10 });
  const today = '2026-10-10'; // period 2 (10-05..10-18) is current, period 1 (09-21..10-04) finished
  const late = night('2026-10-04', undefined, { cash: 150, cashOffPayroll: true });
  const now = night('2026-10-06', undefined, { cash: 100 });
  const base = B.expectedIncome(p, [late, now], today);
  assert.equal(base.cashSoFar, 100);
  assert.equal(base.setAsideSoFar, 0);
  const moved = { ...late, periodStart: '2026-10-05' };
  const inc = B.expectedIncome(p, [moved, now], today);
  assert.equal(inc.cashSoFar, 250, 'the moved night’s cash counts this period');
  assert.ok(inc.setAsideSoFar > 0, 'its off-payroll set-aside too');
  assert.equal(inc.checkSoFar, M.periodTotals(p, [moved, now], 2, today, 10).chk);
  // the finished period it left has no nights now, so it no longer feeds the average check
  assert.notEqual(base.avgCheckPerPeriod, null);
  assert.equal(inc.avgCheckPerPeriod, null);
  // typical take-home (room to put aside) uses the same assignment
  assert.notEqual(B.typicalTakeHome(p, [moved, now], today), B.typicalTakeHome(p, [late, now], today));
});

test('non-taxable per-shift money and the exact amount follow the assigned period', () => {
  const p = prof(14, '2026-09-07', {
    shifts: 0,
    nontaxable: [{ id: 'x1', k: 'mileage', name: 'Mileage', amount: 40, recurring: true }],
  });
  const ns = [night('2026-09-08'), night('2026-09-22', '2026-09-07'), night('2026-09-23')];
  const today = '2026-10-10';
  // period 0 holds two nights (one moved in), period 1 one: each finished period carries exactly $40 of it
  const t0 = M.periodTotals(p, ns, 0, today);
  const t1 = M.periodTotals(p, ns, 1, today);
  assert.equal(t0.ns.length, 2);
  assert.equal(t1.ns.length, 1);
  const n = M.shiftsPerPeriod(p, ns, today).n; // 1.5
  const sum = (t) =>
    t.ns.reduce((s, x) => s + M.computeNight(x, p, n).net - M.computeNight(x, p, n).nontaxPerShift, 0);
  const fixedAdj = (t) =>
    t.ns.reduce((s, x) => s + M.computeNight(x, p, n).fixedPerShift, 0) - M.fixedTotal(p);
  assert.ok(Math.abs(t0.net - (sum(t0) + fixedAdj(t0) + 40)) < 0.02);
  assert.ok(Math.abs(t1.net - (sum(t1) + fixedAdj(t1) + 40)) < 0.02);
});
