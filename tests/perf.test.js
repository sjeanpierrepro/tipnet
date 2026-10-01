// Speed and "same answers" checks for the period math when the shift count is blank (history is used).
// The reference functions below are the ORIGINAL slow implementations, copied so the fast ones can be checked against them.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/js/math.js';
import * as B from '../app/js/budget.js';

/* ---------- reference (old, slow) implementations ---------- */
const refNightsInPeriod = (p, nights, idx) =>
  nights
    .filter((n) => M.periodIndex(p, n.date) === idx)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

function refShiftsPerPeriod(p, nights = [], today, idx) {
  if (M.num(p.shifts) > 0) return { n: M.num(p.shifts), source: 'entered' };
  const done = [...new Set(nights.map((n) => M.periodIndex(p, n.date)))].filter((i) =>
    M.isFinal(p, i, today),
  );
  if (done.length) {
    const avg = done.reduce((s, i) => s + refNightsInPeriod(p, nights, i).length, 0) / done.length;
    return { n: Math.max(1, avg), source: 'history' };
  }
  const at =
    idx !== undefined ? idx : Number.isFinite(M.parseISO(p.periodStart)) ? M.periodIndex(p, today) : 0;
  return { n: Math.max(1, Math.round((M.periodLength(p, at) * 4) / 7)), source: 'default' };
}

function refPeriodTotals(p, nights, idx, today, shifts) {
  const ns = refNightsInPeriod(p, nights, idx);
  const n = shifts > 0 ? shifts : refShiftsPerPeriod(p, nights, today, idx).n;
  let net = 0,
    hrs = 0,
    chk = 0,
    kept = 0,
    cash = 0,
    setAside = 0,
    fixedShares = 0,
    allCash = ns.length > 0;
  ns.forEach((night) => {
    const c = M.computeNight(night, p, n);
    net += M.toCents(c.net);
    hrs += c.hours;
    kept += M.toCents(c.kept);
    fixedShares += M.toCents(c.fixedPerShift);
    setAside += M.toCents(c.taxOnCashToSetAside);
    if (c.onCheck == null) allCash = false;
    else {
      chk += M.toCents(c.onCheck);
      cash += M.toCents(c.cashInHand);
    }
  });
  const exact = ns.length > 0 && M.isFinal(p, idx, today);
  if (exact) {
    const adj = fixedShares - M.toCents(M.fixedTotal(p));
    net += adj;
    chk += adj;
  }
  return {
    ns,
    net: M.fromCents(net),
    hrs,
    chk: M.fromCents(chk),
    kept: M.fromCents(kept),
    cash: M.fromCents(cash),
    setAside: M.fromCents(setAside),
    allCash,
    exact,
  };
}

const hasCash = (n) => n.cash !== '' && n.cash != null && Number.isFinite(parseFloat(n.cash));
function refExpectedIncome(profile, nights, today) {
  const idx = M.periodIndex(profile, today);
  const t = refPeriodTotals(profile, nights, idx, today);
  const expected = refShiftsPerPeriod(profile, nights, today).n;
  const done = [...new Set(nights.map((n) => M.periodIndex(profile, n.date)))].filter((i) =>
    M.isFinal(profile, i, today),
  );
  const past = done.map((i) => refPeriodTotals(profile, nights, i, today));
  const mean = (list, f) =>
    list.length ? M.fromCents(Math.round(list.reduce((s, x) => s + M.toCents(f(x)), 0) / list.length)) : null;
  const avg = mean(past, (x) => x.net);
  const avgChk = mean(
    past.filter((x) => x.allCash),
    (x) => x.chk,
  );
  const withCash = t.ns.filter(hasCash).length;
  let projected;
  if (withCash > 0) projected = M.round2(t.chk * Math.max(1, Math.max(expected, t.ns.length) / withCash));
  else projected = avgChk;
  const projectedFrom = withCash > 0 ? 'nights' : avgChk == null ? null : 'average';
  const kept = (x) => M.toCents(x.net) - M.toCents(x.setAside);
  return {
    cashSoFar: t.cash,
    setAsideSoFar: t.setAside,
    checkSoFar: t.chk,
    projectedCheck: projected,
    projectedFrom,
    avgCheckPerPeriod: avgChk,
    avgTakeHomePerPeriod: avg,
    avgKeptPerPeriod: past.length
      ? M.fromCents(Math.round(past.reduce((s, x) => s + kept(x), 0) / past.length))
      : null,
    projectedKept: t.ns.length
      ? M.fromCents(Math.round(kept(t) * Math.max(1, expected / t.ns.length)))
      : null,
  };
}

