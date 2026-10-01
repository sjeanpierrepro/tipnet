import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/js/math.js';
import * as B from '../app/js/budget.js';
import { migrate } from '../app/js/storage.js';

const near = (a, b, eps = 0.005) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const TODAY = '2026-09-28';
const AFTER = '2026-10-10';
const P = () => M.exampleProfile(TODAY);
const R = 333 / 2000;
const night = (o = {}) => ({ total: 585, cash: 210, pay: { p1: 8 }, barback: true, ...o });

test('cash off payroll: withholding skips the cash kept, take-home rises by the tax not taken', () => {
  const on = M.computeNight(night({ cashOffPayroll: true }), P(), 10);
  const off = M.computeNight(night(), P(), 10);
  assert.equal(on.cashInHand, 136.65); // 210 less the 73.35 barback cash tip-out
  assert.equal(on.cashTipsKept, 136.65);
  assert.equal(on.cashOffPayroll, true);
  near(on.tax, off.tax - 136.65 * R);
  near(on.net, off.net + 136.65 * R);
  near(on.onCheck, on.net - on.cashInHand);
  near(on.onCheck, off.onCheck + 136.65 * R);
  near(on.taxOnCashToSetAside, 136.65 * R);
  assert.equal(off.taxOnCashToSetAside, 0);
  assert.equal(off.cashOffPayroll, false);
});

test('cash off payroll: needs cash entered; tip-out paid from payroll leaves all the cash', () => {
  const none = M.computeNight(night({ cash: null, cashOffPayroll: true }), P(), 10);
  assert.equal(none.cashTipsKept, 0);
  assert.equal(none.cashOffPayroll, false);
  near(none.net, M.computeNight(night({ cash: null }), P(), 10).net);
  const p = P();
  p.tipout.from = 'check';
  const c = M.computeNight(night({ cashOffPayroll: true }), p, 10);
  assert.equal(c.cashTipsKept, 210);
});

test('cash off payroll: cash above the tips is capped, hourly wages are always taxed', () => {
  const c = M.computeNight(
    { total: 150, cash: 500, pay: { p1: 8 }, barback: false, cashOffPayroll: true },
    P(),
    10,
  );
  assert.equal(c.basePay, 96);
  assert.equal(c.tips, 54);
  assert.equal(c.cashTipsKept, 54);
  near(c.tax, 96 * R); // only the wages are taxed
  near(c.taxOnCashToSetAside, 54 * R);
});

test('cash off payroll: the federal tips note leaves out cash that skipped payroll', () => {
  const c = M.computeNight(night({ cashOffPayroll: true }), P(), 10);
  near(c.fedOnTips, (489 - 73.35 - 136.65) * 0.09);
});

test('cash off payroll: locked nights use it too', () => {
  const p = P();
  const snap = M.snapshotFor(p, 10);
  const c = M.computeNight(night({ cashOffPayroll: true, snap }), p, 10);
  near(c.taxOnCashToSetAside, 136.65 * R);
  assert.equal(c.locked, true);
});

test('cash off payroll: period totals add up the set-aside estimates', () => {
  const p = P();
  const ns = M.exampleNights(TODAY).map((n) => ({ ...n, cashOffPayroll: true }));
  const t = M.periodTotals(p, ns, 0, TODAY);
  const sum = ns.reduce((s, n) => s + M.computeNight(n, p, 10).taxOnCashToSetAside, 0);
  near(t.setAside, sum, 0.02);
  assert.ok(t.setAside > 0);
  assert.equal(M.periodTotals(p, M.exampleNights(TODAY), 0, TODAY).setAside, 0);
});

test('check my accuracy: cash that skipped payroll does not distort the rate', () => {
  const p = P();
  const base = M.exampleNights(TODAY);
  const off = base.map((n) => ({ ...n, cashOffPayroll: true }));
  const same = M.calibrate(p, base, 0, M.calibrate(p, base, 0, 1, AFTER).pred, AFTER);
  const b = M.calibrate(p, off, 0, M.calibrate(p, off, 0, 1, AFTER).pred, AFTER);
  // a check that matches the prediction leaves the rate alone, with or without withholding on the cash
  near(same.rNew, M.rate(p), 1e-3);
  near(b.rNew, M.rate(p), 1e-3);
  near(b.err, 0, 1e-9);
  // the real check is bigger by the tax not taken: the rate is the same as when all cash ran through payroll
  const extra = off.reduce((s, n) => s + M.computeNight(n, p, 10).taxOnCashToSetAside, 0);
  const noExtra = M.calibrate(p, base, 0, 800, AFTER);
  const withNo = M.calibrate(p, off, 0, 800 + extra, AFTER);
  assert.ok(noExtra.ok && withNo.ok);
  near(withNo.rNew, noExtra.rNew, 0.01);
});

test('migrate: old data keeps the restaurant default and nights false', () => {
  const S = migrate({
    profile: { gross: 2000, freq: 14, periodStart: '2026-09-21', deductions: [], payTypes: [] },
    nights: [{ id: 1, date: '2026-09-22', total: 100, cash: 20, pay: {}, barback: true }],
  });
  assert.equal(S.workplaces[0].profile.cashOffPayroll, false);
  assert.equal(S.nights[0].cashOffPayroll, undefined);
  const T = migrate({
    ...S,
    workplaces: [{ ...S.workplaces[0], profile: { ...S.workplaces[0].profile, cashOffPayroll: true } }],
    nights: [{ ...S.nights[0], cashOffPayroll: true }],
  });
  assert.equal(T.workplaces[0].profile.cashOffPayroll, true);
  assert.equal(T.nights[0].cashOffPayroll, true);
});

test('budget: safe to spend sets aside the taxes on cash, per restaurant', () => {
  const p = M.exampleProfile(TODAY);
  const nights = M.exampleNights(TODAY).map((n) => ({ ...n, cashOffPayroll: true }));
  const plain = M.exampleNights(TODAY);
  const bud = B.exampleBudget();
  const opt = { cashOnHand: 1000 };
  const a = B.safeToSpendAll(bud, [{ id: 'w1', name: 'A', profile: p, nights: plain }], TODAY, opt);
  const b = B.safeToSpendAll(bud, [{ id: 'w1', name: 'A', profile: p, nights }], TODAY, opt);
  const want = M.periodTotals(p, nights, 0, TODAY).setAside;
  assert.ok(want > 0);
  assert.deepEqual(a.taxAside, []);
  assert.equal(b.taxAsideTotal, want);
  assert.equal(b.taxAside[0].name, 'A');
  near(b.safe, a.safe - want);
  const two = B.safeToSpendAll(
    bud,
    [
      { id: 'w1', name: 'A', profile: p, nights },
      { id: 'w2', name: 'B', profile: p, nights: nights.map((n) => ({ ...n, id: n.id + 10 })) },
    ],
    TODAY,
    opt,
  );
  assert.equal(two.taxAside.length, 2);
  near(two.taxAsideTotal, want * 2, 0.02);
});
