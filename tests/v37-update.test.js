// Updating from v37 (one tip-out per restaurant): a v37 page still open after the update rewrites the whole saved state
// with v37's own loading rules when it saves, and those drop the tip-out list, who was ticked each night and sales. The
// service worker reloads every window when it takes over from before v38 (tests/ui/sw.test.js); as a fallback, a list of
// one person on % of tips or flat is also written in the old single shape (math.savedTipout), which v37 keeps.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as M from '../app/js/math.js';
import { migrate } from '../app/js/storage.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const V37 = '1090d93'; // tipnet-v37, the version live before v38
const today = '2026-10-08';
const BARBACK = { id: 't1', k: 'barback', who: 'Barback', mode: 'pctTips', value: 15, from: 'cash' };
const RUNNER = { id: 't2', k: 'runner', who: 'Runner', mode: 'pctSales', value: 1.25, from: 'payroll' };
const clone = (x) => JSON.parse(JSON.stringify(x));

// Pay periods of 14 days from Sep 7: Sep 7-20 and Sep 21 - Oct 4 are finished on Oct 8, Oct 5-18 is running.
const profile = (list, on = true) => ({
  ...M.exampleProfile(today),
  periodStart: '2026-09-07',
  periodEnd: '2026-09-20',
  freq: 14,
  tipout: { on, basis: 'before' },
  tipouts: list.map((x) => ({ ...x })),
});
// as Tonight saves a night: who was tipped out, and barback = anyone ticked (for older copies of the app)
const night = (id, date, ticked, extra = {}) => ({
  id,
  date,
  total: 500,
  cash: 200,
  pay: { p1: 8 },
  barback: ticked,
  workplaceId: 'w1',
  tipouts: { t1: ticked },
  ...extra,
});
const state = (p, nights) => ({
  schemaVersion: 3,
  profileExample: false,
  nightsExample: false,
  workplaces: [{ id: 'w1', name: 'Lobby', profile: p, calib: [], setupDone: true }],
  nights,
  budget: {},
  settings: { theme: 'auto', lastTab: 'tonight', activeWorkplaceId: 'w1' },
});

/**
 * v37's storage.js and the modules it imports, from git (CI checks out the full history), written to a temp folder and
 * imported. null when git or the commit isn't there.
 */
