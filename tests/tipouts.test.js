// Several tip-outs (owner request): % of tips, % of sales or flat, from cash or payroll; migration of the old single tip-out.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/js/math.js';
import { migrate, encodeBackup, decodeBackup, pinTipouts } from '../app/js/storage.js';

const today = '2026-09-20';
const BARBACK = { id: 't1', k: 'barback', who: 'Barback', mode: 'pctTips', value: 15, from: 'cash' };
const RUNNER = { id: 't2', k: 'runner', who: 'Runner', mode: 'pctSales', value: 1.25, from: 'payroll' };
const P = (list = [BARBACK, RUNNER], basis = 'before') => ({
  ...M.exampleProfile(today),
  tipout: { on: true, basis },
  tipouts: list.map((x) => ({ ...x })),
});
// $585 made, 8 hours at $12 = $96 pay, so $489 tips; $210 cash
const night = (extra = {}) => ({
  date: today,
  total: 585,
  cash: 210,
  pay: { p1: 8 },
  tipouts: { t1: true, t2: true },
  sales: 1000,
  ...extra,
});

test('two people: 15% of tips from cash and 1.25% of sales through payroll, cents exact', () => {
  const c = M.computeNight(night(), P(), 10);
  assert.equal(c.tips, 489);
  assert.deepEqual(
    c.tipouts.map((l) => [l.who, l.mode, l.amount, l.from]),
    [
      ['Barback', 'pctTips', 73.35, 'cash'],
      ['Runner', 'pctSales', 12.5, 'payroll'],
    ],
  );
  assert.equal(c.tipout, 85.85);
  assert.equal(c.kept, 499.15);
  assert.equal(c.fromCash, 73.35, 'only the cash-paid one comes out of the cash');
  assert.equal(c.cashInHand, 136.65);
  assert.equal(c.tipoutScaled, false);
  // everything after the total is worked out exactly as with one tip-out of the same amount
  const single = M.computeNight(
    { ...night(), tipouts: { t1: true } },
    P([{ ...BARBACK, mode: 'flat', value: 85.85, from: 'cash' }]),
    10,
  );
  assert.equal(single.kept, c.kept);
  assert.equal(single.tax, c.tax);
  assert.equal(single.net, c.net);
  assert.equal(single.fedOnTips, c.fedOnTips);
  // but the cash split follows who is paid from cash
  assert.equal(single.cashInHand, 210 - 85.85);
});

test('a flat amount, and an unticked person is left out', () => {
  const p = P([BARBACK, { id: 't3', k: 'busser', who: 'Busser', mode: 'flat', value: 20, from: 'cash' }]);
  const c = M.computeNight(night({ tipouts: { t1: false, t3: true } }), p, 10);
  assert.deepEqual(
    c.tipouts.map((l) => [l.who, l.amount]),
    [['Busser', 20]],
  );
  assert.equal(c.tipout, 20);
  assert.equal(c.fromCash, 20);
});

test('more than the tips: scaled down proportionally to the tips exactly, and it says so', () => {
  const flat = (id, v) => ({ id, k: 'other', who: id, mode: 'flat', value: v, from: 'payroll' });
  const p = P([flat('a', 200), flat('b', 200), flat('c', 200)]);
  const c = M.computeNight(
    { date: today, total: 196, pay: { p1: 8 }, tipouts: { a: true, b: true, c: true } },
    p,
    10,
  );
  assert.equal(c.tips, 100);
  assert.equal(c.tipoutScaled, true);
  assert.deepEqual(
    c.tipouts.map((l) => l.amount),
    [33.34, 33.33, 33.33],
  );
  assert.equal(c.tipout, 100);
  assert.equal(c.kept, 96);
  // uneven shares keep their proportions
  const p2 = P([flat('a', 300), flat('b', 100)]);
  const c2 = M.computeNight(
    { date: today, total: 196, pay: { p1: 8 }, tipouts: { a: true, b: true } },
    p2,
    10,
  );
  assert.deepEqual(
    c2.tipouts.map((l) => l.amount),
    [75, 25],
  );
});

