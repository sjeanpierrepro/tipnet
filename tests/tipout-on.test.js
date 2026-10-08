// A night keeps whether tip-outs were on when it was saved (night.tipoutOn): Setup's "I tip out" switch never changes a
// night already logged (third v38 review: a night saved while it was off went from $410.75 to $360.24 when it was
// switched back on, a $60.60 tip-out never paid). The people and their amounts still follow Setup until the period ends.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/js/math.js';
import { migrate, pinTipouts, encodeBackup, decodeBackup } from '../app/js/storage.js';

const today = '2026-10-08';
const BARBACK = { id: 't1', k: 'barback', who: 'Barback', mode: 'pctTips', value: 15, from: 'cash' };
// Oct 5 - Oct 18 is running; Sep 21 - Oct 4 has ended
const prof = (on, basis = 'before') => ({
  ...M.exampleProfile(today),
  periodStart: '2026-10-05',
  periodEnd: '2026-10-18',
  freq: 14,
  shifts: 10,
  tipout: { on, basis },
  tipouts: [{ ...BARBACK }],
  entryMode: 'total',
});
// $500 made, 8 hours at $12 = $96 pay: $404 tips, 15% for the barback is $60.60 ($360.24 take-home, $410.75 without)
const night = (extra = {}) => ({
  id: 'n1',
  date: '2026-10-06',
  total: 500,
  cash: 200,
  pay: { p1: 8 },
  barback: true,
  tipouts: { t1: true },
  workplaceId: 'w1',
  ...extra,
});
const state = (p, nights, extra = {}) => ({
  schemaVersion: 3,
  profileExample: false,
  nightsExample: false,
  workplaces: [{ id: 'w1', name: 'Bar', setupDone: true, calib: [], profile: p }],
  nights,
  settings: { theme: 'auto', activeWorkplaceId: 'w1' },
  ...extra,
});

test('the math uses the night’s own "I tip out": Setup’s switch never changes it; without one it follows Setup', () => {
  const on = prof(true),
    off = prof(false);
  assert.equal(M.computeNight(night({ tipoutOn: true }), off, 10).net, 360.24, 'saved on, Setup off since');
  assert.equal(M.computeNight(night({ tipoutOn: false }), on, 10).net, 410.75, 'saved off, Setup on since');
  assert.equal(M.computeNight(night(), on, 10).net, 360.24, 'no flag (an example night): Setup’s');
  assert.equal(M.computeNight(night(), off, 10).net, 410.75);
  // a locked night: its own flag, else its snapshot's
  const snapOn = M.snapshotFor(on, 10);
  assert.equal(M.computeNight(night({ snap: snapOn }), off, 10).net, 360.24);
  assert.equal(M.computeNight(night({ snap: snapOn, tipoutOn: false }), on, 10).net, 410.75);
  // the people and their amounts still follow Setup (an unlocked night): a fixed typo applies
  const fixed = prof(true);
  fixed.tipouts[0].value = 10;
  assert.equal(M.computeNight(night({ tipoutOn: true }), fixed, 10).tipout, 40.4);
  assert.deepEqual(M.nightTipout(night({ tipoutOn: false }), on), { ...M.tipoutSetup(on), on: false });
  assert.deepEqual(M.nightTipout(night({ snap: snapOn }), off), M.tipoutSetup(snapOn));
});

