// Who was tipped out (night.tipouts) always follows the people the night is worked out with: alignTicks, locking a night
// into a finished pay period with that period's snapshot, pinning after locking, and a same-date Add with no boxes.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/js/math.js';
import { migrate } from '../app/js/storage.js';
import { mergeNights } from '../app/js/ui/tonight.js';

const today = '2026-10-08';
const BARBACK = { id: 't1', k: 'barback', who: 'Barback', mode: 'pctTips', value: 15, from: 'cash' };
const BARBACK2 = { ...BARBACK, id: 't9' }; // the same barback, row removed and added again in Setup
const RUNNER = { id: 't2', k: 'runner', who: 'Runner', mode: 'pctTips', value: 5, from: 'payroll' };
// Sep 7 - Sep 20 has ended (today is Oct 8)
const prof = (list) => ({
  ...M.exampleProfile(today),
  periodStart: '2026-09-07',
  periodEnd: '2026-09-20',
  freq: 14,
  shifts: 10,
  tipout: { on: true, basis: 'before' },
  tipouts: list.map((x) => ({ ...x })),
});
// $500 made, 8 hours at $12 = $96 pay, so $404 tips: 15% for the barback is $60.60
const night = (id, date, extra = {}) => ({
  id,
  date,
  total: 500,
  cash: 200,
  pay: { p1: 8 },
  barback: true,
  workplaceId: 'w1',
  ...extra,
});

/* ---------- alignTicks ---------- */
test('alignTicks: same people: the choices on screen win, the rest is kept, nobody new is ticked', () => {
  const existing = { t1: false, t2: true, gone: true };
  const out = M.alignTicks(existing, { t1: true, t2: false }, [BARBACK, RUNNER], [BARBACK, RUNNER]);
  assert.deepEqual(out, { t1: true, t2: false, gone: true }, 'an id no longer listed is kept as it was');
  assert.deepEqual(existing, { t1: false, t2: true, gone: true }, 'the input is not changed');
  // someone in the list who is neither on screen nor in the map (added to Setup later) is not ticked
  const host = { id: 't3', k: 'host', who: 'Host', mode: 'flat', value: 10, from: 'cash' };
  assert.deepEqual(M.alignTicks({ t1: true }, {}, [], [BARBACK, host]), { t1: true, t3: false });
  assert.deepEqual(M.alignTicks(null, { t1: true }, [BARBACK], [BARBACK]), { t1: true });
});

test('alignTicks: a choice for someone the night is not worked out with goes to the one person of the same kind', () => {
  // on screen: today's Setup (the re-created barback t9); the night is worked out with its snapshot (t1)
  assert.deepEqual(M.alignTicks({ t1: false }, { t9: true }, [BARBACK2], [BARBACK]), { t1: true });
  assert.deepEqual(M.alignTicks({ t1: true }, { t9: false }, [BARBACK2], [BARBACK]), { t1: false });
  // nobody of that kind: nothing is written, and the night keeps its own choice for the others
  assert.deepEqual(M.alignTicks({ t1: true }, { t2: true }, [RUNNER], [BARBACK]), { t1: true });
  // "Other" only with the same name (case and spaces don't matter)
  const sushi = { id: 'o1', k: 'other', who: 'Sushi bar', mode: 'flat', value: 20, from: 'cash' };
  const sushi2 = { ...sushi, id: 'o2', who: ' sushi BAR ' };
  const deli = { ...sushi, id: 'o3', who: 'Deli' };
  assert.deepEqual(M.alignTicks({}, { o2: true }, [sushi2], [sushi]), { o1: true });
  assert.deepEqual(M.alignTicks({}, { o3: true }, [deli], [sushi]), { o1: false });
});

test('alignTicks: never guesses between two people of the same kind', () => {
  const bbA = { ...BARBACK, id: 'a' },
    bbB = { ...BARBACK, id: 'b' };
  // two barbacks the choice could go to
  assert.deepEqual(M.alignTicks({}, { t9: true }, [BARBACK2], [bbA, bbB]), { a: false, b: false });
  // two barbacks on screen for one in the list
  assert.deepEqual(M.alignTicks({ t1: false }, { a: true, b: true }, [bbA, bbB], [BARBACK]), { t1: false });
  // a person who is on screen himself is never the target of someone else's choice
  assert.deepEqual(M.alignTicks({}, { t1: true, t9: false }, [BARBACK, BARBACK2], [BARBACK2]), { t9: false });
});

test('nightTicks: a copy of the map; a night with only barback says it for everyone in the list', () => {
  const n = { tipouts: { t1: true } };
  const t = M.nightTicks(n, [BARBACK]);
  t.t1 = false;
  assert.deepEqual(n.tipouts, { t1: true });
  assert.deepEqual(M.nightTicks({ barback: true }, [BARBACK, RUNNER]), { t1: true, t2: true });
  assert.deepEqual(M.nightTicks({ barback: false }, [BARBACK]), { t1: false });
});

