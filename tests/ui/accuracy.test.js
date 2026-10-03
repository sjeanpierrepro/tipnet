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
    S.workplaces[0].profile.periodStart = addDays(today, -30);
    S.workplaces[0].profile.periodEnd = addDays(today, -17);
    S.workplaces[0].profile.shifts = shifts;
    S.workplaces[0].setupDone = true;
    S.nights = [night(1, 26), night(2, 20), night(3, 12), night(4, 9), night(5, 1)];
  });

test('check my accuracy: defaults to the newest finished period, blocks an unfinished one, asks before adjusting', async () => {
  const page = await boot({ seed: seed(2) });
  try {
    page.tab('periods');
    const sel = page.$('#cal-period');
    const p = page.state().workplaces[0].profile;
    assert.equal(periodIndex(p, today), 2, 'today is in period 2');
    assert.equal(sel.value, '1', 'newest FINISHED period, not the one in progress');
    assert.equal(page.$('#cal-run').disabled, false);
    assert.equal(page.$('#cal-undo').disabled, true, 'nothing to undo yet');
    assert.equal(page.$('#cal-undo').getAttribute('aria-describedby'), 'cal-undo-why');
    assert.match(page.text(), /Nothing to undo yet\. TipNet hasn’t adjusted your rates\./);

    // an unfinished period cannot be compared
    sel.value = '2';
    page.change(sel);
    assert.equal(page.$('#cal-run').disabled, true);
    assert.match(page.text(), /still in progress/);
    assert.equal(page.state().workplaces[0].calib.length, 0);

    // a comparison shows old -> new and changes nothing yet
    sel.value = '1';
    page.change(sel);
    const pred = calibrate(page.state().workplaces[0].profile, page.state().nights, 1, 1, today).pred;
    assert.ok(pred > 0);
    const r0 = rate(page.state().workplaces[0].profile);
    page.type(page.$('#cal-actual'), String(Math.round(pred * 0.95)));
    page.click(page.$('#cal-run'));
    assert.ok(page.$('#cal-pending'), 'confirmation shown');
    assert.match(page.text(), /Tax rate: 16\.65% → \d+\.\d\d% \([+−]\d+\.\d\d points\)/);
    assert.doesNotMatch(page.text(), /usually work/, 'every shift logged: no warning');
    assert.equal(page.state().workplaces[0].profile.rateOverride, null, 'nothing applied yet');
    assert.equal(page.$('#cal-apply').disabled, false);
    assert.equal(page.doc.activeElement, page.$('#cal-apply'));

    // Don't change leaves everything alone
    page.click(page.$('#cal-keep'));
    assert.equal(page.state().workplaces[0].profile.rateOverride, null);
    assert.equal(page.state().workplaces[0].calib.length, 0);
    assert.match(page.text(), /No change made/);

    // Apply sets the rate and records the check
    page.click(page.$('#cal-run'));
    page.click(page.$('#cal-apply'));
    const S = page.state();
    assert.equal(S.workplaces[0].calib.length, 1);
    assert.ok(
      S.workplaces[0].profile.rateOverride > r0 - 0.0301 &&
        S.workplaces[0].profile.rateOverride < r0 + 0.0301,
      'moved at most 3 points',
    );
    assert.match(page.text(), /Tax rate adjusted from 16\.65% to/);

    // undo puts the paystub rates back
    assert.equal(page.$('#cal-undo').disabled, false, 'something to undo now');
    assert.equal(page.$('#cal-undo-why'), null);
    page.click(page.$('#cal-undo'));
    assert.equal(page.state().workplaces[0].calib.length, 1, 'first tap only arms');
    assert.notEqual(page.state().workplaces[0].profile.rateOverride, null);
    page.click(page.$('#cal-undo'));
    assert.equal(page.state().workplaces[0].profile.rateOverride, null);
    assert.equal(page.state().workplaces[0].calib.length, 0);
    assert.equal(page.$('#cal-undo').disabled, true, 'undone: nothing left to undo');
    // the toast brings the adjustment back
    const undoBtn = [...page.doc.querySelectorAll('#toast button')].find((b) => /undo/i.test(b.textContent));
    assert.ok(undoBtn, 'Undo toast offered');
    page.click(undoBtn);
    assert.equal(page.state().workplaces[0].calib.length, 1);
    assert.notEqual(page.state().workplaces[0].profile.rateOverride, null);
  } finally {
    await page.close();
  }
});

