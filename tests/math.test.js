import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/js/math.js';

const near = (a, b, eps = 0.005) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const P = () => M.exampleProfile();
const N = () => M.exampleNights();
const TODAY = '2026-09-28'; // inside the example period (09-21..10-04), so it is not final
const AFTER = '2026-10-10'; // after the example period, so it is final

test('rates from the stub', () => {
  const p = P();
  near(M.baseRate(p), 333 / 2000, 1e-12);
  near(M.fedRate(p), 0.09, 1e-12);
  assert.equal(M.fixedTotal(p), 60);
  p.rateOverride = 0.2;
  assert.equal(M.rate(p), 0.2);
  assert.equal(M.baseRate({ ...p, gross: 0 }), 0);
});

test('example night: $585, 8 hrs, 15% tip-out from cash, $210 cash', () => {
  const p = P();
  const c = M.computeNight({ total: 585, cash: 210, pay: { p1: 8 }, barback: true }, p, 10);
  assert.equal(c.basePay, 96);
  assert.equal(c.tips, 489);
  assert.equal(c.tipout, 73.35);
  assert.equal(c.kept, 511.65);
  near(c.tax, 85.19);
  assert.equal(c.fixedPerShift, 6);
  near(c.net, 420.46);
  assert.equal(c.fromCash, 73.35);
  assert.equal(c.cashInHand, 136.65);
  near(c.onCheck, 283.81);
  assert.equal(c.hours, 8);
  near(c.fedOnTips, (489 - 73.35) * 0.09);
});

test('no barback means zero tip-out', () => {
  const c = M.computeNight({ total: 585, cash: 210, pay: { p1: 8 }, barback: false }, P(), 10);
  assert.equal(c.tipout, 0);
  assert.equal(c.kept, 585);
  assert.equal(c.fromCash, 0);
  assert.equal(c.cashInHand, 210);
});

test('basis "after" has zero tip-out and cash split ignores it', () => {
  const p = P();
  p.tipout.basis = 'after';
  const c = M.computeNight({ total: 585, cash: 210, pay: { p1: 8 }, barback: true }, p, 10);
  assert.equal(c.tipout, 0);
  assert.equal(c.fromCash, 0);
  assert.equal(c.cashInHand, 210);
});

test('flat tip-out, capped at tips, and from "check" leaves cash alone', () => {
  const p = P();
  p.tipout = { on: true, mode: 'flat', value: 500, basis: 'before', from: 'check' };
  const c = M.computeNight({ total: 585, cash: 210, pay: { p1: 8 }, barback: true }, p, 10);
  assert.equal(c.tipout, 489);
  assert.equal(c.fromCash, 0);
  const p2 = P();
  p2.tipout = { on: true, mode: 'flat', value: 20, basis: 'before', from: 'cash' };
  assert.equal(M.computeNight({ total: 585, pay: { p1: 8 }, barback: true }, p2, 10).tipout, 20);
});

test('tip-out is off when tip-outs are disabled; no cash entered gives null split', () => {
  const p = P();
  p.tipout.on = false;
  const c = M.computeNight({ total: 300, cash: '', pay: { p1: 6 }, barback: true }, p, 10);
  assert.equal(c.tipout, 0);
  assert.equal(c.cashInHand, null);
  assert.equal(c.onCheck, null);
});

test('tips never go negative when total is under base pay', () => {
  const c = M.computeNight({ total: 50, pay: { p1: 8 }, barback: true }, P(), 10);
  assert.equal(c.tips, 0);
  assert.equal(c.tipout, 0);
});

test('a $200 bonus is taxed at the supplemental rate', () => {
  const p = P();
  const r = M.rate(p);
  near(M.suppRate(p), r - 0.09 + 0.22, 1e-12);
  const base = M.computeNight({ total: 585, pay: { p1: 8 }, barback: false }, p, 10);
  const withBonus = M.computeNight({ total: 585, pay: { p1: 8, p3: 200 }, barback: false }, p, 10);
  near(withBonus.extraTax, 200 * (r - 0.09 + 0.22));
  near(withBonus.tax - base.tax, 200 * (r - 0.09 + 0.22));
  assert.equal(withBonus.extra, 200);
  near(withBonus.net - base.net, 200 - 200 * (r - 0.09 + 0.22));
});

