// A backup (code or file) made by a newer TipNet (schemaVersion above this app's) is refused with its own reason,
// never restored: this version could read it wrong and save it over what is here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEMA_VERSION,
  seedState,
  encodeBackup,
  decodeBackup,
  decodeBackupFile,
  backupFileText,
} from '../app/js/storage.js';

const real = () => {
  const S = seedState();
  S.profileExample = false;
  S.nightsExample = false;
  S.nights = [
    { id: 'n1', date: '2026-09-22', total: 250, tips: 200, cash: 50, pay: { p1: 4 }, barback: false },
  ];
  return S;
};
const newer = () => ({ ...JSON.parse(backupFileText(real())), schemaVersion: SCHEMA_VERSION + 1 });
const code = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');

test('a backup from a newer TipNet is refused as "newer-backup" (code and file); this version’s own still restores', () => {
  assert.throws(() => decodeBackup(code(newer())), { message: 'newer-backup' });
  assert.throws(() => decodeBackupFile(JSON.stringify(newer())), { message: 'newer-backup' });
  assert.throws(() => decodeBackupFile(code(newer())), { message: 'newer-backup' });
  // the same version, and older ones, restore as before
  assert.equal(decodeBackup(encodeBackup(real())).nights.length, 1);
  assert.equal(
    decodeBackupFile(JSON.stringify({ ...newer(), schemaVersion: SCHEMA_VERSION })).nights.length,
    1,
  );
  assert.equal(decodeBackupFile(JSON.stringify({ ...newer(), schemaVersion: 3 })).nights.length, 1);
  // anything else that is not a backup stays "bad-backup"
  assert.throws(() => decodeBackup('nonsense'), { message: 'bad-backup' });
});
