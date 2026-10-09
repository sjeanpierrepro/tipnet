// Every money box refuses typos like 1.2.3 (never read as 1.2): a plain message by the box, nothing stored, and the
// same text fixed is accepted. Tonight, the night editor and the accuracy check here; Setup and Budget below.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { businessDate } from '../../app/js/inputs.js';
import { addDays, todayISO } from '../../app/js/math.js';

const AMOUNT = /That isn’t an amount\. Use numbers and one decimal point, like 12\.50\./;
const today = () => businessDate(new Date(), 6);
/** Type into a box and leave it (as tabbing on does): a typo's message shows once the box is left. */
const typeOut = (page, input, value) => {
  page.type(input, value);
  page.leave(input);
};
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
  { id: 't2', k: 'runner', who: 'Runner', mode: 'flat', value: 12.5, from: 'payroll' },
];
const tonightSeed = () =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    S.workplaces[0].profile.tipout = { on: true };
    S.workplaces[0].profile.tipouts = tipouts.map((x) => ({ ...x }));
    S.workplaces[0].profile.payTypes[0].unit = 'hr';
  });

test('Tonight: a typo in the CC tips, hours or cash box blocks Save, shows a message, and is never stored', async () => {
  const page = await boot({ seed: tonightSeed() });
  try {
    const total = key(page, 'night-cc');
    const hours = key(page, 'night-pay-p1');
    const cash = key(page, 'night-cash');
    typeOut(page, hours, '7');
    // total
    for (const bad of ['1.2.3', '12abc', '1,2,3', '$', '1..2']) {
      typeOut(page, total, bad);
      assert.match(errOf(page, total), AMOUNT, bad);
      assert.equal(invalid(total), true, bad);
      assert.match(
        page.$('.result').textContent,
        /Fix the number marked above/,
        'no numbers from a typo: ' + bad,
      );
      assert.doesNotMatch(page.$('.result').textContent, /\$/, bad);
      submit(page);
      assert.equal(page.state().nights.length, 0, bad + ' is not saved');
      assert.equal(page.doc.activeElement, total, 'focus goes to the box');
    }
    typeOut(page, total, '1,250.50');
    assert.equal(errOf(page, total), '');
    assert.equal(invalid(total), false);
    assert.match(page.$('.result').textContent, /of which tips\$1,250\.50/);
    assert.match(page.$('.result').textContent, /Made tonight\$1,334\.50/); // + 7 hours at $12
    // cash
    typeOut(page, cash, '1.2.3');
    assert.match(page.text(), AMOUNT);
    assert.equal(invalid(cash), true);
    submit(page);
    assert.equal(page.state().nights.length, 0);
    assert.equal(page.doc.activeElement, cash);
    typeOut(page, cash, '40');
    assert.equal(invalid(cash), false);
    // hours
    for (const bad of ['1.2.3', '7..5', '7:3:3:3', '7h abc']) {
      typeOut(page, hours, bad);
      assert.match(page.text(), /Hours should be a number, like 6 or 7:30\./, bad);
      // the hours box is not an amount: the result names a number
      assert.match(page.$('.result').textContent, /Fix the number marked above to see your take-home\./, bad);
      submit(page);
      assert.equal(page.state().nights.length, 0, bad);
      assert.equal(page.doc.activeElement, hours);
      // the box itself is marked for screen readers and linked to the message
      const live = key(page, 'night-pay-p1');
      assert.equal(invalid(live), true, bad);
      const ids = (live.getAttribute('aria-describedby') || '').split(' ');
      assert.ok(
        ids.some((id) => /Hours should be a number/.test(page.doc.getElementById(id)?.textContent || '')),
        bad,
      );
    }
    typeOut(page, hours, '7:30');
    assert.equal(invalid(key(page, 'night-pay-p1')), false, 'fixed: no longer marked');
    submit(page);
    const n = page.state().nights;
    assert.equal(n.length, 1);
    assert.equal(n[0].tips, 1290.5);
    assert.equal(n[0].total, 1380.5);
    assert.equal(n[0].cash, 40);
    assert.equal(n[0].pay.p1, 7.5);
  } finally {
    await page.close();
  }
});

