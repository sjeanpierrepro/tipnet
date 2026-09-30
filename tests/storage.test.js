import test from 'node:test';
import assert from 'node:assert/strict';
import {
  migrate,
  seedState,
  erasedState,
  encodeBackup,
  decodeBackup,
  load,
  getState,
  SCHEMA_VERSION,
} from '../app/js/storage.js';
import * as M from '../app/js/math.js';

// The prototype's exact encoder (browser code): btoa(unescape(encodeURIComponent(json)))
const protoEncode = (o) =>
  Buffer.from(unescape(encodeURIComponent(JSON.stringify(o))), 'latin1').toString('base64');

const OLDEST = () => ({
  profileExample: false,
  nightsExample: false,
  profile: {
    freq: 14,
    periodStart: '2026-09-07',
    shifts: 8,
    gross: 1500,
    fed: 120,
    other: 30,
    ss: 93,
    med: 21.75,
    fixed: 40,
    hourly: 10,
    hours: 6,
  },
  nights: [
    { id: 1, date: '2026-09-08', total: 300, cash: 80, hours: 6, barback: true },
    { id: 2, date: '2026-09-09', total: 250, cash: null, hours: 5, barback: false },
  ],
  calib: [],
});
const MIDDLE = () => ({
  profileExample: false,
  nightsExample: false,
  profile: {
    freq: 14,
    periodStart: '2026-09-21',
    shifts: 10,
    gross: 2000,
    rateOverride: null,
    deductions: [{ id: 'd1', k: 'fed', name: 'Federal income tax', amount: 180, mode: 'pct' }],
    payTypes: [
      { id: 'p1', name: 'Bartending', rate: 12, unit: 'hr', usual: 7 },
      { id: 'p2', name: 'Bonus', rate: 0, unit: 'amt', usual: 0, supp: 1 },
    ],
    tipout: { on: true, mode: 'pct', value: 15, basis: 'before', from: 'cash' },
  },
  nights: [{ id: 1, date: '2026-09-21', total: 310, cash: 90, pay: { p1: 6 }, barback: true }],
  calib: [{ label: 'Sep 7 – Sep 20', pred: 900, actual: 880, err: 0.0227 }],
});

test('migrate: oldest prototype shape (hourly/hours/fed/other/ss/med/fixed)', () => {
  const s = migrate(OLDEST());
  const p = s.profile;
  assert.equal(s.schemaVersion, SCHEMA_VERSION);
  assert.equal(p.periodEnd, '');
  assert.equal(p.payTypes.length, 1);
  assert.deepEqual(p.payTypes[0], {
    id: 'p1',
    name: 'Main rate',
    rate: 10,
    unit: 'hr',
    usual: 6,
    k: 'hourly',
  });
  assert.deepEqual(
    p.deductions.map((d) => [d.k, d.amount, d.mode]),
    [
      ['fed', 120, 'pct'],
      ['state', 30, 'pct'],
      ['ss', 93, 'pct'],
      ['med', 21.75, 'pct'],
      ['other', 40, 'fixed'],
    ],
  );
  ['fed', 'other', 'ss', 'med', 'fixed', 'hourly', 'hours'].forEach((k) => assert.equal(k in p, false));
  assert.deepEqual(s.nights[0].pay, { p1: 6 });
  assert.deepEqual(s.nights[1].pay, { p1: 5 });
  assert.equal(p.rateOverride, null);
  assert.ok(M.baseRate(p) > 0);
});

test('migrate: newer prototype shape gets k, periodEnd and schemaVersion, keeps data', () => {
  const s = migrate(MIDDLE());
  assert.equal(s.schemaVersion, 2);
  assert.equal(s.profile.periodEnd, '');
  assert.equal(s.profile.payTypes[0].k, 'hourly');
  assert.equal(s.profile.payTypes[1].k, 'other');
  assert.equal(s.calib.length, 1);
  assert.equal(s.nights[0].total, 310);
});

test('migrate is idempotent, does not mutate its input, and survives garbage', () => {
  const input = MIDDLE();
  const snapshot = JSON.stringify(input);
  const once = migrate(input);
  assert.equal(JSON.stringify(input), snapshot);
  assert.deepEqual(migrate(once), once);
  for (const bad of [null, undefined, 5, 'x', {}, { profile: 3 }]) {
    const s = migrate(bad);
    assert.equal(s.schemaVersion, 2);
    assert.equal(s.profileExample, true);
    assert.equal(s.nights.length, 4);
  }
});

