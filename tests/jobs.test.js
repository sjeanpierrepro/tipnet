// Jobs and other pay (pure parts): classification, presets, typed tips that follow the current rates, input checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/js/math.js';
import { checkCash, parseHoursInput, hoursReadable, dateProblem, maxNightDate } from '../app/js/inputs.js';
import { mergeNights, jobsText, draftFromNight, storedNight, liveNight } from '../app/js/ui/tonight.js';

const TODAY = '2026-09-30';

test('payKind: the main job, per-hour/per-shift jobs, extra hours and flat amounts', () => {
  const t = (k, unit, extra = {}) => ({ id: k, k, unit, rate: 1, ...extra });
  assert.equal(M.payKind(t('ot', 'hr'), 0), 'job', 'the first pay type is always the main job');
  assert.equal(M.payKind(t('hourly', 'hr'), 1), 'job');
  assert.equal(M.payKind(t('training', 'hr'), 1), 'job');
  assert.equal(M.payKind(t('event', 'shift'), 1), 'job');
  assert.equal(M.payKind(t('shift', 'shift'), 1), 'job');
  assert.equal(M.payKind(t('other', 'hr'), 1), 'job', 'an old "Other" per hour is a job');
  assert.equal(M.payKind(t('prep', 'hr'), 1), 'job');
  for (const k of ['ot', 'holiday', 'diff', 'pto']) assert.equal(M.payKind(t(k, 'hr'), 1), 'other', k);
  assert.equal(M.payKind(t('ot', 'shift'), 1), 'other', 'the preset decides, not the unit');
  assert.equal(M.payKind(t('x', 'hr', { diff: true }), 1), 'other', 'a differential flag is other pay');
  for (const k of ['bonus', 'commission', 'autograt', 'other', 'hourly'])
    assert.equal(M.payKind(t(k, 'amt'), 1), 'other', k + ' as a flat amount');
});

test('an existing profile ("Hourly", "Training", Overtime, Bonus) splits into jobs and other pay; nothing is lost', () => {
  const p = {
    payTypes: [
      { id: 'p1', k: 'hourly', name: 'Hourly', unit: 'hr', rate: 12, usual: 7 },
      { id: 'p2', k: 'training', name: 'Training', unit: 'hr', rate: 15, usual: 0 },
      { id: 'p3', k: 'ot', name: 'Overtime', unit: 'hr', rate: 18, usual: 0 },
      { id: 'p4', k: 'bonus', name: 'Bonus', unit: 'amt', rate: 0, usual: 0, supp: 1 },
      { id: 'p5', k: 'other', name: 'Cater', unit: 'shift', rate: 50, usual: 0 },
    ],
  };
  assert.deepEqual(
    M.jobsOf(p).map((t) => t.id),
    ['p1', 'p2', 'p5'],
  );
  assert.deepEqual(
    M.otherPayOf(p).map((t) => t.id),
    ['p3', 'p4'],
  );
  assert.equal(M.jobsOf(p).length + M.otherPayOf(p).length, p.payTypes.length);
});

