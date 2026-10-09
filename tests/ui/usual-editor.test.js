// Sixth review: the night editor read an old night's "usual" hours (a night saved without its hours, pay {}) from
// today's Setup instead of the night's snapshot, so saving it unchanged moved its money ($217.04 -> $214.04) when the
// usual amount differed. It now reads them the way the math does (math.pinPay: the snapshot's when it is locked).
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import * as M from '../../app/js/math.js';
import { draftFromNight } from '../../app/js/ui/tonight.js';

const setup = () => {
  const today = M.todayISO();
  const start = M.addDays(today, -28);
  const old = {
    ...M.exampleProfile(today),
    periodStart: start,
    periodEnd: M.addDays(start, 13),
    freq: 14,
    shifts: 10,
  };
  old.payTypes = [{ id: 'p1', k: 'bartender', name: 'Bartender', rate: 12, unit: 'hr', usual: 7 }];
  const now = JSON.parse(JSON.stringify(old));
  now.payTypes[0].usual = 5;
  const night = {
    id: 'n1',
    date: M.addDays(start, 3),
    total: 300,
    cash: 100,
    pay: {},
    barback: true,
    tipouts: { t1: true },
    tipoutOn: true,
    snap: M.snapshotFor(old, 10),
    workplaceId: 'w1',
  };
  return { now, night };
};

test('draftFromNight: a locked night without its hours shows its snapshot’s usual hours, not today’s Setup’s', () => {
  const { now, night } = setup();
  assert.equal(draftFromNight(night, now).pay.p1, '7');
  // unlocked: Setup's, as the math reads it
  const { snap, ...open } = night;
  assert.ok(snap);
  assert.equal(draftFromNight(open, now).pay.p1, '5');
});

test('night editor: saving such a night unchanged keeps its money', async () => {
  const { now, night } = setup();
  const seed = realState((S) => {
    S.workplaces[0].setupDone = true;
    S.workplaces[0].profile = now;
    S.nights = [night];
  });
  const page = await boot({ seed });
  try {
    const net = () => M.computeNight(page.state().nights[0], page.state().workplaces[0].profile, 10).net;
    const before = net();
    page.tab('periods');
    await page.settle();
    page.click(page.$$('button').find((x) => (x.getAttribute('aria-label') || '').startsWith('Edit night')));
    await page.settle();
    assert.equal(page.$('[data-focus-key="edit-n1-pay-p1"]').value, '7');
    page.click(page.button('Save changes'));
    await page.settle();
    assert.equal(net(), before);
  } finally {
    await page.close();
  }
});
