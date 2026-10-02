// Setup guardrails (review 6, item 5): rate numbers apply after a pause or on leaving the field, never per keystroke;
// a calm note for a tiny gross or very high % deductions; the rate is never above 100%.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import * as M from '../../app/js/math.js';

const seed = () =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
  });
const grossInput = (page) =>
  page.must(
    page.$$('input').find((i) => i.value === '2000'),
    'gross',
  );
// The harness unrefs timers, so hold the event loop open while waiting.
const wait = (ms) =>
  new Promise((r) => {
    const keep = setInterval(() => {}, 20);
    setTimeout(() => {
      clearInterval(keep);
      r();
    }, ms);
  });
/** "$X goes to taxes" from the Setup summary. */
const taxPer100 = (page) => {
  const m = /about \$([\d,.]+) goes to taxes/.exec(page.text());
  return m ? Number(m[1].replace(/,/g, '')) : null;
};

test('typing "2100" into gross never passes through $2: nothing applies until a pause', async () => {
  const page = await boot({ seed: seed() });
  try {
    page.openSetup();
    const gross = grossInput(page);
    const seen = [];
    for (const v of ['2', '21', '210', '2100']) {
      page.type(gross, v);
      seen.push(page.state().workplaces[0].profile.gross);
      assert.ok(taxPer100(page) <= 100, 'never a rate above 100%');
      assert.doesNotMatch(page.text(), /small gross pay/);
    }
    assert.deepEqual(seen, [2000, 2000, 2000, 2000], 'the saved gross is untouched while typing');
    assert.match(page.$('#draft-state').textContent, /changes that aren’t saved yet/);
    assert.equal(page.$('#draft-save').disabled, false, 'Save works while a number waits for its pause');
    await wait(750); // the typing pause: the draft takes the number, nothing is saved
    assert.equal(page.state().workplaces[0].profile.gross, 2000);
    assert.doesNotMatch(page.text(), /small gross pay/);
    await page.saveSetup();
    assert.equal(page.state().workplaces[0].profile.gross, 2100);
    for (let i = 0; i < 40 && !/Saved\./.test(page.text()); i++) await wait(50);
    assert.match(page.$('#wp-saved-w1').textContent, /^Saved\./);
  } finally {
    await page.close();
  }
});

test('Save right after typing (no pause) applies the waiting number', async () => {
  const page = await boot({ seed: seed() });
  try {
    page.openSetup();
    page.type(grossInput(page), '2400');
    await page.saveSetup();
    assert.equal(page.state().workplaces[0].profile.gross, 2400);
  } finally {
    await page.close();
  }
});

test('a tiny gross gets a calm note, and a rate above 100% is capped with a note (never blocked)', async () => {
  const page = await boot({ seed: seed() });
  try {
    page.openSetup();
    let gross = grossInput(page);
    page.type(gross, '2');
    page.change(gross);
    assert.match(page.text(), /That’s a small gross pay for one paycheck/);
    assert.equal(taxPer100(page), 100, 'capped at 100%');
    assert.match(page.text(), /add up to more than your gross pay, so TipNet uses 100% for now/);
    assert.match(page.text(), /More than your gross pay: check this amount/);
    await page.saveSetup();
    const p = page.state().workplaces[0].profile;
    assert.equal(p.gross, 2, 'saved: a note, not a block');
    assert.ok(M.rate(p) <= 1);
    // back to a normal gross: the notes go away
    page.openSetup();
    gross = page.byText('.field', 'Gross pay', page.app).querySelector('input');
    page.type(gross, '2000');
    page.change(gross);
    assert.doesNotMatch(page.text(), /small gross pay|so TipNet uses 100%|unusually high/);
  } finally {
    await page.close();
  }
});

test('% deductions at 60% or more of gross get an "unusually high" note', async () => {
  const page = await boot({ seed: seed() });
  try {
    page.openSetup();
    const gross = grossInput(page);
    page.type(gross, '500'); // example % deductions: 180 + 124 + 29 = 333 = 66.6%
    page.change(gross);
    assert.match(page.text(), /deductions are 67% of your gross pay, which is unusually high/);
    assert.doesNotMatch(page.text(), /small gross pay/);
  } finally {
    await page.close();
  }
});