test('non-supplemental flat amount uses the regular rate', () => {
  const p = P();
  p.payTypes[2] = { id: 'p3', k: 'autograt', name: 'Auto-grat', rate: 0, unit: 'amt', usual: 0 };
  const c = M.computeNight({ total: 400, pay: { p1: 8, p3: 100 }, barback: false }, p, 10);
  near(c.extraTax, 100 * M.rate(p));
});

test('supplemental rate never drops the regular share below zero', () => {
  const p = P();
  p.rateOverride = 0.05; // lower than fed rate 9%
  near(M.suppRate(p), 0.22, 1e-12);
});

test('a differential does not double count hours', () => {
  const p = P();
  p.payTypes.push({ id: 'p4', k: 'diff', name: 'Lead', rate: 2, unit: 'hr', usual: 0 });
  const c = M.computeNight({ total: 500, pay: { p1: 8, p4: 8 }, barback: false }, p, 10);
  assert.equal(c.hours, 8);
  assert.equal(c.basePay, 8 * 12 + 8 * 2);
});

test('per-shift pay counts toward base pay but not hours', () => {
  const p = P();
  p.payTypes.push({ id: 'p5', k: 'event', name: 'Event', rate: 100, unit: 'shift', usual: 0 });
  const c = M.computeNight({ total: 500, pay: { p1: 6, p5: 1 }, barback: false }, p, 10);
  assert.equal(c.basePay, 72 + 100);
  assert.equal(c.hours, 6);
});

test('main pay type falls back to its usual hours', () => {
  const c = M.computeNight({ total: 300, barback: false }, P(), 10);
  assert.equal(c.hours, 7);
  assert.equal(c.basePay, 84);
});

test('shift fallback order: entered, then history, then 4 a week', () => {
  const p = P();
  assert.deepEqual(M.shiftsPerPeriod(p, N(), TODAY), { n: 10, source: 'entered' });
  p.shifts = 0;
  // no finished periods yet -> default 14 * 4 / 7 = 8
  assert.deepEqual(M.shiftsPerPeriod(p, N(), TODAY), { n: 8, source: 'default' });
  // one finished period with 4 nights, another with 2 -> average 3
  p.periodStart = '2026-09-07';
  p.periodEnd = '2026-09-20';
  const nights = [
    { date: '2026-09-08' }, { date: '2026-09-09' }, { date: '2026-09-10' }, { date: '2026-09-11' },
    { date: '2026-09-21' }, { date: '2026-09-22' },
  ];
  const r = M.shiftsPerPeriod(p, nights, '2026-10-30');
  assert.equal(r.source, 'history');
  assert.equal(r.n, 3);
  // never less than 1
  assert.equal(M.shiftsPerPeriod({ ...p, shifts: 0, periodEnd: '', freq: 7 }, [], TODAY).n, 4);
  assert.equal(M.shiftsPerPeriod({ ...p, shifts: 0, periodEnd: '2026-09-07' }, [], TODAY).n, 1);
});

test('period length: from dates, invalid dates fall back to frequency', () => {
  const p = P();
  assert.equal(M.periodLength(p), 14);
  assert.equal(M.lengthFromDates(p), true);
  p.periodEnd = '2026-09-27';
  assert.equal(M.periodLength(p), 7);
  p.periodEnd = '2026-09-01'; // before start
  assert.equal(M.periodLength(p), 14);
  assert.equal(M.lengthFromDates(p), false);
  p.periodEnd = '2027-01-01'; // over 62 days
  assert.equal(M.periodLength(p), 14);
  p.periodEnd = '';
  p.freq = 15;
  assert.equal(M.periodLength(p), 15);
});

test('period boundaries', () => {
  const p = P(); // 2026-09-21 .. 10-04, length 14
  assert.equal(M.periodIndex(p, '2026-09-21'), 0);
  assert.equal(M.periodIndex(p, '2026-10-04'), 0);
  assert.equal(M.periodIndex(p, '2026-10-05'), 1);
  assert.equal(M.periodIndex(p, '2026-09-20'), -1);
  assert.equal(M.periodIndex(p, '2026-09-07'), -1);
  assert.equal(M.periodIndex(p, '2026-09-06'), -2);
  assert.deepEqual(M.periodRange(p, 1), { start: '2026-10-05', end: '2026-10-18' });
  assert.equal(M.isFinal(p, 0, '2026-10-04'), false);
  assert.equal(M.isFinal(p, 0, '2026-10-05'), true);
});

