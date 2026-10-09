// A job or Other pay taken out of Setup while saved nights have an amount for it is RETIRED, not deleted: hidden from
// Tonight's pickers, Setup's list and new nights, but its rate, unit and flags stay for the money of the nights that
// used it. A pay type no night uses is deleted as before. Adding a job back with the same name and unit un-retires it.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/js/math.js';
import { migrate, seedState } from '../app/js/storage.js';
import { draftFromNight, storedNight } from '../app/js/ui/tonight.js';
import { loadV37, V37 } from './v37.js';

const bar = { id: 'bar', k: 'bartender', name: 'Bartender', unit: 'hr', rate: 12, usual: 0 };
const tr = { id: 'tr', k: 'training', name: 'Training', unit: 'hr', rate: 15, usual: 0 };
const bonus = { id: 'bo', k: 'bonus', name: 'Bonus', unit: 'amt', rate: 0, usual: 0, supp: 1 };
const night = (pay, extra = {}) => ({
  id: 'n1',
  date: '2026-10-05',
  tips: 200,
  cash: 50,
  total: 0,
  pay,
  ...extra,
});

test('keepUsedPay: a removed pay type a night has an amount for is kept as retired; one no night uses goes', () => {
  const nights = [night({ bar: 5, tr: 6 })];
  const out = M.keepUsedPay([bar, tr, bonus], [bar], nights);
  assert.deepEqual(
    out.map((t) => [t.id, !!t.retired]),
    [
      ['bar', false],
      ['tr', true],
    ],
  );
  assert.equal(out[1].rate, 15, 'its rate stays');
  assert.equal(tr.retired, undefined, 'the list given is not changed');
  // a locked night counts too (its row names the job)
  const locked = [night({ bar: 5, bo: 25 }, { snap: { pay: [] } })];
  assert.deepEqual(
    M.keepUsedPay([bar, tr, bonus], [bar], locked).map((t) => t.id),
    ['bar', 'bo'],
  );
  // 0 hours is no amount
  assert.deepEqual(
    M.keepUsedPay([bar, tr], [bar], [night({ bar: 5, tr: 0 })]).map((t) => t.id),
    ['bar'],
  );
});

test('keepUsedPay: adding a job back with the same name (any case) and unit un-retires the same id at the new rate', () => {
  const nights = [night({ bar: 5, tr: 6 })];
  const retired = M.keepUsedPay([bar, tr], [bar], nights);
  const fresh = { id: 'p999', k: 'otherjob', name: ' training ', unit: 'hr', rate: 16, usual: 0 };
  const back = M.keepUsedPay(retired, retired.concat([fresh]), nights);
  assert.deepEqual(
    back.map((t) => [t.id, t.rate, !!t.retired]),
    [
      ['bar', 12, false],
      ['tr', 16, false],
    ],
  );
  // by its preset's name too
  const preset = { id: 'p998', k: 'training', name: 'Training', unit: 'hr', rate: 17, usual: 0 };
  assert.deepEqual(
    M.keepUsedPay(retired, retired.concat([preset]), nights).map((t) => [t.id, t.rate, !!t.retired]),
    [
      ['bar', 12, false],
      ['tr', 17, false],
    ],
  );
  // another unit is another pay type (6 hours are not 6 shifts)
  const perShift = { id: 'p997', k: 'otherjob', name: 'Training', unit: 'shift', rate: 50, usual: 0 };
  assert.deepEqual(
    M.keepUsedPay(retired, retired.concat([perShift]), nights).map((t) => [t.id, !!t.retired]),
    [
      ['bar', false],
      ['tr', true],
      ['p997', false],
    ],
  );
  // removed and added again in one Save: the same id, at the new rate
  assert.deepEqual(
    M.keepUsedPay([bar, tr], [bar, fresh], nights).map((t) => [t.id, t.rate, !!t.retired]),
    [
      ['bar', 12, false],
      ['tr', 16, false],
    ],
  );
});

test('jobsOf / otherPayOf leave retired pay types out unless asked for (a night that used them)', () => {
  const p = { payTypes: [bar, { ...tr, retired: 1 }, { ...bonus, retired: 1 }] };
  assert.deepEqual(
    M.jobsOf(p).map((t) => t.id),
    ['bar'],
  );
  assert.deepEqual(M.otherPayOf(p), []);
  assert.deepEqual(
    M.jobsOf(p, ['tr']).map((t) => t.id),
    ['bar', 'tr'],
  );
  assert.deepEqual(
    M.otherPayOf(p, ['bo']).map((t) => t.id),
    ['bo'],
  );
  assert.deepEqual(M.retiredUsed(night({ bar: 5, tr: 6, bo: 0 }), p), ['tr']);
});

