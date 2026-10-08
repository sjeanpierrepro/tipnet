// "You've logged 10 nights since your last backup" on Tonight: shows after every 10th saved night, Save backup file
// resets the count, "Not now" waits 10 more nights, and it never shows together with the 30-day reminder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { fileSaver, nightsBackupDue, countSavedNight, restoreFromFileText } from '../../app/js/ui/backup.js';
import { migrate, seedState } from '../../app/js/storage.js';
import { exampleNights } from '../../app/js/math.js';
import { businessDate } from '../../app/js/inputs.js';

const saved = [];
fileSaver.save = (name, text) => saved.push({ name, text });
const seed = (mutate) =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    S.settings.lastBackupAt = Date.now() - 3600e3; // backed up an hour ago: the 30-day reminder isn't due
    if (mutate) mutate(S);
  });
const key = (page, k) => page.must(page.$('[data-focus-key="' + k + '"]'), k);
const logNight = (page, total = '300') => {
  page.type(key(page, 'night-total'), total);
  page.type(key(page, 'night-pay-p1'), '6');
  page.click(page.button('Save night'));
  // a second night on the same date: keep it separate
  const sep = page.byText('button', 'Save as a separate night');
  if (sep) page.click(sep);
};

test('the 10th saved night shows the card; Save backup file saves and starts counting again', async () => {
  saved.length = 0;
  const page = await boot({ seed: seed((S) => (S.settings.nightsSinceBackup = 8)) });
  try {
    logNight(page);
    assert.equal(page.state().settings.nightsSinceBackup, 9);
    assert.equal(page.$('#nights-backup'), null, '9 nights: not yet');
    logNight(page);
    const card = page.must(page.$('#nights-backup'), 'card');
    assert.match(page.text(card), /You’ve logged 10 nights since your last backup\./);
    assert.equal(page.$('#backup-nudge'), null);
    page.click(page.button('Save backup file', card));
    assert.equal(saved.length, 1);
    assert.match(saved[0].name, /^tipnet-backup-\d{4}-\d{2}-\d{2}\.json$/);
    assert.equal(page.state().settings.nightsSinceBackup, 0);
    assert.equal(page.$('#nights-backup'), null);
  } finally {
    await page.close();
  }
});

test('"Not now" hides the card until 10 more nights are saved', async () => {
  const page = await boot({ seed: seed((S) => (S.settings.nightsSinceBackup = 10)) });
  try {
    page.click(page.button('Not now', page.must(page.$('#nights-backup'), 'card')));
    assert.equal(page.$('#nights-backup'), null);
    assert.equal(page.state().settings.backupNightsAt, 20);
    page.state().settings.nightsSinceBackup = 18;
    logNight(page);
    assert.equal(page.$('#nights-backup'), null, '19 nights');
    logNight(page);
    assert.match(page.text(page.$('#nights-backup')), /You’ve logged 20 nights since your last backup\./);
  } finally {
    await page.close();
  }
});

test('never both reminders: Tonight shows the 10-nights card, Setup keeps the 30-day one', async () => {
  const page = await boot({
    seed: seed((S) => {
      delete S.settings.lastBackupAt; // never backed up: the 30-day reminder is due too
      S.nights = exampleNights(businessDate()).map((n) => ({ ...n, workplaceId: 'w1' }));
      while (S.nights.length < 6) S.nights.push({ ...S.nights[0], id: 'x' + S.nights.length });
      S.settings.nightsSinceBackup = 12;
    }),
  });
  try {
    assert.ok(page.$('#nights-backup'));
    assert.match(
      page.text(page.$('#nights-backup')),
      /You’ve logged 12 nights and haven’t saved a backup yet\./,
    );
    assert.equal(page.$('#backup-nudge'), null);
    page.tab('setup');
    assert.ok(page.$('#backup-nudge'), 'Setup keeps the 30-day reminder');
    assert.equal(page.$('#nights-backup'), null);
    // one "Not now" is enough: the 30-day reminder doesn't take the card's place straight away
    page.tab('tonight');
    page.click(page.button('Not now', page.must(page.$('#nights-backup'), 'card')));
    assert.equal(page.$('#nights-backup'), null);
    assert.equal(page.$('#backup-nudge'), null);
  } finally {
    await page.close();
  }
});

test('adding to or replacing a night already saved for that date is not a new night', async () => {
  const page = await boot({ seed: seed((S) => (S.settings.nightsSinceBackup = 5)) });
  try {
    logNight(page);
    assert.equal(page.state().settings.nightsSinceBackup, 6);
    const nights = page.state().nights.length;
    page.type(key(page, 'night-total'), '100');
    page.type(key(page, 'night-pay-p1'), '2');
    page.click(page.button('Save night'));
    page.click(page.must(page.byText('button', 'Add to that night'), 'Add'));
    assert.equal(page.state().nights.length, nights);
    assert.equal(page.state().settings.nightsSinceBackup, 6);
    page.type(key(page, 'night-total'), '120');
    page.type(key(page, 'night-pay-p1'), '2');
    page.click(page.button('Save night'));
    page.click(page.must(page.byText('button', 'Replace it'), 'Replace'));
    assert.equal(page.state().settings.nightsSinceBackup, 6);
  } finally {
    await page.close();
  }
});

test('pure: example nights never count; the counts are kept by migrate, junk is dropped', () => {
  const S = seedState();
  S.settings.nightsSinceBackup = 30;
  assert.equal(nightsBackupDue(S), false, 'example mode');
  S.nightsExample = false;
  assert.equal(nightsBackupDue(S), true);
  countSavedNight(S);
  assert.equal(S.settings.nightsSinceBackup, 31);
  S.settings.backupNightsAt = 40;
  assert.equal(nightsBackupDue(S), false);
  const m = migrate({ ...S, settings: { ...S.settings, nightsSinceBackup: 7, backupNightsAt: 'x' } });
  assert.equal(m.settings.nightsSinceBackup, 7);
  assert.equal('backupNightsAt' in m.settings, false);
  assert.equal('nightsSinceBackup' in migrate({ ...S, settings: { nightsSinceBackup: -1 } }).settings, false);
});

test('the saved file carries the reset count: restoring it does not bring the card back', async () => {
  saved.length = 0;
  const page = await boot({
    seed: seed((S) => {
      S.settings.nightsSinceBackup = 10;
      S.settings.lastBackupAt = Date.now() - 40 * 86400e3;
    }),
  });
  try {
    const card = page.must(page.$('#nights-backup'), 'card');
    page.click(page.button('Save backup file', card));
    const file = JSON.parse(saved[0].text);
    assert.equal(file.settings.nightsSinceBackup, 0, 'the file holds the reset count');
    assert.equal(file.settings.backupNightsAt, undefined);
    assert.ok(file.settings.lastBackupAt > Date.now() - 60e3, 'and the new backup time');
    restoreFromFileText(saved[0].text);
    page.tab('periods');
    page.tab('tonight');
    assert.equal(page.state().settings.nightsSinceBackup, 0);
    assert.equal(page.$('#nights-backup'), null, 'no "10 nights" card right after restoring');
  } finally {
    await page.close();
  }
});