test('period math is safe across daylight-saving changes', () => {
  // US DST: spring forward 2026-03-08, fall back 2026-11-01
  const p = { freq: 7, periodStart: '2026-03-02', periodEnd: '', shifts: 4 };
  assert.equal(M.periodIndex(p, '2026-03-08'), 0);
  assert.equal(M.periodIndex(p, '2026-03-09'), 1);
  assert.equal(M.periodRange(p, 1).start, '2026-03-09');
  const q = { freq: 7, periodStart: '2026-10-26', periodEnd: '', shifts: 4 };
  assert.equal(M.periodIndex(q, '2026-11-01'), 0);
  assert.equal(M.periodIndex(q, '2026-11-02'), 1);
  assert.equal(M.dayDiff('2026-03-07', '2026-03-09'), 2);
  assert.equal(M.dayDiff('2026-10-31', '2026-11-02'), 2);
  assert.equal(M.addDays('2026-03-08', 1), '2026-03-09');
  assert.equal(M.addDays('2026-11-01', -1), '2026-10-31');
  // year boundary and leap day
  assert.equal(M.addDays('2027-12-31', 1), '2028-01-01');
  assert.equal(M.dayDiff('2028-02-28', '2028-03-01'), 2);
});

test('period totals for an in-progress period sum nightly net', () => {
  const p = P();
  const t = M.periodTotals(p, N(), 0, TODAY);
  const sum = N().reduce((s, n) => s + M.computeNight(n, p, 10).net, 0);
  near(t.net, sum);
  assert.equal(t.exact, false);
  assert.equal(t.ns.length, 4);
  assert.equal(t.allCash, true);
  assert.equal(t.hrs, 6 + 7 + 8 + 5 + 2);
});

test('a final period swaps per-shift fixed shares for the exact fixed total', () => {
  const p = P(); // 4 nights * $6 = $24 of shares; exact fixed is $60
  const live = M.periodTotals(p, N(), 0, TODAY);
  const fin = M.periodTotals(p, N(), 0, AFTER);
  assert.equal(fin.exact, true);
  near(fin.net, live.net + 24 - 60);
  near(fin.chk, live.chk + 24 - 60);
  // an empty final period is not "exact"
  assert.equal(M.periodTotals(p, N(), 5, AFTER).exact, false);
});

test('period totals report missing cash', () => {
  const nights = N();
  nights[1].cash = null;
  assert.equal(M.periodTotals(P(), nights, 0, TODAY).allCash, false);
});

test('calibration math', () => {
  const p = P();
  const nights = N();
  const c = M.calibrate(p, nights, 0, 800, TODAY);
  assert.equal(c.ok, true);
  let T = 0, C = 0, pred = 0;
  nights.forEach((n) => {
    const x = M.computeNight(n, p, 10);
    T += x.kept + x.extra; C += x.cashInHand; pred += x.onCheck + x.fixedPerShift;
  });
  pred -= 60;
  near(c.pred, pred);
  near(c.err, (pred - 800) / 800, 1e-9);
  const rNew = 1 - (800 + 60 + C) / T;
  near(c.rNew, rNew, 1e-9);
  near(c.rateOverride, (M.rate(p) + rNew) / 2, 1e-9);
  // a prediction fed back as the actual gives ~0 error and ~unchanged rate
  const same = M.calibrate(p, nights, 0, c.pred, TODAY);
  near(same.err, 0, 1e-9);
  near(same.rNew, M.rate(p), 1e-3);
});

test('calibration clamps r_new at 0.02 and 0.45', () => {
  const p = P();
  const hi = M.calibrate(p, N(), 0, 100000, TODAY); // huge check -> rate would be negative
  assert.equal(hi.rNew, 0.02);
  const lo = M.calibrate(p, N(), 0, 1, TODAY); // tiny check -> rate would exceed 100%
  assert.equal(lo.rNew, 0.45);
  near(lo.rateOverride, (M.rate(p) + 0.45) / 2, 1e-9);
});

test('calibration refuses when cash is missing and counts the nights', () => {
  const nights = N();
  nights[0].cash = null; nights[2].cash = '';
  const c = M.calibrate(P(), nights, 0, 800, TODAY);
  assert.equal(c.ok, false);
  assert.equal(c.reason, 'missingCash');
  assert.equal(c.missingCash, 2);
  assert.equal(M.calibrate(P(), N(), 0, 0, TODAY).reason, 'noactual');
  assert.equal(M.calibrate(P(), N(), 9, 800, TODAY).reason, 'nonights');
});