test('Tonight: the CC tips box refuses a typo, and so does an amount in Other pay', async () => {
  const page = await boot({
    seed: realState((S) => {
      S.workplaces[0].setupDone = true;
      S.workplaces[0].profile.tipout.on = false;
      S.workplaces[0].profile.payTypes.push({ id: 'bonus', k: 'bonus', name: 'Bonus', unit: 'amt', rate: 0 });
    }),
  });
  try {
    const total = key(page, 'night-cc');
    typeOut(page, key(page, 'night-pay-p1'), '6');
    typeOut(page, total, '1.2.3');
    assert.match(errOf(page, total), AMOUNT);
    submit(page);
    assert.equal(page.state().nights.length, 0);
    typeOut(page, total, '350');
    page.click(page.button('+ Add other pay'));
    const bonus = key(page, 'night-pay-bonus');
    typeOut(page, bonus, '5.5.5');
    assert.match(page.text(), /Bonus: That isn’t an amount\./);
    submit(page);
    assert.equal(page.state().nights.length, 0);
    assert.equal(page.doc.activeElement, bonus);
    typeOut(page, bonus, '25');
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
    const total = key(page, 'edit-1-cc');
    const cash = key(page, 'edit-1-cash');
    const hours = key(page, 'edit-1-pay-p1');
    typeOut(page, total, '1.2.3');
    assert.match(errOf(page, total), AMOUNT);
    assert.match(page.text(), /Fix the number marked above to see the estimate\./);
    page.click(page.button('Save changes'));
    assert.equal(page.state().nights[0].total, 300, 'not stored');
    assert.equal(page.doc.activeElement, total);
    typeOut(page, total, '320');
    typeOut(page, cash, '5,0,0');
    assert.equal(invalid(cash), true);
    page.click(page.button('Save changes'));
    assert.equal(page.state().nights[0].cash, 50, 'not stored');
    assert.equal(page.doc.activeElement, cash);
    typeOut(page, cash, '60');
    typeOut(page, hours, '6..5');
    page.click(page.button('Save changes'));
    assert.match(page.text(), /Hours should be a number/);
    assert.equal(page.state().nights[0].pay.p1, 6);
    typeOut(page, hours, '6.5');
    page.click(page.button('Save changes'));
    const n = page.state().nights[0];
    // $320 CC + $60 cash, 6.5 hours at $12
    assert.deepEqual([n.tips, n.total, n.cash, n.pay.p1], [380, 458, 60, 6.5]);
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
    typeOut(page, actual, '1.2.3');
    assert.match(errOf(page, actual), AMOUNT);
    assert.equal(invalid(actual), true);
    page.click(page.$('#cal-run'));
    assert.equal(page.doc.activeElement, actual);
    assert.equal(page.$('#cal-apply'), null, 'nothing to apply');
    assert.equal(page.state().workplaces[0].calib.length, 0);
    typeOut(page, actual, '400');
    assert.equal(invalid(actual), false);
    page.click(page.$('#cal-run'));
    assert.ok(page.$('#cal-apply') || page.$('#cal-keep'), 'the comparison is shown');
  } finally {
    await page.close();
  }
});

/* ---------- Setup ---------- */
const byId = (page, id) => page.must(page.$('#' + id), id);
const reasons = (page) => page.text(page.must(page.$('#draft-reasons'), 'reasons'));

test('guided setup: a typo in gross pay, a deduction, the main rate or a tip-out stops Next/Finish and is never stored', async () => {
  const page = await boot();
  try {
    page.tab('setup');
    typeOut(page, page.$$('input[type=date]', page.app)[0], '2026-09-01');
    const gross = page.$('input[placeholder="e.g. 2,000"]', page.app);
    // step 1: gross pay
    typeOut(page, gross, '1.2.3');
    assert.match(errOf(page, gross), AMOUNT);
    assert.equal(invalid(gross), true);
    page.click(page.button('Next'));
    assert.match(page.text(), /1\. Pay period and gross/, 'still on step 1');
    assert.equal(page.doc.activeElement, gross);
    assert.notEqual((page.state().settings.guidedDraft.profile || {}).gross, 1.2, 'not stored as 1.2');
    typeOut(page, gross, '1,500');
    assert.equal(invalid(gross), false);
    page.click(page.button('Next'));
    assert.equal(page.state().settings.guidedDraft.profile.gross, 1500);
    // step 2: a deduction
    const ded = page.must(page.$('input[id^="da-"]'), 'deduction');
    typeOut(page, ded, '12abc');
    assert.match(errOf(page, ded), AMOUNT);
    page.click(page.button('Next'));
    assert.match(page.text(), /Deductions/);
    assert.equal(page.doc.activeElement, ded);
    assert.ok(
      page.state().settings.guidedDraft.profile.deductions.every((d) => d.amount !== 12),
      'not stored as 12',
    );
    typeOut(page, ded, '150,5');
    assert.equal(invalid(ded), false);
    page.click(page.button('Next'));
    // step 3: the main rate, then a tip-out
    const rate = byId(page, 'pr-p1');
    typeOut(page, rate, '12.5.0');
    assert.match(errOf(page, rate), AMOUNT);
    page.click(page.button('Finish setup'));
    assert.equal(page.state().workplaces[0].setupDone, undefined, 'not finished');
    assert.equal(page.doc.activeElement, rate);
    typeOut(page, rate, '12.50');
    page.click(byId(page, 'to-on'));
    const tv = page.must(page.$('input[id^="tv-"]'), 'tip-out amount');
    typeOut(page, tv, '1.2.3');
    assert.match(errOf(page, tv), /That isn’t a percent\./);
    page.click(page.button('Finish setup'));
    assert.notEqual(page.state().workplaces[0].setupDone, true, 'not finished');
    typeOut(page, tv, '15');
    page.click(page.button('Finish setup'));
    const w = page.state().workplaces[0];
    assert.equal(w.setupDone, true);
    assert.equal(w.profile.payTypes[0].rate, 12.5);
    assert.equal(w.profile.tipouts[0].value, 15);
    assert.equal(w.profile.deductions[0].amount, 150.5);
  } finally {
    await page.close();
  }
});

