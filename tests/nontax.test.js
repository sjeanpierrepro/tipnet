// Non-taxable earnings (owner request): left out of the gross the tax rate comes from; recurring ones are added to every
// check untaxed (per shift, exact for a finished period); one-off amounts on a night add to take-home with no withholding.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/js/math.js';
import { migrate } from '../app/js/storage.js';

const near = (a, b, eps = 0.005) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const TODAY = '2026-09-28'; // inside the example period (09-21..10-04)
const AFTER = '2026-10-10'; // after it: the period is final
const P = (mutate) => {
  const p = M.exampleProfile(TODAY);
  if (mutate) mutate(p);
  return p;
};
const withNontax = (items) => P((p) => (p.nontaxable = items));
const item = (amount, recurring = true, k = 'expense') => ({
  id: 'x' + amount,
  k,
  name: 'Thing',
  amount,
  recurring,
});
const NIGHTS = () =>
  ['2026-09-22', '2026-09-23', '2026-09-24'].map((date, i) => ({
    id: 'n' + i,
    date,
    total: 400,
    cash: 100,
    pay: { p1: 6 },
    barback: true,
  }));

test('nontax: the tax rate comes from the taxable gross (gross minus non-taxable earnings)', () => {
  const p = withNontax([item(100), item(100, false)]);
  near(M.taxableGross(p), 1800, 1e-9);
  near(M.baseRate(p), 333 / 1800, 1e-12);
  near(M.fedRate(p), 180 / 1800, 1e-12);
  assert.equal(M.stubWarnings(p).nontaxIgnored, false);
  // as big as the gross: ignored (and Setup says so)
  const bad = withNontax([item(2500)]);
  near(M.taxableGross(bad), 2000, 1e-9);
  near(M.baseRate(bad), 333 / 2000, 1e-12);
  assert.equal(M.stubWarnings(bad).nontaxIgnored, true);
  assert.equal(M.nontaxRecurring(p), 100, 'only the recurring one comes every check');
  assert.equal(M.nontaxOnStub(p), 200);
});

test('nontax: recurring money is added untaxed per shift, and exactly for a finished period', () => {
  const fixRate = (p) => {
    p.rateOverride = 0.2; // the same rate on both sides, so only the non-taxable money differs
    return p;
  };
  const plain = fixRate(P());
  const nt = fixRate(withNontax([item(100)]));
  const a = M.computeNight(NIGHTS()[0], plain, 10);
  const b = M.computeNight(NIGHTS()[0], nt, 10);
  assert.equal(b.nontaxPerShift, 10);
  assert.equal(b.tax, a.tax, 'no tax on it');
  near(b.net - a.net, 10, 1e-9);
  near(b.onCheck - a.onCheck, 10, 1e-9);
  assert.equal(b.tips, a.tips);
  // current period: per-shift shares; finished period: the exact amount on that check
  const cur = [M.periodTotals(plain, NIGHTS(), 0, TODAY, 10), M.periodTotals(nt, NIGHTS(), 0, TODAY, 10)];
  near(cur[1].net - cur[0].net, 30, 1e-9);
  const fin = [M.periodTotals(plain, NIGHTS(), 0, AFTER, 10), M.periodTotals(nt, NIGHTS(), 0, AFTER, 10)];
  near(fin[1].net - fin[0].net, 100, 1e-9);
  near(fin[1].chk - fin[0].chk, 100, 1e-9);
  // "just this once" adds nothing to checks
  const once = fixRate(withNontax([item(100, false)]));
  near(M.periodTotals(once, NIGHTS(), 0, AFTER, 10).net, fin[0].net, 1e-9);
});

test('nontax: a locked night keeps the non-taxable amount it was locked with', () => {
  const p = withNontax([item(100)]);
  const { nights } = M.lockFinishedNights(p, NIGHTS(), AFTER);
  assert.equal(nights[0].snap.nontax, 100);
  const later = { ...p, nontaxable: [] };
  near(M.computeNight(nights[0], later).nontaxPerShift, M.computeNight(nights[0], p).nontaxPerShift, 1e-9);
  near(M.periodTotals(later, nights, 0, AFTER).net, M.periodTotals(p, nights, 0, AFTER).net, 1e-9);
  assert.equal(M.snapshotFor(P()).nontax, undefined, 'none: not written');
});