test('cash paid out is capped by the cash entered; no cash entered keeps the null split', () => {
  const c = M.computeNight(night({ cash: 50 }), P(), 10);
  assert.equal(c.fromCash, 50);
  assert.equal(c.cashInHand, 0);
  const n = M.computeNight(night({ cash: null }), P(), 10);
  assert.equal(n.cashInHand, null);
  assert.equal(n.tipout, 85.85);
});

test('% of sales with no sales entered counts nothing and says sales are needed', () => {
  const c = M.computeNight(night({ sales: undefined }), P(), 10);
  assert.equal(c.tipoutNeedsSales, true);
  assert.equal(c.tipout, 73.35);
  assert.equal(M.salesCents({ sales: '' }), null);
  assert.equal(M.salesCents({ sales: '1,000' }), 100); // parseFloat: callers clean first
  assert.equal(M.salesCents({ sales: 1234.565 }), 123457);
});

test('"the number I enter is after tip-out": nothing is taken out; switched off: nothing either', () => {
  const after = M.computeNight(night(), P(undefined, 'after'), 10);
  assert.equal(after.tipout, 0);
  assert.deepEqual(after.tipouts, []);
  assert.equal(after.cashInHand, 210);
  const p = P();
  p.tipout.on = false;
  assert.equal(M.computeNight(night(), p, 10).tipout, 0);
});

test('old nights: barback true means everyone, false (or missing) means nobody', () => {
  const p = P();
  const all = M.computeNight({ ...night(), tipouts: undefined, barback: true }, p, 10);
  assert.equal(all.tipout, 85.85);
  const none = M.computeNight({ ...night(), tipouts: undefined, barback: false }, p, 10);
  assert.equal(none.tipout, 0);
  assert.equal(M.computeNight({ ...night(), tipouts: undefined }, p, 10).tipout, 0);
});

test('the old single tip-out still works as one Barback (pct of tips, flat, from check = payroll)', () => {
  const old = { ...M.exampleProfile(today) };
  delete old.tipouts;
  old.tipout = { on: true, mode: 'pct', value: 15, basis: 'before', from: 'check' };
  const n = { date: today, total: 585, cash: 210, pay: { p1: 8 }, barback: true };
  const a = M.computeNight(n, old, 10);
  const b = M.computeNight({ ...n, tipouts: { t1: true } }, P([{ ...BARBACK, from: 'payroll' }]), 10);
  assert.equal(a.tipout, 73.35);
  assert.equal(a.fromCash, 0);
  assert.equal(a.net, b.net);
  assert.equal(a.onCheck, b.onCheck);
  assert.deepEqual(M.legacyTipouts({ on: false, mode: 'pct', value: 15 }), []);
  assert.equal(M.legacyTipouts({ on: true, mode: 'flat', value: 20, from: 'cash' })[0].mode, 'flat');
});

/* ---------- migration ---------- */
const oldState = (to, extra = {}) => ({
  schemaVersion: 3,
  profileExample: false,
  nightsExample: false,
  workplaces: [
    {
      id: 'w1',
      name: 'Bar',
      setupDone: true,
      calib: [],
      profile: { ...M.exampleProfile(today), tipouts: undefined, tipout: to },
    },
  ],
  nights: [
    { id: 'n1', date: today, total: 585, cash: 210, pay: { p1: 8 }, barback: true, workplaceId: 'w1' },
  ],
  settings: { theme: 'auto', activeWorkplaceId: 'w1' },
  ...extra,
});