test('presets: every job and every other-pay kind is offered; all the older presets are still there', () => {
  const jobs = M.JOB_PRESETS.map((x) => x.name);
  for (const n of [
    'Bartender',
    'Server',
    'Barback',
    'Supervisor / shift lead',
    'Prep',
    'Training',
    'Host',
    'Private event / banquet',
    'Other job',
  ])
    assert.ok(jobs.includes(n), n);
  const other = M.OTHER_PAY_PRESETS.map((x) => x.k);
  assert.deepEqual(other, [
    'ot',
    'holiday',
    'diff',
    'pto',
    'bonus',
    'commission',
    'autograt',
    'other',
    'ntexpense',
    'ntmileage',
    'ntuniform',
    'ntmeal',
    'ntother',
  ]);
  for (const k of [
    'hourly',
    'training',
    'ot',
    'holiday',
    'diff',
    'pto',
    'event',
    'shift',
    'bonus',
    'commission',
  ])
    assert.ok(M.findPayPreset(k), k);
  assert.ok(M.findPayPreset('autograt').notes.includes('wages, not tips'));
  assert.equal(M.JOB_PRESETS.length + M.OTHER_PAY_PRESETS.length, M.PAY_PRESETS.length);
  // Every job preset is a job, every other-pay preset is other pay, as payKind sees them.
  M.JOB_PRESETS.forEach((pr) => assert.equal(M.payKind({ k: pr.k, unit: pr.unit }, 1), 'job', pr.k));
  M.OTHER_PAY_PRESETS.forEach((pr) => assert.equal(M.payKind({ k: pr.k, unit: pr.unit }, 1), 'other', pr.k));
  // Overtime autofills 1.5x the main job's rate; "Other job" starts without a name.
  assert.equal(M.applyPayPreset({ id: 'x', rate: 0 }, 'ot', 12).rate, 18);
  assert.equal(M.applyPayPreset({ id: 'x', rate: 10 }, 'otherjob').name, '');
  assert.equal(M.applyPayPreset({ id: 'x', rate: 10 }, 'prep').rate, 10, 'switching jobs keeps the rate');
});

/* ---------- typed tips follow the current rates (review item 3) ---------- */
const profile = () => {
  const p = M.exampleProfile(TODAY);
  p.tipout.on = false;
  return p;
};
test('$400 tips + 8 h at $12, then the rate is fixed to $15 in the same period: tips stay $400, take-home rises', () => {
  const p = profile();
  const night = { id: 1, date: TODAY, total: 496, tips: 400, cash: null, pay: { p1: 8 }, barback: true };
  const before = M.computeNight(night, p, 10);
  assert.equal(before.total, 496);
  assert.equal(before.tips, 400);
  p.payTypes[0].rate = 15;
  const after = M.computeNight(night, p, 10);
  assert.equal(after.total, 520, '400 + 8 x $15');
  assert.equal(after.tips, 400, 'the tips did not turn into wages');
  assert.equal(after.basePay, 120);
  assert.ok(after.net > before.net, 'take-home rises');
  assert.equal(M.round2(after.net - before.net), M.round2(24 * (1 - M.rate(p))));
  assert.equal(M.tipsFromTotal(night, p), 400);
  // A night without typed tips (typed as a total) keeps its total, as before.
  const old = { ...night };
  delete old.tips;
  assert.equal(M.computeNight(old, p, 10).total, 496);
  assert.equal(M.computeNight(old, p, 10).tips, 376);
});

test('a locked night keeps its snapshot; locking stores tips + pay at the rates it is locked with', () => {
  const p = profile();
  p.periodStart = '2026-09-01';
  p.periodEnd = '2026-09-14';
  const n = { id: 1, date: '2026-09-05', total: 496, tips: 400, cash: null, pay: { p1: 8 }, barback: true };
  p.payTypes[0].rate = 15; // fixed before the period ended: the finished period locks at $15
  const { nights, stamped } = M.lockFinishedNights(p, [n], TODAY);
  assert.equal(stamped, 1);
  assert.equal(nights[0].total, 520, 'total brought up to date when it locks');
  assert.equal(nights[0].tips, 400);
  const locked = M.computeNight(nights[0], p, 10);
  p.payTypes[0].rate = 20; // a raise later never rewrites the finished period
  assert.deepEqual(M.computeNight(nights[0], p, 10), locked);
  assert.equal(M.computeNight(nights[0], p, 10).total, 520);
});

test('a night with typed tips and no pay amounts never borrows the old "usual" hours', () => {
  const p = profile();
  assert.equal(M.payAmount({ pay: {} }, p.payTypes[0], 0), 7, 'old nights keep the fallback');
  assert.equal(M.payAmount({ pay: {}, tips: 100 }, p.payTypes[0], 0), 0);
  assert.equal(M.computeNight({ total: 100, tips: 100, pay: {}, barback: false }, p, 10).total, 100);
});

