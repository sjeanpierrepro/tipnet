// What migrate keeps (tips, the guided draft, backup times), what backups leave out, and the injectable "today".
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  migrate,
  seedState,
  encodeBackup,
  decodeBackup,
  backupFileText,
  decodeBackupFile,
  isSetUp,
  hasBasics,
} from '../app/js/storage.js';
import * as M from '../app/js/math.js';

const real = (f) => {
  const S = seedState();
  S.profileExample = false;
  S.nightsExample = false;
  S.nights = [];
  if (f) f(S);
  return S;
};

test('migrate keeps a night’s tips (rounded to cents) and drops bad ones', () => {
  const S = real((s) => {
    s.nights = [
      { id: 'a', date: '2026-09-22', total: 300, tips: 212.345 },
      { id: 'b', date: '2026-09-23', total: 300, tips: -5 },
      { id: 'c', date: '2026-09-24', total: 300, tips: 'x' },
      { id: 'd', date: '2026-09-25', total: 300, tips: Infinity },
    ];
  });
  const out = migrate(S).nights;
  assert.equal(out[0].tips, 212.35);
  assert.ok(out.slice(1).every((n) => !('tips' in n)));
});

test('migrate keeps settings.guidedDraft, cleaned like a profile, with blank dates left blank', () => {
  const S = seedState();
  S.settings.guidedDraft = {
    step: 2,
    noDeductions: true,
    profile: {
      periodStart: '',
      periodEnd: 'junk',
      gross: '1500',
      shifts: 9.4,
      freq: '7',
      payTypes: [{ id: 'p1', rate: 12, unit: 'hr' }],
      deductions: [{ id: 'd1', amount: 100, mode: 'pct', k: 'fed' }, 'bad'],
      tipout: { on: 1, value: 15 },
      entryMode: 'nonsense',
      evil: '<script>',
    },
  };
  const g = migrate(S).settings.guidedDraft;
  assert.equal(g.step, 2);
  assert.equal(g.noDeductions, true);
  assert.equal(g.workplaceId, 'w1', 'an old draft is about the first restaurant');
  assert.equal(g.profile.periodStart, '', 'never defaults to today');
  assert.equal(g.profile.periodEnd, '');
  assert.equal(g.profile.gross, 1500);
  assert.equal(g.profile.shifts, 9);
  assert.equal(g.profile.freq, 7);
  assert.equal(g.profile.deductions.length, 1);
  assert.equal(g.profile.tipout.on, true);
  assert.equal(g.profile.entryMode, 'tips');
  assert.equal(g.profile.evil, undefined);
  // junk drafts: a bad step is 0, a non-object draft is dropped
  assert.equal(
    migrate({ ...seedState(), settings: { guidedDraft: { step: 9 } } }).settings.guidedDraft.step,
    0,
  );
  assert.equal(migrate({ ...seedState(), settings: { guidedDraft: 'x' } }).settings.guidedDraft, undefined);
  assert.equal(
    migrate({ ...seedState(), settings: { guidedDraft: { step: 1, noDeductions: 'yes' } } }).settings
      .guidedDraft.noDeductions,
    undefined,
  );
});

test('backups (code and file) leave out the guided draft and the license key; the file restores the same data', () => {
  const S = real((s) => {
    s.nights = [{ id: 'a', date: '2026-09-22', total: 300, cash: null, pay: {}, barback: true, tips: 250 }];
    s.settings.guidedDraft = { step: 1 };
    s.settings.entitlement = { plan: 'monthly', key: 'SECRET-KEY', instanceId: 'i' };
    s.settings.theme = 'dark';
  });
  const code = encodeBackup(S);
  const text = backupFileText(S);
  assert.doesNotMatch(Buffer.from(code, 'base64').toString(), /guidedDraft|SECRET/);
  assert.doesNotMatch(text, /guidedDraft|SECRET/);
  assert.deepEqual(JSON.parse(text), JSON.parse(Buffer.from(code, 'base64').toString()), 'same data');
  const a = decodeBackup(code);
  const b = decodeBackupFile(text);
  assert.deepEqual(a, b);
  assert.equal(b.nights[0].tips, 250);
  assert.equal(b.settings.theme, 'dark');
  assert.equal(b.settings.entitlement, undefined);
  // a hand-made file with a draft or a key in it still does not bring them in
  const sneaky = JSON.stringify({ ...S, settings: { guidedDraft: { step: 2 }, entitlement: { key: 'k' } } });
  const c = decodeBackupFile(sneaky);
  assert.equal(c.settings.guidedDraft, undefined);
  assert.equal(c.settings.entitlement, undefined);
  // a backup code saved into a file works too; junk does not
  assert.equal(decodeBackupFile('\uFEFF' + code + '\n').nights.length, 1);
  for (const bad of ['', '{}', '{"profile":1}', 'not a backup', '[1,2]', '{"profile":{},"nights":"x"}'])
    assert.throws(() => decodeBackupFile(bad), /bad-backup/, bad);
});

test('migrate locks finished periods with the "today" it is given, not the real clock', () => {
  const TODAY = '2026-09-28';
  const S = real((s) => {
    s.workplaces[0].profile = M.exampleProfile(TODAY);
    s.nights = M.exampleNights(TODAY);
  });
  assert.ok(
    migrate(S, { today: TODAY }).nights.every((n) => !n.snap),
    'period still open on 09-28',
  );
  assert.ok(
    migrate(S, { today: '2026-10-10' }).nights.every((n) => n.snap),
    'finished by 10-10',
  );
});

test('a real profile without a valid start date stays blank and is not set up; the example gets today', () => {
  const S = real((s) => {
    s.workplaces[0].profile.periodStart = 'garbage';
    s.workplaces[0].setupDone = true;
    s.nights = [{ id: 'a', date: '2026-09-22', total: 300 }];
  });
  const m = migrate(S, { today: '2026-09-30' });
  assert.equal(m.workplaces[0].profile.periodStart, '');
  assert.equal(m.nights.length, 1, 'nights kept (and not locked)');
  assert.ok(!m.nights[0].snap);
  assert.equal(isSetUp(m), false, 'Setup asks for the date first');
  assert.equal(hasBasics(m.workplaces[0].profile, { noDeductions: true }), false);
  const ex = seedState();
  ex.workplaces[0].profile.periodStart = '';
  assert.equal(migrate(ex, { today: '2026-09-30' }).workplaces[0].profile.periodStart, '2026-09-30');
});

test('migrate keeps the backup times and the iPhone note flag; junk is dropped', () => {
  const s = seedState();
  s.settings = { lastBackupAt: 1790000000000, backupNudgeUntil: 1790000000001, iosNoteSeen: true };
  const out = migrate(s).settings;
  assert.equal(out.lastBackupAt, 1790000000000);
  assert.equal(out.backupNudgeUntil, 1790000000001);
  assert.equal(out.iosNoteSeen, true);
  s.settings = { lastBackupAt: 'x', backupNudgeUntil: -1, iosNoteSeen: 'yes' };
  const bad = migrate(s).settings;
  assert.equal(bad.lastBackupAt, undefined);
  assert.equal(bad.backupNudgeUntil, undefined);
  assert.equal(bad.iosNoteSeen, undefined);
});
