import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { exampleBudget, paidKey } from '../../app/js/budget.js';
import { addDays, todayISO } from '../../app/js/math.js';
import { flush } from '../../app/js/storage.js';

const DEV = 'http://localhost/?unlock=dev';
const seed = () => realState((S) => {
  S.settings.setupDone = true;
  S.budget = exampleBudget();
  // bills spread over the month so at least one always falls inside the visible pay periods
  S.budget.bills = [3, 8, 13, 18, 23, 28].map((d, i) => ({ id: 'b' + (i + 1), name: 'Bill ' + (i + 1), amount: 50 + i, dueDay: d, category: 'Other' }));
});
const paidBoxes = (page) => page.$$('input[type=checkbox][data-focus-key^="paid-"]');

test('budget: hidden on a normal host, dev unlock on localhost shows it', async () => {
  const off = await boot({ url: 'https://tipnet.example/', seed: seed() });
  try { assert.equal(off.tabHidden('budget'), true); } finally { await off.close(); }
  const dev = await boot({ url: DEV, seed: seed() });
  try { assert.equal(dev.tabHidden('budget'), false); dev.tab('budget'); assert.ok(dev.$('#budget-balance')); } finally { await dev.close(); }
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
    page.state().profile.periodStart = addDays(page.state().profile.periodStart, -1);
    page.tab('tonight'); page.tab('budget');
    assert.equal(page.state().budget.paidBills[key], true);
    const again = paidBoxes(page).find((b) => b.getAttribute('data-focus-key') === 'paid-' + key);
    assert.ok(again, 'bill still listed');
    assert.equal(again.checked, true);
  } finally { await page.close(); }
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
  } finally { await page.close(); }
});

for (const [kind, name, list] of [['category', 'Groceries', 'categories'], ['goal', 'Emergency fund', 'goals'], ['bill', 'Bill 1', 'bills']]) {
  test('budget: deleting a ' + kind + ' offers Undo that restores it', async () => {
    const page = await boot({ url: DEV, seed: seed() });
    try {
      page.tab('budget');
      const n = page.state().budget[list].length;
      if (kind === 'bill') page.click(page.byText('summary', 'Edit or remove bills'));
      const del = page.byLabel('Delete ' + name);
      page.click(del); page.click(del); // two taps
      assert.equal(page.state().budget[list].length, n - 1);
      assert.ok(!page.state().budget[list].some((x) => x.name === name));
      page.click(page.button('Undo', page.$('#toast')));
      assert.equal(page.state().budget[list].length, n);
      assert.ok(page.state().budget[list].some((x) => x.name === name), 'restored');
    } finally { await page.close(); }
  });
}
