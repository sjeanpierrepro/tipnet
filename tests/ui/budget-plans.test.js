import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { exampleBudget, recordPayday, safeToSpend } from '../../app/js/budget.js';
import { addDays, todayISO } from '../../app/js/math.js';

const DEV = 'http://localhost/?unlock=dev';
const seed = (goals = []) =>
  realState((S) => {
    S.settings.setupDone = true;
    S.budget = exampleBudget();
    S.budget.bills = [];
    S.budget.categories = [];
    S.budget.goals = goals;
    S.budget.balance = { amount: 2000, asOf: new Date().toISOString() };
  });
const key = (page, k) => page.must(page.$('[data-focus-key="' + k + '"]'), k);
const planForm = (page) => page.$('form[aria-label="Plan a big purchase"]');
const fill = (page, k, v) => page.type(key(page, k), v);
const toDate = (page) => page.click(page.byLabel('Need it by a certain date?'));
const toAmount = (page) => page.click(page.byLabel('Choose an amount a paycheck instead'));
const submit = (page) => page.click(page.button('Make this plan', planForm(page)));
const plan = (over) => ({
  id: 'p1',
  name: 'Car down payment',
  kind: 'purchase',
  target: 2400,
  saved: 0,
  startSaved: 0,
  perPaycheck: 0,
  createdAt: todayISO(),
  ...over,
});