test('Setup draft: typos in gross, a deduction, a job rate and a tip-out amount disable Save, say why, and are never applied', async () => {
  const page = await boot({
    seed: realState((S) => {
      const p = S.workplaces[0].profile;
      S.workplaces[0].setupDone = true;
      p.gross = 2000;
      p.deductions = [{ id: 'd1', k: 'other', name: 'Health', amount: 100, mode: 'fixed' }];
      p.tipout = { on: true };
      p.tipouts = [{ id: 't1', k: 'barback', who: 'Barback', mode: 'pctTips', value: 15, from: 'cash' }];
    }),
  });
  try {
    page.openSetup();
    const gross = page.byText('.field', 'Gross pay', page.app).querySelector('input');
    const boxes = [
      [gross, 'Gross pay'],
      [byId(page, 'da-d1'), 'Amount this check'],
      [byId(page, 'pr-p1'), 'Rate'],
      [byId(page, 'tv-t1'), 'Percent of tips'],
    ];
    const good = boxes.map(([i]) => i.value);
    for (const [input, label] of boxes) {
      const was = input.value;
      typeOut(page, input, '1.2.3');
      assert.match(
        errOf(page, input),
        label === 'Percent of tips' ? /That isn’t a percent\./ : AMOUNT,
        label,
      );
      assert.equal(invalid(input), true, label);
      assert.equal(byId(page, 'draft-save').disabled, true, label + ': Save is off');
      // the Save bar says it in the box's own words
      assert.match(
        reasons(page),
        label === 'Percent of tips'
          ? /Fix “Percent of tips”: that isn’t a percent\./
          : new RegExp('Fix “' + label + '[^”]*”: that isn’t an amount\\.'),
        label,
      );
      assert.match(page.text(page.$('.save-bar')), /You have changes that aren’t saved yet\./, label);
      typeOut(page, input, was);
      assert.equal(invalid(input), false, label + ' fixed');
    }
    // after all that, the draft still holds the last good numbers and saves unchanged
    boxes.forEach(([i], k) => assert.equal(i.value, good[k]));
    // a typo left in a box next to a good change: Save stays off and nothing is applied
    typeOut(page, gross, '2,100');
    typeOut(page, boxes[1][0], '1,2,3');
    page.click(byId(page, 'draft-save'));
    const w = () => page.state().workplaces[0].profile;
    assert.equal(w().gross, 2000, 'nothing saved');
    assert.equal(w().deductions[0].amount, 100);
    assert.equal(byId(page, 'draft-save').disabled, true);
    typeOut(page, boxes[1][0], '125.50');
    await page.saveSetup();
    assert.equal(w().gross, 2100);
    assert.equal(w().deductions[0].amount, 125.5);
  } finally {
    await page.close();
  }
});

test('Setup draft: the shifts box and a non-taxable amount refuse typos too', async () => {
  const page = await boot({
    seed: realState((S) => {
      S.workplaces[0].setupDone = true;
      S.workplaces[0].profile.nontaxable = [
        { id: 'x1', k: 'other', name: 'Mileage', amount: 20, recurring: true },
      ];
    }),
  });
  try {
    page.openSetup();
    const shifts = page.byText('.field', 'Shifts you worked', page.app).querySelector('input');
    typeOut(page, shifts, '5.5.5');
    assert.match(errOf(page, shifts), /That isn’t a number of shifts\./);
    assert.equal(byId(page, 'draft-save').disabled, true);
    typeOut(page, shifts, '5');
    assert.equal(invalid(shifts), false);
    const nt = byId(page, 'na-x1');
    typeOut(page, nt, '2o');
    assert.match(errOf(page, nt), AMOUNT);
    assert.equal(byId(page, 'draft-save').disabled, true);
    typeOut(page, nt, '25');
    assert.equal(invalid(nt), false);
    await page.saveSetup();
    const p = page.state().workplaces[0].profile;
    assert.equal(p.shifts, 5);
    assert.equal(p.nontaxable[0].amount, 25);
  } finally {
    await page.close();
  }
});
