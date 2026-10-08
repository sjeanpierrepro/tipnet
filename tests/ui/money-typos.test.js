// Every money box refuses typos like 1.2.3 (never read as 1.2): a plain message by the box, nothing stored, and the
// same text fixed is accepted. Tonight, the night editor and the accuracy check here; Setup and Budget below.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { businessDate } from '../../app/js/inputs.js';
import { addDays, todayISO } from '../../app/js/math.js';

const AMOUNT = /That isn’t an amount\. Use numbers and one decimal point, like 12\.50\./;
const today = () => businessDate(new Date(), 6);
const key = (page, k) => page.must(page.$('[data-focus-key="' + k + '"]'), k);
const submit = (page) => page.click(page.$('form button[type=submit]'));
/** The error line next to a box: found through the box's aria-describedby, so a hidden or unlinked message fails. */
const errOf = (page, input) => {
  const ids = (input.getAttribute('aria-describedby') || '').split(/\s+/);
  const e = ids.map((i) => page.doc.getElementById(i)).find((n) => n && n.classList.contains('field-error'));
  return e && !e.hidden ? e.textContent : '';
};
const invalid = (input) => input.getAttribute('aria-invalid') === 'true';

const tipouts = [
  { id: 't1', k: 'barback', who: 'Barback', mode: 'pctTips', value: 15, from: 'cash' },
  { id: 't2', k: 'runner', who: 'Runner', mode: 'pctSales', value: 1.25, from: 'payroll' },
];
const tonightSeed = (mode = 'total') =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    S.workplaces[0].profile.entryMode = mode;
    S.workplaces[0].profile.tipout = { on: true, basis: 'before' };
    S.workplaces[0].profile.tipouts = tipouts.map((x) => ({ ...x }));
    S.workplaces[0].profile.payTypes[0].unit = 'hr';
  });

test('Tonight: a typo in the total, hours, sales or cash box blocks Save, shows a message, and is never stored', async () => {
  const page = await boot({ seed: tonightSeed() });
  try {
    const total = key(page, 'night-total');
    const hours = key(page, 'night-pay-p1');
    const cash = key(page, 'night-cash');
    const sales = key(page, 'night-sales');
    page.type(hours, '7');
    page.type(sales, '1000');
    // total
    for (const bad of ['1.2.3', '12abc', '1,2,3', '$', '1..2']) {
      page.type(total, bad);
      assert.match(errOf(page, total), AMOUNT, bad);
      assert.equal(invalid(total), true, bad);
      assert.match(
        page.$('.result').textContent,
        /Fix the amount marked above/,
        'no numbers from a typo: ' + bad,
      );
      assert.doesNotMatch(page.$('.result').textContent, /\$/, bad);
      submit(page);
      assert.equal(page.state().nights.length, 0, bad + ' is not saved');
      assert.equal(page.doc.activeElement, total, 'focus goes to the box');
    }
    page.type(total, '1,250.50');
    assert.equal(errOf(page, total), '');
    assert.equal(invalid(total), false);
    assert.match(page.$('.result').textContent, /Made tonight\$1,250\.50/);
    // cash
    page.type(cash, '1.2.3');
    assert.match(page.text(), AMOUNT);
    assert.equal(invalid(cash), true);
    submit(page);
    assert.equal(page.state().nights.length, 0);
    assert.equal(page.doc.activeElement, cash);
    page.type(cash, '40');
    assert.equal(invalid(cash), false);
    // sales
    page.type(sales, '10.0.0');
    assert.equal(invalid(sales), true);
    assert.match(errOf(page, sales), AMOUNT);
    submit(page);
    assert.equal(page.state().nights.length, 0);
    assert.equal(page.doc.activeElement, sales);
    page.type(sales, '1000');
    assert.equal(invalid(sales), false);
    // hours
    for (const bad of ['1.2.3', '7..5', '7:3:3:3', '7h abc']) {
      page.type(hours, bad);
      assert.match(page.text(), /Hours should be a number, like 6 or 7:30\./, bad);
      submit(page);
      assert.equal(page.state().nights.length, 0, bad);
      assert.equal(page.doc.activeElement, hours);
    }
    page.type(hours, '7:30');
    submit(page);
    const n = page.state().nights;
    assert.equal(n.length, 1);
    assert.equal(n[0].total, 1250.5);
    assert.equal(n[0].cash, 40);
    assert.equal(n[0].sales, 1000);
    assert.equal(n[0].pay.p1, 7.5);
  } finally {
    await page.close();
  }
});

