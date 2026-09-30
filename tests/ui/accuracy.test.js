import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { addDays, todayISO, calibrate, periodIndex, rate } from '../../app/js/math.js';

// Pay periods are 14 days long. Period 0 and 1 are finished; period 2 (the one that contains today) is not.
const today = todayISO();
const night = (id, ago) => ({
  id,
  date: addDays(today, -ago),
  total: 300 + id,
  cash: 80,
  pay: { p1: 6 },
  barback: true,
});
const seed = (shifts = 2) =>
  realState((S) => {
    S.profile.periodStart = addDays(today, -30);
    S.profile.periodEnd = addDays(today, -17);
    S.profile.shifts = shifts;
    S.settings.setupDone = true;
    S.nights = [night(1, 26), night(2, 20), night(3, 12), night(4, 9), night(5, 1)];
  });

test('check my accuracy: defaults to the newest finished period, blocks an unfinished one, asks before adjusting', async () => {
  const page = await boot({ seed: seed(2) });
  try {
    page.tab('periods');
    const sel = page.$('#cal-period');
    const p = page.state().profile;
    assert.equal(periodIndex(p, today), 2, 'today is in period 2');
    assert.equal(sel.value, '1', 'newest FINISHED period, not the one in progress');
    assert.equal(page.$('#cal-run').disabled, false);

    // an unfinished period cannot be compared
    sel.value = '2';
    page.change(sel);
    assert.equal(page.$('#cal-run').disabled, true);
    assert.match(page.text(), /still in progress/);
    assert.equal(page.state().calib.length, 0);

    // a comparison shows old -> new and changes nothing yet
    sel.value = '1';
    page.change(sel);
    const pred = calibrate(page.state().profile, page.state().nights, 1, 1, today).pred;
    assert.ok(pred > 0);
    const r0 = rate(page.state().profile);
    page.type(page.$('#cal-actual'), String(Math.round(pred * 0.95)));
    page.click(page.$('#cal-run'));
    assert.ok(page.$('#cal-pending'), 'confirmation shown');
    assert.match(page.text(), /Tax rate: 16\.65% → \d+\.\d\d% \([+−]\d+\.\d\d points\)/);
    assert.doesNotMatch(page.text(), /usually work/, 'every shift logged: no warning');
    assert.equal(page.state().profile.rateOverride, null, 'nothing applied yet');
    assert.equal(page.$('#cal-apply').disabled, false);
    assert.equal(page.doc.activeElement, page.$('#cal-apply'));

    // Don't change leaves everything alone
    page.click(page.$('#cal-keep'));
    assert.equal(page.state().profile.rateOverride, null);
    assert.equal(page.state().calib.length, 0);
    assert.match(page.text(), /No change made/);

    // Apply sets the rate and records the check
    page.click(page.$('#cal-run'));
    page.click(page.$('#cal-apply'));
    const S = page.state();
    assert.equal(S.calib.length, 1);
    assert.ok(
      S.profile.rateOverride > r0 - 0.0301 && S.profile.rateOverride < r0 + 0.0301,
      'moved at most 3 points',
    );
    assert.match(page.text(), /Tax rate adjusted from 16\.65% to/);

    // undo puts the paystub rates back
    page.click(page.$('#cal-undo'));
    assert.equal(page.state().calib.length, 1, 'first tap only arms');
    assert.notEqual(page.state().profile.rateOverride, null);
    page.click(page.$('#cal-undo'));
    assert.equal(page.state().profile.rateOverride, null);
    assert.equal(page.state().calib.length, 0);
    // the toast brings the adjustment back
    const undoBtn = [...page.doc.querySelectorAll('#toast button')].find((b) => /undo/i.test(b.textContent));
    assert.ok(undoBtn, 'Undo toast offered');
    page.click(undoBtn);
    assert.equal(page.state().calib.length, 1);
    assert.notEqual(page.state().profile.rateOverride, null);
  } finally {
    await page.close();
  }
});

test('check my accuracy: fewer nights than usual warns, defaults to not applying, and needs a tick', async () => {
  const page = await boot({ seed: seed(3) }); // 3 shifts entered, only 2 logged in period 1
  try {
    page.tab('periods');
    const pred = calibrate(page.state().profile, page.state().nights, 1, 1, today).pred;
    page.type(page.$('#cal-actual'), String(Math.round(pred * 1.5))); // the check paid for a night that is not logged
    page.click(page.$('#cal-run'));
    const text = page.text();
    assert.match(
      text,
      /You logged 2 nights but usually work 3\. If you missed some, add them first, or the adjustment will be off\./,
    );
    assert.match(text, /more than 25%/);
    assert.match(text, /capped/);
    assert.equal(page.$('#cal-apply').disabled, true, 'not applying is the default');
    assert.equal(page.doc.activeElement, page.$('#cal-keep'), 'focus on "Don’t change"');
    const tick = page.$('#cal-confirm');
    tick.checked = true;
    page.change(tick);
    assert.equal(page.$('#cal-apply').disabled, false);
    page.click(page.$('#cal-apply'));
    const r = page.state().profile.rateOverride;
    assert.ok(Math.abs(r - (0.1665 - 0.03)) < 1e-9, 'capped at 3 points: ' + r);
  } finally {
    await page.close();
  }
});

test('check my accuracy: the same pay period adjusts once; Replace restarts from the earlier rate (no compounding)', async () => {
  const page = await boot({ seed: seed(2) });
  try {
    page.tab('periods');
    const S0 = page.state();
    const r0 = rate(S0.profile);
    const pred = calibrate(S0.profile, S0.nights, 1, 1, today).pred;
    const actual = String(Math.round(pred * 0.9));
    const compare = () => {
      page.type(page.$('#cal-actual'), actual);
      page.click(page.$('#cal-run'));
    };
    compare();
    assert.doesNotMatch(page.$('#cal-apply').textContent, /Replace/);
    page.click(page.$('#cal-apply'));
    const first = page.state();
    assert.equal(first.calib.length, 1);
    assert.equal(first.calib[0].idx, 1);
    assert.equal(first.calib[0].rateBefore, r0);
    const r1 = first.profile.rateOverride;
    for (let i = 0; i < 4; i++) {
      compare();
      assert.match(page.text(), /You already compared this pay period/);
      assert.match(page.$('#cal-apply').textContent, /Replace my earlier comparison for this pay period/);
      page.click(page.$('#cal-apply'));
    }
    const S = page.state();
    assert.equal(S.calib.length, 1, 'still one history row');
    assert.ok(Math.abs(S.profile.rateOverride - r1) < 1e-12, 'same result every time, nothing compounds');
  } finally {
    await page.close();
  }
});

test('check my accuracy: Pay periods has a heading and a night note is shown and editable', async () => {
  const page = await boot({
    seed: realState((S) => {
      S.profile.periodStart = addDays(today, -30);
      S.profile.periodEnd = addDays(today, -17);
      S.profile.shifts = 2;
      S.settings.setupDone = true;
      S.nights = [{ ...night(1, 26), note: 'Private party upstairs' }];
    }),
  });
  try {
    page.tab('periods');
    assert.equal(page.$('h1').textContent, 'Pay periods');
    assert.match(page.$('.night-note').textContent, /Private party upstairs/);
    page.click(page.byLabel('Edit night ' + page.$('.list-row .main div').textContent));
    const note = page.$('#edit-1-note');
    assert.equal(note.value, 'Private party upstairs');
    page.type(note, 'Wedding');
    page.click(page.$('form button[type=submit]'));
    assert.equal(page.state().nights[0].note, 'Wedding');
  } finally {
    await page.close();
  }
});
