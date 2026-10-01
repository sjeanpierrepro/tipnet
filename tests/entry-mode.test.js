// Tips-only entry and "set up": the pure pieces (migrate defaults, conversions, isSetUp).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  migrate,
  seedState,
  erasedState,
  encodeBackup,
  decodeBackup,
  isSetUp,
  hasBasics,
} from '../app/js/storage.js';
import * as M from '../app/js/math.js';

const TODAY = '2026-09-28';
const code = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64');
const real = (mutate) => {
  const S = seedState();
  S.profileExample = false;
  S.nightsExample = false;
  S.nights = [];
  delete S.workplaces[0].profile.entryMode;
  if (mutate) mutate(S);
  return S;
};

test('entry mode: new install, seed and erased state type tips', () => {
  assert.equal(seedState().workplaces[0].profile.entryMode, 'tips');
  assert.equal(erasedState().workplaces[0].profile.entryMode, 'tips');
  assert.equal(migrate(null).workplaces[0].profile.entryMode, 'tips');
  assert.equal(migrate('garbage').workplaces[0].profile.entryMode, 'tips');
  const s = seedState();
  delete s.workplaces[0].profile.entryMode;
  assert.equal(migrate(s).workplaces[0].profile.entryMode, 'tips', 'still the example, no real nights');
});

test('entry mode: existing users without one keep typing totals', () => {
  // real nights
  const withNights = real((S) => {
    S.profileExample = true; // even on the example paystub
    S.nights = [{ id: 1, date: '2026-01-05', total: 300, cash: null, pay: { p1: 6 }, barback: true }];
  });
  assert.equal(migrate(withNights).workplaces[0].profile.entryMode, 'total');
  // own profile, no nights
  assert.equal(migrate(real()).workplaces[0].profile.entryMode, 'total');
  // example nights do not count as real
  const exNights = seedState();
  delete exNights.workplaces[0].profile.entryMode;
  assert.equal(migrate(exNights).workplaces[0].profile.entryMode, 'tips');
});

test('entry mode: a saved choice is kept; garbage falls back to the rule', () => {
  assert.equal(
    migrate(real((S) => (S.workplaces[0].profile.entryMode = 'tips'))).workplaces[0].profile.entryMode,
    'tips',
  );
  assert.equal(
    migrate(real((S) => (S.workplaces[0].profile.entryMode = 'total'))).workplaces[0].profile.entryMode,
    'total',
  );
  assert.equal(
    migrate(real((S) => (S.workplaces[0].profile.entryMode = 'TIPS'))).workplaces[0].profile.entryMode,
    'total',
  );
  assert.equal(
    migrate(real((S) => (S.workplaces[0].profile.entryMode = 7))).workplaces[0].profile.entryMode,
    'total',
  );
  const fresh = seedState();
  fresh.workplaces[0].profile.entryMode = { x: 1 };
  assert.equal(migrate(fresh).workplaces[0].profile.entryMode, 'tips');
});

test('entry mode: travels in backup codes; prototype codes type totals', () => {
  const S = real((x) => (x.workplaces[0].profile.entryMode = 'tips'));
  assert.equal(decodeBackup(encodeBackup(S)).workplaces[0].profile.entryMode, 'tips');
  const T = real((x) => (x.workplaces[0].profile.entryMode = 'total'));
  assert.equal(decodeBackup(encodeBackup(T)).workplaces[0].profile.entryMode, 'total');
  // oldest prototype: hourly + hours, no payTypes, no flags
  const proto = { profile: { hourly: 12, hours: 7, gross: 2000, fed: 180 }, nights: [] };
  assert.equal(decodeBackup(code(proto)).workplaces[0].profile.entryMode, 'total');
  const proto2 = {
    profile: { hourly: 12, hours: 7 },
    nights: [{ date: '2026-01-05', total: 300, hours: 6 }],
  };
  assert.equal(decodeBackup(code(proto2)).workplaces[0].profile.entryMode, 'total');
});

