// Setup's "Removed X. Undo" toasts belong to the open draft: once Save applies it (or Cancel throws it away) their Undo
// would do nothing, so they are dismissed (second v38 review: Undo after Save silently did nothing).
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { todayISO, addDays, exampleProfile } from '../../app/js/math.js';

const today = todayISO();
const BARBACK = { id: 't1', k: 'barback', who: 'Barback', mode: 'pctTips', value: 15, from: 'cash' };
const RUNNER = { id: 't2', k: 'runner', who: 'Runner', mode: 'pctTips', value: 5, from: 'payroll' };
const seed = () =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    const start = addDays(today, -5);
    S.workplaces[0].profile = {
      ...exampleProfile(today),
      periodStart: start,
      periodEnd: addDays(start, 13),
      freq: 14,
      payDelay: 1,
      tipout: { on: true },
      tipouts: [{ ...BARBACK }, { ...RUNNER }],
    };
  });
const undoButton = (page) => page.$$('#toast button').find((b) => b.textContent === 'Undo') || null;
const people = (page) => page.state().workplaces[0].profile.tipouts.map((r) => r.who);

test('Setup: Undo works on the draft until Save; Save dismisses the Undo toast', async () => {
  const page = await boot({ seed: seed() });
  try {
    page.openSetup();
    page.click(page.byLabel('Remove Barback'));
    assert.ok(undoButton(page), 'Undo offered while the draft is open');
    page.click(undoButton(page));
    assert.ok(page.byLabel('Remove Barback'), 'Undo brings the row back in the draft');
    page.click(page.byLabel('Remove Barback'));
    const deduction = page.state().workplaces[0].profile.deductions[0].name;
    page.click(page.byLabel('Remove ' + deduction));
    assert.equal(page.$$('#toast .toast').length, 2);
    await page.saveSetup();
    assert.deepEqual(people(page), ['Runner']);
    assert.equal(!!undoButton(page), false, 'no Undo that would do nothing');
    assert.equal(page.$$('#toast .toast').length, 0);
  } finally {
    await page.close();
  }
});

test('Setup: Cancel (and closing the row) dismisses the draft’s Undo toast', async () => {
  const page = await boot({ seed: seed() });
  try {
    page.openSetup();
    page.click(page.byLabel('Remove Runner'));
    assert.ok(undoButton(page));
    page.click(page.$('#draft-cancel'));
    assert.equal(!!undoButton(page), false);
    assert.deepEqual(people(page), ['Barback', 'Runner'], 'nothing was saved');
    // the row's heading closes it too (with unsaved changes it asks first: Discard)
    page.openSetup();
    page.click(page.byLabel('Remove Runner'));
    assert.ok(undoButton(page));
    page.click(page.$('#wp-row-w1'));
    page.click(page.$('#draft-ask-discard'));
    assert.equal(!!undoButton(page), false);
    assert.deepEqual(people(page), ['Barback', 'Runner']);
  } finally {
    await page.close();
  }
});
