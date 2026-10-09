// The shift count is a Setup value ("Shifts you work in a pay period", one number per establishment): every night's
// fixed-deduction share follows it, never an average of past pay periods that moves by itself when a period ends or a
// forgotten night is logged. An establishment saved without one gets, on load, the count its running pay period was
// shown with (so no night changes at the update); a count that isn't whole is kept exactly in profile.shiftsAvg.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/js/math.js';
import { migrate } from '../app/js/storage.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
const P = (over = {}) => ({
  freq: 14,
  periodStart: '2026-09-07',
  periodEnd: '',
  shifts: 0,
  gross: 2000,
  rateOverride: null,
  deductions: [
    { id: 'd1', k: 'fed', name: 'Fed', amount: 200, mode: 'pct' },
    { id: 'd4', k: 'health', name: 'Health', amount: 100, mode: 'fixed' },
  ],
  payTypes: [{ id: 'p1', k: 'bartender', name: 'Bartender', rate: 5, unit: 'hr', usual: 0 }],
  tipout: { on: false },
  tipouts: [],
  ...over,
});
const night = (id, date, wid = 'w1') => ({
  id,
  date,
  total: 250,
  tips: 200,
  cash: 50,
  pay: { p1: 10 },
  barback: false,
  tipoutOn: false,
  tipouts: {},
  workplaceId: wid,
});
const state = (nights, profile = P()) => ({
  schemaVersion: 4,
  profileExample: false,
  nightsExample: false,
  workplaces: [{ id: 'w1', name: 'Bar', profile, calib: [], setupDone: true }],
  nights,
  budget: {},
  settings: { wordingV38: true },
});
/** Every night's take-home as the app shows it (Pay periods and Tonight: the shift count for the night's period). */
function shown(S, today) {
  const out = {};
  S.workplaces.forEach((w) => {
    const p = w.profile;
    const ns = S.nights.filter((n) => n.workplaceId === w.id);
    ns.forEach((n) => {
      const k = M.nightPeriodIndex(p, n);
      out[n.id] = M.computeNight(n, p, M.shiftsPerPeriod(p, ns, today, k).n).net;
    });
  });
  return out;
}
const days = (from, count, step = 1, prefix = 'n') =>
  Array.from({ length: count }, (x, i) => night(prefix + i, M.addDays(from, i * step)));

test('a pay period ending never changes its nights: the first period (5 nights) the day before and after', () => {
  const S0 = migrate(state(days('2026-09-08', 5, 2)), { today: '2026-09-20' });
  const before = shown(S0, '2026-09-20');
  assert.equal(before.n0, 212.5); // 8 shifts (about 4 a week): $100 / 8 = $12.50 of fixed deductions
  const S1 = migrate(clone(S0), { today: '2026-09-21' });
  assert.ok(
    S1.nights.every((n) => n.snap),
    'locked',
  );
  assert.deepEqual(shown(S1, '2026-09-21'), before);
});

test('a pay period ending never changes its nights: a second period of 10 nights, the day before and after', () => {
  const S0 = migrate(state(days('2026-09-08', 5, 2)), { today: '2026-09-20' });
  const S1 = migrate(clone(S0), { today: '2026-09-21' });
  S1.nights.push(...days('2026-09-21', 10, 1, 'm'));
  const S2 = migrate(clone(S1), { today: '2026-10-04' });
  const before = shown(S2, '2026-10-04');
  const S3 = migrate(clone(S2), { today: '2026-10-05' });
  assert.ok(
    S3.nights.every((n) => n.snap),
    'locked',
  );
  assert.deepEqual(shown(S3, '2026-10-05'), before);
});

test('a forgotten night logged into an empty finished pay period leaves the running nights as they were', () => {
  // [Aug 24 - Sep 6]: 6 nights, [Sep 7 - Sep 20]: none, the running period [Sep 21 - Oct 4]: 2 nights
  const nights = days('2026-08-25', 6, 1, 'o').concat(days('2026-09-28', 2, 1, 'r'));
  const S0 = migrate(state(nights, P({ periodStart: '2026-08-24' })), { today: '2026-09-30' });
  const before = shown(S0, '2026-09-30');
  S0.nights.push(night('late', '2026-09-10'));
  const S1 = migrate(clone(S0), { today: '2026-09-30' });
  const after = shown(S1, '2026-09-30');
  ['r0', 'r1', 'o0'].forEach((id) => assert.equal(after[id], before[id], id));
});