test('check my accuracy: fewer nights than usual warns, defaults to not applying, and needs a tick', async () => {
  const page = await boot({ seed: seed(3) }); // 3 shifts entered, only 2 logged in period 1
  try {
    page.tab('periods');
    const pred = calibrate(page.state().workplaces[0].profile, page.state().nights, 1, 1, today).pred;
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
    const r = page.state().workplaces[0].profile.rateOverride;
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
    const r0 = rate(S0.workplaces[0].profile);
    const pred = calibrate(S0.workplaces[0].profile, S0.nights, 1, 1, today).pred;
    const actual = String(Math.round(pred * 0.9));
    const compare = () => {
      page.type(page.$('#cal-actual'), actual);
      page.click(page.$('#cal-run'));
    };
    compare();
    assert.doesNotMatch(page.$('#cal-apply').textContent, /Replace/);
    page.click(page.$('#cal-apply'));
    const first = page.state();
    assert.equal(first.workplaces[0].calib.length, 1);
    assert.equal(first.workplaces[0].calib[0].idx, 1);
    assert.equal(first.workplaces[0].calib[0].rateBefore, r0);
    const r1 = first.workplaces[0].profile.rateOverride;
    for (let i = 0; i < 4; i++) {
      compare();
      assert.match(page.text(), /You already compared this pay period/);
      assert.match(page.$('#cal-apply').textContent, /Replace my earlier comparison for this pay period/);
      page.click(page.$('#cal-apply'));
    }
    const S = page.state();
    assert.equal(S.workplaces[0].calib.length, 1, 'still one history row');
    assert.ok(
      Math.abs(S.workplaces[0].profile.rateOverride - r1) < 1e-12,
      'same result every time, nothing compounds',
    );
  } finally {
    await page.close();
  }
});

test('check my accuracy: an older comparison cannot be redone once a later one exists', async () => {
  const page = await boot({ seed: seed(2) });
  try {
    page.tab('periods');
    const S0 = page.state();
    const compare = (idx, factor) => {
      const sel = page.$('#cal-period');
      sel.value = String(idx);
      page.change(sel);
      const pred = calibrate(page.state().workplaces[0].profile, page.state().nights, idx, 1, today).pred;
      page.type(page.$('#cal-actual'), String(Math.round(pred * factor)));
      page.click(page.$('#cal-run'));
    };
    assert.ok(calibrate(S0.workplaces[0].profile, S0.nights, 0, 1, today).pred > 0, 'period 0 has nights');
    compare(1, 0.95);
    page.click(page.$('#cal-apply'));
    compare(0, 0.97);
    page.click(page.$('#cal-apply'));
    const before = page.state();
    assert.equal(before.workplaces[0].calib.length, 2);
    // Going back to period 1 is refused: it would throw away the period 0 adjustment made after it.
    compare(1, 0.9);
    assert.equal(page.$('#cal-pending'), null, 'no adjustment offered');
    assert.match(page.text(), /have compared a later one since, so it can’t be redone/);
    const after = page.state();
    assert.equal(after.workplaces[0].calib.length, 2);
    assert.equal(
      after.workplaces[0].profile.rateOverride,
      before.workplaces[0].profile.rateOverride,
      'rate unchanged',
    );
  } finally {
    await page.close();
  }
});