test('backup round trip, including unicode', () => {
  const s = seedState();
  s.profile.payTypes[0].name = 'Bartending – café \u{1F378}';
  s.calib.push({ label: 'Sep 7 – Sep 20', pred: 1, actual: 2, err: -0.5 });
  const code = encodeBackup(s);
  assert.match(code, /^[A-Za-z0-9+/=]+$/);
  assert.deepEqual(decodeBackup(code), migrate(s));
  assert.deepEqual(decodeBackup('  ' + code.slice(0, 20) + '\n' + code.slice(20) + '  '), migrate(s));
});

test('backup: large state and bad codes', () => {
  const s = seedState();
  s.nights = Array.from({ length: 3000 }, (_, i) => ({
    id: i,
    date: '2026-09-21',
    total: 100,
    cash: null,
    pay: {},
    barback: true,
  }));
  assert.equal(decodeBackup(encodeBackup(s)).nights.length, 3000);
  for (const bad of ['', 'not base64!!', 'e30=', encodeBackup({ hello: 1 }).slice(0, 10)]) {
    assert.throws(() => decodeBackup(bad), /bad-backup/);
  }
});

test('a prototype backup code restores (both shapes, unicode name)', () => {
  const mid = MIDDLE();
  mid.profile.payTypes[0].name = 'Bar – naïve';
  const s = decodeBackup(protoEncode(mid));
  assert.equal(s.profile.payTypes[0].name, 'Bar – naïve');
  assert.equal(s.nights.length, 1);
  assert.equal(s.schemaVersion, 2);
  const old = decodeBackup(protoEncode(OLDEST()));
  assert.equal(old.profile.deductions.length, 5);
  assert.equal(old.nights.length, 2);
  // a v2 code is also decodable by the prototype's decoder (same format)
  const back = JSON.parse(
    decodeURIComponent(escape(Buffer.from(encodeBackup(s), 'base64').toString('latin1'))),
  );
  assert.equal(back.nights.length, 1);
});

test('seed and erased states', () => {
  const s = seedState();
  assert.equal(s.profileExample, true);
  assert.equal(s.nightsExample, true);
  assert.equal(s.nights.length, 4);
  const e = erasedState();
  assert.equal(e.nights.length, 0);
  assert.equal(e.nightsExample, false);
  assert.equal(e.profileExample, true);
});

test('load() works in Node with no IndexedDB or localStorage (falls back to seed)', async () => {
  const s = await load();
  assert.equal(s.nightsExample, true);
  assert.equal(getState(), s);
});

/* ---------- budget in state and backups ---------- */
import { exampleBudget } from '../app/js/budget.js';

test('budget: seed and erased states start empty; migrate adds it to old states', () => {
  assert.deepEqual(seedState().budget, { bills: [], categories: [], goals: [], spends: [], paidBills: {} });
  assert.deepEqual(erasedState().budget.bills, []);
  assert.deepEqual(migrate(MIDDLE()).budget, {
    bills: [],
    categories: [],
    goals: [],
    spends: [],
    paidBills: {},
  });
  assert.deepEqual(migrate(OLDEST()).budget.spends, []);
});

test('budget: garbage budget is repaired, valid budget is kept', () => {
  const s = MIDDLE();
  s.budget = 'nope';
  assert.deepEqual(migrate(s).budget.bills, []);
  const t = MIDDLE();
  t.budget = exampleBudget();
  assert.equal(migrate(t).budget.bills.length, 3);
});

test('budget: backup round-trip keeps budget; old codes without budget still restore', () => {
  const s = migrate(MIDDLE());
  s.budget = exampleBudget();
  s.budget.paidBills['b1@2026-10-01'] = true; // "Paid" ticks are keyed by bill and due date
  const back = decodeBackup(encodeBackup(s));
  assert.deepEqual(back.budget, s.budget);
  // An old-style tick ("<periodIndex>:<billId>") is converted at load: period 0 is Sep 21 – Oct 4, rent is due Oct 1.
  const legacy = migrate(MIDDLE());
  legacy.budget = exampleBudget();
  legacy.budget.paidBills = { '0:b1': true, '3:b1': true };
  assert.deepEqual(decodeBackup(encodeBackup(legacy)).budget.paidBills, { 'b1@2026-10-01': true });
  const old = decodeBackup(protoEncode(MIDDLE()));
  assert.deepEqual(old.budget.goals, []);
  assert.equal(old.nights.length, 1);
});

