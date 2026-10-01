import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { exampleBudget, safeToSpend } from '../../app/js/budget.js';
import { addDays, todayISO } from '../../app/js/math.js';

const DEV = 'http://localhost/?unlock=dev';
const seed = (income) =>
  realState((S) => {
    S.settings.setupDone = true;
    S.budget = exampleBudget();
    S.budget.bills = [];
    S.budget.categories = [];
    S.budget.goals = [];
    S.budget.balance = { amount: 500, asOf: new Date().toISOString() };
    if (income) S.budget.income = income;
  });
const key = (page, k) => page.must(page.$('[data-focus-key="' + k + '"]'), k);
const form = (page, label) => page.$('form[aria-label="' + label + '"]');
const gig = (over) => ({
  id: 'i1',
  name: 'DoorDash',
  amount: 150,
  freq: 'weekly',
  nextDate: todayISO(),
  ...over,
});

test('other income: add a source once, with a label on every field, and it is saved with its next date', async () => {
  const page = await boot({ url: DEV, seed: seed() });
  try {
    page.tab('budget');
    const f = form(page, 'Add other income');
    for (const label of ['What is it called?', 'How much does it pay?', 'How often?', 'Next date it arrives'])
      assert.ok(page.byText('label', label, f), 'label: ' + label);
    page.click(page.button('Add other income', f)); // empty: refused
    assert.equal(page.state().budget.income, undefined);
    assert.match(page.text(f), /Give it a name/);
    page.type(key(page, 'ef-income-new-name'), 'DoorDash');
    page.type(key(page, 'ef-income-new-amount'), '150');
    page.type(key(page, 'ef-income-new-date'), todayISO());
    page.click(page.button('Add other income', f));
    const s = page.state().budget.income[0];
    assert.equal(s.name, 'DoorDash');
    assert.equal(s.amount, 150);
    assert.equal(s.freq, 'weekly');
    assert.equal(s.nextDate, todayISO());
    const row = page.byText('li', 'DoorDash');
    assert.match(page.text(row), /Every week\. Next: /);
    assert.match(page.text(), /About \$650\.00 a month from regular other income/);
    assert.ok(page.byLabel('Edit other income DoorDash'));
    assert.ok(page.byLabel('Delete other income DoorDash'));
  } finally {
    await page.close();
  }
});

test('other income: twice a month asks for two days, and the breakdown shows income arriving before payday', async () => {
  const page = await boot({ url: DEV, seed: seed() });
  try {
    page.tab('budget');
    const f = form(page, 'Add other income');
    const sel = key(page, 'ef-income-new-freq');
    sel.value = 'twiceMonthly';
    page.change(sel);
    page.type(key(page, 'ef-income-new-name'), 'Support');
    page.type(key(page, 'ef-income-new-amount'), '300');
    page.type(key(page, 'ef-income-new-date'), todayISO());
    page.click(page.button('Add other income', f));
    assert.match(page.text(f), /Enter a day from 1 to 31/);
    page.type(key(page, 'ef-income-new-day1'), '1');
    page.type(key(page, 'ef-income-new-day2'), '15');
    page.click(page.button('Add other income', f));
    assert.deepEqual(page.state().budget.income[0].days, [1, 15]);
  } finally {
    await page.close();
  }
});

test('other income: safe to spend and the breakdown include it only when it arrives before payday', async () => {
  const page = await boot({ url: DEV, seed: seed([gig()]) });
  try {
    page.tab('budget');
    const S = page.state();
    const r = safeToSpend(S.budget, S.profile, [], todayISO());
    assert.ok(r.otherIncomeTotal >= 150, 'arrives today');
    assert.match(page.text(), /Other income before payday\+\$150\.00/);
    assert.match(page.text(), /DoorDash, /);
    const later = S.budget.income[0];
    later.nextDate = addDays(r.payday, 30);
    page.tab('tonight');
    page.tab('budget');
    assert.doesNotMatch(page.text(), /Other income before payday/);
  } finally {
    await page.close();
  }
});

test('other income: edit changes it, and delete takes two taps and has Undo', async () => {
  const page = await boot({
    url: DEV,
    seed: seed([gig(), gig({ id: 'i2', name: 'Support', freq: 'monthly', days: [3] })]),
  });
  try {
    page.tab('budget');
    page.click(page.byLabel('Edit other income DoorDash'));
    page.type(key(page, 'ef-income-i1-amount'), '200');
    page.click(page.button('Save changes', form(page, 'Edit other income DoorDash')));
    assert.equal(page.state().budget.income[0].amount, 200);
    const del = page.byLabel('Delete other income DoorDash');
    page.click(del);
    page.click(del);
    assert.deepEqual(
      page.state().budget.income.map((x) => x.id),
      ['i2'],
    );
    page.click(page.button('Undo', page.$('#toast')));
    assert.deepEqual(
      page.state().budget.income.map((x) => x.id),
      ['i1', 'i2'],
    );
  } finally {
    await page.close();
  }
});

test('other income: a plan compares against the typical check plus regular other income when there is some', async () => {
  const page = await boot({ url: DEV, seed: seed([gig({ amount: 1000 })]) });
  try {
    page.tab('budget');
    const f = form(page, 'Plan a big purchase');
    page.type(key(page, 'ef-plan-new-name'), 'Trip');
    page.type(key(page, 'ef-plan-new-cost'), '1000');
    page.type(key(page, 'ef-plan-new-per'), '100');
    const t = page.text(f);
    if (/% of a typical check/.test(t))
      assert.match(t, /of a typical check plus your regular other income\./);
    else assert.match(t, /once you have a finished pay period/);
  } finally {
    await page.close();
  }
});