test('totalFromTips / tipsFromTotal: $400 tips + 8 h x $12 = 496, and back', () => {
  const p = M.exampleProfile(TODAY);
  const night = { id: 1, date: TODAY, total: 0, cash: null, pay: { p1: 8 }, barback: true };
  assert.equal(M.totalFromTips(400, night, p), 496);
  assert.equal(M.tipsFromTotal({ ...night, total: 496 }, p), 400);
  // the $585 example night is $489 of tips
  assert.equal(M.tipsFromTotal(M.exampleNights(TODAY)[2], p), 489);
  // flat "(on top)" amounts are not part of total
  assert.equal(M.totalFromTips(400, { ...night, pay: { p1: 8, p3: 50 } }, p), 496);
  // blank main hours use the usual 7
  assert.equal(M.totalFromTips(100, { ...night, pay: {} }, p), 184);
  // a locked night uses its own rate
  const snap = M.snapshotFor(p, 10);
  snap.pay[0].rate = 10;
  assert.equal(M.totalFromTips(400, { ...night, snap }, p), 480);
  assert.equal(M.tipsFromTotal({ ...night, total: 480, snap }, p), 400);
  // cents stay exact
  assert.equal(M.totalFromTips(0.1, { ...night, pay: { p1: 0.3333 } }, p), 4.1);
});

test('the $400 tips night estimates with the real functions (about $407), the $585 example stays $420.46', () => {
  const p = M.exampleProfile(TODAY);
  p.tipout.on = false;
  const n = M.shiftsPerPeriod(p, [], TODAY).n;
  const c = M.computeNight(
    {
      id: 1,
      date: TODAY,
      total: M.totalFromTips(400, { pay: { p1: 8 } }, p),
      cash: null,
      pay: { p1: 8 },
      barback: true,
    },
    p,
    n,
  );
  assert.equal(c.total, 496);
  assert.equal(c.tips, 400);
  assert.ok(c.net > 407 && c.net < 408, String(c.net));
  const ex = M.computeNight(M.exampleNights(TODAY)[2], M.exampleProfile(TODAY), n);
  assert.equal(ex.net, 420.46);
  assert.equal(ex.cashInHand, 136.65);
  assert.equal(ex.onCheck, 283.81);
});

test('isSetUp: example paystub no, real nights yes, Finish yes, Skip needs the basics', () => {
  assert.equal(isSetUp(seedState()), false, 'first launch');
  assert.equal(isSetUp(erasedState()), false, 'erased');
  assert.equal(isSetUp(migrate(seedState())), false);
  // real nights, even on the example paystub (older installs could save those)
  const nights = seedState();
  nights.nightsExample = false;
  nights.nights = [
    { id: 1, date: '2026-01-05', total: 300, cash: null, pay: {}, barback: true, workplaceId: 'w1' },
  ];
  assert.equal(isSetUp(nights), true);
  // finished guided setup
  const done = real((S) => (S.workplaces[0].setupDone = true));
  done.workplaces[0].profile.gross = 0;
  assert.equal(isSetUp(done), true);
  // an old "Skip" left setupDone on the example paystub: not set up
  const oldSkip = seedState();
  oldSkip.workplaces[0].setupDone = true;
  assert.equal(isSetUp(oldSkip), false);
  // Skip: blank paystub until gross, a deduction (or "no deductions") and the main rate are in
  const skip = real((S) => {
    S.workplaces[0].guideSkipped = true;
    S.workplaces[0].profile.gross = 0;
    S.workplaces[0].profile.deductions.forEach((d) => (d.amount = 0));
    S.workplaces[0].profile.payTypes[0].rate = 0;
  });
  assert.equal(isSetUp(skip), false);
  skip.workplaces[0].profile.gross = 1800;
  skip.workplaces[0].profile.payTypes[0].rate = 11;
  assert.equal(isSetUp(skip), false, 'no deduction yet');
  skip.workplaces[0].noDeductions = true;
  assert.equal(isSetUp(skip), true);
  delete skip.workplaces[0].noDeductions;
  skip.workplaces[0].profile.deductions[0].amount = 150;
  assert.equal(isSetUp(skip), true);
  assert.equal(hasBasics(null), false);
  // the flags survive a reload; junk does not
  const m = migrate({
    ...skip,
    workplaces: [{ ...skip.workplaces[0], noDeductions: true, guideSkipped: 'yes' }],
  });
  assert.equal(m.workplaces[0].noDeductions, true);
  assert.equal(m.workplaces[0].guideSkipped, undefined);
});
