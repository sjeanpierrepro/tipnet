// Updating from v37 (one tip-out per restaurant): a v37 page still open after the update rewrites the whole saved state
// with v37's own loading rules when it saves, and those drop the tip-out list and who was ticked each night. The
// service worker reloads every window when it takes over from before v38 (tests/ui/sw.test.js); as a fallback, a list of
// one person on % of tips or flat is also written in the old single shape (math.savedTipout), which v37 keeps.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/js/math.js';
import { migrate } from '../app/js/storage.js';
import { loadV37, V37 } from './v37.js';

const today = '2026-10-08';
const BARBACK = { id: 't1', k: 'barback', who: 'Barback', mode: 'pctTips', value: 15, from: 'cash' };
const RUNNER = { id: 't2', k: 'runner', who: 'Runner', mode: 'flat', value: 12.5, from: 'payroll' };
const clone = (x) => JSON.parse(JSON.stringify(x));

// Pay periods of 14 days from Sep 7: Sep 7-20 and Sep 21 - Oct 4 are finished on Oct 8, Oct 5-18 is running.
const profile = (list, on = true) => ({
  ...M.exampleProfile(today),
  periodStart: '2026-09-07',
  periodEnd: '2026-09-20',
  freq: 14,
  tipout: { on },
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

/** v37's storage.js (tests/v37.js), or null when git or the commit isn't there. */
const S37 = async () => {
  const v = await loadV37();
  return v && v.storage;
};

/** Every night's numbers and every pay period's totals, worked out by this version (or by v37's math, Mx). */
function money(S, Mx = M) {
  const p = S.workplaces[0].profile;
  const idx = [...new Set(S.nights.map((n) => Mx.nightPeriodIndex(p, n)))].sort();
  return {
    nights: S.nights.map((n) => ({ id: n.id, ...Mx.computeNight(n, p, 10) })),
    periods: idx.map((i) => {
      // v37 has no "Exact amounts" line (nor its parts)
      const { ns, adjust, adjustFixed, adjustNontax, ...totals } = Mx.periodTotals(p, S.nights, i, today);
      return { nights: ns.length, ...totals };
    }),
  };
}
/** The money both versions show (v38 adds the tip-out lines; v37 has one tip-out). */
const shared = (m) => ({
  nights: m.nights.map((c) => [
    c.id,
    c.total,
    c.tips,
    c.tipout,
    c.kept,
    c.tax,
    c.net,
    c.fromCash,
    c.cashInHand,
    c.onCheck,
  ]),
  periods: m.periods,
});

test('savedTipout: a list of one on % of tips or flat is also written in the old single shape; anything else is not', () => {
  // no basis any more: v37 reads a missing one as "before tip-out", and the switch says whether anything is taken out
  assert.deepEqual(M.savedTipout(true, [BARBACK]), {
    on: true,
    mode: 'pct',
    value: 15,
    from: 'cash',
  });
  assert.deepEqual(M.savedTipout(true, [{ ...RUNNER, mode: 'flat', value: 20 }]), {
    on: true,
    mode: 'flat',
    value: 20,
    from: 'check',
  });
  assert.deepEqual(M.savedTipout(false, [BARBACK]).value, 15, 'switched off: still there');
  // several people, nobody: only the switch
  assert.deepEqual(M.savedTipout(true, [BARBACK, RUNNER]), { on: true });
  assert.deepEqual(M.savedTipout(false, []), { on: false });
  // a snapshot carries them too
  assert.deepEqual(M.snapshotFor(profile([BARBACK]), 10).tipout, M.savedTipout(true, [BARBACK]));
  assert.deepEqual(M.snapshotFor(profile([BARBACK, RUNNER]), 10).tipout, { on: true });
});

test('v38 reads only the list (the old fields never change a night), and loading puts them back in step with it', () => {
  const p = profile([{ ...RUNNER, mode: 'flat', value: 10 }]);
  p.tipout = { on: true, mode: 'pct', value: 50, from: 'cash' }; // out of step with the list
  const n = night('a', '2026-10-06', true, { tipouts: { t2: true } });
  const plain = { ...p, tipout: { on: true } };
  assert.deepEqual(M.computeNight(n, p, 10), M.computeNight(n, plain, 10));
  assert.equal(M.computeNight(n, p, 10).tipout, 10);
  const S = migrate(state(p, [n]), { today });
  assert.deepEqual(S.workplaces[0].profile.tipout, {
    on: true,
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
  assert.deepEqual(saved(), { on: true, mode: 'pct', value: 20, from: 'cash' });
  p.tipouts.push({ ...RUNNER }); // a second person: v37 can't hold that
  await s.flush();
  assert.deepEqual(saved(), { on: true });
  p.tipouts.shift(); // only the runner ($12.50 flat through payroll) left
  await s.flush();
  assert.deepEqual(saved(), { on: true, mode: 'flat', value: 12.5, from: 'check' });
  p.tipouts[0].value = 25;
  await s.flush();
  assert.deepEqual(saved(), { on: true, mode: 'flat', value: 25, from: 'check' });
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

test('a v37 page saving after the update: a night saved while tip-outs were off keeps no tip-out (third review)', async (t) => {
  const old = await S37();
  if (!old) return t.skip('git or commit ' + V37 + ' (tipnet-v37) is not available');
  // "I tip out" was off for x (nobody ticked, as Tonight now saves it) and is on again; y was saved with it on
  const v38 = migrate(
    state(profile([BARBACK]), [
      night('x', '2026-10-06', false, { tipoutOn: false }),
      night('y', '2026-10-07', true, { tipoutOn: true }),
    ]),
    { today },
  );
  assert.equal(money(v38).nights[0].net, 410.75);
  const after = migrate(clone(old.migrate(clone(v38), { today })), { today });
  // v37 drops tipoutOn and the ticks, but keeps barback (false for x): the money stays
  assert.deepEqual(money(after), money(v38));
  assert.equal(money(after).nights[0].tipout, 0);
  assert.equal(money(after).nights[1].tipout, 60.6);
});

test('a v37 tip-out switched off keeps its amount on the update ($20 flat through payroll), and v37 reads it back', async (t) => {
  // third v38 review (off37): the list became [] and the $20 was gone when "I tip out" was ticked again
  const raw = state(
    {
      ...profile([]),
      tipouts: undefined,
      tipout: { on: false, mode: 'flat', value: 20, basis: 'before', from: 'check' },
    },
    [
      { ...night('a', '2026-10-06', true), tipouts: undefined }, // v37's own default while off: barback true
    ],
  );
  const v38 = migrate(raw, { today });
  const p = v38.workplaces[0].profile;
  assert.deepEqual(p.tipouts, [
    { id: 't1', k: 'barback', who: 'Barback', mode: 'flat', value: 20, from: 'payroll' },
  ]);
  assert.deepEqual(p.tipout, { on: false, mode: 'flat', value: 20, from: 'check' });
  // the night saved while it was off stays without a tip-out, also once it is ticked again
  assert.equal(v38.nights[0].tipoutOn, false);
  p.tipout.on = true;
  assert.equal(M.computeNight(v38.nights[0], p, 10).tipout, 0);
  // a new night with it on: the $20 is back, through payroll
  const c = M.computeNight({ ...night('b', '2026-10-07', true), tipoutOn: true }, p, 10);
  assert.equal(c.tipout, 20);
  assert.equal(c.fromCash, 0);
  p.tipout.on = false;
  const old = await S37();
  if (!old) return t.skip('git or commit ' + V37 + ' (tipnet-v37) is not available');
  // v37 itself kept it the same way (its own migrate), and gets it back from v38 as it wrote it (v37 adds its basis)
  const v37Shape = { ...p.tipout, basis: 'before' };
  assert.deepEqual(old.migrate(clone(raw), { today }).workplaces[0].profile.tipout, v37Shape);
  assert.deepEqual(old.migrate(clone(v38), { today }).workplaces[0].profile.tipout, v37Shape);
  const after = migrate(clone(old.migrate(clone(v38), { today })), { today });
  assert.deepEqual(after.workplaces[0].profile, v38.workplaces[0].profile);
  assert.deepEqual(money(after), money(v38));
});

test('a v37 setup "after tip-out" loads as "I tip out" off: every night and pay period has the same money as in v37, and a v37 page reading it back too', async (t) => {
  const v = await loadV37();
  if (!v) return t.skip('git or commit ' + V37 + ' (tipnet-v37) is not available');
  const { storage: S7, math: M7 } = v;
  // v37 shape: one tip-out, no list. Sep 7-20 was locked "before tip-out" (15% of tips taken out), then the person
  // switched to "after tip-out": Sep 21 - Oct 4 was locked that way, and Oct 5-18 is running with it.
  const p = {
    ...profile([]),
    tipouts: undefined,
    tipout: { on: true, mode: 'pct', value: 15, basis: 'before', from: 'cash' },
    entryMode: 'total',
  };
  const raw = state(p, [
    { ...night('a', '2026-09-10', true), tipouts: undefined },
    { ...night('b', '2026-09-12', false), tipouts: undefined },
    { ...night('c', '2026-09-25', true), tipouts: undefined },
    { ...night('d', '2026-10-06', true), tipouts: undefined },
    { ...night('e', '2026-10-07', true, { cash: null }), tipouts: undefined },
  ]);
  const early = S7.migrate(clone(raw), { today: '2026-09-22' }); // locks Sep 7-20 "before"
  early.workplaces[0].profile.tipout.basis = 'after';
  const v37 = S7.migrate(clone(early), { today }); // locks Sep 21 - Oct 4 "after"
  assert.equal(v37.nights.find((n) => n.id === 'a').snap.tipout.basis, 'before');
  assert.equal(v37.nights.find((n) => n.id === 'c').snap.tipout.basis, 'after');
  const m37 = money(v37, M7);
  assert.equal(m37.nights.find((n) => n.id === 'a').tipout, 60.6, 'locked before: the 15% came out');
  assert.equal(m37.nights.find((n) => n.id === 'd').tipout, 0, 'after: nothing came out');

  const v38 = migrate(clone(v37), { today });
  const p38 = v38.workplaces[0].profile;
  assert.deepEqual(p38.tipout, { on: false, mode: 'pct', value: 15, from: 'cash' }, 'off, the amount kept');
  assert.deepEqual(p38.tipouts, [BARBACK], 'the person is kept');
  const by = (id) => v38.nights.find((n) => n.id === id);
  assert.deepEqual(by('c').snap.tipout, { on: false, mode: 'pct', value: 15, from: 'cash' });
  assert.equal(by('a').snap.tipout.on, true, 'the period locked before tip-out keeps its tip-out');
  assert.deepEqual(
    v38.nights.map((n) => [n.id, n.tipoutOn]),
    [
      ['a', true],
      ['b', true],
      ['c', false],
      ['d', false],
      ['e', false],
    ],
  );
  assert.deepEqual(shared(money(v38)), shared(m37), 'v38 shows what v37 showed');
  // switching "I tip out" on later changes no night already logged (they keep tipoutOn false)
  const on = clone(v38);
  on.workplaces[0].profile.tipout.on = true;
  assert.deepEqual(shared(money(on)), shared(m37));
  // a v37 page reading the v38 save (it has no tipoutOn) works out the same money
  const back = S7.migrate(clone(v38), { today });
  assert.deepEqual(shared(money(back, M7)), shared(m37));
  // and v38 reading that v37 rewrite again
  assert.deepEqual(shared(money(migrate(clone(back), { today }))), shared(m37));
  // loading again writes the same JSON
  assert.equal(JSON.stringify(migrate(clone(v38), { today })), JSON.stringify(v38));
});

test('a v38 night that says tip-outs were on, with an "after tip-out" setup (test data only): loads as off, the same $0 tip-out', () => {
  const p = { ...profile([BARBACK]), tipout: { on: true, basis: 'after' } };
  const n = night('a', '2026-10-06', true, { tipoutOn: true });
  const before = M.computeNight(n, p, 10);
  assert.equal(before.tipout, 0);
  const S = migrate(state(p, [n]), { today });
  assert.equal(S.nights[0].tipoutOn, false);
  assert.equal(S.nights[0].barback, false, 'for older copies of the app');
  assert.deepEqual(S.workplaces[0].profile.tipout, { on: false, mode: 'pct', value: 15, from: 'cash' });
  assert.equal(M.computeNight(S.nights[0], S.workplaces[0].profile, 10).net, before.net);
});