test('the update gives an establishment without a shift count the one its running pay period was shown with', () => {
  const today = '2026-09-30';
  // two finished periods of 6 and 7 nights: the running period was worked out with 6.5 shifts
  const nights = days('2026-08-25', 6, 1, 'a')
    .concat(days('2026-09-08', 7, 1, 'b'))
    .concat(days('2026-09-28', 2, 1, 'r'));
  const raw = state(nights, P({ periodStart: '2026-08-24' }));
  const v37n = M.historyShifts(raw.workplaces[0].profile, raw.nights, today).n;
  assert.equal(v37n, 6.5);
  const S = migrate(clone(raw), { today });
  const p = S.workplaces[0].profile;
  // not a whole number: kept exactly next to shifts (which a v37 page rounds), so no night changes
  assert.equal(p.shifts, 0);
  assert.equal(p.shiftsAvg, 6.5);
  assert.deepEqual(M.shiftsPerPeriod(p, [], today), { n: 6.5, source: 'entered' });
  assert.equal(
    shown(S, today).r0,
    M.computeNight(
      S.nights.find((n) => n.id === 'r0'),
      p,
      6.5,
    ).net,
  );
  // loaded again later (a period ended, nights were added): it stays
  S.nights.push(night('x', '2026-09-29'));
  const later = migrate(clone(S), { today: '2026-10-20' });
  assert.equal(later.workplaces[0].profile.shiftsAvg, 6.5);
  // a whole average is written as the shift count itself
  const whole = migrate(
    state(
      days('2026-08-25', 6, 1, 'a').concat(days('2026-09-08', 6, 1, 'b')),
      P({ periodStart: '2026-08-24' }),
    ),
    { today },
  );
  assert.equal(whole.workplaces[0].profile.shifts, 6);
  assert.equal('shiftsAvg' in whole.workplaces[0].profile, false);
  // an entered count is kept as it is
  const entered = migrate(state(nights, P({ periodStart: '2026-08-24', shifts: 9 })), { today });
  assert.equal(entered.workplaces[0].profile.shifts, 9);
  assert.equal('shiftsAvg' in entered.workplaces[0].profile, false);
});

test('an establishment still in its guided setup gets no shift count on load (Setup asks for it)', () => {
  const raw = state([night('a', '2026-09-08')]);
  raw.workplaces.push({ id: 'w2', name: 'Cafe', profile: P(), calib: [], setupDone: false });
  const S = migrate(raw, { today: '2026-09-30' });
  assert.equal(S.workplaces[0].profile.shifts > 0 || S.workplaces[0].profile.shiftsAvg > 0, true);
  assert.equal(S.workplaces[1].profile.shifts, 0);
  assert.equal('shiftsAvg' in S.workplaces[1].profile, false);
});

test('the money paths never average past pay periods: shiftsPerPeriod is the Setup count (or about 4 a week)', () => {
  const p = P();
  const ns = days('2026-09-08', 3, 1);
  // a finished period with 3 nights would have made it 3; without a Setup count it is about 4 a week (8)
  assert.deepEqual(M.shiftsPerPeriod(p, ns, '2026-10-01'), { n: 8, source: 'default' });
  assert.deepEqual(M.historyShifts(p, ns, '2026-10-01'), { n: 3, source: 'history' });
  assert.deepEqual(M.shiftsPerPeriod({ ...p, shifts: 7 }, ns, '2026-10-01'), { n: 7, source: 'entered' });
  assert.deepEqual(M.shiftsPerPeriod({ ...p, shiftsAvg: 6.5 }, ns, '2026-10-01'), {
    n: 6.5,
    source: 'entered',
  });
  // locking uses the Setup count too, not the history that now includes the period just ended
  const r = M.lockFinishedNights({ ...p, shifts: 7 }, ns, '2026-10-01');
  assert.ok(r.nights.every((n) => n.snap.n === 7));
  const u = M.periodToSetup({ ...p, shifts: 7 }, ns, 0, '2026-10-01');
  assert.ok(u.after.every((n) => n.snap.n === 7));
});