test('weekly hours run Monday to Sunday and flag over 40', () => {
  const p = P();
  // 2026-09-21 is a Monday
  assert.equal(M.weekdayMon0('2026-09-21'), 0);
  assert.equal(M.weekdayMon0('2026-09-27'), 6);
  const w = M.weeklyHours(p, N(), '2026-09-24');
  assert.equal(w.weekStart, '2026-09-21');
  assert.equal(w.weekEnd, '2026-09-27');
  assert.equal(w.hours, 6 + 7 + 8 + 5 + 2);
  assert.equal(w.over, false);
  const many = Array.from({ length: 6 }, (_, i) => ({ date: M.addDays('2026-09-21', i), pay: { p1: 8 } }));
  assert.equal(M.weeklyHours(p, many, '2026-09-27').over, true); // 48h
  assert.equal(M.weeklyHours(p, many, '2026-09-28').hours, 0); // next Monday starts a new week
});

test('summary numbers for the Setup box', () => {
  const s = M.summary(P(), N(), TODAY);
  assert.equal(s.taxPer100, 16.65);
  assert.equal(s.keepPer100, 83.35);
  assert.equal(s.fixed, 60);
  assert.equal(s.fixedPerShift, 6);
  assert.equal(s.shifts, 10);
  assert.equal(s.shiftSource, 'entered');
  assert.equal(s.periodLength, 14);
  assert.equal(s.fromDates, true);
  assert.equal(s.adjusted, false);
});

test('presets: groups, defaults, flags', () => {
  const groups = [...new Set(M.PRESETS.pay.map((x) => x.g))];
  assert.deepEqual(groups, ['Hourly', 'Per shift', 'Flat amount', 'Other']);
  assert.deepEqual([...new Set(M.PRESETS.deductions.map((x) => x.g))], ['Taxes', 'Benefits', 'Retirement', 'Other']);
  assert.equal(M.findPayPreset('bonus').supp, 1);
  assert.equal(M.findPayPreset('commission').supp, 1);
  assert.ok(!M.findPayPreset('autograt').supp);
  assert.equal(M.findPayPreset('diff').diff, 1);
  assert.equal(M.findDeductionPreset('fed').mode, 'pct');
  assert.equal(M.findDeductionPreset('health').mode, 'fixed');
  assert.equal(M.findDeductionPreset('k401').mode, 'pct');
  assert.ok(M.findDeductionPreset('hsa').notes);
  assert.ok(M.findDeductionPreset('supppre').notes);
  const ot = M.applyPayPreset({ id: 'x', rate: 0, usual: 0 }, 'ot', 12);
  assert.equal(ot.rate, 18);
  assert.equal(M.applyPayPreset({ id: 'x' }, 'bonus').supp, 1);
});

test('applyPayPreset only autofills the rate for Overtime (1.5x main rate)', () => {
  M.PAY_PRESETS.forEach((pr) => {
    const out = M.applyPayPreset({ id: 'x', rate: 0, usual: 0 }, pr.k, 20);
    if (pr.k === 'ot') assert.equal(out.rate, 30, 'overtime is 1.5x the main rate');
    else assert.equal(out.rate, 0, pr.k + ' must not autofill a rate');
  });
  assert.deepEqual(M.PAY_PRESETS.filter((pr) => pr.rateMultiplier).map((pr) => pr.k), ['ot']);
  // No main rate yet: overtime stays as typed.
  assert.equal(M.applyPayPreset({ id: 'x', rate: 5 }, 'ot', 0).rate, 5);
});

test('fill Social Security + Medicare from gross', () => {
  const p = { gross: 2000, deductions: [{ id: 'd1', k: 'ss', name: 'Social Security', amount: 1, mode: 'pct' }] };
  const d = M.fillFica(p);
  assert.equal(d.find((x) => x.k === 'ss').amount, 124);
  assert.equal(d.find((x) => x.k === 'med').amount, 29);
  assert.equal(d.length, 2);
});

test('cents helpers', () => {
  assert.equal(M.toCents(1.005), 101);
  assert.equal(M.toCents(0.1 + 0.2), 30);
  assert.equal(M.toCents(-2.675), -268);
  assert.equal(M.round2(73.35), 73.35);
});

test('regression: calibration counts non-numeric cash as missing (not silently $0)', () => {
  const nights = N();
  nights[1].cash = 'abc';
  const c = M.calibrate(P(), nights, 0, 800, TODAY);
  assert.equal(c.ok, false);
  assert.equal(c.reason, 'missingCash');
  assert.equal(c.missingCash, 1);
});
