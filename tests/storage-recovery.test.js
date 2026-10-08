// Stored data that cannot be read is never replaced by the example: a copy is kept and nothing is saved over it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seedState } from '../app/js/storage.js';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
const realCopy = () => {
  const S = seedState();
  S.profileExample = false;
  S.nightsExample = false;
  S.nights = [{ id: 'n1', date: '2026-09-22', total: 250, cash: null, pay: {}, barback: true }];
  return { ...S, _savedAt: 5000 };
};

test('a loading error keeps the stored data, saves nothing over it and offers a copy', async () => {
  mem.clear();
  const stored = JSON.stringify(realCopy());
  mem.set('tipnet.v2', stored);
  const s = await import('../app/js/storage.js?recovery');
  s._setIdbWait(20);
  s._setMigrator(() => {
    throw new Error('cannot read');
  });
  const st = await s.load();
  assert.equal(st.nightsExample, true, 'the example is shown, not saved');
  const rec = s.recoveryInfo();
  assert.ok(rec && rec.at > 0);
  assert.equal(JSON.parse(rec.text).nights.length, 1, 'the raw data is offered');
  assert.equal(JSON.parse(mem.get('tipnet.recovery')).data.nights[0].id, 'n1', 'and kept under its own key');
  // a change, a scheduled save and a tab hide all write nothing
  st.settings.theme = 'dark';
  assert.equal(await s.scheduleSave(0), false);
  assert.equal(await s.flush(), false);
  assert.equal(mem.get('tipnet.v2'), stored, 'the stored copy is untouched');
  // the person erases or restores: saving works again
  s._setMigrator();
  s.setState(seedState());
  assert.equal(s.recoveryInfo(), null);
  assert.equal(await s.flush(), true);
  assert.notEqual(mem.get('tipnet.v2'), stored);
});

test('empty storage and normal data are not affected', async () => {
  mem.clear();
  const s = await import('../app/js/storage.js?recovery-normal');
  s._setIdbWait(20);
  let st = await s.load();
  assert.equal(st.nightsExample, true);
  assert.equal(s.recoveryInfo(), null);
  assert.equal(await s.flush(), true);
  mem.set('tipnet.v2', JSON.stringify(realCopy()));
  s._resetCache();
  st = await s.load();
  assert.equal(st.nights.length, 1);
  assert.equal(s.recoveryInfo(), null);
  assert.equal(mem.has('tipnet.recovery'), false);
});
