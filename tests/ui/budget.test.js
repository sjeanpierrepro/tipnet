import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { exampleBudget, safeToSpend, recordPayday } from '../../app/js/budget.js';
import { addDays, todayISO } from '../../app/js/math.js';
import { flush } from '../../app/js/storage.js';

const DEV = 'http://localhost/?unlock=dev';
const seed = () =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    S.budget = exampleBudget();
    // bills spread over the month so at least one always falls inside the visible pay periods
    S.budget.bills = [3, 8, 13, 18, 23, 28].map((d, i) => ({
      id: 'b' + (i + 1),
      name: 'Bill ' + (i + 1),
      amount: 50 + i,
      dueDay: d,
      category: 'Other',
    }));
  });
const paidBoxes = (page) => page.$$('input[type=checkbox][data-focus-key^="paid-"]');

test('budget: hidden on a normal host, dev unlock on localhost shows it', async () => {
  const off = await boot({ url: 'https://tipnet.example/', seed: seed() });
  try {
    assert.equal(off.tabHidden('budget'), true);
  } finally {
    await off.close();
  }
  const dev = await boot({ url: DEV, seed: seed() });
  try {
    assert.equal(dev.tabHidden('budget'), false);
    dev.tab('budget');
    assert.ok(dev.$('#budget-balance'));
  } finally {
    await dev.close();
  }
});

test('budget: a Paid tick persists and survives a pay-schedule change', async () => {
  const page = await boot({ url: DEV, seed: seed() });
  try {
    page.tab('budget');
    const box = paidBoxes(page)[0];
    const key = box.getAttribute('data-focus-key').slice('paid-'.length);
    box.click();
    assert.equal(page.state().budget.paidBills[key], true);
    await flush();
    const stored = JSON.parse(page.win.localStorage.getItem('tipnet.v2'));
    assert.equal(stored.budget.paidBills[key], true, 'saved to storage');

    // move the pay period start by a day: the same bill on the same due date is still paid
    page.state().workplaces[0].profile.periodStart = addDays(
      page.state().workplaces[0].profile.periodStart,
      -1,
    );
    page.tab('tonight');
    page.tab('budget');
    assert.equal(page.state().budget.paidBills[key], true);
    const again = paidBoxes(page).find((b) => b.getAttribute('data-focus-key') === 'paid-' + key);
    assert.ok(again, 'bill still listed');
    assert.equal(again.checked, true);
  } finally {
    await page.close();
  }
});

test('budget: the balance saves with an as-of time', async () => {
  const page = await boot({ url: DEV, seed: seed() });
  try {
    page.tab('budget');
    const before = Date.now();
    const input = page.$('#budget-balance');
    page.type(input, '1234.50');
    page.change(input); // leaving the field saves at once
    const bal = page.state().budget.balance;
    assert.equal(bal.amount, 1234.5);
    assert.ok(Math.abs(new Date(bal.asOf).getTime() - before) < 5000);
    assert.match(page.text(), /Your balance as of/);
    await flush();
    assert.equal(JSON.parse(page.win.localStorage.getItem('tipnet.v2')).budget.balance.amount, 1234.5);
  } finally {
    await page.close();
  }
});

for (const [kind, name, list] of [
  ['category', 'Groceries', 'categories'],
  ['goal', 'Emergency fund', 'goals'],
  ['bill', 'Bill 1', 'bills'],
]) {
  test('budget: deleting a ' + kind + ' offers Undo that restores it', async () => {
    const page = await boot({ url: DEV, seed: seed() });
    try {
      page.tab('budget');
      const n = page.state().budget[list].length;
      if (kind === 'bill') page.click(page.byText('summary', 'Edit or remove bills'));
      const del = page.byLabel('Delete ' + name);
      page.click(del);
      page.click(del); // two taps
      assert.equal(page.state().budget[list].length, n - 1);
      assert.ok(!page.state().budget[list].some((x) => x.name === name));
      page.click(page.button('Undo', page.$('#toast')));
      assert.equal(page.state().budget[list].length, n);
      assert.ok(
        page.state().budget[list].some((x) => x.name === name),
        'restored',
      );
    } finally {
      await page.close();
    }
  });
}

test('budget: an armed Delete button is renamed and announced', async () => {
  const page = await boot({ url: DEV, seed: seed() });
  try {
    page.tab('budget');
    const del = page.byLabel('Delete Groceries');
    page.click(del);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(del.getAttribute('aria-label'), 'Confirm delete Groceries');
    assert.match(page.$('#budget-live').textContent, /Confirm delete Groceries/);
  } finally {
    await page.close();
  }
});

