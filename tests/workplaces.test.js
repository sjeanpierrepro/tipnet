// Several restaurants (schema v3): migration from v2 and the prototype, the helpers, locking per restaurant, backups, merging.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  migrate,
  seedState,
  activeWorkplace,
  workplaceOf,
  findWorkplace,
  nightsOf,
  isSetUp,
  isWorkplaceSetUp,
  lockAll,
  mergeStates,
  encodeBackup,
  decodeBackup,
  backupFileText,
  decodeBackupFile,
  SCHEMA_VERSION,
  FIRST_WORKPLACE_NAME,
} from '../app/js/storage.js';
import { exampleProfile } from '../app/js/math.js';

const TODAY = '2026-10-01';
const prof = (start = '2026-09-07', extra = {}) => ({
  ...exampleProfile(TODAY),
  periodStart: start,
  periodEnd: '',
  ...extra,
});
/** A v2 state as saved before restaurants existed. */
const v2 = () => ({
  schemaVersion: 2,
  profileExample: false,
  nightsExample: false,
  profile: prof(),
  nights: [
    { id: 'a', date: '2026-09-10', total: 300, cash: 100, pay: { p1: 6 }, barback: true },
    { id: 'b', date: '2026-09-28', total: 400, cash: 120, pay: { p1: 7 }, barback: true },
  ],
  calib: [{ label: 'Aug 24 – Sep 6', pred: 900, actual: 910, err: -0.011 }],
  budget: { goals: [{ id: 'g1', name: 'Fund', target: 500, saved: 0, perPaycheck: 20 }] },
  settings: {
    theme: 'dark',
    setupDone: true,
    noDeductions: true,
    guidedDraft: { step: 1 },
    dayCutoffHour: 5,
  },
});
/** A v3 state with two restaurants. */
const two = () => {
  const S = migrate(v2(), { today: TODAY });
  S.workplaces.push({
    id: 'w2',
    name: 'Second Spot',
    profile: prof('2026-09-01', { freq: 'semimonthly' }),
    calib: [],
    setupDone: true,
  });
  S.nights.push({
    id: 'c',
    date: '2026-09-10',
    total: 200,
    cash: 50,
    pay: { p1: 5 },
    barback: true,
    workplaceId: 'w2',
  });
  return migrate(S, { today: TODAY });
};

test('v2 -> v3: the profile and accuracy history become the first restaurant; every night belongs to it', () => {
  const S = migrate(v2(), { today: TODAY });
  assert.equal(S.schemaVersion, 3);
  assert.equal(SCHEMA_VERSION, 3);
  assert.equal(S.workplaces.length, 1);
  const w = S.workplaces[0];
  assert.equal(w.id, 'w1');
  assert.equal(w.name, FIRST_WORKPLACE_NAME);
  assert.equal(w.profile.gross, 2000);
  assert.equal(w.calib.length, 1);
  // the setup flags moved from settings onto the restaurant
  assert.equal(w.setupDone, true);
  assert.equal(w.noDeductions, true);
  assert.equal('setupDone' in S.settings, false);
  assert.equal('noDeductions' in S.settings, false);
  // shared settings stay shared; the old guided draft is about the first restaurant
  assert.equal(S.settings.theme, 'dark');
  assert.equal(S.settings.dayCutoffHour, 5);
  assert.equal(S.settings.guidedDraft.workplaceId, 'w1');
  assert.equal(S.settings.activeWorkplaceId, 'w1');
  assert.ok(S.nights.every((n) => n.workplaceId === 'w1'));
  // no live v2 fields are left
  assert.equal('profile' in S, false);
  assert.equal('calib' in S, false);
  // idempotent
  assert.deepEqual(migrate(S, { today: TODAY }), S);
});

test('the seed state has one restaurant and example nights that belong to it', () => {
  const S = seedState();
  assert.equal(S.workplaces.length, 1);
  assert.ok(S.nights.every((n) => n.workplaceId === 'w1'));
  assert.equal(activeWorkplace(S).id, 'w1');
});

