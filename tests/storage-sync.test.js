// Two open copies of TipNet (two tabs, or the installed app and a browser tab) sharing one storage.
// Each copy is its own instance of storage.js (a different ?query), like two pages; they share a fake localStorage and
// talk through Node's real BroadcastChannel, as two tabs would.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seedState, mergeStates } from '../app/js/storage.js';

class MemStore {
  constructor() {
    this.m = new Map();
    this.full = false;
  }
  getItem(k) {
    return this.m.has(k) ? this.m.get(k) : null;
  }
  setItem(k, v) {
    if (this.full) throw new Error('QuotaExceededError');
    this.m.set(k, String(v));
  }
  removeItem(k) {
    this.m.delete(k);
  }
}
const store = new MemStore();
globalThis.localStorage = store;

const night = (id, date, total = 300) => ({ id, date, total, cash: null, pay: { p1: 6 }, barback: true });
function realSeed() {
  const S = seedState();
  S.profileExample = false;
  S.nightsExample = false;
  S.nights = [night('n0', '2026-09-22')];
  return { ...S, _savedAt: 1000, _writer: 'old' };
}
const stored = () => JSON.parse(store.getItem('tipnet.v2'));
const until = async (f, ms = 1000) => {
  const t = Date.now();
  while (!f() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 5));
  return f();
};

let n = 0;
async function copy() {
  const s = await import('../app/js/storage.js?copy=' + ++n);
  const seen = [];
  s.setExternalHandler((e) => seen.push(e));
  await s.load();
  return { s, seen };
}

test('two copies: a night saved in A and a theme change in B both survive; A updates without a reload', async () => {
  store.setItem('tipnet.v2', JSON.stringify(realSeed()));
  const A = await copy();
  const B = await copy();
  A.s.getState().nights.push(night('a1', '2026-09-23', 410));
  assert.equal(await A.s.flush(), true);
  // B still shows what it loaded; the theme change is its own, unsaved
  B.s.getState().settings.theme = 'dark';
  assert.equal(await B.s.flush(), true);
  const S = stored();
  assert.deepEqual(
    S.nights.map((x) => x.id),
    ['n0', 'a1'],
    'A’s night was not overwritten',
  );
  assert.equal(S.settings.theme, 'dark', 'B’s change kept');
  assert.deepEqual(
    B.s.getState().nights.map((x) => x.id),
    ['n0', 'a1'],
    'B shows the latest',
  );
  assert.deepEqual(B.seen, [{ conflict: true }], 'B redraws and says it was updated in another window');
  // A hears about B's save (BroadcastChannel) and takes it in
  assert.ok(await until(() => A.s.getState().settings.theme === 'dark'), 'A updated');
  assert.equal(A.seen.at(-1).conflict, false, 'A had nothing unsaved: no message, just a redraw');
});

test('two copies: new nights saved in both are all kept; an edit and a delete in one copy apply', async () => {
  store.setItem('tipnet.v2', JSON.stringify(realSeed()));
  const A = await copy();
  const B = await copy();
  A.s.getState().nights.push(night('x1', '2026-09-24', 200));
  await A.s.flush();
  const b = B.s.getState();
  b.nights.push(night('x1', '2026-09-25', 999)); // same new id by chance: both nights are kept
  b.nights.push(night('b2', '2026-09-26', 150));
  b.nights[0].total = 333; // an edit of a night the other copy did not touch
  await B.s.flush();
  const S = stored();
  assert.equal(S.nights.length, 4);
  assert.deepEqual(S.nights.map((x) => x.total).sort(), [150, 200, 333, 999].sort());
  assert.equal(new Set(S.nights.map((x) => x.id)).size, 4, 'ids stay unique');
  // a delete in A of a night B never touched
  await until(() => A.s.getState().nights.length === 4);
  A.s.getState().nights = A.s.getState().nights.filter((x) => x.id !== 'b2');
  await A.s.flush();
  assert.equal(stored().nights.length, 3);
});

