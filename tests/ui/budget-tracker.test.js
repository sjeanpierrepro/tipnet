import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { exampleBudget, recordPayday, purchasePlan } from '../../app/js/budget.js';
import { addDays, todayISO } from '../../app/js/math.js';

const DEV = 'http://localhost/?unlock=dev';
const seed = (goals) =>
  realState((S) => {
    S.settings.setupDone = true;
    S.budget = exampleBudget();
    S.budget.bills = [];
    S.budget.categories = [];
    S.budget.goals = goals;
    S.budget.balance = { amount: 2000, asOf: new Date().toISOString() };
  });
const key = (page, k) => page.must(page.$('[data-focus-key="' + k + '"]'), k);
const plan = (over) => ({
  id: 'p1',
  name: 'Car down payment',
  kind: 'purchase',
  target: 2400,
  saved: 0,
  startSaved: 0,
  perPaycheck: 0,
  createdAt: todayISO(),
  targetDate: addDays(todayISO(), 150),
  ...over,
});
const row = (page) => page.byText('li', 'Car down payment');
const record = (page, v) => {
  page.type(key(page, 'goal-rec-p1'), v);
  page.click(key(page, 'goal-rec-save-p1'));
};

test('tracker: record below plan raises the amount and explains it; the field is named and shows the plan', async () => {
  const page = await boot({ url: DEV, seed: seed([plan()]) });
  try {
    page.tab('budget');
    const S = page.state();
    const payday = recordPayday(S.profile, todayISO());
    const planned = purchasePlan(S.budget.goals[0], S.profile, todayISO()).perPaycheck;
    const input = key(page, 'goal-rec-p1');
    assert.match(input.getAttribute('aria-label'), /^Amount saved for Car down payment from the .+ check$/);
    assert.equal(input.getAttribute('placeholder'), 'planned $' + planned.toFixed(2));
    assert.match(page.text(row(page)), /How much did you put toward this from this check\?/);
    assert.match(
      page.text(row(page)),
      /To reach \$2,400\.00 by .+: \$[\d,]+\.\d\d a paycheck for \d+ paychecks/,
    );
    record(page, '10');
    const g = page.state().budget.goals[0];
    assert.equal(g.saved, 10);
    assert.equal(g.contributions.length, 1);
    assert.equal(g.contributions[0].payday, payday);
    assert.equal(g.contributions[0].planned, planned);
    const after = purchasePlan(g, page.state().profile, todayISO());
    assert.ok(after.perChange > 0);
    const t = page.text(row(page));
    assert.match(t, /Up \$\d+\.\d\d because this check was below plan\./);
    assert.match(t, /more paychecks/);
    assert.match(t, /You put \$10\.00 toward this from the .+ check/);
    assert.ok(key(page, 'goal-rec-p1'), 'the field is still there for focus');
    assert.ok(key(page, 'goal-rec-save-p1'));
    // entering again for the same payday edits it (no second entry)
    record(page, '400');
    const g2 = page.state().budget.goals[0];
    assert.equal(g2.contributions.length, 1);
    assert.equal(g2.saved, 400);
    assert.match(page.text(row(page)), /Down \$\d+\.\d\d because this check was above plan\./);
  } finally {
    await page.close();
  }
});

test('tracker: a negative or empty amount is refused, 0 is allowed', async () => {
  const page = await boot({ url: DEV, seed: seed([plan()]) });
  try {
    page.tab('budget');
    record(page, '-5');
    assert.equal(page.state().budget.goals[0].contributions, undefined);
    assert.equal(page.state().budget.goals[0].saved, 0);
    page.click(key(page, 'goal-rec-save-p1')); // empty
    assert.equal(page.state().budget.goals[0].contributions, undefined);
    assert.ok(page.$('.field-error:not([hidden])', row(page)), 'an error is shown');
    record(page, '0');
    assert.equal(page.state().budget.goals[0].contributions.length, 1);
    assert.equal(page.state().budget.goals[0].contributions[0].amount, 0);
  } finally {
    await page.close();
  }
});

