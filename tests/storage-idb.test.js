// IndexedDB that never answers (open stays pending, e.g. blocked by an old tab) must not leave a blank screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seedState } from '../app/js/storage.js';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
const lsCopy = () => {
  const S = seedState();
  S.profileExample = false;
  S.nightsExample = false;
  S.nights = [{ id: 'n1', date: '2026-09-22', total: 250, cash: null, pay: {}, barback: true }];
  return { ...S, _savedAt: 5000 };
};

test('IndexedDB open never resolves: load falls back to the localStorage copy within the timeout', async () => {
  let opens = 0;
  globalThis.indexedDB = {
    open: () => {
      opens++;
      return {}; // no events, ever
    },
  };
  try {
    mem.set('tipnet.v2', JSON.stringify(lsCopy()));
    const s = await import('../app/js/storage.js?hang');
    s._setIdbWait(60);
    const t = Date.now();
    const st = await s.load();
    assert.ok(Date.now() - t < 1000, 'did not hang');
    assert.equal(st.nights.length, 1, 'the localStorage copy');
    assert.equal(opens, 1);
    // saving still works (localStorage), and does not wait forever either
    st.nights.push({ id: 'n2', date: '2026-09-23', total: 100, cash: null, pay: {}, barback: true });
    assert.equal(await s.flush(), true);
    assert.equal(JSON.parse(mem.get('tipnet.v2')).nights.length, 2);
  } finally {
    delete globalThis.indexedDB;
  }
});

test('IndexedDB blocked: carries on at once with the localStorage copy (or the seed)', async () => {
  globalThis.indexedDB = {
    open: () => {
      const req = {};
      setTimeout(() => req.onblocked && req.onblocked(), 0);
      return req;
    },
  };
  try {
    mem.clear();
    const s = await import('../app/js/storage.js?blocked');
    const t = Date.now();
    const st = await s.load();
    assert.ok(Date.now() - t < 500);
    assert.equal(st.nightsExample, true, 'nothing saved anywhere: the example state');
  } finally {
    delete globalThis.indexedDB;
  }
});