test('nontax: a one-off non-taxable amount on a night adds to take-home with no tax, tip-out or wages', () => {
  const p = P((x) => {
    x.payTypes.push(M.applyPayPreset({ id: 'nt', rate: 0, usual: 0 }, 'ntmileage'));
    x.tipout = { on: true, mode: 'pct', value: 10, basis: 'before', from: 'cash' };
  });
  assert.equal(M.payKind(p.payTypes[p.payTypes.length - 1], p.payTypes.length - 1), 'other');
  assert.equal(p.payTypes[p.payTypes.length - 1].nontax, 1);
  const night = NIGHTS()[0];
  const a = M.computeNight(night, p, 10);
  const b = M.computeNight({ ...night, pay: { ...night.pay, nt: 25 } }, p, 10);
  assert.equal(b.nontax, 25);
  assert.deepEqual(
    [b.tax, b.tipout, b.tips, b.basePay, b.hours, b.extra, b.kept],
    [a.tax, a.tipout, a.tips, a.basePay, a.hours, a.extra, a.kept],
  );
  near(b.net - a.net, 25, 1e-9);
  near(b.onCheck - a.onCheck, 25, 1e-9);
});

test('nontax: calibration counts non-taxable money in the check but not in the taxed base', () => {
  // Build "real" checks with a known true rate, then check that calibrate recovers the same rate with and without
  // non-taxable money on the stub.
  const truth = 0.25;
  const run = (p, nights) => {
    const exact = { ...p, rateOverride: truth };
    const actual = M.periodTotals(exact, nights, 0, AFTER, 10).chk;
    return M.calibrate(p, nights, 0, actual, AFTER, 10);
  };
  const nights = NIGHTS();
  const plain = run(P(), nights);
  const rec = run(withNontax([item(150)]), nights);
  near(rec.rNew, plain.rNew, 1e-6);
  near(rec.rNew, truth, 1e-3);
  // a one-off amount on a night too
  const p1 = P((x) => x.payTypes.push(M.applyPayPreset({ id: 'nt', rate: 0, usual: 0 }, 'ntexpense')));
  const n1 = nights.map((n, i) => (i === 0 ? { ...n, pay: { ...n.pay, nt: 40 } } : n));
  near(run(p1, n1).rNew, truth, 1e-3);
  // the predicted check includes the recurring money exactly once
  const exact = M.periodTotals({ ...withNontax([item(150)]), rateOverride: truth }, nights, 0, AFTER, 10).chk;
  near(rec.actual, exact, 1e-9);
});

test('nontax: saved data and backups keep the non-taxable rows; bad rows are cleaned', () => {
  const S = migrate({
    profile: {
      ...P(),
      nontaxable: [
        { id: 'a', k: 'mileage', name: 'Mileage reimbursement', amount: 42.5 },
        { id: 'b', k: 'other', name: 'Tool money', amount: -5, recurring: false },
        null,
        'junk',
      ],
      payTypes: [...P().payTypes, { id: 'nt', k: 'ntmeal', name: 'Meal', unit: 'amt', rate: 0, nontax: 1 }],
    },
    nights: [],
  });
  const p = S.workplaces[0].profile;
  assert.deepEqual(p.nontaxable, [
    { id: 'a', k: 'mileage', name: 'Mileage reimbursement', amount: 42.5, recurring: true },
    { id: 'b', k: 'other', name: 'Tool money', amount: 0, recurring: false },
  ]);
  assert.equal(p.payTypes[p.payTypes.length - 1].nontax, 1);
  assert.equal('nontaxable' in migrate({ profile: P(), nights: [] }).workplaces[0].profile, false);
  // a locked night's non-taxable amount survives a round trip
  const locked = M.lockFinishedNights(withNontax([item(100)]), NIGHTS(), AFTER).nights;
  const back = migrate({ profile: withNontax([item(100)]), nights: locked }, { today: AFTER });
  assert.equal(back.nights[0].snap.nontax, 100);
});