test('Tonight, tips mode: the tips box refuses a typo, and so does an amount in Other pay', async () => {
  const page = await boot({
    seed: realState((S) => {
      S.workplaces[0].setupDone = true;
      S.workplaces[0].profile.entryMode = 'tips';
      S.workplaces[0].profile.tipout.on = false;
      S.workplaces[0].profile.payTypes.push({ id: 'bonus', k: 'bonus', name: 'Bonus', unit: 'amt', rate: 0 });
    }),
  });
  try {
    const total = key(page, 'night-total');
    page.type(key(page, 'night-pay-p1'), '6');
    page.type(total, '1.2.3');
    assert.match(errOf(page, total), AMOUNT);
    submit(page);
    assert.equal(page.state().nights.length, 0);
    page.type(total, '350');
    page.click(page.button('+ Add other pay'));
    const bonus = key(page, 'night-pay-bonus');
    page.type(bonus, '5.5.5');
    assert.match(page.text(), /Bonus: That isn’t an amount\./);
    submit(page);
    assert.equal(page.state().nights.length, 0);
    assert.equal(page.doc.activeElement, bonus);
    page.type(bonus, '25');
    submit(page);
    const n = page.state().nights[0];
    assert.equal(n.tips, 350);
    assert.equal(n.pay.bonus, 25);
  } finally {
    await page.close();
  }
});

test('Pay periods night editor: a typo is refused with a message and the saved night is left as it was', async () => {
  const D = today();
  const page = await boot({
    seed: realState((S) => {
      S.workplaces[0].setupDone = true;
      S.workplaces[0].profile.tipout.on = false;
      S.nights = [{ id: 1, date: D, total: 300, cash: 50, pay: { p1: 6 }, barback: false }];
    }),
  });
  try {
    page.tab('periods');
    const { fmtDate } = await import('../../app/js/ui/common.js');
    page.click(page.must(page.byLabel('Edit night ' + fmtDate(D)), 'Edit'));
    const total = key(page, 'edit-1-total');
    const cash = key(page, 'edit-1-cash');
    const hours = key(page, 'edit-1-pay-p1');
    page.type(total, '1.2.3');
    assert.match(errOf(page, total), AMOUNT);
    assert.match(page.text(), /Fix the amount marked above to see the estimate\./);
    page.click(page.button('Save changes'));
    assert.equal(page.state().nights[0].total, 300, 'not stored');
    assert.equal(page.doc.activeElement, total);
    page.type(total, '320');
    page.type(cash, '5,0,0');
    assert.equal(invalid(cash), true);
    page.click(page.button('Save changes'));
    assert.equal(page.state().nights[0].cash, 50, 'not stored');
    assert.equal(page.doc.activeElement, cash);
    page.type(cash, '60');
    page.type(hours, '6..5');
    page.click(page.button('Save changes'));
    assert.match(page.text(), /Hours should be a number/);
    assert.equal(page.state().nights[0].pay.p1, 6);
    page.type(hours, '6.5');
    page.click(page.button('Save changes'));
    const n = page.state().nights[0];
    assert.deepEqual([n.total, n.cash, n.pay.p1], [320, 60, 6.5]);
  } finally {
    await page.close();
  }
});

test('Check my accuracy: a typo in the paycheck amount compares nothing; the fixed amount does', async () => {
  const t = todayISO();
  const page = await boot({
    seed: realState((S) => {
      S.workplaces[0].profile.periodStart = addDays(t, -30);
      S.workplaces[0].profile.periodEnd = addDays(t, -17);
      S.workplaces[0].profile.shifts = 2;
      S.workplaces[0].setupDone = true;
      S.nights = [
        { id: 1, date: addDays(t, -26), total: 301, cash: 80, pay: { p1: 6 }, barback: true },
        { id: 2, date: addDays(t, -20), total: 302, cash: 80, pay: { p1: 6 }, barback: true },
      ];
    }),
  });
  try {
    page.tab('periods');
    const actual = page.must(page.$('#cal-actual'), 'actual');
    page.type(actual, '1.2.3');
    assert.match(errOf(page, actual), AMOUNT);
    assert.equal(invalid(actual), true);
    page.click(page.$('#cal-run'));
    assert.equal(page.doc.activeElement, actual);
    assert.equal(page.$('#cal-apply'), null, 'nothing to apply');
    assert.equal(page.state().workplaces[0].calib.length, 0);
    page.type(actual, '400');
    assert.equal(invalid(actual), false);
    page.click(page.$('#cal-run'));
    assert.ok(page.$('#cal-apply') || page.$('#cal-keep'), 'the comparison is shown');
  } finally {
    await page.close();
  }
});
