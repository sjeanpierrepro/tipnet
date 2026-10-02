// Non-taxable earnings on screen: Setup rows (draft, Save/Cancel, Undo), the guided deductions step, and a one-off
// non-taxable amount on Tonight.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';

const seed = (mutate) =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    if (mutate) mutate(S);
  });
const addRow = (page) => page.click(page.must(page.$('#nt-add'), '+ Add non-taxable earnings'));
const amountOf = (page) => page.must(page.$('#nontax-section input[id^="na-"]'), 'amount');
const setAmount = (page, v) => {
  const a = amountOf(page);
  page.type(a, v);
  page.change(a);
};

test('nontax Setup: rows are part of the draft; Save stores them and the rate summary says what happened', async () => {
  const page = await boot({ seed: seed() });
  try {
    page.openSetup();
    assert.match(page.text(), /Non-taxable earnings on this paystub/);
    assert.match(page.text(), /Money your stub lists as non-taxable, like reimbursements\./);
    addRow(page);
    assert.equal(page.doc.activeElement.id.startsWith('nk-'), true, 'focus on the new row');
    const kind = page.$('#nontax-section select[id^="nk-"]');
    kind.value = 'mileage';
    page.change(kind);
    setAmount(page, '100');
    assert.match(
      page.text(),
      /Non-taxable earnings of \$100\.00 are left out, so your rate comes from \$1,900\.00/,
    );
    assert.equal(page.state().workplaces[0].profile.nontaxable, undefined, 'a draft until Save');
    await page.saveSetup();
    const [x] = page.state().workplaces[0].profile.nontaxable;
    assert.deepEqual([x.k, x.name, x.amount, x.recurring], ['mileage', 'Mileage reimbursement', 100, true]);
    // "Just this once", then Cancel: nothing changes
    page.openSetup();
    const how = page.$('#nontax-section select[id^="nr-"]');
    how.value = 'no';
    page.change(how);
    page.click(page.$('#draft-cancel'));
    assert.equal(page.state().workplaces[0].profile.nontaxable[0].recurring, true);
  } finally {
    await page.close();
  }
});

test('nontax Setup: Remove has an Undo; "Other non-taxable" asks for a name', async () => {
  const page = await boot({
    seed: seed((S) => {
      S.workplaces[0].profile.nontaxable = [
        { id: 'a', k: 'expense', name: 'Expense reimbursement', amount: 50, recurring: true },
      ];
    }),
  });
  try {
    page.openSetup();
    page.click(page.byLabel('Remove Expense reimbursement'));
    assert.equal(page.$$('#nontax-section .repeat-row').length, 0);
    page.click(page.button('Undo', page.$('#toast')));
    assert.equal(page.$$('#nontax-section .repeat-row').length, 1);
    const kind = page.$('#nk-a');
    kind.value = 'other';
    page.change(kind);
    page.type(page.must(page.$('#nn-a'), 'name box'), 'Tool money');
    await page.saveSetup();
    const [x] = page.state().workplaces[0].profile.nontaxable;
    assert.deepEqual([x.k, x.name, x.amount], ['other', 'Tool money', 50]);
  } finally {
    await page.close();
  }
});

test('nontax: guided setup offers it in the deductions step; empty rows are dropped on Finish', async () => {
  const page = await boot();
  try {
    page.type(page.$$('input[type=date]', page.app)[0], '2026-09-01');
    page.type(page.$('input[placeholder="e.g. 2,000"]', page.app), '1500');
    page.click(page.button('Next'));
    assert.match(page.text(), /Non-taxable earnings on this paystub/);
    page.click(page.$('#no-ded'));
    addRow(page);
    setAmount(page, '40');
    addRow(page); // left empty
    page.click(page.button('Next'));
    page.type(page.$('#pr-p1'), '12');
    page.click(page.button('Finish setup'));
    const nt = page.state().workplaces[0].profile.nontaxable;
    assert.equal(nt.length, 1);
    assert.equal(nt[0].amount, 40);
  } finally {
    await page.close();
  }
});

test('nontax Tonight: a non-taxable amount is added with no tax and shown as such', async () => {
  const page = await boot({
    seed: seed((S) => {
      const p = S.workplaces[0].profile;
      p.entryMode = 'tips';
      p.payTypes = [
        { id: 'bar', k: 'bartender', name: 'Bartender', unit: 'hr', rate: 12, usual: 0 },
        {
          id: 'mi',
          k: 'ntmileage',
          name: 'Mileage reimbursement',
          unit: 'amt',
          rate: 0,
          usual: 0,
          nontax: 1,
        },
      ];
    }),
  });
  try {
    page.type(page.$('[data-focus-key="night-total"]'), '200');
    page.type(page.$('[data-focus-key="night-pay-bar"]'), '5');
    await page.settle();
    const taxRe = /Taxes and % deductions \([^)]*\)\s*−\$([\d.,]+)/;
    const before = page.must(taxRe.exec(page.text()), 'tax line')[1];
    page.click(page.button('+ Add other pay'));
    assert.match(page.text(), /Mileage reimbursement \$ \(no tax\)/);
    page.type(page.$('[data-focus-key="night-pay-mi"]'), '25');
    await page.settle();
    assert.match(page.text(), /Non-taxable tonight \(no tax\)\s*\+\$25\.00/);
    const after = page.must(taxRe.exec(page.text()), 'tax line')[1];
    assert.equal(after, before, 'no tax on it');
    page.click(page.$('form button[type=submit]'));
    await page.settle();
    const n = page.state().nights[0];
    assert.equal(Number(n.pay.mi), 25);
    assert.equal(n.tips, 200, 'not tips');
  } finally {
    await page.close();
  }
});
