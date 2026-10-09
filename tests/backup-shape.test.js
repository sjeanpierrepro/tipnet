// Sixth review: Restore accepted JSON that isn't TipNet data ({"workplaces":[],"nights":[]}, workplaces without a
// profile, "profile":1) and migrate() turned it into the example, so two taps replaced real data with the example.
// A backup (code or file) must now look like TipNet data the way stored data must (recognizedShape), else it is refused
// with Error('not-tipnet') and nothing is changed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  seedState,
  encodeBackup,
  decodeBackup,
  decodeBackupFile,
  backupFileText,
} from '../app/js/storage.js';

const code = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
const notTipnet = [
  { workplaces: [], nights: [] },
  { workplaces: [{ id: 'w1' }], nights: [{ date: '2026-09-01', total: 100 }] },
  { workplaces: [{ id: 'w1', profile: 1 }], nights: [] },
  { profile: 1, nights: [] },
  { profile: [], nights: [] },
  { hello: 1, nights: [] },
];

test('a backup that is not TipNet data is refused as "not-tipnet" (code and file)', () => {
  for (const d of notTipnet) {
    assert.throws(() => decodeBackup(code(d)), { message: 'not-tipnet' }, JSON.stringify(d));
    assert.throws(() => decodeBackupFile(JSON.stringify(d)), { message: 'not-tipnet' }, JSON.stringify(d));
    assert.throws(() => decodeBackupFile(code(d)), { message: 'not-tipnet' }, JSON.stringify(d));
  }
});

test('real backups still restore: this version’s, a v2 single profile, and a workplace list with one profile', () => {
  const S = seedState();
  S.profileExample = false;
  S.nightsExample = false;
  S.nights = [
    { id: 'n1', date: '2026-09-22', total: 250, tips: 200, cash: 50, pay: { p1: 4 }, barback: false },
  ];
  assert.equal(decodeBackup(encodeBackup(S)).nights.length, 1);
  assert.equal(decodeBackupFile(backupFileText(S)).nights.length, 1);
  const v2 = { profile: S.workplaces[0].profile, nights: S.nights };
  assert.equal(decodeBackup(code(v2)).nights.length, 1);
  const mixed = JSON.parse(backupFileText(S));
  mixed.workplaces.push({ id: 'w9' }); // one without a profile next to a real one
  assert.equal(decodeBackupFile(JSON.stringify(mixed)).nights.length, 1);
});
