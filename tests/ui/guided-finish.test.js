// Guided setup can always be finished: "no deductions" on a 2nd+ establishment, and a negative deduction amount.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';

const stepNow = (page) => {
  const s = page.$('.steps [aria-current="step"]');
  return s ? s.textContent : 'finished';
};
const fillStep0 = (page) => {
  page.type(page.$$('input[type=date]', page.app)[0], '2026-09-01');
  page.type(page.$$('input[type=date]', page.app)[2], '2026-09-20');
  page.type(page.must(page.$('input[placeholder="e.g. 2,000"]', page.app), 'gross'), '900');
  page.type(page.$('input[placeholder="e.g. 10"]', page.app), '10');
};
const shown = (page) =>
  page
    .$$('.field-error', page.app)
    .filter((e) => !e.hidden && e.textContent)
    .map((e) => e.textContent);

test('a second establishment: "no deductions" ticked, Finish completes the setup', async () => {
  const page = await boot({
    seed: realState((S) => {
      S.workplaces[0].setupDone = true;
      S.workplaces[0].name = 'Voodoo Bayou';
    }),
  });
  try {
    page.tab('setup');
    page.click(page.button('+ Set up another establishment'));
    page.type(page.$('#wp-new-name'), 'Second Spot');
    page.click(page.button('Start setup'));
    fillStep0(page);
    page.click(page.button('Next'));
    page.click(page.must(page.$('#no-ded'), 'no-ded box'));
    page.click(page.button('Next'));
    assert.match(stepNow(page), /^3\./);
    page.type(page.must(page.$('input[placeholder="e.g. 12"]', page.app), 'rate'), '8');
    page.click(page.button('Finish setup'));
    await page.settle();
    assert.equal(page.state().workplaces[1].setupDone, true);
  } finally {
    await page.close();
  }
});

test('first run: a negative deduction amount is refused on step 2 with a plain message, no loop', async () => {
  const page = await boot();
  try {
    page.tab('setup');
    await page.settle();
    fillStep0(page);
    page.click(page.button('Next'));
    const amts = page.$$('input[id^="da-"]', page.app);
    page.type(amts[0], '60');
    page.leave(amts[0]);
    page.type(amts[1], '-5');
    page.leave(amts[1]);
    await page.settle();
    page.click(page.button('Next'));
    await page.settle();
    assert.match(stepNow(page), /^2\./);
    assert.ok(shown(page).includes("Amounts can't be negative."), shown(page).join(' / '));
    page.click(page.button('Next'));
    await page.settle();
    assert.match(stepNow(page), /^2\./);
  } finally {
    await page.close();
  }
});
