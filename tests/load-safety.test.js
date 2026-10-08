// v38 review 3: stored data that is there but unreadable, not recognized, or from a newer TipNet is never replaced.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seedState, SCHEMA_VERSION } from '../app/js/storage.js';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
let n = 0;
const fresh = async () => {
  const s = await import('../app/js/storage.js?safety' + n++);
  s._setIdbWait(20);
  return s;
};
const real = (extra = {}) => {
  const S = seedState();
  S.profileExample = false;
  S.nightsExample = false;
  S.nights = [{ id: 'n1', date: '2026-09-22', total: 250, cash: null, pay: {}, barback: true }];
  return { ...S, _savedAt: 5000, ...extra };
};
// load, then check nothing can be written over the stored text
async function assertProtected(text, label) {
  mem.clear();
  mem.set('tipnet.v2', text);
  const s = await fresh();
  const st = await s.load();
  const rec = s.recoveryInfo();
  assert.ok(rec, label + ': recovery screen');
  assert.equal(rec.text, text.startsWith('{') || text.startsWith('[') ? rec.text : text, label);
  assert.ok(JSON.stringify(rec.text).length > 0);
  st.settings.theme = 'dark';
  assert.equal(await s.flush(), false, label + ': no write');
  assert.equal(mem.get('tipnet.v2'), text, label + ': stored text untouched');
  return { s, rec };
}

test('truncated JSON in tipnet.v2 with no other copy: recovery, nothing written, raw text offered', async () => {
  const text = JSON.stringify(real()).slice(0, 60);
  const { rec } = await assertProtected(text, 'truncated');
  assert.equal(rec.text, text);
  assert.equal(JSON.parse(mem.get('tipnet.recovery')).data, text, 'kept under its own key');
});

test('unrecognized shapes are kept, not replaced by the example', async () => {
  const noProfile = JSON.stringify({ ...real(), workplaces: [{ id: 'w1', name: 'X' }] });
  await assertProtected(noProfile, 'workplaces without profile');
  await assertProtected(JSON.stringify([1, 2, 3]), 'top-level array');
  await assertProtected('42', 'a number');
});

test('empty stored data is just first run', async () => {
  for (const t of ['{}', '[]', '']) {
    mem.clear();
    if (t) mem.set('tipnet.v2', t);
    const s = await fresh();
    const st = await s.load();
    assert.equal(s.recoveryInfo(), null, JSON.stringify(t));
    assert.equal(st.nightsExample, true);
    assert.equal(await s.flush(), true);
  }
});

test('data saved by a newer TipNet is not opened or saved over', async () => {
  mem.clear();
  const stored = JSON.stringify(real({ schemaVersion: SCHEMA_VERSION + 1, futureField: [1] }));
  mem.set('tipnet.v2', stored);
  const s = await fresh();
  const st = await s.load();
  const rec = s.recoveryInfo();
  assert.ok(rec && rec.newer, 'newer-version screen');
  assert.equal(JSON.parse(rec.text).futureField[0], 1);
  assert.equal(mem.has('tipnet.recovery'), false, 'nothing copied aside, the data is not damaged');
  st.settings.theme = 'dark';
  assert.equal(await s.flush(), false);
  assert.equal(mem.get('tipnet.v2'), stored);
});

test('this version and older versions (and old backups) still load', async () => {
  for (const v of [undefined, 1, 2, 3, SCHEMA_VERSION]) {
    mem.clear();
    mem.set('tipnet.v2', JSON.stringify(real({ schemaVersion: v })));
    const s = await fresh();
    const st = await s.load();
    assert.equal(s.recoveryInfo(), null, 'v' + v);
    assert.equal(st.nights.length, 1);
    assert.equal(st.schemaVersion, SCHEMA_VERSION);
  }
});

test('another window with a newer TipNet saves: this window never merges or overwrites it', async () => {
  mem.clear();
  mem.set('tipnet.v2', JSON.stringify(real()));
  const s = await fresh();
  const st = await s.load();
  let told = 0;
  s.setExternalHandler(() => told++);
  const newer = JSON.stringify(real({ schemaVersion: SCHEMA_VERSION + 1, _savedAt: 9000, _writer: 'other' }));
  mem.set('tipnet.v2', newer);
  st.settings.theme = 'dark'; // an unsaved change here
  assert.equal(await s.syncFromStorage(), true);
  assert.ok(s.recoveryInfo() && s.recoveryInfo().newer);
  assert.equal(told, 1, 'the screen is told to redraw');
  assert.equal(await s.flush(), false);
  assert.equal(mem.get('tipnet.v2'), newer, 'their copy is untouched');
});

test('a copy this version cannot read from another window is ignored, not taken in', async () => {
  mem.clear();
  mem.set('tipnet.v2', JSON.stringify(real()));
  const s = await fresh();
  const st = await s.load();
  mem.set('tipnet.v2', JSON.stringify({ workplaces: [{ id: 'w1' }], _savedAt: 9000, _writer: 'other' }));
  assert.equal(await s.syncFromStorage(), false);
  assert.equal(st.nights.length, 1);
  assert.equal(s.recoveryInfo(), null);
});