test('budget: has a page heading, and the goal Amount field uses the app field style', async () => {
  const page = await boot({ url: DEV, seed: seed() });
  try {
    page.tab('budget');
    assert.equal(page.$('h1', page.app).textContent, 'Budget');
    const amount = page.$('input[aria-label="Amount to add to Emergency fund"]');
    assert.ok(amount.classList.contains('input'), 'uses the shared .input style (44 px tall)');
    assert.ok(
      page.$('input.input[aria-label^="Amount saved for Emergency fund from the"]'),
      'the check amount field too',
    );
  } finally {
    await page.close();
  }
});

test('budget: month end sets aside a day-based allowance and explains it', async () => {
  mock.timers.enable({ apis: ['Date'], now: new Date(2026, 8, 30, 12, 0) }); // Sep 30
  try {
    const page = await boot({
      url: DEV,
      seed: realState((S) => {
        S.workplaces[0].setupDone = true;
        S.workplaces[0].profile.freq = 14;
        S.workplaces[0].profile.payDelay = 1;
        S.workplaces[0].profile.periodEnd = '2026-10-04';
        S.workplaces[0].profile.periodStart = '2026-09-21'; // 14 days: period 09-21..10-04, payday 10-05
        S.budget = exampleBudget();
        S.budget.bills = [];
        S.budget.goals = [];
        S.budget.balance = { amount: 2000, asOf: new Date(2026, 8, 30, 11, 0).toISOString() };
      }),
    });
    try {
      page.tab('budget');
      const r = safeToSpend(page.state().budget, page.state().workplaces[0].profile, [], '2026-09-30');
      assert.equal(r.daysAway, 5);
      // Groceries 400, Gas 160, Fun 150, nothing spent. Sep 30 = 1 day of 30, Oct 1-4 = 4 days of 31:
      // Sep 30: 13.33 + 5.33 + 5.00 = 23.66. Oct 1-4: 51.61 + 20.65 + 19.35 = 91.61. Total 115.27 (each rounded to the cent).
      assert.equal(r.categoriesTotal, 115.27);
      assert.equal(r.safe, 1884.73);
      const text = page.text();
      assert.match(text, /a day across your spending categories/);
      assert.match(text, /for the 5 days until payday/);
      assert.match(text, /\$1,884.73/);
    } finally {
      await page.close();
    }
  } finally {
    mock.timers.reset();
  }
});

test('budget: recording what you put toward a goal stops it coming out of your money; extra money does not', async () => {
  const page = await boot({
    url: DEV,
    seed: realState((S) => {
      S.workplaces[0].setupDone = true;
      S.budget = exampleBudget();
      S.budget.bills = [];
      S.budget.categories = [];
      S.budget.goals = [{ id: 'g1', name: 'Fund', target: 1000, saved: 0, perPaycheck: 40 }];
      S.budget.balance = { amount: 500, asOf: new Date().toISOString() };
    }),
  });
  try {
    page.tab('budget');
    const payday = recordPayday(page.state().workplaces[0].profile, todayISO());
    const field = () => page.$('input[data-focus-key="goal-rec-g1"]');
    assert.equal(
      safeToSpend(page.state().budget, page.state().workplaces[0].profile, [], todayISO()).goalsTotal,
      40,
    );
    page.type(field(), '25');
    page.click(page.$('button[data-focus-key="goal-rec-save-g1"]'));
    const g = () => page.state().budget.goals[0];
    assert.equal(g().saved, 25);
    assert.equal(g().contributions[0].payday, payday);
    assert.equal(g().contributions[0].planned, 40);
    assert.equal(
      safeToSpend(page.state().budget, page.state().workplaces[0].profile, [], todayISO()).goalsTotal,
      0,
    );
    await flush();
    assert.equal(
      JSON.parse(page.win.localStorage.getItem('tipnet.v2')).budget.goals[0].contributions[0].amount,
      25,
      'saved to storage',
    );
    // Extra money adds to saved but is not for this check
    page.type(page.$('input[data-focus-key="goal-add-g1"]'), '40');
    page.click(page.button('Add to saved'));
    assert.equal(g().saved, 65);
    assert.equal(g().contributions[1].payday, null);
    assert.equal(g().contributions.length, 2);
  } finally {
    await page.close();
  }
});