test('a copy with nothing unsaved just takes the newer data (storage event path)', async () => {
  store.setItem('tipnet.v2', JSON.stringify(realSeed()));
  const A = await copy();
  const newer = { ...realSeed(), _savedAt: Date.now() + 5, _writer: 'someone' };
  newer.nights.push(night('z9', '2026-09-27'));
  store.setItem('tipnet.v2', JSON.stringify(newer));
  assert.equal(await A.s.syncFromStorage(), true);
  assert.deepEqual(
    A.s.getState().nights.map((x) => x.id),
    ['n0', 'z9'],
  );
  assert.deepEqual(A.seen, [{ conflict: false }]);
  assert.equal(await A.s.syncFromStorage(), false, 'nothing newer the second time');
});

test('mergeStates is pure: settings merge key by key; a change on both sides keeps the other copy’s', () => {
  const b = { ...realSeed(), settings: { theme: 'auto', lastTab: 'tonight', dayCutoffHour: 6 } };
  const mine = { ...b, settings: { theme: 'dark', lastTab: 'setup', dayCutoffHour: 6 } };
  const theirs = { ...b, settings: { theme: 'auto', lastTab: 'periods', dayCutoffHour: 4 } };
  const out = mergeStates(b, mine, theirs);
  assert.deepEqual(out.settings, { theme: 'dark', lastTab: 'periods', dayCutoffHour: 4 });
  assert.equal(out._savedAt, undefined);
  assert.equal(b.settings.theme, 'auto', 'inputs untouched');
});

test('save results: a failed write resolves false and is reported; the next good one true', async () => {
  store.setItem('tipnet.v2', JSON.stringify(realSeed()));
  const A = await copy();
  const results = [];
  A.s.setSaveHandler((ok) => results.push(ok));
  store.full = true;
  const p = A.s.scheduleSave(1);
  assert.equal(await p, false, 'the scheduled save says it failed');
  store.full = false;
  assert.equal(await A.s.flush(), true);
  assert.deepEqual(results, [false, true]);
});

test('a flush with no changes writes nothing and broadcasts nothing; a real change still does', async () => {
  store.setItem('tipnet.v2', JSON.stringify(realSeed()));
  const A = await copy();
  await A.s.flush(); // whatever loading tidied up is written once
  const heard = [];
  const ear = new BroadcastChannel('tipnet');
  ear.onmessage = (e) => heard.push(e.data);
  let writes = 0;
  const set = store.setItem.bind(store);
  store.setItem = (k, v) => {
    writes++;
    set(k, v);
  };
  try {
    const before = store.getItem('tipnet.v2');
    assert.equal(await A.s.flush(), true, 'nothing to save counts as saved');
    assert.equal(await A.s.flush(), true);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(writes, 0, 'nothing written');
    assert.equal(store.getItem('tipnet.v2'), before, 'stored copy untouched (same stamp)');
    assert.deepEqual(heard, [], 'nothing announced');
    A.s.getState().settings.theme = 'dark';
    assert.equal(await A.s.flush(), true);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(writes, 1);
    assert.equal(heard.length, 1, 'a real change is announced');
  } finally {
    store.setItem = set;
    ear.close();
  }
});

test('a copy just loaded from storage writes nothing when it is hidden or closed unchanged', async () => {
  store.setItem('tipnet.v2', JSON.stringify(realSeed()));
  const A = await copy();
  await A.s.flush();
  const stampA = stored()._savedAt;
  const B = await copy(); // B reloads
  await B.s.flush(); // and is hidden again without changes
  assert.equal(stored()._savedAt, stampA, 'B wrote nothing');
  const S = A.s.getState();
  S.nights.push(night('a7', '2026-09-24'));
  await A.s.flush();
  assert.ok(stored().nights.some((n) => n.id === 'a7'));
  assert.equal(A.s.getState(), S, 'A kept its state object');
});