/* ---------- test data ---------- */
const MODES = [7, 14, 15, 30, 'semimonthly', 'monthly'];
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const profileFor = (freq, shifts = '') => ({
  ...M.exampleProfile('2024-01-10'),
  freq,
  periodStart: '2024-01-03',
  periodEnd: '',
  shifts,
});
function makeNights(rand, count, startISO, spanDays) {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    date: M.addDays(startISO, Math.floor(rand() * spanDays)),
    total: Math.round(150 + rand() * 500),
    cash: rand() < 0.25 ? '' : Math.round(rand() * 200),
    pay: { p1: 4 + Math.floor(rand() * 5) },
    barback: rand() < 0.5,
  }));
}

test('fast period math gives the same answers as the original on random data', () => {
  const rand = rng(12345);
  MODES.forEach((freq) =>
    [''].concat([6]).forEach((shifts) => {
      const p = profileFor(freq, shifts);
      const nights = makeNights(rand, 120, '2024-01-01', 300); // unsorted, with same-day ties
      const today = '2024-07-20';
      const ix = M.indexNights(p, nights);
      const ref = refShiftsPerPeriod(p, nights, today);
      assert.deepEqual(M.shiftsPerPeriod(p, nights, today), ref, freq + ' shifts (no index)');
      assert.deepEqual(M.shiftsPerPeriod(p, nights, today, undefined, ix), ref, freq + ' shifts (index)');
      for (let i = -1; i <= 25; i++) {
        assert.deepEqual(
          M.nightsInPeriod(p, nights, i, ix),
          refNightsInPeriod(p, nights, i),
          freq + ' nights ' + i,
        );
        const want = refPeriodTotals(p, nights, i, today);
        assert.deepEqual(M.periodTotals(p, nights, i, today), want, freq + ' totals ' + i);
        assert.deepEqual(
          M.periodTotals(p, nights, i, today, undefined, ix),
          want,
          freq + ' totals (index) ' + i,
        );
      }
      [today, '2024-03-05', '2024-12-01'].forEach((t) => {
        assert.deepEqual(
          B.expectedIncome(p, nights, t),
          refExpectedIncome(p, nights, t),
          freq + ' income ' + t,
        );
      });
    }),
  );
});

test('fast safeToSpend equals safeToSpend with a prebuilt index', () => {
  const rand = rng(99);
  MODES.forEach((freq) => {
    const p = profileFor(freq);
    const nights = makeNights(rand, 90, '2024-01-01', 250);
    const b = B.exampleBudget();
    const a = B.safeToSpend(b, p, nights, '2024-06-14', { cashOnHand: 800 });
    const c = B.safeToSpend(b, p, nights, '2024-06-14', { cashOnHand: 800, index: M.indexNights(p, nights) });
    assert.deepEqual(a, c);
  });
});

test('performance: 1,000 nights over 3 years, all 6 modes, blank shifts, every period plus safe to spend', () => {
  const rand = rng(2026);
  const today = '2026-09-29';
  const cases = MODES.map((freq) => {
    const p = { ...M.exampleProfile(today), freq, periodStart: '2023-10-02', periodEnd: '', shifts: '' };
    return { p, nights: makeNights(rand, 1000, '2023-10-02', 1092) };
  });
  const t0 = performance.now();
  let periods = 0;
  cases.forEach(({ p, nights }) => {
    const index = M.indexNights(p, nights);
    const base = M.shiftsPerPeriod(p, nights, today, undefined, index);
    [...index.keys()].forEach((i) => {
      M.periodTotals(p, nights, i, today, base.n, index);
      periods++;
    });
    B.safeToSpend(B.exampleBudget(), p, nights, today, { cashOnHand: 500, index });
  });
  const ms = performance.now() - t0;
  console.log(`# perf: ${periods} periods and 6 safe-to-spend runs in ${ms.toFixed(0)} ms`);
  assert.ok(ms < 200, `took ${ms.toFixed(0)} ms, want under 200`);
  // the plain call (no index, no shared count) must also be fast enough for a screen
  const t1 = performance.now();
  cases.forEach(({ p, nights }) => B.safeToSpend(B.exampleBudget(), p, nights, today));
  const ms2 = performance.now() - t1;
  console.log(`# perf: 6 plain safeToSpend calls in ${ms2.toFixed(0)} ms`);
  assert.ok(ms2 < 200, `plain safeToSpend took ${ms2.toFixed(0)} ms`);
});