test('backup code never carries the license key', () => {
  const s = migrate(MIDDLE());
  s.settings.entitlement = {
    plan: 'monthly',
    key: 'SECRET-KEY-1234',
    instanceId: 'i',
    status: 'active',
    validatedAt: new Date().toISOString(),
  };
  const code = encodeBackup(s);
  assert.ok(!Buffer.from(code, 'base64').toString().includes('SECRET-KEY'));
  assert.equal(decodeBackup(code).settings.entitlement, undefined);
});

test('migrate: payDelay stays absent when unset, is clamped and rounded when set', () => {
  const mk = (v) => {
    const s = MIDDLE();
    if (v !== 'absent') s.profile.payDelay = v;
    return migrate(s).profile;
  };
  assert.equal('payDelay' in mk('absent'), false);
  assert.equal('payDelay' in mk(''), false);
  assert.equal('payDelay' in mk(null), false);
  assert.equal('payDelay' in mk('abc'), false);
  assert.equal(mk(0).payDelay, 0);
  assert.equal(mk('4').payDelay, 4);
  assert.equal(mk(3.6).payDelay, 4);
  assert.equal(mk(40).payDelay, 21);
  assert.equal(mk(-2).payDelay, 0);
});

test('migrate: freq accepts 7/14/15/30 and the calendar strings, rejects garbage', () => {
  const f = (freq) => migrate({ ...MIDDLE(), profile: { ...MIDDLE().profile, freq } }).profile.freq;
  for (const ok of [7, 14, 15, 30, 'semimonthly', 'monthly']) assert.equal(f(ok), ok);
  assert.equal(f('15'), 15);
  for (const bad of ['weekly', 'x', 99, null, {}, NaN, -1]) assert.equal(f(bad), 14);
  assert.equal(migrate({ ...MIDDLE(), profile: (({ freq, ...r }) => r)(MIDDLE().profile) }).profile.freq, 14);
});

test('a prototype backup code with freq 15/30 restores as fixed lengths', () => {
  for (const fr of [15, 30]) {
    const mid = MIDDLE();
    mid.profile.freq = fr;
    mid.profile.periodStart = '2026-09-16';
    const s = decodeBackup(protoEncode(mid));
    assert.equal(s.profile.freq, fr);
    assert.equal(M.calendarMode(s.profile), null);
    assert.equal(M.periodLength(s.profile), fr);
  }
});

test('Late nights setting survives a reload and a backup restore; bad values are dropped', () => {
  const s = migrate(MIDDLE());
  s.settings.dayCutoffHour = 0;
  assert.equal(migrate(JSON.parse(JSON.stringify(s))).settings.dayCutoffHour, 0);
  assert.equal(decodeBackup(encodeBackup(s)).settings.dayCutoffHour, 0);
  s.settings.dayCutoffHour = 4;
  assert.equal(migrate(s).settings.dayCutoffHour, 4);
  for (const bad of [13, -1, 2.5, '4', null]) {
    s.settings.dayCutoffHour = bad;
    assert.equal('dayCutoffHour' in migrate(s).settings, false, String(bad));
  }
});

test('migrate: old calib entries stay valid, new ones keep period info, impossible-date nights are dropped', async () => {
  const { migrate } = await import('../app/js/storage.js');
  const S = migrate({
    profile: {},
    calib: [
      { label: 'old', pred: 1, actual: 2, err: 0.1 },
      {
        label: 'new',
        pred: 1,
        actual: 2,
        err: 0.1,
        idx: 3,
        start: '2026-09-01',
        end: '2026-09-14',
        rateBefore: 0.2,
        rateAfter: 0.22,
      },
    ],
    nights: [
      { id: 1, date: '2026-02-31', total: 100 },
      { id: 2, date: '2026-02-28', total: 100 },
    ],
  });
  assert.equal(S.calib[0].label, 'old');
  assert.equal(S.calib[0].idx, undefined);
  assert.equal(S.calib[1].idx, 3);
  assert.equal(S.calib[1].rateBefore, 0.2);
  assert.deepEqual(
    S.nights.map((n) => n.date),
    ['2026-02-28'],
  );
});
