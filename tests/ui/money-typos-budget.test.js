// Budget boxes refuse typos like 1.2.3 (see money-typos.test.js for Tonight, Pay periods and Setup): a message by the
// box, nothing stored, and the fixed text is accepted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { exampleBudget } from '../../app/js/budget.js';
import { addDays, todayISO } from '../../app/js/math.js';

const AMOUNT = /That isn’t an amount\. Use numbers and one decimal point, like 12\.50\./;
const DEV = 'http://localhost/?unlock=dev';
const key = (page, k) => page.must(page.$('[data-focus-key="' + k + '"]'), k);
/** The error line next to a box, found through its aria-describedby (so an unlinked or hidden message fails). */
const errOf = (page, input) => {
  const ids = (input.getAttribute('aria-describedby') || '').split(/\s+/);
  const e = ids.map((i) => page.doc.getElementById(i)).find((n) => n && n.classList.contains('field-error'));
  return e && !e.hidden ? e.textContent : '';
};
const invalid = (input) => input.getAttribute('aria-invalid') === 'true';
const seed = (mutate) =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    S.budget = exampleBudget();
    S.budget.bills = [];
    S.budget.goals = [];
    S.budget.balance = { amount: 2000, asOf: new Date().toISOString() };
    if (mutate) mutate(S);
  });

test('Budget: a bill, a spending category and logging spending refuse typos', async () => {
  const page = await boot({
    url: DEV,
    seed: seed((S) => (S.budget.categories = [{ id: 'c1', name: 'Food', monthly: 300 }])),
  });
  try {
    page.tab('budget');
    page.type(key(page, 'ef-bill-new-name'), 'Rent');
    const amount = key(page, 'ef-bill-new-amount');
    const day = key(page, 'ef-bill-new-dueDay');
    page.type(day, '5');
    page.type(amount, '1.2.3');
    assert.match(errOf(page, amount), AMOUNT);
    assert.equal(invalid(amount), true);
    page.click(page.button('Add bill'));
    assert.equal(page.state().budget.bills.length, 0, 'not stored');
    assert.equal(page.doc.activeElement.getAttribute('data-focus-key'), 'ef-bill-new-amount');
    page.type(amount, '1,250.50');
    assert.equal(invalid(amount), false);
    page.type(day, '5.5.5');
    assert.match(errOf(page, day), /That isn’t a day\./);
    page.click(page.button('Add bill'));
    assert.equal(page.state().budget.bills.length, 0);
    page.type(day, '5');
    page.click(page.button('Add bill'));
    assert.equal(page.state().budget.bills[0].amount, 1250.5);
    // spending category: the monthly amount
    page.type(key(page, 'ef-category-new-name'), 'Gas');
    const monthly = key(page, 'ef-category-new-monthly');
    page.type(monthly, '12abc');
    page.click(page.button('Add category'));
    assert.match(errOf(page, monthly), AMOUNT);
    assert.equal(page.state().budget.categories.length, 1);
    page.type(monthly, '80');
    page.click(page.button('Add category'));
    assert.equal(page.state().budget.categories.length, 2);
    // log spending
    const spend = key(page, 'spend-amount');
    page.type(spend, '4.5.0');
    assert.match(errOf(page, spend), AMOUNT);
    page.click(page.button('Log spending'));
    assert.equal(page.state().budget.spends.length, 0);
    page.type(spend, '4,50');
    page.click(page.button('Log spending'));
    assert.equal(page.state().budget.spends[0].amount, 4.5);
  } finally {
    await page.close();
  }
});

test('Budget: "Money you have right now" never saves a typo; the last balance stays', async () => {
  const page = await boot({ url: DEV, seed: seed() });
  try {
    page.tab('budget');
    const input = page.must(page.$('#budget-balance'), 'balance');
    page.type(input, '1.2.3');
    page.change(input);
    assert.match(errOf(page, input), AMOUNT);
    assert.equal(invalid(input), true);
    assert.equal(page.state().budget.balance.amount, 2000, 'still the last good balance');
    page.type(input, '1,500');
    page.change(input);
    assert.equal(invalid(input), false);
    assert.equal(page.state().budget.balance.amount, 1500);
  } finally {
    await page.close();
  }
});

