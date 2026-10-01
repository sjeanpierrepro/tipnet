// Backup files (save / restore), the "Last backup" reminder, the iPhone Safari note, failed saves, and another window's save.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import * as storage from '../../app/js/storage.js';
import { fileSaver, backupDue } from '../../app/js/ui/backup.js';
import { exampleNights, todayISO } from '../../app/js/math.js';

// The harness unrefs timers, so hold the event loop open while waiting.
const wait = (ms) =>
  new Promise((r) => {
    const keep = setInterval(() => {}, 20);
    setTimeout(() => {
      clearInterval(keep);
      r();
    }, ms);
  });
const withNights = (count = 5, f) =>
  realState((S) => {
    S.nights = exampleNights().slice(0, count);
    while (S.nights.length < count)
      S.nights.push({ ...S.nights[0], id: 'x' + S.nights.length, date: '2026-01-0' + S.nights.length });
    if (f) f(S);
  });
const saved = [];
fileSaver.save = (name, text) => saved.push({ name, text });

test('Setup: "Save a backup file" downloads tipnet-backup-<date>.json with the backup data and notes the time', async () => {
  saved.length = 0;
  const page = await boot({
    seed: withNights(
      2,
      (S) => (S.settings.entitlement = { plan: 'monthly', key: 'SECRET', instanceId: 'i' }),
    ),
  });
  try {
    page.tab('setup');
    assert.match(page.text(), /Last backup: never\./);
    page.click(page.button('Save a backup file'));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].name, 'tipnet-backup-' + todayISO() + '.json');
    const data = JSON.parse(saved[0].text);
    assert.equal(data.nights.length, 2);
    assert.doesNotMatch(saved[0].text, /SECRET|guidedDraft/);
    assert.ok(Date.now() - page.state().settings.lastBackupAt < 5000);
    assert.match(page.text(), /Backup file saved/);
    assert.doesNotMatch(page.$('#bk-last').textContent, /never/);
  } finally {
    await page.close();
  }
});

test('Restore from a file: replaces the data after a second tap; a wrong file says so and changes nothing', async () => {
  const backup = withNights(3, (S) => (S.settings.theme = 'dark'));
  const page = await boot({ seed: withNights(1) });
  try {
    page.tab('setup');
    const input = page.must(page.$('#bk-file'), 'file input');
    let clicks = 0;
    input.click = () => clicks++;
    const btn = page.$('#bk-restore-file');
    page.click(btn);
    assert.equal(clicks, 0, 'first tap only arms (there are real nights here)');
    assert.match(btn.textContent, /Tap again/);
    page.click(btn);
    assert.equal(clicks, 1, 'second tap opens the file picker');
    const pick = async (text) => {
      Object.defineProperty(input, 'files', {
        configurable: true,
        value: [{ size: text.length, text: async () => text }],
      });
      input.dispatchEvent(new page.win.Event('change'));
      await page.settle();
    };
    await pick('hello, not a backup');
    assert.match(page.text(), /That file is not a TipNet backup/);
    assert.equal(page.state().nights.length, 1);
    await pick(storage.backupFileText(backup));
    assert.equal(page.state().nights.length, 3);
    assert.equal(page.state().settings.theme, 'dark');
    assert.match(page.doc.getElementById('toast').textContent, /Restored 3 nights/);
  } finally {
    await page.close();
  }
});

test('first-launch restore card offers a backup file too', async () => {
  const page = await boot();
  try {
    page.click(page.byLabel('Moving from another phone? Restore a backup code'));
    assert.ok(page.$('#restore-card #bk-restore-file'), 'Restore from a file');
    const input = page.$('#restore-card #bk-file');
    Object.defineProperty(input, 'files', {
      value: [{ size: 10, text: async () => storage.backupFileText(withNights(2)) }],
    });
    page.click(page.$('#bk-restore-file')); // nothing real here: no second tap needed
    input.dispatchEvent(new page.win.Event('change'));
    await page.settle();
    assert.equal(page.state().nights.length, 2);
    assert.match(page.text(), /Tips you made tonight|Log tonight|Tonight/);
  } finally {
    await page.close();
  }
});

test('backupDue: 5+ real nights and no backup in 30 days, unless dismissed', () => {
  const now = Date.parse('2026-09-30T12:00:00Z');
  const DAY = 864e5;
  const S = withNights(5);
  assert.equal(backupDue(S, now), true, 'never');
  assert.equal(backupDue(withNights(4), now), false, 'fewer than 5 nights');
  assert.equal(backupDue({ ...S, nightsExample: true }, now), false, 'example nights');
  assert.equal(backupDue({ ...S, settings: { lastBackupAt: now - 29 * DAY } }, now), false);
  assert.equal(backupDue({ ...S, settings: { lastBackupAt: now - 31 * DAY } }, now), true);
  assert.equal(backupDue({ ...S, settings: { backupNudgeUntil: now + DAY } }, now), false, 'dismissed');
  assert.equal(backupDue({ ...S, settings: { backupNudgeUntil: now - DAY } }, now), true);
});

