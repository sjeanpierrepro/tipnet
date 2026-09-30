// Locked nights: a night saved with a snapshot of Setup keeps its numbers when Setup changes later.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/js/math.js';
import { migrate, encodeBackup, decodeBackup } from '../app/js/storage.js';

const near = (a, b, eps = 0.005) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const TODAY = '2026-09-28'; // inside the example period (09-21..10-04)
const AFTER = '2026-10-10'; // the example period has finished
const P = () => M.exampleProfile(TODAY);
const N = () => M.exampleNights(TODAY);
const lock = (nights, p, n = 10) => nights.map((x) => ({ ...x, snap: M.snapshotFor(p, n) }));
const raise = (p) => { p.payTypes[0].rate = 14; p.deductions.push({ id: 'd9', k: 'dental', name: 'Dental', amount: 40, mode: 'fixed' }); p.tipout.value = 20; };

test('snapshotFor keeps the rates, pay types, tip-out, fixed total and shift basis', () => {
  const p = P();
  p.rateOverride = 0.2;
  const s = M.snapshotFor(p, 9);
  assert.equal(s.r, 0.2);
  near(s.rf, 0.09, 1e-12);
  assert.equal(s.fixed, 60);
  assert.equal(s.n, 9);
  assert.deepEqual(s.pay[0], { id: 'p1', rate: 12, unit: 'hr', usual: 7 });
  assert.deepEqual(s.pay[2], { id: 'p3', rate: 0, unit: 'amt', supp: 1 });
  assert.deepEqual(s.tipout, { on: true, mode: 'pct', value: 15, basis: 'before', from: 'cash' });
  assert.equal(M.snapshotFor({ ...P(), shifts: 0 }).n, 8, 'no shift count: about 4 a week');
  // a snapshot is plain data: a JSON round trip changes nothing
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
});

test('a locked night ignores later Setup changes; an unlocked one follows them', () => {
  const p = P();
  const night = { total: 585, cash: 210, pay: { p1: 8 }, barback: true };
  const before = M.computeNight(night, p, 10);
  const locked = { ...night, snap: M.snapshotFor(p, 10) };
  raise(p);
  p.rateOverride = 0.3;
  const after = M.computeNight(locked, p, 99); // the shifts argument is ignored for a locked night
  assert.deepEqual({ ...after, locked: false }, { ...before, locked: false });
  assert.equal(after.locked, true);
  const unlocked = M.computeNight(night, p, 10);
  assert.notEqual(unlocked.net, before.net);
  assert.equal(unlocked.basePay, 112);
  assert.equal(unlocked.r, 0.3);
  // weekly hours read the night's own pay types
  assert.equal(M.basePay(locked, p).hours, 8);
});

test('a raise after a finished period does not change it (net, check and exact fixed deductions)', () => {
  const p = P();
  const nights = lock(N(), p);
  const was = M.periodTotals(p, nights, 0, AFTER);
  assert.equal(was.exact, true);
  raise(p);
  p.rateOverride = 0.25;
  const now = M.periodTotals(p, nights, 0, AFTER);
  assert.equal(now.net, was.net);
  assert.equal(now.chk, was.chk);
  assert.equal(M.periodFixed(p, nights), 60, 'the exact fixed total comes from the snapshots');
  assert.equal(M.periodFixed(p, N()), 100, 'unlocked nights use the current Setup');
});

test('unlocked nights in the current period follow Setup until the period ends', () => {
  const p = P();
  const live = M.periodTotals(p, N(), 0, TODAY);
  p.payTypes[0].rate = 14;
  const raised = M.periodTotals(p, N(), 0, TODAY);
  assert.ok(raised.net > live.net, 'the raise shows up while the period is open');
});

test('calibration: rate override only moves unlocked nights; the check uses the period snapshots', () => {
  const p = P();
  const nights = lock(N(), p);
  const c1 = M.calibrate(p, nights, 0, 800, AFTER);
  raise(p);
  const c2 = M.calibrate(p, nights, 0, 800, AFTER);
  assert.equal(c2.pred, c1.pred, 'a Setup change after the fact does not change what was predicted');
  assert.equal(c2.F, 60);
  p.rateOverride = c2.rateOverride;
  assert.equal(M.periodTotals(p, nights, 0, AFTER).net, M.periodTotals(P(), lock(N(), P()), 0, AFTER).net);
});

/* ---------- migration stamping and backups ---------- */
const realToday = M.todayISO();
const stateWith = (nights) => ({
  profileExample: false, nightsExample: false,
  profile: { ...M.exampleProfile(realToday), periodStart: M.addDays(realToday, -21), periodEnd: M.addDays(realToday, -8), shifts: 3 },
  nights,
});
const nightAgo = (id, ago) => ({ id, date: M.addDays(realToday, -ago), total: 300, cash: 80, pay: { p1: 6 }, barback: true });

test('load migration locks nights in finished periods only, with the Setup they are shown with', () => {
  const S = migrate(stateWith([nightAgo(1, 27), nightAgo(2, 20), nightAgo(3, 5), nightAgo(4, 1)]));
  const [a, b, c, d] = S.nights;
  assert.ok(a.snap && b.snap, 'finished periods: locked');
  assert.equal(a.snap.n, 3);
  assert.equal(a.snap.pay[0].rate, 12);
  assert.ok(!c.snap && !d.snap, 'the current period stays unlocked');
  // what a finished period shows does not change when Setup does
  const before = M.periodTotals(S.profile, S.nights, 0);
  S.profile.payTypes[0].rate = 20;
  const again = migrate(S); // reload after the raise
  assert.equal(again.nights[0].snap.pay[0].rate, 12, 'an existing snapshot is kept');
  assert.equal(M.periodTotals(again.profile, again.nights, 0).net, before.net);
  assert.ok(!again.nights[3].snap);
});

test('backup round trip keeps snapshots; malformed ones are dropped; prototype codes still work', () => {
  const S = migrate(stateWith([nightAgo(1, 27), nightAgo(2, 1)]));
  S.nights[1].snap = M.snapshotFor(S.profile, 3); // a screen may lock a current-period night too
  const back = decodeBackup(encodeBackup(S));
  assert.deepEqual(back.nights, S.nights);
  const bad = migrate(stateWith([{ ...nightAgo(1, 1), snap: { r: 'x', pay: 3 } }, { ...nightAgo(2, 2), snap: { r: 2, rf: 0, fixed: 0, n: 1, pay: [] } }]));
  assert.ok(!bad.nights[0].snap && !bad.nights[1].snap, 'garbage snapshots are removed (current period: unlocked)');
  // a prototype backup (no snapshots) restores and its finished nights get locked
  const proto = Buffer.from(JSON.stringify(stateWith([nightAgo(1, 27)])), 'utf8').toString('base64');
  const r = decodeBackup(proto);
  assert.equal(r.nights.length, 1);
  assert.ok(r.nights[0].snap);
});