test('Budget: a goal form shows the message and no numbers for a typo, and refuses to add it', async () => {
  const page = await boot({ url: DEV, seed: seed() });
  try {
    page.tab('budget');
    page.type(key(page, 'ef-goal-new-name'), 'Trip');
    const cost = key(page, 'ef-goal-new-cost');
    const saved = key(page, 'ef-goal-new-saved');
    const per = key(page, 'ef-goal-new-per');
    page.type(cost, '1.2.3');
    assert.match(errOf(page, cost), AMOUNT);
    assert.equal(page.$('#ef-goal-new-live').textContent, '', 'no preview from a typo');
    assert.equal(page.$('#ef-goal-new-possible').textContent, '');
    page.click(page.button('Add goal'));
    assert.equal(page.state().budget.goals.length, 0);
    assert.equal(page.doc.activeElement.getAttribute('data-focus-key'), 'ef-goal-new-cost');
    page.type(cost, '1200');
    assert.equal(invalid(cost), false);
    page.type(saved, '5..0');
    assert.match(errOf(page, saved), AMOUNT);
    page.click(page.button('Add goal'));
    assert.equal(page.state().budget.goals.length, 0);
    page.type(saved, '50');
    page.type(per, '10.0.0');
    assert.match(errOf(page, per), AMOUNT);
    page.click(page.button('Add goal'));
    assert.equal(page.state().budget.goals.length, 0);
    page.type(per, '25');
    page.click(page.button('Add goal'));
    const g = page.state().budget.goals[0];
    assert.deepEqual([g.target, g.saved, g.perPaycheck], [1200, 50, 25]);
  } finally {
    await page.close();
  }
});

test('Budget: money toward a goal (this check, extra, editing an entry) refuses typos', async () => {
  const goal = {
    id: 'p1',
    name: 'Car',
    kind: 'purchase',
    target: 2400,
    saved: 0,
    startSaved: 0,
    perPaycheck: 0,
    createdAt: todayISO(),
    targetDate: addDays(todayISO(), 150),
  };
  const page = await boot({ url: DEV, seed: seed((S) => (S.budget.goals = [goal])) });
  try {
    page.tab('budget');
    const rec = key(page, 'goal-rec-p1');
    page.type(rec, '1.2.3');
    assert.match(errOf(page, rec), AMOUNT);
    page.click(key(page, 'goal-rec-save-p1'));
    assert.equal(page.state().budget.goals[0].saved, 0, 'not stored');
    assert.equal(page.doc.activeElement.getAttribute('data-focus-key'), 'goal-rec-p1');
    const add = key(page, 'goal-add-p1');
    page.type(add, '12abc');
    assert.match(errOf(page, add), AMOUNT);
    page.click(page.byLabel('Add extra money to Car'));
    assert.equal(page.state().budget.goals[0].saved, 0);
    page.type(add, '30');
    assert.equal(invalid(add), false);
    page.click(page.byLabel('Add extra money to Car'));
    assert.equal(page.state().budget.goals[0].saved, 30);
    // edit that entry in the history
    page.click(page.must(page.$('button[aria-label^="Edit the amount for Car"]'), 'edit entry'));
    const edit = page.must(page.$('[data-focus-key^="entry-edit-p1-"]'), 'entry edit box');
    page.type(edit, '9.9.9');
    assert.match(errOf(page, edit), AMOUNT);
    page.click(page.$('[data-focus-key^="entry-save-p1-"]'));
    assert.equal(page.state().budget.goals[0].saved, 30, 'not changed');
    page.type(edit, '25');
    page.click(page.$('[data-focus-key^="entry-save-p1-"]'));
    assert.equal(page.state().budget.goals[0].saved, 25);
  } finally {
    await page.close();
  }
});

test('Budget: other income refuses a typo in the amount', async () => {
  const page = await boot({ url: DEV, seed: seed() });
  try {
    page.tab('budget');
    page.type(key(page, 'ef-income-new-name'), 'Gig');
    page.type(key(page, 'ef-income-new-date'), todayISO());
    const amount = key(page, 'ef-income-new-amount');
    page.type(amount, '1.2.3');
    assert.match(errOf(page, amount), AMOUNT);
    page.click(page.button('Add other income'));
    assert.equal(page.state().budget.income, undefined);
    assert.equal(page.doc.activeElement.getAttribute('data-focus-key'), 'ef-income-new-amount');
    page.type(amount, '150');
    page.click(page.button('Add other income'));
    assert.equal(page.state().budget.income[0].amount, 150);
  } finally {
    await page.close();
  }
});