test('plans: create one by a date, with the numbers shown in plain words', async () => {
  const page = await boot({ url: DEV, seed: seed() });
  try {
    page.tab('budget');
    const date = addDays(todayISO(), 150);
    toDate(page);
    fill(page, 'ef-plan-new-name', 'Car down payment');
    fill(page, 'ef-plan-new-cost', '2400');
    fill(page, 'ef-plan-new-saved', '400');
    fill(page, 'ef-plan-new-date', date);
    const preview = page.text(planForm(page));
    assert.match(preview, /About \$\d[\d,]*\.\d\d a paycheck for \d+ paychecks \(ready by /);
    assert.match(
      preview,
      /compare it to your paychecks once you have a finished pay period|% of a typical check/,
    );
    submit(page);
    const g = page.state().budget.goals.find((x) => x.kind === 'purchase');
    assert.ok(g, 'plan saved');
    assert.equal(g.name, 'Car down payment');
    assert.equal(g.target, 2400);
    assert.equal(g.saved, 400);
    assert.equal(g.startSaved, 400);
    assert.equal(g.targetDate, date);
    assert.equal(g.createdAt, todayISO());
    const row = page.byText('li', 'Car down payment');
    assert.ok(row);
    assert.match(page.text(row), /On track/);
    assert.match(page.text(row), /\$400\.00 saved of \$2,400\.00/);
    assert.match(page.text(row), /a paycheck for [0-9]+ paychecks/);
    assert.ok(page.$('[aria-label="Car down payment progress"]', row), 'progress bar named for the plan');
    assert.ok(page.byLabel('Edit plan Car down payment'));
    assert.ok(page.byLabel('Delete plan Car down payment'));
  } finally {
    await page.close();
  }
});

test('plans: create one with a set amount a paycheck, and a missing amount or past date is refused', async () => {
  const page = await boot({ url: DEV, seed: seed() });
  try {
    page.tab('budget');
    fill(page, 'ef-plan-new-name', 'Laptop');
    fill(page, 'ef-plan-new-cost', '1000');
    submit(page); // no amount chosen (TipNet does not know the paycheck yet)
    assert.equal(page.state().budget.goals.filter((x) => x.kind === 'purchase').length, 0);
    assert.match(page.text(planForm(page)), /Enter an amount above zero/);
    toDate(page);
    submit(page); // no date chosen
    assert.equal(page.state().budget.goals.filter((x) => x.kind === 'purchase').length, 0);
    assert.match(page.text(planForm(page)), /Pick a date after today/);
    toAmount(page);
    fill(page, 'ef-plan-new-per', '110');
    assert.match(page.text(planForm(page)), /\$110 a paycheck → about 10 paychecks → ready by about /);
    submit(page);
    const g = page.state().budget.goals.find((x) => x.name === 'Laptop');
    assert.equal(g.perPaycheck, 110);
    assert.equal('targetDate' in g, false);
  } finally {
    await page.close();
  }
});

test('plans: the realism line compares to a typical check, and a big share gets a gentle note', async () => {
  const page = await boot({ url: DEV, seed: seed() });
  try {
    page.tab('budget');
    fill(page, 'ef-plan-new-name', 'Trip');
    fill(page, 'ef-plan-new-cost', '1000');
    fill(page, 'ef-plan-new-per', '10');
    const t = page.text(planForm(page));
    const m = /about (\d+)% of a typical check/i.exec(t);
    if (m) {
      assert.ok(Number(m[1]) < 35);
      fill(page, 'ef-plan-new-per', '5000');
      assert.match(page.text(planForm(page)), /That's a big share of each check; a later date lowers it\./);
    } else assert.match(t, /compare it to your paychecks once you have a finished pay period/);
  } finally {
    await page.close();
  }
});

test('plans: the amount entry and Add to saved work, and safe to spend counts the plan until an amount is recorded', async () => {
  const page = await boot({
    url: DEV,
    seed: seed([plan({ targetDate: addDays(todayISO(), 100) })]),
  });
  try {
    page.tab('budget');
    const S = page.state();
    const payday = recordPayday(S.profile, todayISO());
    const due = safeToSpend(S.budget, S.profile, [], todayISO()).goalsTotal;
    assert.ok(due > 0);
    page.type(key(page, 'goal-rec-p1'), '0');
    page.click(key(page, 'goal-rec-save-p1'));
    assert.equal(page.state().budget.goals[0].contributions[0].payday, payday);
    assert.equal(safeToSpend(page.state().budget, page.state().profile, [], todayISO()).goalsTotal, 0);
    page.type(key(page, 'goal-add-p1'), '300');
    page.click(page.button('Add to saved'));
    assert.equal(page.state().budget.goals[0].saved, 300);
    assert.match(page.text(page.byText('li', 'Car down payment')), /\$300\.00 saved of/);
  } finally {
    await page.close();
  }
});

test('plans: a plan with enough saved is ready, and Mark as bought takes two taps and has Undo', async () => {
  const page = await boot({
    url: DEV,
    seed: seed([plan({ saved: 2400, targetDate: addDays(todayISO(), 100) })]),
  });
  try {
    page.tab('budget');
    assert.match(page.text(page.byText('li', 'Car down payment')), /Ready to buy/);
    const buy = page.byLabel('Mark Car down payment as bought');
    page.click(buy);
    assert.equal(page.state().budget.goals[0].boughtAt, undefined, 'one tap only arms it');
    page.click(buy);
    assert.equal(page.state().budget.goals[0].boughtAt, todayISO());
    const done = page.byText('summary', 'Done (1)');
    assert.ok(done, 'moved to a Done list');
    assert.equal(done.parentElement.open, false, 'collapsed');
    assert.equal(page.byText('li', 'Car down payment').closest('details'), done.parentElement);
    const r = safeToSpend(page.state().budget, page.state().profile, [], todayISO());
    assert.equal(r.goals.length, 0, 'left out of safe to spend');
    page.click(page.button('Undo', page.$('#toast')));
    assert.equal(page.state().budget.goals[0].boughtAt, undefined);
    assert.ok(page.byLabel('Mark Car down payment as bought'));
  } finally {
    await page.close();
  }
});

test('plans: delete takes two taps and Undo brings it back in the same place', async () => {
  const page = await boot({
    url: DEV,
    seed: seed([
      { id: 'g1', name: 'Fund', target: 1000, saved: 0, perPaycheck: 40 },
      plan({ targetDate: addDays(todayISO(), 100) }),
    ]),
  });
  try {
    page.tab('budget');
    const del = page.byLabel('Delete plan Car down payment');
    page.click(del);
    page.click(del);
    assert.equal(page.state().budget.goals.length, 1);
    page.click(page.button('Undo', page.$('#toast')));
    assert.deepEqual(
      page.state().budget.goals.map((g) => g.id),
      ['g1', 'p1'],
    );
  } finally {
    await page.close();
  }
});

test('plans: edit changes the plan and starts on-track counting again', async () => {
  const page = await boot({
    url: DEV,
    seed: seed([plan({ targetDate: addDays(todayISO(), 100), createdAt: addDays(todayISO(), -30) })]),
  });
  try {
    page.tab('budget');
    page.click(page.byLabel('Edit plan Car down payment'));
    fill(page, 'ef-plan-p1-cost', '3000');
    page.click(page.button('Save plan'));
    const g = page.state().budget.goals[0];
    assert.equal(g.target, 3000);
    assert.equal(g.createdAt, todayISO());
    assert.equal(g.kind, 'purchase');
  } finally {
    await page.close();
  }
});