/* ---------- c) locking into a finished pay period that has locked nights ---------- */
test('locking with the period’s snapshot carries the ticks over to its people (re-created barback: $60.60 kept)', () => {
  const old = prof([BARBACK]);
  const now = prof([BARBACK2]);
  const a = night('a', '2026-09-10', { tipouts: { t1: true }, snap: M.snapshotFor(old, 10) });
  // saved as a separate night (or unlocked until now) with today's people
  const b = night('b', '2026-09-12', { tipouts: { t9: true } });
  const { nights, stamped } = M.lockFinishedNights(now, [a, b], today);
  assert.equal(stamped, 1);
  const lb = nights[1];
  assert.deepEqual(
    lb.snap.tipouts.map((r) => r.id),
    ['t1'],
    'the period’s own snapshot',
  );
  assert.equal(lb.tipouts.t1, true);
  assert.equal(lb.barback, true);
  const c = M.computeNight(lb, now, 10);
  assert.equal(c.tipout, 60.6);
  assert.equal(c.net, M.computeNight(a, now, 10).net, 'the same numbers as the night locked before');
  assert.deepEqual(b.tipouts, { t9: true }, 'pure: the input night is not changed');
  // a period locked fresh from today's Setup keeps the map as it is
  const alone = M.lockFinishedNights(now, [b], today).nights[0];
  assert.deepEqual(alone.tipouts, { t9: true });
});

test('a night with no list added to a finished period is pinned to the people it is locked with (lock, then pin)', async () => {
  // Setup now: the barback is gone, a runner was added; the period's locked night has the barback
  const old = prof([BARBACK]);
  const now = prof([RUNNER]);
  const a = night('a', '2026-09-10', { tipouts: { t1: true }, snap: M.snapshotFor(old, 10) });
  const S = await import('../app/js/storage.js');
  const st = S.setState(
    {
      schemaVersion: 3,
      profileExample: false,
      nightsExample: false,
      workplaces: [{ id: 'w1', name: 'Bar', setupDone: true, calib: [], profile: now }],
      nights: [a],
      settings: {},
    },
    { today },
  );
  // a night is added (no list of who was tipped out: "yes" = everyone), then locks
  st.nights.push(night('i1', '2026-09-12'));
  S.lockFinished({ force: true, today });
  const imp = st.nights.find((n) => n.id === 'i1');
  assert.deepEqual(
    imp.snap.tipouts.map((r) => r.id),
    ['t1'],
  );
  assert.deepEqual(imp.tipouts, { t1: true });
  const c = M.computeNight(imp, now, 10);
  assert.deepEqual(
    c.tipouts.map((l) => [l.who, l.amount]),
    [['Barback', 60.6]],
  );
  // the re-created barback (same kind): the same $60.60
  const st2 = S.setState(
    {
      schemaVersion: 3,
      workplaces: [{ id: 'w1', name: 'Bar', setupDone: true, calib: [], profile: prof([BARBACK2]) }],
      nights: [a],
      settings: {},
    },
    { today },
  );
  st2.nights.push(night('i2', '2026-09-12'));
  S.lockFinished({ force: true, today });
  assert.equal(
    M.computeNight(
      st2.nights.find((n) => n.id === 'i2'),
      now,
      10,
    ).tipout,
    60.6,
  );
});

test('loading: a night with no list in a finished period with locked nights is pinned to the snapshot’s people', () => {
  const old = prof([BARBACK]);
  const raw = {
    schemaVersion: 3,
    profileExample: false,
    nightsExample: false,
    workplaces: [{ id: 'w1', name: 'Bar', setupDone: true, calib: [], profile: prof([RUNNER]) }],
    nights: [
      night('a', '2026-09-10', { tipouts: { t1: true }, snap: M.snapshotFor(old, 10) }),
      night('b', '2026-09-12'),
      night('c', '2026-10-06'), // the running pay period: today's people
      night('d', '2026-09-14', { barback: false }),
    ],
    settings: {},
  };
  const out = migrate(raw, { today });
  const b = out.nights.find((n) => n.id === 'b');
  assert.deepEqual(b.tipouts, { t1: true });
  assert.deepEqual(out.nights.find((n) => n.id === 'd').tipouts, { t1: false }, 'nobody stays nobody');
  assert.equal(M.computeNight(b, out.workplaces[0].profile, 10).tipout, 60.6);
  assert.deepEqual(out.nights.find((n) => n.id === 'c').tipouts, { t2: true });
  // loading again changes nothing, not even the order of the fields (copies of TipNet merge nights by their JSON)
  assert.equal(JSON.stringify(migrate(out, { today })), JSON.stringify(out));
});