test('check my accuracy: Pay periods has a heading and a night note is shown and editable', async () => {
  const page = await boot({
    seed: realState((S) => {
      S.workplaces[0].profile.periodStart = addDays(today, -30);
      S.workplaces[0].profile.periodEnd = addDays(today, -17);
      S.workplaces[0].profile.shifts = 2;
      S.workplaces[0].setupDone = true;
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

test('check my accuracy: matched by the period dates, so moving the start date in Setup cannot adjust the same dates twice', async () => {
  const page = await boot({ seed: seed(2) });
  try {
    page.tab('periods');
    const S0 = page.state();
    const pred = calibrate(S0.workplaces[0].profile, S0.nights, 1, 1, today).pred;
    const actual = String(Math.round(pred * 0.9));
    page.type(page.$('#cal-actual'), actual);
    page.click(page.$('#cal-run'));
    page.click(page.$('#cal-apply'));
    const first = page.state().workplaces[0].calib[0];
    const r1 = page.state().workplaces[0].profile.rateOverride;
    // Setup: the start date moves back one period, same schedule. The compared dates are now period 2.
    const p = page.state().workplaces[0].profile;
    p.periodStart = addDays(p.periodStart, -14);
    p.periodEnd = addDays(p.periodEnd, -14);
    page.tab('tonight');
    page.tab('periods');
    const sel = page.$('#cal-period');
    assert.equal(sel.value, '2', 'the newest finished period has the same dates as before');
    page.type(page.$('#cal-actual'), actual);
    page.click(page.$('#cal-run'));
    assert.match(page.text(), /You already compared this pay period/);
    assert.match(page.$('#cal-apply').textContent, /Replace my earlier comparison for this pay period/);
    page.click(page.$('#cal-apply'));
    const S = page.state();
    assert.equal(S.workplaces[0].calib.length, 1, 'replaced, not stacked');
    assert.equal(S.workplaces[0].calib[0].start, first.start);
    assert.equal(S.workplaces[0].calib[0].end, first.end);
    assert.ok(Math.abs(S.workplaces[0].profile.rateOverride - r1) < 1e-12, 'no compounding');
  } finally {
    await page.close();
  }
});

test('check my accuracy: a check that matches the estimate (within 0.5%) says so and proposes nothing', async () => {
  const page = await boot({ seed: seed(2) });
  try {
    page.tab('periods');
    const sel = page.$('#cal-period');
    sel.value = '1';
    page.change(sel);
    const pred = calibrate(page.state().workplaces[0].profile, page.state().nights, 1, 1, today).pred;
    page.type(page.$('#cal-actual'), pred.toFixed(2));
    page.click(page.$('#cal-run'));
    assert.equal(page.$('#cal-pending'), null, 'nothing to apply, so nothing is asked');
    assert.match(page.text(), /Your estimate matched — no change needed\./);
    assert.equal(page.state().workplaces[0].profile.rateOverride, null);
    assert.equal(page.state().workplaces[0].calib.length, 0);
  } finally {
    await page.close();
  }
});

test('check my accuracy: a mistyped check applied, then the right one (matching the estimate) offers Replace and restores the rate', async () => {
  const page = await boot({ seed: seed(2) });
  try {
    page.tab('periods');
    const S0 = page.state();
    const r0 = rate(S0.workplaces[0].profile);
    const pred = calibrate(S0.workplaces[0].profile, S0.nights, 1, 1, today).pred;
    const compare = (v) => {
      page.type(page.$('#cal-actual'), v);
      page.click(page.$('#cal-run'));
    };
    compare(String(Math.round(pred * 0.9))); // the typo: 10% low
    page.click(page.$('#cal-apply'));
    const typoRate = page.state().workplaces[0].profile.rateOverride;
    assert.ok(typoRate - r0 > 0.02, 'the typo moved the rate up');
    compare(pred.toFixed(2)); // the right amount: it matches the (locked) estimate
    assert.ok(page.$('#cal-pending'), 'not "matched": the earlier comparison can be replaced');
    assert.doesNotMatch(page.text(), /Your estimate matched/);
    assert.match(page.text(), /You already compared this pay period/);
    assert.match(page.$('#cal-apply').textContent, /Replace my earlier comparison for this pay period/);
    // the change is shown from the rate in use now (the typo's), back to the paystub rate
    const typoPct = (typoRate * 100).toFixed(2).replace('.', '\\.');
    assert.match(
      page.$('#cal-pending').textContent,
      new RegExp('Tax rate: ' + typoPct + '% → 16\\.65% \\(−'),
    );
    page.click(page.$('#cal-apply'));
    assert.match(page.text(), new RegExp('Tax rate adjusted from ' + typoPct + '% to 16\\.65%'));
    const W = page.state().workplaces[0];
    assert.ok(Math.abs(rate(W.profile) - r0) < 1e-9, 'back to the paystub rate: ' + rate(W.profile));
    assert.equal(W.calib.length, 1, 'the history row was replaced, not added');
    assert.ok(Math.abs(W.calib[0].err) < 1e-9);
    assert.equal(W.calib[0].actual, Number(pred.toFixed(2)));
  } finally {
    await page.close();
  }
});

test('check my accuracy: a period locked at an older rate, checked exactly, proposes moving back toward it', async () => {
  const page = await boot({ seed: seed(2) });
  try {
    page.tab('periods');
    const S0 = page.state();
    const r0 = rate(S0.workplaces[0].profile);
    assert.ok(S0.nights.filter((n) => n.snap).length >= 2, 'finished periods are locked at the paystub rate');
    // another adjustment moved the rate 3 points up since (the locked nights keep r0)
    S0.workplaces[0].profile.rateOverride = r0 + 0.03;
    page.tab('tonight');
    page.tab('periods');
    const pred = calibrate(page.state().workplaces[0].profile, page.state().nights, 1, 1, today).pred;
    page.type(page.$('#cal-actual'), pred.toFixed(2));
    page.click(page.$('#cal-run'));
    assert.doesNotMatch(page.text(), /Your estimate matched/);
    assert.ok(page.$('#cal-pending'), 'a change is proposed');
    page.click(page.$('#cal-apply'));
    const got = page.state().workplaces[0].profile.rateOverride;
    assert.ok(Math.abs(got - (r0 + 0.015)) < 0.0005, 'halfway back toward the locked rate: ' + got);
  } finally {
    await page.close();
  }
});
