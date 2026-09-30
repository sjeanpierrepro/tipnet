import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { getState } from '../../app/js/storage.js';
import { exampleBudget } from '../../app/js/budget.js';
import { addDays, todayISO } from '../../app/js/math.js';

const keyOf = (page) => { const a = page.doc.activeElement; return a && a !== page.doc.body ? (a.getAttribute('data-focus-key') || a.id || null) : null; };

test('focus: ticking a bill Paid keeps focus on the same checkbox', async () => {
  const S = realState((s) => {
    s.settings.setupDone = true; s.budget = exampleBudget();
    s.budget.bills = [3, 8, 13, 18, 23, 28].map((d, i) => ({ id: 'b' + (i + 1), name: 'Bill ' + (i + 1), amount: 50, dueDay: d, category: 'Other' }));
  });
  const page = await boot({ url: 'http://localhost/?unlock=dev', seed: S });
  try {
    page.tab('budget');
    const box = page.$('input[type=checkbox][data-focus-key^="paid-"]');
    const key = box.getAttribute('data-focus-key');
    box.focus();
    assert.equal(page.doc.activeElement, box);
    box.click();
    assert.equal(keyOf(page), key, 'focus stays on the same control');
    assert.notEqual(page.doc.activeElement, page.doc.body);
    assert.equal(page.doc.activeElement.checked, true);
  } finally { await page.close(); }
});

test('focus: opening Edit night puts focus on a keyed control, not the page', async () => {
  const today = todayISO();
  const S = realState((s) => {
    s.settings.setupDone = true;
    s.nights = [{ id: 7, date: addDays(today, -1), total: 300, cash: 80, pay: { p1: 6 }, barback: true }];
  });
  const page = await boot({ seed: S });
  try {
    page.tab('periods');
    const edit = page.byLabel('Edit night ' + page.$('.list-row .main div').textContent);
    edit.focus();
    edit.click();
    assert.ok(page.$('form .card-title, .card-title'), 'editor opened');
    const key = keyOf(page);
    assert.ok(key, 'something keyed has focus');
    assert.notEqual(page.doc.activeElement, page.doc.body);
    assert.match(key, /^edit-7/, 'focus is inside the night editor: ' + key);
    // Cancel returns focus to the Edit button
    page.click(page.button('Cancel'));
    assert.match(keyOf(page) || '', /^edit-7/, 'back on the Edit control after Cancel');
    assert.equal(page.doc.activeElement.tagName, 'BUTTON');
  } finally { await page.close(); }
});

test('focus: adding a bill keeps its box open and focus in the form', async () => {
  const S = realState((s) => { s.settings.setupDone = true; s.budget = exampleBudget(); });
  const page = await boot({ url: 'http://localhost/?unlock=dev', seed: S });
  try {
    page.tab('budget');
    const det = [...page.doc.querySelectorAll('details')].find((d) => /Add a bill/.test(d.textContent));
    det.open = true;
    const f = (l) => [...page.doc.querySelectorAll('input')].find((i) => i.labels && i.labels[0] && i.labels[0].textContent.startsWith(l));
    f('Bill name').value = 'Gym'; f('Amount').value = '30'; f('Due day').value = '5';
    const add = page.button('Add bill');
    add.focus();
    add.click();
    assert.ok(getState().budget.bills.some((b) => b.name === 'Gym'), 'bill added');
    assert.equal(keyOf(page), 'add-bill', 'focus stays on the Add bill button');
    assert.equal([...page.doc.querySelectorAll('details')].find((d) => /Add a bill/.test(d.textContent)).open, true);
  } finally { await page.close(); }
});

test('focus: removing a deduction moves focus to the next Remove button', async () => {
  const S = realState((s) => { s.settings.setupDone = true; });
  const page = await boot({ seed: S });
  try {
    page.tab('setup');
    const rm = page.byLabel('Remove ' + getState().profile.deductions[0].name);
    rm.focus();
    rm.click();
    const a = page.doc.activeElement;
    assert.equal(a.tagName, 'BUTTON');
    assert.match(a.getAttribute('aria-label') || '', /^Remove /);
  } finally { await page.close(); }
});
