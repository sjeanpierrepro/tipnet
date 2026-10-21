// "Save to iCloud or Google Drive": the backup file handed to the phone's share menu (Setup, and the Tonight cards).
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { fileSaver } from '../../app/js/ui/backup.js';
import { todayISO, exampleNights } from '../../app/js/math.js';
import { businessDate } from '../../app/js/inputs.js';

const saved = [];
fileSaver.save = (name, text) => saved.push({ name, text });
const seed = (mutate) =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    S.settings.lastBackupAt = Date.now() - 3600e3;
    S.settings.nightsSinceBackup = 10;
    if (mutate) mutate(S);
  });
/** Makes this page's navigator share-capable (or not), then redraws Tonight. Returns the share() arguments. */
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130.0 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36';
const stub = (page, { canShare = true, share, ua = IPHONE } = {}) => {
  const calls = [];
  const nav = page.win.navigator;
  Object.defineProperty(nav, 'userAgent', { configurable: true, value: ua });
  Object.defineProperty(nav, 'canShare', {
    configurable: true,
    value: canShare === null ? undefined : (d) => canShare && !!d && Array.isArray(d.files),
  });
  Object.defineProperty(nav, 'share', {
    configurable: true,
    value: (d) => {
      calls.push(d);
      return share ? share(d) : Promise.resolve();
    },
  });
  page.tab('periods');
  page.tab('tonight');
  return calls;
};
const SHARE = 'Save to iCloud or Google Drive';
const abort = () => Promise.reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
const fail = () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
const stateOf = (page) => {
  const s = page.state().settings;
  return [s.lastBackupAt, s.nightsSinceBackup, s.backupNightsAt];
};
const toastText = (page) => page.doc.getElementById('toast').textContent;

test('canShare missing or false: no share button anywhere', async () => {
  const page = await boot({ seed: seed() });
  try {
    stub(page, { canShare: false });
    assert.ok(page.$('#nights-backup'));
    assert.equal(page.$('#nights-backup-share'), null);
    page.tab('setup');
    assert.equal(page.byText('button', SHARE), null);
    assert.equal(page.$('#bk-share-hint'), null);
    stub(page, { canShare: null });
    assert.equal(page.$('#nights-backup-share'), null);
  } finally {
    await page.close();
  }
});

test('a computer that can share files: no share button (only Save a backup file)', async () => {
  const page = await boot({ seed: seed() });
  try {
    stub(page, { ua: DESKTOP });
    assert.ok(page.$('#nights-backup'));
    assert.equal(page.$('#nights-backup-share'), null);
    page.tab('setup');
    assert.equal(page.byText('button', SHARE), null);
    assert.equal(page.$('#bk-share-hint'), null);
    assert.ok(page.button('Save a backup file'));
    stub(page, { ua: ANDROID });
    assert.ok(page.$('#nights-backup-share'), 'Android shows it');
  } finally {
    await page.close();
  }
});

test('canShare true: the button shows on the Tonight card and in Setup, with its hint', async () => {
  const page = await boot({ seed: seed() });
  try {
    stub(page);
    assert.equal(page.$('#nights-backup-share').textContent, SHARE);
    page.tab('setup');
    assert.equal(page.$('#bk-share-file').textContent, SHARE);
    assert.match(
      page.text(),
      /Opens your phone’s share menu\. Pick Save to Files, then iCloud Drive \(iPhone\), or Drive \(Android\), so your backup is safe/,
    );
  } finally {
    await page.close();
  }
});

test('the 30-day reminder offers the button too', async () => {
  const page = await boot({
    seed: seed((S) => {
      S.nights = exampleNights(businessDate()).map((n) => ({ ...n, workplaceId: 'w1' }));
      while (S.nights.length < 6) S.nights.push({ ...S.nights[0], id: 'x' + S.nights.length });
      S.settings.nightsSinceBackup = 2;
      S.settings.lastBackupAt = Date.now() - 40 * 864e5;
    }),
  });
  try {
    stub(page);
    page.tab('setup');
    assert.ok(page.$('#nudge-share'));
  } finally {
    await page.close();
  }
});