test('Tonight and Setup: the "Last backup: never" reminder saves a file or is put off for 30 days', async () => {
  saved.length = 0;
  const page = await boot({ seed: withNights(5) });
  try {
    page.tab('tonight');
    const nudge = page.must(page.$('#backup-nudge'), 'reminder on Tonight');
    assert.match(nudge.textContent, /Last backup: never\./);
    page.tab('setup');
    assert.ok(page.$('#backup-nudge'), 'and on Setup');
    page.tab('periods');
    assert.equal(page.$('#backup-nudge'), null, 'not on Pay periods');
    page.tab('tonight');
    page.click(page.$('#nudge-later'));
    assert.equal(page.$('#backup-nudge'), null);
    assert.ok(page.state().settings.backupNudgeUntil > Date.now() + 29 * 864e5);
    // once put off, it is gone until then; saving a file also stops it
    page.state().settings.backupNudgeUntil = Date.now() - 1;
    page.tab('setup');
    page.tab('tonight');
    page.click(page.must(page.$('#nudge-save'), 'reminder is back'));
    assert.equal(saved.length, 1);
    assert.equal(page.$('#backup-nudge'), null);
  } finally {
    await page.close();
  }
});

test('iPhone Safari (not installed): Setup explains that Safari may clear data, once', async () => {
  let page = await boot({ seed: withNights(1) });
  let after;
  try {
    Object.defineProperty(page.win.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1',
    });
    Object.defineProperty(page.win.navigator, 'standalone', { configurable: true, value: false });
    page.tab('setup');
    const note = page.must(page.$('#ios-evict-note'), 'the note');
    assert.match(note.textContent, /Safari may clear a website’s data if you don’t open it for about a week/);
    page.tab('tonight');
    page.tab('setup');
    assert.ok(page.$('#ios-evict-note'), 'stays for this visit');
    assert.equal(page.state().settings.iosNoteSeen, true);
    await storage.flush();
    after = JSON.parse(page.win.localStorage.getItem('tipnet.v2'));
  } finally {
    await page.close();
  }
  page = await boot({ seed: after });
  try {
    Object.defineProperty(page.win.navigator, 'userAgent', { configurable: true, value: 'iPhone' });
    Object.defineProperty(page.win.navigator, 'standalone', { configurable: true, value: false });
    page.tab('setup');
    assert.equal(page.$('#ios-evict-note'), null, 'shown once');
  } finally {
    await page.close();
  }
});

test('a failed save shows the banner and Setup says it could not save; a good one clears both', async () => {
  const page = await boot({ seed: withNights(1) });
  const good = globalThis.localStorage;
  try {
    page.tab('setup');
    globalThis.localStorage = {
      getItem: (k) => good.getItem(k),
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    };
    const gross = page.byText('.field', 'Gross pay', page.app).querySelector('input');
    page.type(gross, '1900');
    assert.match(page.text(), /Saving…/);
    await wait(500);
    assert.equal(page.doc.getElementById('save-error').hidden, false, 'banner shown');
    assert.match(page.doc.getElementById('save-error').textContent, /Couldn't save on this device/);
    assert.match(page.text(), /Couldn’t save on this device/);
    assert.doesNotMatch(page.text(), /All changes saved/);
    globalThis.localStorage = good;
    page.type(gross, '1950');
    await wait(500);
    assert.equal(page.doc.getElementById('save-error').hidden, true, 'banner gone');
    assert.match(page.text(), /All changes saved on this device\./);
    assert.equal(JSON.parse(good.getItem('tipnet.v2')).workplaces[0].profile.gross, 1950);
  } finally {
    globalThis.localStorage = good;
    await page.close();
  }
});

test('another window saved: the screen shows its data; unsaved changes here are merged and a calm message says so', async () => {
  const page = await boot({ seed: withNights(1) });
  try {
    const other = () => {
      const S = JSON.parse(page.win.localStorage.getItem('tipnet.v2'));
      return { ...(S || withNights(1)), _savedAt: Date.now() + 10, _writer: 'other-tab' };
    };
    // nothing unsaved here: just redraw with the new night
    const A = other();
    A.nights.push({ id: 'o1', date: '2026-01-09', total: 123, cash: null, pay: {}, barback: true });
    page.win.localStorage.setItem('tipnet.v2', JSON.stringify(A));
    assert.equal(await storage.syncFromStorage(), true);
    assert.equal(page.state().nights.length, 2);
    assert.doesNotMatch(page.doc.getElementById('toast').textContent, /another window/);
    // a change here not saved yet + another save there: both kept
    page.state().settings.theme = 'dark';
    storage.scheduleSave();
    const B = other();
    B.nights.push({ id: 'o2', date: '2026-01-10', total: 50, cash: null, pay: {}, barback: true });
    page.win.localStorage.setItem('tipnet.v2', JSON.stringify(B));
    await storage.syncFromStorage();
    assert.equal(page.state().nights.length, 3);
    assert.equal(page.state().settings.theme, 'dark');
    assert.equal(page.doc.documentElement.getAttribute('data-theme'), 'dark');
    assert.match(
      page.doc.getElementById('toast').textContent,
      /TipNet was updated in another window\. Showing the latest\./,
    );
    const S = JSON.parse(page.win.localStorage.getItem('tipnet.v2'));
    assert.equal(S.nights.length, 3, 'the merged data is saved');
    assert.equal(S.settings.theme, 'dark');
  } finally {
    await page.close();
  }
});