test('migration: an old tip-out that was on becomes one Barback; off becomes an empty list; basis is kept', () => {
  const on = migrate(oldState({ on: true, mode: 'pct', value: 15, basis: 'before', from: 'cash' }), {
    today,
  });
  const p = on.workplaces[0].profile;
  // a list of one on % of tips or flat keeps the old fields too (for v37, see savedTipout)
  assert.deepEqual(p.tipout, { on: true, basis: 'before', mode: 'pct', value: 15, from: 'cash' });
  assert.deepEqual(p.tipouts, [BARBACK]);
  const flat = migrate(oldState({ on: true, mode: 'flat', value: 20, basis: 'after', from: 'check' }), {
    today,
  });
  assert.deepEqual(flat.workplaces[0].profile.tipout, {
    on: true,
    basis: 'after',
    mode: 'flat',
    value: 20,
    from: 'check',
  });
  assert.deepEqual(flat.workplaces[0].profile.tipouts, [
    { id: 't1', k: 'barback', who: 'Barback', mode: 'flat', value: 20, from: 'payroll' },
  ]);
  const off = migrate(oldState({ on: false, mode: 'pct', value: 15, basis: 'after', from: 'cash' }), {
    today,
  });
  assert.deepEqual(off.workplaces[0].profile.tipout, { on: false, basis: 'after' });
  assert.deepEqual(off.workplaces[0].profile.tipouts, []);
  // the night's money is the same before and after the migration
  const before = M.computeNight(
    oldState({ on: true, mode: 'pct', value: 15, from: 'cash' }).nights[0],
    {
      ...M.exampleProfile(today),
      tipouts: undefined,
      tipout: { on: true, mode: 'pct', value: 15, basis: 'before', from: 'cash' },
    },
    10,
  );
  assert.equal(M.computeNight(on.nights[0], p, 10).net, before.net);
  // migrating again changes nothing
  assert.deepEqual(migrate(on, { today }), on);
});