/* ---------- same-date Add with no boxes on screen ---------- */
test('same-date Add with tip-outs off or "after tip-out" (no boxes): the night keeps who it had', () => {
  const p = prof([BARBACK, RUNNER]);
  p.tipout.on = false;
  const a = night('a', '2026-10-06', { tipouts: { t1: true, t2: false } });
  // the added part has no boxes: no map, and the draft's barback default (true)
  const b = { id: 'x', date: '2026-10-06', total: 100, cash: null, pay: { p1: 1 }, barback: true };
  const m = mergeNights(a, b, p);
  assert.deepEqual(m.tipouts, { t1: true, t2: false });
  assert.equal(m.total, 600);
  // with boxes, ticks still add up (someone tipped out in either part was tipped out that night)
  const m2 = mergeNights(a, { ...b, tipouts: { t1: false, t2: true } }, p);
  assert.deepEqual(m2.tipouts, { t1: true, t2: true });
});

/* ---------- Setup Save: a person removed and added again (second v38 review) ---------- */
test('carryTicks: a removed person’s ticks go to the one added person of the same kind, on unlocked nights only', () => {
  const OTHER = { id: 'o1', k: 'other', who: 'Sushi bar', mode: 'flat', value: 10, from: 'cash' };
  const OTHER2 = { ...OTHER, id: 'o2', who: ' sushi BAR ' }; // the same name, typed again
  const before = [BARBACK, RUNNER, OTHER];
  const after = [RUNNER, BARBACK2, OTHER2];
  const ns = [
    night('a', '2026-10-01', { tipouts: { t1: true, t2: false, o1: true } }),
    night('b', '2026-10-02', { tipouts: { t1: false, t2: true, o1: false } }),
    night('c', '2026-10-03', { tipouts: { t2: true } }), // saved before the barback was in Setup: stays unticked
    night('d', '2026-09-10', { tipouts: { t1: true }, snap: M.snapshotFor(prof([BARBACK]), 10) }), // locked
    night('e', '2026-10-04', { tipouts: undefined, barback: true }), // no list: left alone
  ];
  const r = M.carryTicks(ns, before, after);
  assert.equal(r.changed, 2);
  assert.deepEqual(r.nights[0].tipouts, { t1: true, t2: false, o1: true, t9: true, o2: true });
  assert.equal(r.nights[0].barback, true);
  assert.deepEqual(r.nights[1].tipouts, { t1: false, t2: true, o1: false, t9: false, o2: false });
  assert.equal(r.nights[1].barback, true, 'the runner is ticked');
  assert.equal(r.nights[2], ns[2], 'unchanged nights are the same objects');
  assert.equal(r.nights[3], ns[3], 'a locked night uses its snapshot: untouched');
  assert.equal(r.nights[4], ns[4]);
  assert.deepEqual(ns[0].tipouts, { t1: true, t2: false, o1: true }, 'pure: the input is not changed');
  // $60.60 for the barback stays on the night (Barback 15% of $404 tips)
  const p = prof(after);
  assert.equal(M.computeNight(r.nights[0], p, 10).tipouts.find((l) => l.id === 't9').amount, 60.6);
});

test('carryTicks: never guesses between two, and a different kind or name is never matched', () => {
  const ns = [night('a', '2026-10-01', { tipouts: { t1: true, t2: true } })];
  const B3 = { ...BARBACK, id: 't3' };
  // two barbacks removed, one added: which one is it? nothing is carried
  assert.equal(M.carryTicks(ns, [BARBACK, B3], [BARBACK2]).changed, 0);
  // one removed, two added: nothing is carried
  assert.equal(M.carryTicks(ns, [BARBACK], [BARBACK2, { ...BARBACK, id: 't8' }]).changed, 0);
  // a runner removed and a barback added: not the same person
  assert.equal(M.carryTicks(ns, [RUNNER], [BARBACK2]).changed, 0);
  // "other" needs the same name
  const O1 = { id: 'o1', k: 'other', who: 'Sushi bar', mode: 'flat', value: 10, from: 'cash' };
  const ns2 = [night('a', '2026-10-01', { tipouts: { o1: true } })];
  assert.equal(M.carryTicks(ns2, [O1], [{ ...O1, id: 'o2', who: 'Kitchen crew' }]).changed, 0);
  // nobody removed (only added) or nobody added: nothing to do
  assert.equal(M.carryTicks(ns, [BARBACK], [BARBACK, BARBACK2]).changed, 0);
  assert.equal(M.carryTicks(ns, [BARBACK, RUNNER], [RUNNER]).changed, 0);
});

test('same-date Add: the night keeps whether tip-outs were on, whatever the added part says (third v38 review)', () => {
  const p = prof([BARBACK]);
  const a = night('a', '2026-10-06', { tipouts: { t1: true }, tipoutOn: true });
  const b = {
    id: 'x',
    date: '2026-10-06',
    total: 100,
    cash: null,
    pay: { p1: 1 },
    barback: false,
    tipouts: { t1: false },
    tipoutOn: false,
  };
  assert.equal(mergeNights(a, b, p).tipoutOn, true);
  assert.equal(mergeNights({ ...a, tipoutOn: false }, { ...b, tipoutOn: true }, p).tipoutOn, false);
});
