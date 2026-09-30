import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { addDays, todayISO, calibrate, periodIndex } from '../../app/js/math.js';

// Pay periods are 14 days long. Period 0 and 1 are finished; period 2 (the one that contains today) is not.
const today = todayISO();
const night = (id, ago) => ({ id, date: addDays(today, -ago), total: 300 + id, cash: 80, pay: { p1: 6 }, barback: true });
const seed = () => realState((S) => {
  S.profile.periodStart = addDays(today, -30);
  S.profile.periodEnd = addDays(today, -17);
  S.profile.shifts = 4;
  S.settings.setupDone = true;
  S.nights = [night(1, 26), night(2, 20), night(3, 12), night(4, 9), night(5, 1)];
});

test('check my accuracy: defaults to the newest finished period, blocks an unfinished one, adjusts the rate', async () => {
  const S0 = seed();
  const page = await boot({ seed: S0 });
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

    // a correct comparison adjusts the rate
    sel.value = '1';
    page.change(sel);
    assert.equal(page.$('#cal-run').disabled, false);
    const pred = calibrate(page.state().profile, page.state().nights, 1, 1, today).pred;
    assert.ok(pred > 0);
    assert.equal(page.state().profile.rateOverride, null);
    page.type(page.$('#cal-actual'), String(Math.round(pred * 0.9)));
    page.click(page.$('#cal-run'));
    const S = page.state();
    assert.equal(S.calib.length, 1);
    assert.ok(S.profile.rateOverride > 0 && S.profile.rateOverride < 1, 'rate override set');
    assert.match(page.text(), /Tax rate adjusted to/);

    // undo puts the paystub rates back
    page.click(page.$('#cal-undo'));
    assert.equal(page.state().profile.rateOverride, null);
    assert.equal(page.state().calib.length, 0);
  } finally { await page.close(); }
});