test('migration: new fields are cleaned (who, mode, value, from), hostile ids rewritten the same everywhere', () => {
  const S = oldState({ on: true, basis: 'before' });
  S.workplaces[0].profile.tipouts = [
    { id: 'r<1>', k: 'runner', who: '  Runner  ', mode: 'pctSales', value: '1.22', from: 'payroll' },
    { id: 'x', k: 'nope', who: '', mode: 'weird', value: -3, from: 'bank' },
    'junk',
  ];
  S.nights[0].tipouts = { 'r<1>': true, x: 'yes' };
  S.nights[0].sales = '980.5';
  const out = migrate(S, { today });
  const list = out.workplaces[0].profile.tipouts;
  assert.equal(list.length, 2);
  assert.match(list[0].id, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(
    { ...list[0], id: 'id' },
    { id: 'id', k: 'runner', who: 'Runner', mode: 'pctSales', value: 1.22, from: 'payroll' },
  );
  assert.deepEqual(list[1], { id: 'x', k: 'other', who: 'Other', mode: 'pctTips', value: 0, from: 'cash' });
  assert.deepEqual(out.nights[0].tipouts, { [list[0].id]: true, x: false });
  assert.equal(out.nights[0].sales, 980.5);
  // a night without sales gets none; one without tip-out choices gets its barback choice for the people set up now
  const plain = migrate(oldState({ on: true, mode: 'pct', value: 15 }), { today });
  assert.equal('sales' in plain.nights[0], false);
  assert.deepEqual(plain.nights[0].tipouts, { t1: true });
});

test('migration: old backup codes restore with the tip-out list; new ones round-trip it', () => {
  const old = oldState({ on: true, mode: 'pct', value: 12.5, basis: 'before', from: 'cash' });
  const code = Buffer.from(JSON.stringify(old), 'utf8').toString('base64');
  const S = decodeBackup(code);
  assert.deepEqual(S.workplaces[0].profile.tipouts, [{ ...BARBACK, value: 12.5 }]);
  S.workplaces[0].profile.tipouts.push({ ...RUNNER });
  S.nights[0].tipouts = { t1: true, t2: false };
  S.nights[0].sales = 700;
  const back = decodeBackup(encodeBackup(S));
  assert.deepEqual(back.workplaces[0].profile.tipouts, [{ ...BARBACK, value: 12.5 }, RUNNER]);
  assert.deepEqual(back.nights[0].tipouts, { t1: true, t2: false });
  assert.equal(back.nights[0].sales, 700);
});

test('locked periods never change: an old single-tip-out snapshot keeps working after migration and Setup edits', () => {
  const S = oldState({ on: true, mode: 'pct', value: 15, basis: 'before', from: 'cash' });
  const oldSnap = {
    v: 1,
    r: 0.1665,
    rf: 0.09,
    fixed: 60,
    n: 10,
    pay: [{ id: 'p1', rate: 12, unit: 'hr', usual: 7 }],
    tipout: { on: true, mode: 'pct', value: 15, basis: 'before', from: 'cash' },
  };
  S.nights[0].snap = oldSnap;
  const before = M.computeNight(S.nights[0], S.workplaces[0].profile, 10);
  const out = migrate(S, { today });
  const n = out.nights[0];
  assert.deepEqual(n.snap.tipout, { on: true, basis: 'before', mode: 'pct', value: 15, from: 'cash' });
  assert.deepEqual(n.snap.tipouts, [BARBACK]);
  const p = out.workplaces[0].profile;
  p.tipouts.push({ ...RUNNER, mode: 'flat', value: 50 });
  p.tipouts[0].value = 30;
  const after = M.computeNight(n, p, 10);
  assert.equal(after.tipout, before.tipout);
  assert.equal(after.net, before.net);
  assert.equal(after.cashInHand, before.cashInHand);
  // a new snapshot carries the whole list
  const snap = M.snapshotFor(p, 10);
  assert.equal(snap.tipouts.length, 2);
  p.tipouts[1].value = 99;
  assert.equal(snap.tipouts[1].value, 50, 'a copy, not the live list');
});

test('an older night keeps the people set up when it was saved: someone added to Setup later is not counted on it', () => {
  const out = migrate(oldState({ on: true, mode: 'pct', value: 15, basis: 'before', from: 'cash' }), {
    today,
  });
  const n = out.nights[0];
  assert.ok(!n.snap, 'still in the current pay period');
  assert.deepEqual(n.tipouts, { t1: true }, 'pinned to the one Barback it stood for');
  const p = out.workplaces[0].profile;
  const before = M.computeNight(n, p, 10);
  p.tipouts.push({ ...RUNNER, mode: 'flat', value: 50 });
  const after = M.computeNight(n, p, 10);
  assert.equal(after.tipout, before.tipout);
  assert.equal(after.net, before.net);
  // nights with no list (older saves): nobody stays nobody, everyone is everyone set up right now, and only once
  const off = { id: 'n2', date: today, total: 300, cash: 100, pay: {}, barback: false, workplaceId: 'w1' };
  const imp = { id: 'n3', date: today, total: 300, cash: 100, pay: {}, barback: true, workplaceId: 'w1' };
  assert.equal(pinTipouts(out.workplaces, [off, imp]), 2);
  assert.deepEqual(off.tipouts, { t1: false, t2: false });
  assert.deepEqual(imp.tipouts, { t1: true, t2: true });
  assert.equal(pinTipouts(out.workplaces, [off, imp]), 0);
});

test('nights with no list are pinned when they lock, before a Setup change can add someone', async () => {
  const S = await import('../app/js/storage.js');
  const st = S.setState(oldState({ on: true, mode: 'pct', value: 15, basis: 'before', from: 'cash' }), {
    today,
  });
  st.nights.push({ id: 'i1', date: today, total: 300, cash: 100, pay: {}, barback: true, workplaceId: 'w1' });
  S.lockFinished({ force: true, today });
  assert.deepEqual(st.nights[1].tipouts, { t1: true });
  st.workplaces[0].profile.tipouts.push({ ...RUNNER });
  const c = M.computeNight(st.nights[1], st.workplaces[0].profile, 10);
  assert.deepEqual(
    c.tipouts.map((l) => l.who),
    ['Barback'],
  );
});