test('helpers: activeWorkplace, workplaceOf, findWorkplace, nightsOf', () => {
  const S = two();
  assert.equal(activeWorkplace(S).id, 'w1');
  S.settings.activeWorkplaceId = 'w2';
  assert.equal(activeWorkplace(S).name, 'Second Spot');
  S.settings.activeWorkplaceId = 'gone';
  assert.equal(activeWorkplace(S).id, 'w1', 'an unknown pick falls back to the first');
  assert.equal(workplaceOf(S, 'w2').id, 'w2');
  assert.equal(workplaceOf(S, 'nope').id, 'w1');
  assert.equal(findWorkplace(S, 'nope'), null);
  assert.deepEqual(
    nightsOf(S, 'w1').map((n) => n.id),
    ['a', 'b'],
  );
  assert.deepEqual(
    nightsOf(S, 'w2').map((n) => n.id),
    ['c'],
  );
  // migrate keeps a valid pick and drops a bad one
  assert.equal(
    migrate({ ...S, settings: { ...S.settings, activeWorkplaceId: 'w2' } }).settings.activeWorkplaceId,
    'w2',
  );
  assert.equal(
    migrate({ ...S, settings: { ...S.settings, activeWorkplaceId: 'zz' } }).settings.activeWorkplaceId,
    'w1',
  );
});

test('migrate v3: ids unique, names cleaned, unknown night restaurants go to the first, fundedBy checked', () => {
  const S = two();
  const raw = JSON.parse(JSON.stringify(S));
  raw.workplaces.push({ id: 'w2', name: '  ', profile: prof() }); // repeated id, blank name
  raw.workplaces.push({ id: 'w4', name: 'x' }); // no profile: dropped
  raw.nights.push({ id: 'z', date: '2026-09-11', total: 1, pay: {}, workplaceId: 'nowhere' });
  raw.budget.goals.push({ id: 'g2', name: 'Car', target: 9, saved: 0, perPaycheck: 1, fundedBy: 'w2' });
  raw.budget.goals.push({ id: 'g3', name: 'Trip', target: 9, saved: 0, perPaycheck: 1, fundedBy: 'gone' });
  raw.settings.periodsFilter = 'w2';
  const M = migrate(raw, { today: TODAY });
  assert.equal(M.workplaces.length, 3);
  assert.equal(new Set(M.workplaces.map((w) => w.id)).size, 3);
  assert.equal(M.workplaces[2].name, 'Restaurant 3');
  assert.equal(M.nights.find((n) => n.id === 'z').workplaceId, 'w1');
  assert.equal(M.budget.goals.find((g) => g.id === 'g2').fundedBy, 'w2');
  assert.equal('fundedBy' in M.budget.goals.find((g) => g.id === 'g3'), false);
  assert.equal(M.settings.periodsFilter, 'w2');
  // garbage never throws
  for (const bad of [{ workplaces: 'x' }, { workplaces: [null, 3] }, { workplaces: [{ profile: 'x' }] }]) {
    const s = migrate(bad);
    assert.equal(s.workplaces.length, 1);
  }
});

test('set up: per restaurant; a restaurant added later is not set up until its guided setup is finished', () => {
  const S = two();
  assert.equal(isSetUp(S), true);
  assert.equal(isWorkplaceSetUp(S, S.workplaces[1]), true);
  const fresh = JSON.parse(JSON.stringify(S));
  fresh.nights = fresh.nights.filter((n) => n.workplaceId !== 'w2');
  fresh.workplaces[1].setupDone = false;
  const M = migrate(fresh, { today: TODAY });
  assert.equal(M.workplaces[1].setupDone, false);
  assert.equal(isWorkplaceSetUp(M, M.workplaces[1]), false, 'basics are in, but its setup is still running');
  assert.equal(isWorkplaceSetUp(M, M.workplaces[0]), true);
  assert.equal(isSetUp(M), true, 'the app as a whole is set up');
});

