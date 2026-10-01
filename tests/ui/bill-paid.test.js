// Adding a bill whose due day already passed this month asks "Already paid this month?" (ticked by default).
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { exampleBudget, paidKey, billsDue, isPaid } from '../../app/js/budget.js';
import { todayISO } from '../../app/js/math.js';

const DEV = 'http://localhost/?unlock=dev';
const seed = () =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    S.budget = exampleBudget();
    S.budget.bills = [];
  });
function addBill(page, { name, day, untick = false }) {
  const det = page.$$('details').find((d) => /Add a bill/.test(d.textContent));
  det.open = true;
  const f = (l) =>
    page.$$('input').find((i) => i.labels && i.labels[0] && i.labels[0].textContent.startsWith(l));
  page.type(f('Bill name'), name);
  page.type(f('Amount'), '40');
  page.type(f('Due day'), String(day));
  const cb = page.$('[data-focus-key="ef-bill-new-paid"]');
  const shown = !cb.closest('label').hidden;
  const text = cb.closest('label').textContent;
  if (untick && shown) {
    cb.checked = false;
    page.change(cb);
  }
  page.click(page.button('Add bill'));
  return { shown, text, bill: page.state().budget.bills.find((b) => b.name === name) };
}

test('bills: a due day already passed this month asks "Already paid this month?" and marks it paid by default', async () => {
  const page = await boot({ url: DEV, seed: seed() });
  try {
    page.tab('budget');
    const today = todayISO();
    const first = today.slice(0, 8) + '01';
    const r = addBill(page, { name: 'Gym', day: 1 });
    if (today === first) {
      // the 1st: nothing has passed yet this month
      assert.equal(r.shown, false);
      assert.equal(r.bill.since, today);
      return;
    }
    assert.equal(r.shown, true, 'the question shows');
    assert.match(r.text, /Already paid this month\?/);
    assert.equal(r.bill.since, first, 'counts from this month’s due date');
    assert.equal(page.state().budget.paidBills[paidKey(r.bill.id, first)], true, 'marked paid');
    assert.doesNotMatch(page.text(page.byText('li', 'Gym') || page.app), /past due/);
    // unticked: it shows as owed
    const u = addBill(page, { name: 'Phone', day: 1, untick: true });
    assert.equal(u.bill.since, first);
    assert.equal(page.state().budget.paidBills[paidKey(u.bill.id, first)], undefined);
    const owed = billsDue({ bills: [u.bill] }, first, today).filter((b) => !isPaid(page.state().budget, b));
    assert.equal(owed.length, 1, 'still owed');
  } finally {
    await page.close();
  }
});

test('bills: a due day still ahead this month does not ask, and the bill starts today', async () => {
  const page = await boot({ url: DEV, seed: seed() });
  try {
    page.tab('budget');
    const today = todayISO();
    const d = Number(today.slice(8));
    const r = addBill(page, { name: 'Car', day: Math.min(31, d + 1 > 28 ? d : d + 1) });
    assert.equal(r.shown, false);
    assert.equal(r.bill.since, today);
  } finally {
    await page.close();
  }
});

test('bills: "Start with example budget" opens with no overdue bills', async () => {
  const page = await boot({
    url: DEV,
    seed: realState((S) => {
      S.workplaces[0].setupDone = true;
    }),
  });
  try {
    page.tab('budget');
    const btn = page.byText('button', 'Start with example budget');
    if (btn) page.click(btn);
    const B = page.state().budget;
    assert.ok(B.bills.length > 0);
    assert.ok(B.bills.every((b) => b.since === todayISO()));
    assert.doesNotMatch(page.text(), /past due/);
  } finally {
    await page.close();
  }
});
