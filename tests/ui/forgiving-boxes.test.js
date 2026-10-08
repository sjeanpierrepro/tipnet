// Valid ways of writing a number are accepted, and the saved number is the right one: "15%" in a percent box,
// "$ 12.50" / "12.50$" / "+12" in money boxes, "8hrs." in hours, "15th" for a bill's due day.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { exampleBudget } from '../../app/js/budget.js';

const PERCENT = 'That isn’t a percent. Use something like 15 or 1.25.';
const AMOUNT = /That isn’t an amount\./;
const DEV = 'http://localhost/?unlock=dev';
const byId = (page, id) => page.must(page.$('#' + id), id);
const key = (page, k) => page.must(page.$('[data-focus-key="' + k + '"]'), k);
const errOf = (page, input) => {
  const ids = (input.getAttribute('aria-describedby') || '').split(/\s+/);
  const e = ids.map((i) => page.doc.getElementById(i)).find((n) => n && n.classList.contains('field-error'));
  return e && !e.hidden ? e.textContent : '';
};

test('Setup: a tip-out percent box takes "15%" and says percent when it is wrong; dollars stay dollars', async () => {
  const page = await boot({
    seed: realState((S) => {
      const p = S.workplaces[0].profile;
      S.workplaces[0].setupDone = true;
      p.tipout = { on: true, basis: 'before' };
      p.tipouts = [{ id: 't1', k: 'barback', who: 'Barback', mode: 'pctTips', value: 10, from: 'cash' }];
    }),
  });
  try {
    page.openSetup();
    const amt = byId(page, 'tv-t1');
    const saved = () => page.state().workplaces[0].profile.tipouts[0];
    page.type(amt, '1.25 %');
    assert.equal(errOf(page, amt), '');
    page.type(amt, '1.2.3');
    assert.equal(errOf(page, amt), PERCENT);
    page.type(amt, '15%');
    assert.equal(errOf(page, amt), '');
    await page.saveSetup();
    assert.equal(saved().value, 15);
    // dollars: no % sign, money wording, "$ 12.50" is fine
    page.openSetup();
    const amt2 = byId(page, 'tv-t1');
    const mode = byId(page, 'tm-t1');
    page.type(amt2, '15%');
    mode.value = 'flat';
    page.change(mode);
    assert.match(errOf(page, amt2), AMOUNT, '15% is not dollars');
    page.type(amt2, '$ 12.50');
    assert.equal(errOf(page, amt2), '');
    await page.saveSetup();
    assert.equal(saved().value, 12.5);
  } finally {
    await page.close();
  }
});

test('Tonight: "$ 12.50", "+12" and "7h 30m." are accepted and saved as 12.5, 12 and 7.5', async () => {
  const page = await boot({
    seed: realState((S) => {
      S.workplaces[0].setupDone = true;
      S.workplaces[0].profile.entryMode = 'total';
      S.workplaces[0].profile.tipout = { on: false, basis: 'before' };
      S.workplaces[0].profile.payTypes[0].unit = 'hr';
    }),
  });
  try {
    const total = key(page, 'night-total');
    const hours = key(page, 'night-pay-p1');
    page.type(hours, '7h 30m.');
    page.type(total, '$ 12.50');
    assert.equal(errOf(page, total), '');
    page.click(page.$('form button[type=submit]'));
    const n = page.state().nights;
    assert.equal(n.length, 1);
    assert.equal(n[0].total, 12.5);
    assert.equal(n[0].pay.p1, 7.5);
    page.type(total, '+12');
    assert.equal(errOf(page, total), '');
    page.type(total, '12.50$');
    assert.equal(errOf(page, total), '');
  } finally {
    await page.close();
  }
});

test('Budget: a bill’s due day takes "15th", "1st", "2nd", "3rd" and refuses "15abc"', async () => {
  const page = await boot({
    url: DEV,
    seed: realState((S) => {
      S.workplaces[0].setupDone = true;
      S.budget = exampleBudget();
      S.budget.bills = [];
      S.budget.goals = [];
      S.budget.balance = { amount: 2000, asOf: new Date().toISOString() };
    }),
  });
  try {
    page.tab('budget');
    // the form is drawn again after each add, so the boxes are looked up each time
    const box = (k) => key(page, 'ef-bill-new-' + k);
    let want = 0;
    for (const [text, d] of [
      ['15th', 15],
      ['1ST', 1],
      ['2nd', 2],
      ['3rd', 3],
      ['21st', 21],
    ]) {
      page.type(box('name'), 'Bill ' + text);
      page.type(box('amount'), '50');
      page.type(box('dueDay'), text);
      assert.equal(errOf(page, box('dueDay')), '', text);
      page.click(page.button('Add bill'));
      assert.equal(page.state().budget.bills.length, ++want, text);
      assert.equal(page.state().budget.bills[want - 1].dueDay, d, text);
    }
    for (const bad of ['15abc', '1.2.3']) {
      page.type(box('name'), 'Bad');
      page.type(box('amount'), '50');
      page.type(box('dueDay'), bad);
      assert.match(errOf(page, box('dueDay')), /That isn’t a day\./, bad);
      page.click(page.button('Add bill'));
      assert.equal(page.state().budget.bills.length, want, bad);
    }
  } finally {
    await page.close();
  }
});