async function loadV37() {
  const files = new Map();
  try {
    const want = ['storage.js'];
    while (want.length) {
      const f = want.shift();
      if (files.has(f)) continue;
      const src = execFileSync('git', ['show', V37 + ':app/js/' + f], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      files.set(f, src);
      for (const m of src.matchAll(/from '\.\/([\w-]+\.js)'/g)) want.push(m[1]);
    }
  } catch (e) {
    return null;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tipnet-v37-'));
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type": "module"}');
    files.forEach((src, f) => fs.writeFileSync(path.join(dir, f), src));
    return await import(pathToFileURL(path.join(dir, 'storage.js')).href);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
let v37 = null;
const S37 = async () => v37 || (v37 = await loadV37());

/** Every night's numbers and every pay period's totals, worked out by this version. */
function money(S) {
  const p = S.workplaces[0].profile;
  const idx = [...new Set(S.nights.map((n) => M.nightPeriodIndex(p, n)))].sort();
  return {
    nights: S.nights.map((n) => ({ id: n.id, ...M.computeNight(n, p, 10) })),
    periods: idx.map((i) => {
      const { ns, ...totals } = M.periodTotals(p, S.nights, i, today);
      return { nights: ns.length, ...totals };
    }),
  };
}

test('savedTipout: a list of one on % of tips or flat is also written in the old single shape; anything else is not', () => {
  assert.deepEqual(M.savedTipout(true, 'before', [BARBACK]), {
    on: true,
    basis: 'before',
    mode: 'pct',
    value: 15,
    from: 'cash',
  });
  assert.deepEqual(M.savedTipout(true, 'after', [{ ...RUNNER, mode: 'flat', value: 20 }]), {
    on: true,
    basis: 'after',
    mode: 'flat',
    value: 20,
    from: 'check',
  });
  assert.deepEqual(M.savedTipout(false, 'before', [BARBACK]).value, 15, 'switched off: still there');
  // % of sales (v37 has no sales), several people, nobody: only the switch and basis
  assert.deepEqual(M.savedTipout(true, 'before', [RUNNER]), { on: true, basis: 'before' });
  assert.deepEqual(M.savedTipout(true, 'before', [BARBACK, RUNNER]), { on: true, basis: 'before' });
  assert.deepEqual(M.savedTipout(false, 'nonsense', []), { on: false, basis: 'before' });
  // a snapshot carries them too
  assert.deepEqual(M.snapshotFor(profile([BARBACK]), 10).tipout, M.savedTipout(true, 'before', [BARBACK]));
  assert.deepEqual(M.snapshotFor(profile([BARBACK, RUNNER]), 10).tipout, { on: true, basis: 'before' });
});

test('v38 reads only the list (the old fields never change a night), and loading puts them back in step with it', () => {
  const p = profile([{ ...RUNNER, mode: 'flat', value: 10 }]);
  p.tipout = { on: true, basis: 'before', mode: 'pct', value: 50, from: 'cash' }; // out of step with the list
  const n = night('a', '2026-10-06', true, { tipouts: { t2: true } });
  const plain = { ...p, tipout: { on: true, basis: 'before' } };
  assert.deepEqual(M.computeNight(n, p, 10), M.computeNight(n, plain, 10));
  assert.equal(M.computeNight(n, p, 10).tipout, 10);
  const S = migrate(state(p, [n]), { today });
  assert.deepEqual(S.workplaces[0].profile.tipout, {
    on: true,
    basis: 'before',
    mode: 'flat',
    value: 10,
    from: 'check',
  });
  assert.deepEqual(S.workplaces[0].profile.tipouts, [{ ...RUNNER, mode: 'flat', value: 10 }]);
  // loading again writes the same JSON (open copies compare by JSON when they merge)
  assert.equal(JSON.stringify(migrate(clone(S), { today })), JSON.stringify(S));
});

test('a save puts the old fields back in step after Setup changed the list (the same tipout object)', async () => {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
  mem.set('tipnet.v2', JSON.stringify(migrate(state(profile([BARBACK]), []), { today })));
  const s = await import('../app/js/storage.js?v37-sync');
  await s.load();
  const p = s.getState().workplaces[0].profile;
  const to = p.tipout; // Setup's boxes hold this object
  const saved = () => JSON.parse(mem.get('tipnet.v2')).workplaces[0].profile.tipout;
  p.tipouts[0].value = 20; // Setup: the barback now gets 20%
  assert.equal(await s.flush(), true);
  assert.deepEqual(saved(), { on: true, basis: 'before', mode: 'pct', value: 20, from: 'cash' });
  p.tipouts.push({ ...RUNNER }); // a second person: v37 can't hold that
  await s.flush();
  assert.deepEqual(saved(), { on: true, basis: 'before' });
  p.tipouts.shift(); // only the runner (% of sales) left
  await s.flush();
  assert.deepEqual(saved(), { on: true, basis: 'before' });
  p.tipouts[0].mode = 'flat';
  p.tipouts[0].value = 25;
  await s.flush();
  assert.deepEqual(saved(), { on: true, basis: 'before', mode: 'flat', value: 25, from: 'check' });
  assert.equal(p.tipout, to, 'the same object');
  assert.deepEqual(to, saved());
});

test('a v37 page saving after the update keeps the tip-out setup and every night’s money (one Barback)', async (t) => {
  const old = await S37();
  if (!old) return t.skip('git or commit ' + V37 + ' (tipnet-v37) is not available');
  // The finished pay periods were locked while the barback got $20 a night through payroll; Setup now says 15% of tips
  // from cash. The running period's nights follow Setup (unlocked).
  const locked = migrate(
    state(profile([{ ...BARBACK, mode: 'flat', value: 20, from: 'payroll' }]), [
      night('a', '2026-09-10', true),
      night('b', '2026-09-12', false), // nobody tipped out
      night('c', '2026-09-25', true, { cash: 10 }), // less cash than the tip-out
    ]),
    { today },
  );
  locked.workplaces[0].profile.tipouts = [{ ...BARBACK }];
  locked.nights.push(
    night('d', '2026-10-06', true),
    night('e', '2026-10-07', false),
    night('f', '2026-10-07', true, { cash: null }),
  );
  const v38 = migrate(locked, { today }); // what v38 has saved
  assert.ok(['a', 'b', 'c'].every((id) => v38.nights.find((n) => n.id === id).snap));
  assert.ok(['d', 'e', 'f'].every((id) => !v38.nights.find((n) => n.id === id).snap));
  // The v37 page takes that in and writes it back with its own rules (and a night of its own)
  const mine = old.migrate(clone(v38), { today });
  mine.nights.push({
    id: 'g',
    date: today,
    total: 500,
    cash: 200,
    pay: { p1: 8 },
    barback: true,
    workplaceId: 'w1',
  });
  const after = migrate(clone(old.migrate(mine, { today })), { today });
  const p = after.workplaces[0].profile;
  assert.deepEqual(p.tipout, v38.workplaces[0].profile.tipout);
  assert.deepEqual(p.tipouts, [BARBACK]);
  const back = { ...after, nights: after.nights.filter((n) => n.id !== 'g') };
  assert.deepEqual(back.nights, v38.nights, 'every night as it was: snapshots, who was tipped out');
  assert.deepEqual(money(back), money(v38));
  assert.equal(money(v38).nights.find((n) => n.id === 'a').tipout, 20, 'the locked $20');
  // the v37 page's own night counts the barback's 15% of tips from cash
  const g = M.computeNight(
    after.nights.find((n) => n.id === 'g'),
    p,
    10,
  );
  assert.equal(g.tipout, M.round2(g.tips * 0.15));
  assert.equal(g.fromCash, g.tipout);
});

test('a v37 page saving after the update keeps one flat tip-out paid through payroll (the name becomes Barback)', async (t) => {
  const old = await S37();
  if (!old) return t.skip('git or commit ' + V37 + ' (tipnet-v37) is not available');
  const runner = { ...RUNNER, mode: 'flat', value: 25 };
  const v38 = migrate(
    state(profile([runner]), [
      { ...night('a', '2026-09-10', true), tipouts: { t2: true } },
      { ...night('b', '2026-10-06', true), tipouts: { t2: true } },
      { ...night('c', '2026-10-07', false), tipouts: { t2: false } },
    ]),
    { today },
  );
  const after = migrate(clone(old.migrate(clone(v38), { today })), { today });
  // v37 has no names or kinds: the amount, how it is paid and every night's money stay; it reads as one Barback
  assert.deepEqual(after.workplaces[0].profile.tipouts, [
    { id: 't1', k: 'barback', who: 'Barback', mode: 'flat', value: 25, from: 'payroll' },
  ]);
  assert.deepEqual(after.workplaces[0].profile.tipout, v38.workplaces[0].profile.tipout);
  const strip = (m) => ({
    nights: m.nights.map((c) => ({ ...c, tipouts: c.tipouts.map((l) => ({ ...l, id: 0, k: 0, who: 0 })) })),
    periods: m.periods,
  });
  assert.deepEqual(strip(money(after)), strip(money(v38)));
  assert.equal(money(after).nights[1].tipout, 25);
});