const profile = () => {
  const p = M.exampleProfile('2026-10-09');
  p.tipout = { on: false };
  p.tipouts = [];
  p.payTypes = [bar, tr].map((t) => ({ ...t }));
  return p;
};

test('the money of a night that used a retired pay type stays, unlocked, when its period locks, and on update', () => {
  const p = profile();
  const n = { ...night({ bar: 5, tr: 6 }), date: p.periodStart, total: 350 };
  const before = M.computeNight(n, p, 10).net;
  p.payTypes = M.keepUsedPay(p.payTypes, [p.payTypes[0]], [n]);
  assert.equal(M.computeNight(n, p, 10).net, before, 'running period');
  // a snapshot of today's Setup leaves the retired type out; the night that used it gets it added (snapWithPay)
  assert.deepEqual(
    M.snapshotFor(p, 10).pay.map((t) => t.id),
    ['bar'],
  );
  const later = M.addDays(p.periodEnd, 1);
  const { nights } = M.lockFinishedNights(p, [n], later);
  assert.ok(nights[0].snap);
  assert.deepEqual(
    nights[0].snap.pay.map((t) => [t.id, t.rate]),
    [
      ['bar', 12],
      ['tr', 15],
    ],
  );
  const n10 = M.computeNight(nights[0], p, 10).net;
  assert.equal(n10, M.computeNight(n, p, nights[0].snap.n).net, 'locked: the same money');
  // "Update this pay period to today's Setup": the retired type isn't today's Setup, the night keeps its own rate
  nights[0].snap.pay[1].rate = 14;
  const idx = M.nightPeriodIndex(p, nights[0]);
  const { after } = M.periodToSetup(p, nights, idx, later);
  assert.deepEqual(
    after[0].snap.pay.map((t) => [t.id, t.rate]),
    [
      ['bar', 12],
      ['tr', 14],
    ],
  );
  // a night of a finished period without a snapshot (not locked yet) keeps the retired type at its last Setup rate
  const { after: after2 } = M.periodToSetup(p, [n], idx, later);
  assert.deepEqual(
    after2[0].snap.pay.map((t) => [t.id, t.rate]),
    [
      ['bar', 12],
      ['tr', 15],
    ],
  );
});

test('a new night does not store retired pay types; the editor keeps a night’s retired amounts', () => {
  const p = profile();
  const n = { ...night({ bar: 5, tr: 6 }), date: p.periodStart, total: 350 };
  p.payTypes = M.keepUsedPay(p.payTypes, [p.payTypes[0]], [n]);
  const d = draftFromNight(n, p);
  assert.deepEqual(d.keep, ['tr']);
  assert.deepEqual(d.rows, ['bar', 'tr']);
  const out = storedNight(d, p, 'n1');
  assert.equal(out.pay.tr, 6);
  assert.equal(out.total, 350);
  const fresh = storedNight({ ...d, keep: [], rows: ['bar'], pay: { bar: '5' } }, p, 'n2');
  assert.equal('tr' in fresh.pay, false, 'not written on a night that did not work it');
});

test('loading keeps the retired flag (never on the main job)', () => {
  const S = seedState();
  S.profileExample = false;
  S.nightsExample = false;
  S.nights = [];
  S.workplaces[0].profile.payTypes = [
    { ...bar, retired: 1 },
    { ...tr, retired: true },
  ];
  const out = migrate(JSON.parse(JSON.stringify(S)), { today: '2026-10-09' });
  assert.deepEqual(
    out.workplaces[0].profile.payTypes.map((t) => [t.id, !!t.retired]),
    [
      ['bar', false],
      ['tr', true],
    ],
  );
});

test('v37 reads a retired pay type as a pay type and works out the same money', async (t) => {
  const v = await loadV37();
  if (!v) return t.skip('git or commit ' + V37 + ' (tipnet-v37) is not available');
  const S = seedState();
  S.profileExample = false;
  S.nightsExample = false;
  const w = S.workplaces[0];
  const p = profile();
  w.profile = p;
  p.shifts = 10;
  const n = { ...night({ bar: 5, tr: 6 }), date: '2026-10-08', total: 350, workplaceId: w.id };
  p.payTypes = M.keepUsedPay(p.payTypes, [p.payTypes[0]], [n]);
  S.nights = [n];
  const v38 = migrate(JSON.parse(JSON.stringify(S)), { today: '2026-10-09' });
  const m38 = M.computeNight(v38.nights[0], v38.workplaces[0].profile, 10).net;
  const v37 = v.storage.migrate(JSON.parse(JSON.stringify(v38)), { today: '2026-10-09' });
  assert.equal(v.math.computeNight(v37.nights[0], v37.workplaces[0].profile, 10).net, m38);
  assert.equal(m38, M.computeNight(n, profile(), 10).net, 'the same as before Training was taken out');
});
