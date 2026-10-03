// A Setup schedule change that finishes a pay period mid-day locks it right away (independent review, item 4), so a
// second Setup save the same day can't rewrite it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { addDays, todayISO, computeNight } from '../../app/js/math.js';

const today = todayISO();
const seed = () =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    S.workplaces[0].profile.periodStart = addDays(today, -6); // the night's period runs to today+7
    S.workplaces[0].profile.periodEnd = addDays(today, 7);
    S.workplaces[0].profile.shifts = 5;
    S.nights = [{ id: 'n1', date: addDays(today, -5), total: 300, cash: 80, pay: { p1: 6 }, barback: true }];
  });

test('Setup: a schedule change that ends the night’s pay period locks it at once; a later save keeps it', async () => {
  const page = await boot({ seed: seed() });
  try {
    assert.equal(page.state().nights[0].snap, undefined, 'its period is still running');
    page.openSetup();
    const [start, end] = page.$$('input[type=date]', page.app);
    page.type(start, addDays(today, -18)); // period today-18 .. today-5: ended yesterday
    page.type(end, addDays(today, -5));
    await page.saveSetup();
    const n = page.state().nights[0];
    assert.ok(n.snap, 'locked by the save itself, not tomorrow');
    const snap = JSON.stringify(n.snap);
    const p = page.state().workplaces[0].profile;
    const net = computeNight(n, p, 5).net;
    // a second Setup save the same day (a new shift count) can't rewrite the finished period
    page.openSetup();
    const shifts = page.$$('input[inputmode=numeric]', page.app).find((i) => i.value === '5');
    page.type(page.must(shifts, 'shifts field'), '9');
    await page.saveSetup();
    assert.equal(page.state().workplaces[0].profile.shifts, 9);
    assert.equal(JSON.stringify(page.state().nights[0].snap), snap);
    assert.equal(computeNight(page.state().nights[0], page.state().workplaces[0].profile, 9).net, net);
  } finally {
    await page.close();
  }
});