test('loading: every night gets the switch it was most likely saved with; switching it later changes no night', () => {
  const S = migrate(
    state(prof(false), [
      // saved while it was off: no list yet (an older save, or a CSV import) and the draft's "everyone" (barback true)
      night({ id: 'a', tipouts: undefined }),
      night({ id: 'b' }),
      // locked with tip-outs on (its period ended): its snapshot's switch
      night({ id: 'c', date: '2026-09-25', snap: M.snapshotFor(prof(true), 10) }),
    ]),
    { today },
  );
  const [a, b, c] = S.nights;
  assert.equal(a.tipoutOn, false);
  assert.deepEqual(a.tipouts, { t1: false }, 'saved while off: nobody was tipped out');
  assert.equal(a.barback, false);
  assert.equal(b.tipoutOn, false);
  assert.deepEqual(b.tipouts, { t1: true }, 'a list it has is kept');
  assert.equal(c.tipoutOn, true);
  // "I tip out" switched back on: the nights saved while it was off keep their money (the reviewer's $410.75)
  const p = S.workplaces[0].profile;
  p.tipout.on = true;
  assert.deepEqual(
    S.nights.map((n) => M.computeNight(n, p, 10).net),
    [410.75, 410.75, 360.24],
  );
  // and off again: the locked night keeps its tip-out
  p.tipout.on = false;
  assert.equal(M.computeNight(c, p, 10).net, 360.24);
  // loading again changes nothing, not even the order of the fields (copies of TipNet merge nights by their JSON)
  assert.equal(JSON.stringify(migrate(S, { today })), JSON.stringify(S));
  // a night saved while it was on keeps it when switched off
  const on = migrate(state(prof(true), [night({ tipouts: undefined })]), { today });
  assert.equal(on.nights[0].tipoutOn, true);
  assert.deepEqual(on.nights[0].tipouts, { t1: true });
  on.workplaces[0].profile.tipout.on = false;
  assert.equal(M.computeNight(on.nights[0], on.workplaces[0].profile, 10).net, 360.24);
});

test('loading: example nights keep following Setup; the flag is cleaned; backups keep it', () => {
  const ex = migrate(state(prof(true), [night()], { nightsExample: true }), { today });
  assert.equal('tipoutOn' in ex.nights[0], false, 'example nights follow the Setup they illustrate');
  const S = migrate(state(prof(true), [night({ tipoutOn: 'yes' }), night({ id: 'n2', tipoutOn: false })]), {
    today,
  });
  assert.equal(S.nights[0].tipoutOn, true, 'not a boolean: read as unknown, then Setup’s');
  assert.equal(S.nights[1].tipoutOn, false);
  assert.deepEqual(decodeBackup(encodeBackup(S)).nights, S.nights);
  assert.deepEqual(Object.keys(S.nights[1]).slice(0, 9), [
    'id',
    'date',
    'total',
    'cash',
    'pay',
    'barback',
    'workplaceId',
    'tipouts',
    'tipoutOn',
  ]);
});

test('pinTipouts: a night with no list saved while tip-outs were off (or "after tip-out") pins everyone as not tipped out', () => {
  const ws = [{ id: 'w1', profile: prof(true) }];
  const ns = [
    night({ id: 'a', tipouts: undefined, tipoutOn: false }),
    night({ id: 'b', tipouts: undefined, tipoutOn: true }),
    night({ id: 'c', tipouts: undefined, tipoutOn: true, barback: false }),
  ];
  assert.equal(pinTipouts(ws, ns), 3);
  assert.deepEqual(
    ns.map((n) => [n.tipouts, n.barback]),
    [
      [{ t1: false }, false],
      [{ t1: true }, true],
      [{ t1: false }, false],
    ],
  );
  const after = [night({ tipouts: undefined, tipoutOn: true })];
  pinTipouts([{ id: 'w1', profile: prof(true, 'after') }], after);
  assert.deepEqual([after[0].tipouts, after[0].barback], [{ t1: false }, false]);
});

test('a night imported (no switch, no list) is pinned to the Setup it is imported with when the import locks', async () => {
  const S = await import('../app/js/storage.js');
  const st = S.setState(state(prof(false), []), { today });
  st.nights.push({
    id: 'imp',
    date: '2026-10-06',
    total: 500,
    cash: 200,
    pay: { p1: 8 },
    barback: true,
    workplaceId: 'w1',
  });
  S.lockFinished({ force: true, today });
  const n = st.nights[0];
  assert.equal(n.tipoutOn, false);
  assert.deepEqual(n.tipouts, { t1: false });
  st.workplaces[0].profile.tipout.on = true;
  assert.equal(M.computeNight(n, st.workplaces[0].profile, 10).net, 410.75);
});