test('tracker: history lists checks and extras; Edit adjusts saved; Remove takes two taps and Undo restores', async () => {
  const page = await boot({ url: DEV, seed: seed([plan()]) });
  try {
    page.tab('budget');
    record(page, '150');
    page.type(key(page, 'goal-add-p1'), '50');
    page.click(page.button('Add to saved'));
    assert.equal(page.state().budget.goals[0].saved, 200);
    const summary = page.byText('summary', 'What you put in (2)', row(page));
    assert.ok(summary, 'history');
    const t = page.text(row(page));
    assert.match(t, /check: \$150\.00 \(planned \$[\d,]+\.\d\d\)/);
    assert.match(t, /Extra: \$50\.00 \(/);
    // inline edit of the check entry
    page.click(
      page
        .$$('button')
        .find((b) =>
          /^Edit the amount for Car down payment, .+ check$/.test(b.getAttribute('aria-label') || ''),
        ),
    );
    const edit = page.$('input[data-focus-key^="entry-edit-p1-"]');
    assert.ok(edit, 'inline field');
    page.type(edit, '100');
    page.click(page.$('button[data-focus-key^="entry-save-p1-"]'));
    assert.equal(page.state().budget.goals[0].saved, 150);
    assert.equal(page.state().budget.goals[0].contributions[0].amount, 100);
    // remove the extra: two taps, saved goes down, Undo brings it back
    const del = page
      .$$('button')
      .find((b) => b.getAttribute('aria-label') === 'Delete the amount for Car down payment, extra');
    page.click(del);
    assert.equal(page.state().budget.goals[0].contributions.length, 2, 'one tap only arms it');
    page.click(del);
    assert.equal(page.state().budget.goals[0].contributions.length, 1);
    assert.equal(page.state().budget.goals[0].saved, 100);
    page.click(page.button('Undo', page.$('#toast')));
    assert.equal(page.state().budget.goals[0].contributions.length, 2);
    assert.equal(page.state().budget.goals[0].saved, 150);
  } finally {
    await page.close();
  }
});

test('tracker: a fixed plan shows the ready-by date moving; a plain goal shows its status', async () => {
  const page = await boot({
    url: DEV,
    seed: seed([
      plan({ targetDate: undefined, perPaycheck: 100 }),
      {
        id: 'g1',
        name: 'Fund',
        target: 1000,
        saved: 0,
        startSaved: 0,
        perPaycheck: 50,
        createdAt: todayISO(),
      },
    ]),
  });
  try {
    page.tab('budget');
    assert.match(page.text(row(page)), /Ready by about [A-Z][a-z]{2} \d+/);
    record(page, '0');
    assert.match(page.text(row(page)), /Ready by about .+ \(moved [0-9]+ weeks? later\)/);
    assert.ok(page.$('input[aria-label^="Amount saved for Fund from the"]'));
    page.type(page.$('input[data-focus-key="goal-rec-g1"]'), '50');
    page.click(page.$('button[data-focus-key="goal-rec-save-g1"]'));
    assert.equal(page.state().budget.goals[1].saved, 50);
    assert.match(page.text(page.byText('li', 'Fund')), /On track/);
  } finally {
    await page.close();
  }
});

test('tracker: an unrealistic plan is said calmly and offers Move the date', async () => {
  const page = await boot({
    url: DEV,
    seed: seed([plan({ target: 900000, targetDate: addDays(todayISO(), 20) })]),
  });
  try {
    page.tab('budget');
    const t = page.text(row(page));
    if (/% of a typical check/.test(t)) {
      assert.match(t, /more than half of a typical check/);
      page.click(page.byLabel('Move the date for Car down payment'));
      assert.ok(page.$('form[aria-label="Edit plan Car down payment"]'), 'opens the plan to edit');
    } else assert.match(t, /compare it to your paychecks|Pick a later date/);
  } finally {
    await page.close();
  }
});