/* ---------- inputs ---------- */
test('checkCash: tips mode compares with the tips, even $0; total mode with the tips part of the total', () => {
  assert.equal(checkCash('0', '50', { tips: true }).status, 'over', '$0 tips: cash is not free');
  assert.equal(checkCash('0', '0', { tips: true }).status, 'ok');
  assert.equal(checkCash('100', '100', { tips: true }).status, 'ok');
  assert.equal(checkCash('', '40', { tips: true }).status, 'ok', 'nothing typed yet');
  const over = checkCash('300', '250', { basePay: 96 });
  assert.equal(over.status, 'over', '300 - 96 = 204 of tips');
  assert.match(
    over.message,
    /more than the tips in what you made tonight \(the total minus \$96\.00 of hourly pay\)/,
  );
  assert.equal(checkCash('300', '204', { basePay: 96 }).status, 'ok');
  assert.equal(checkCash('300', '250').status, 'ok', 'no pay known: the total is the limit');
});

test('parseHoursInput keeps a minus sign (so it can be refused); readable vs junk', () => {
  assert.equal(parseHoursInput('-5'), -5);
  assert.equal(parseHoursInput('-7:30'), -7.5);
  assert.equal(parseHoursInput('2:15'), 2.25);
  assert.equal(hoursReadable('abc'), false);
  assert.equal(hoursReadable(''), false);
  assert.equal(hoursReadable('0'), true);
});

test('night dates: from Jan 1, 2000 to one day after today', () => {
  assert.equal(dateProblem(TODAY, TODAY), '');
  assert.equal(dateProblem('2026-10-01', TODAY), '');
  assert.match(dateProblem('2026-10-02', TODAY), /between Jan 1, 2000 and tomorrow/);
  assert.equal(dateProblem('2000-01-01', TODAY), '');
  assert.match(dateProblem('1999-12-31', TODAY), /between/);
  assert.match(dateProblem('', TODAY), /between/);
  assert.equal(maxNightDate('2026-12-31'), '2027-01-01');
});

/* ---------- nights with several jobs ---------- */
const jobsProfile = (mode = 'tips') => {
  const p = profile();
  p.entryMode = mode;
  p.payTypes = [
    { id: 'bar', k: 'bartender', name: 'Bartender', unit: 'hr', rate: 12, usual: 0 },
    { id: 'prep', k: 'prep', name: 'Prep', unit: 'hr', rate: 10, usual: 0 },
    { id: 'lead', k: 'lead', name: 'Supervisor / shift lead', unit: 'hr', rate: 15, usual: 0 },
    { id: 'bonus', k: 'bonus', name: 'Bonus', unit: 'amt', rate: 0, usual: 0, supp: 1 },
  ];
  return p;
};
test('a double (Prep 2 h + Bartender 6 h): stored, described, and merged by job', () => {
  const p = jobsProfile();
  const d = {
    total: '400',
    cash: '',
    pay: { bar: '6', prep: '2' },
    rows: ['prep', 'bar'],
    barback: true,
    date: TODAY,
  };
  const n = storedNight(d, p, 1);
  assert.equal(n.total, 400 + 2 * 10 + 6 * 12);
  assert.equal(n.tips, 400);
  assert.deepEqual(n.pay, { bar: 6, prep: 2, lead: 0, bonus: 0 });
  assert.equal(jobsText(n, p), 'Bartender 6 h · Prep 2 h');
  const round = draftFromNight(n, p);
  assert.deepEqual(round.rows, ['bar', 'prep']);
  assert.equal(round.total, '400');
  assert.equal(round.showOther, false);
  // Add another 3 h of Prep with $50 tips on the same date: hours merge by job
  const more = storedNight({ ...d, total: '50', pay: { prep: '3' }, rows: ['prep'] }, p, 2);
  const m = mergeNights(n, more, p);
  assert.deepEqual(m.pay, { bar: 6, prep: 5, lead: 0, bonus: 0 });
  assert.equal(m.tips, 450);
  assert.equal(m.total, 450 + 5 * 10 + 6 * 12);
  // a blank main job is an explicit 0 (never its old usual amount)
  assert.equal(liveNight({ ...d, pay: { prep: '2' }, rows: ['prep'] }, 'x', p).pay.bar, '0');
});
