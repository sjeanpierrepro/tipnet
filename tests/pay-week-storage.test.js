// A night's picked pay week (night.periodStart) is kept by migrate, backups and the two-copies merge.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  migrate,
  seedState,
  encodeBackup,
  decodeBackup,
  backupFileText,
  decodeBackupFile,
  mergeStates,
} from '../app/js/storage.js';

const night = (id, date, extra = {}) => ({
  id,
  date,
  total: 300,
  cash: 80,
  pay: { p1: 6 },
  barback: true,
  ...extra,
});
function state(nights) {
  const S = seedState();
  S.profileExample = false;
  S.nightsExample = false;
  S.nights = nights.map((n) => ({ ...n, workplaceId: S.workplaces[0].id }));
  return S;
}

test('migrate keeps periodStart only when it is a valid ISO date', () => {
  const out = migrate(
    state([
      night('a', '2026-09-22', { periodStart: '2026-09-07' }),
      night('b', '2026-09-22', { periodStart: '2026-02-31' }),
      night('c', '2026-09-22', { periodStart: 'last week' }),
      night('d', '2026-09-22', { periodStart: 20260907 }),
      night('e', '2026-09-22', { periodStart: '' }),
      night('f', '2026-09-22'),
    ]),
    { today: '2026-09-25' },
  );
  const by = Object.fromEntries(out.nights.map((n) => [n.id, n]));
  assert.equal(by.a.periodStart, '2026-09-07');
  for (const id of ['b', 'c', 'd', 'e', 'f']) assert.equal('periodStart' in by[id], false, id);
});

test('backup codes and backup files carry periodStart', () => {
  const S = migrate(state([night('a', '2026-09-22', { periodStart: '2026-09-07' })]), {
    today: '2026-09-25',
  });
  assert.equal(decodeBackup(encodeBackup(S)).nights[0].periodStart, '2026-09-07');
  assert.equal(decodeBackupFile(backupFileText(S)).nights[0].periodStart, '2026-09-07');
});

test('the two-copies merge carries a pay week picked in one copy', () => {
  const b = state([night('a', '2026-09-22'), night('b', '2026-09-23')]);
  const mine = JSON.parse(JSON.stringify(b));
  mine.nights[0].periodStart = '2026-09-07';
  const theirs = JSON.parse(JSON.stringify(b));
  theirs.nights.push({
    ...night('c', '2026-09-24', { periodStart: '2026-10-05' }),
    workplaceId: b.workplaces[0].id,
  });
  const out = mergeStates(b, mine, theirs);
  const by = Object.fromEntries(out.nights.map((n) => [n.id, n]));
  assert.equal(by.a.periodStart, '2026-09-07', 'this copy’s pick');
  assert.equal(by.c.periodStart, '2026-10-05', 'the other copy’s new night');
  // removing the pick here (back to its own week) also merges
  const mine2 = JSON.parse(JSON.stringify(out));
  delete mine2.nights.find((n) => n.id === 'a').periodStart;
  const out2 = mergeStates(out, mine2, out);
  assert.equal('periodStart' in out2.nights.find((n) => n.id === 'a'), false);
});