test('share resolves: same bookkeeping as Save backup file; the file equals the normal backup', async () => {
  saved.length = 0;
  const page = await boot({ seed: seed((S) => (S.settings.backupNightsAt = 5)) });
  try {
    const calls = stub(page);
    const before = Date.now();
    page.click(page.$('#nights-backup-share'));
    assert.equal(calls.length, 1, 'share() is called straight from the click');
    await page.settle();
    const [file] = calls[0].files;
    assert.equal(calls[0].title, 'TipNet backup');
    assert.equal(file.name, 'tipnet-backup-' + todayISO() + '.txt');
    assert.equal(file.type, 'text/plain');
    const s = page.state().settings;
    assert.ok(s.lastBackupAt >= before && s.lastBackupAt < before + 5000);
    assert.equal(s.nightsSinceBackup, 0);
    assert.equal('backupNightsAt' in s, false);
    assert.equal(page.$('#nights-backup'), null, 'the card goes away');
    assert.match(toastText(page), /Backup file sent/);
    const shared = JSON.parse(await file.text());
    assert.equal(shared.settings.lastBackupAt, s.lastBackupAt, 'the file carries the stored time');
    assert.equal(shared.settings.nightsSinceBackup, 0);
    page.tab('setup');
    page.click(page.button('Save a backup file'));
    const normal = JSON.parse(saved[0].text);
    delete normal.settings.lastBackupAt;
    delete shared.settings.lastBackupAt;
    delete normal.settings.lastTab; // which tab was open is not part of the backup's content
    delete shared.settings.lastTab;
    assert.deepEqual(shared, normal);
  } finally {
    await page.close();
  }
});

test('Setup: share resolves updates Last backup and says so', async () => {
  const page = await boot({ seed: seed() });
  try {
    const calls = stub(page);
    page.tab('setup');
    page.click(page.$('#bk-share-file'));
    await page.settle();
    assert.equal(calls.length, 1);
    assert.equal(page.state().settings.nightsSinceBackup, 0);
    assert.match(page.text(), /Backup file sent/);
  } finally {
    await page.close();
  }
});

test('AbortError (cancelled): nothing changes and no message', async () => {
  const page = await boot({ seed: seed() });
  try {
    stub(page, { share: abort });
    const before = stateOf(page);
    page.click(page.$('#nights-backup-share'));
    await page.settle();
    assert.deepEqual(stateOf(page), before);
    assert.ok(page.$('#nights-backup'), 'card stays');
    assert.equal(toastText(page), '');
    page.tab('setup');
    page.click(page.$('#bk-share-file'));
    await page.settle();
    assert.deepEqual(stateOf(page), before);
    assert.doesNotMatch(page.text(), /Backup file sent|didn’t work/);
  } finally {
    await page.close();
  }
});

test('another error: a calm line pointing to Save a backup file, nothing counted', async () => {
  const page = await boot({ seed: seed() });
  try {
    stub(page, { share: fail });
    const before = stateOf(page);
    page.click(page.$('#nights-backup-share'));
    await page.settle();
    assert.deepEqual(stateOf(page), before);
    assert.match(
      toastText(page),
      /That didn’t work\. Tap Save backup file instead\./,
      'the Tonight card button’s name',
    );
    page.tab('setup');
    page.click(page.$('#bk-share-file'));
    await page.settle();
    assert.match(page.text(), /Tap Save a backup file instead/);
    assert.deepEqual(stateOf(page), before);
  } finally {
    await page.close();
  }
});

test('Restore from a file accepts the shared .txt file', async () => {
  const page = await boot({ seed: seed() });
  try {
    const calls = stub(page);
    page.click(page.$('#nights-backup-share'));
    await page.settle();
    const text = await calls[0].files[0].text();
    page.tab('setup');
    const input = page.must(page.$('#bk-file'), 'file input');
    assert.match(input.getAttribute('accept'), /\.txt/);
    page.state().settings.theme = 'dark';
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [{ size: text.length, text: async () => text }],
    });
    input.dispatchEvent(new page.win.Event('change'));
    await page.settle();
    assert.match(toastText(page), /Restored/);
    assert.notEqual(page.state().settings.theme, 'dark', 'the file replaced what was here');
    assert.equal(page.state().settings.nightsSinceBackup, 0);
  } finally {
    await page.close();
  }
});