test('locking: each restaurant locks its nights on its own pay schedule', () => {
  const S = two();
  // w1: every two weeks from Sep 7 (Sep 7-20 finished on Oct 1); w2: twice a month from Sep 1 (Sep 1-15 finished)
  const wp = [
    { id: 'w1', profile: S.workplaces[0].profile },
    { id: 'w2', profile: S.workplaces[1].profile },
  ];
  const nights = [
    { id: 1, date: '2026-09-16', total: 100, pay: {}, workplaceId: 'w1' }, // w1 period Sep 7-20: finished
    { id: 2, date: '2026-09-16', total: 100, pay: {}, workplaceId: 'w2' }, // w2 period Sep 16-30: not finished on Sep 25
    { id: 3, date: '2026-09-10', total: 100, pay: {}, workplaceId: 'w2' }, // w2 period Sep 1-15: finished
  ];
  const r = lockAll(wp, nights, '2026-09-25');
  assert.equal(r.stamped, 2);
  assert.ok(r.nights[0].snap && !r.nights[1].snap && r.nights[2].snap);
  assert.deepEqual(
    r.nights.map((n) => n.id),
    [1, 2, 3],
    'order kept',
  );
  // a restaurant without a start date has nothing finished
  const none = lockAll(
    [{ id: 'w1', profile: { ...wp[0].profile, periodStart: '' } }],
    nights.slice(0, 1),
    TODAY,
  );
  assert.equal(none.stamped, 0);
});

test('backups: v3 carries every restaurant; v2 codes and files restore as the first restaurant', () => {
  const S = two();
  const back = decodeBackup(encodeBackup(S));
  assert.equal(back.workplaces.length, 2);
  assert.equal(back.workplaces[1].name, 'Second Spot');
  assert.equal(nightsOf(back, 'w2').length, 1);
  const file = decodeBackupFile(backupFileText(S));
  assert.deepEqual(file.workplaces, back.workplaces);
  // an old v2 code (from before restaurants)
  const old = v2();
  const code = Buffer.from(JSON.stringify(old), 'utf8').toString('base64');
  const r = decodeBackup(code);
  assert.equal(r.workplaces.length, 1);
  assert.equal(r.workplaces[0].profile.gross, 2000);
  assert.ok(r.nights.every((n) => n.workplaceId === 'w1'));
  // and an old v2 file
  assert.equal(decodeBackupFile(JSON.stringify(old)).workplaces[0].calib.length, 1);
  // a backup never carries the half-finished guided setup
  assert.equal(back.settings.guidedDraft, undefined);
});

test('two open copies: restaurants merge by id', () => {
  const base = two();
  const mine = JSON.parse(JSON.stringify(base));
  const theirs = JSON.parse(JSON.stringify(base));
  // here: rename the first restaurant and add a third; there: change the second one's gross and its accuracy history
  mine.workplaces[0].name = 'Voodoo Bayou';
  mine.workplaces.push({ id: 'w3', name: 'Third', profile: prof(), calib: [] });
  theirs.workplaces[1].profile.gross = 2500;
  theirs.workplaces[1].calib.push({ label: 'x', pred: 1, actual: 1, err: 0 });
  const out = migrate(mergeStates(base, mine, theirs));
  assert.deepEqual(
    out.workplaces.map((w) => w.name),
    ['Voodoo Bayou', 'Second Spot', 'Third'],
  );
  assert.equal(out.workplaces[1].profile.gross, 2500);
  assert.equal(out.workplaces[1].calib.length, 1);
  // both edited the same restaurant, different fields: both kept
  const m2 = JSON.parse(JSON.stringify(base));
  const t2 = JSON.parse(JSON.stringify(base));
  m2.workplaces[1].name = 'Spot Two';
  t2.workplaces[1].profile.gross = 1900;
  const o2 = migrate(mergeStates(base, m2, t2));
  assert.equal(o2.workplaces[1].name, 'Spot Two');
  assert.equal(o2.workplaces[1].profile.gross, 1900);
  // removed here (untouched there): removed, with its nights
  const m3 = JSON.parse(JSON.stringify(base));
  m3.workplaces.splice(1, 1);
  m3.nights = m3.nights.filter((n) => n.workplaceId !== 'w2');
  const o3 = migrate(mergeStates(base, m3, JSON.parse(JSON.stringify(base))));
  assert.deepEqual(
    o3.workplaces.map((w) => w.id),
    ['w1'],
  );
  assert.equal(nightsOf(o3, 'w2').length, 0);
});
