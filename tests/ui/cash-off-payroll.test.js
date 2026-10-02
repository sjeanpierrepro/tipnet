import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { exampleProfile, addDays, todayISO } from '../../app/js/math.js';

const today = todayISO();
const seed = (mutate) =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    if (mutate) mutate(S);
  });
const key = (page, k) => page.must(page.$('[data-focus-key="' + k + '"]'), k);
const fill = (page, total, hours, cash) => {
  page.type(key(page, 'night-total'), total);
  page.type(key(page, 'night-pay-p1'), hours);
  if (cash !== undefined) page.type(key(page, 'night-cash'), cash);
};
const heroNum = (page) => Number(page.$('.result .hero').textContent.replace(/[^0-9.]/g, ''));
const wrap = (cb) => cb.closest('div.stack-sm');

test('tonight: the cash box shows only once cash is typed; ticking it raises take-home and shows the set-aside', async () => {
  const page = await boot({ seed: seed() });
  try {
    const cb = key(page, 'night-cashoff');
    assert.equal(wrap(cb).hidden, true, 'hidden until cash is entered');
    fill(page, '585', '8');
    assert.doesNotMatch(page.text(), /Set aside about/);
    page.type(key(page, 'night-cash'), '210');
    assert.equal(wrap(cb).hidden, false);
    assert.equal(cb.checked, false);
    assert.equal(
      page.$('label[for="' + cb.id + '"]').textContent,
      'Cash tips weren’t run through payroll tonight',
    );
    assert.match(
      page.text(),
      /Tick this if no tax was taken out of tonight’s cash, so your check is bigger\./,
    );
    const before = heroNum(page);
    cb.checked = true;
    page.change(cb);
    assert.ok(heroNum(page) > before, 'take-home rises');
    assert.match(page.text(), /Set aside about \$22\.75 for taxes on tonight’s cash \(estimate\)\./);
    page.click(page.button('Save night'));
    assert.equal(page.state().nights[0].cashOffPayroll, true);
  } finally {
    await page.close();
  }
});

test('tonight: the restaurant default pre-ticks the box; Setup saves the default', async () => {
  const page = await boot({ seed: seed((S) => (S.workplaces[0].profile.cashOffPayroll = true)) });
  try {
    fill(page, '585', '8', '210');
    assert.equal(key(page, 'night-cashoff').checked, true);
    page.openSetup();
    const box = page.must(page.$('#cash-off-payroll'), 'setup box');
    assert.equal(box.checked, true);
    assert.match(page.text(), /Cash tips here usually aren’t run through payroll/);
    box.checked = false;
    page.change(box);
    await page.settle();
    assert.equal(page.state().workplaces[0].profile.cashOffPayroll, true, 'a draft until Save');
    await page.saveSetup();
    assert.equal(page.state().workplaces[0].profile.cashOffPayroll, false);
    page.tab('tonight');
    fill(page, '585', '8', '210');
    assert.equal(key(page, 'night-cashoff').checked, false, 'untouched tonight follows the new default');
  } finally {
    await page.close();
  }
});

test('tonight: each restaurant has its own default and keeps its own tick', async () => {
  const page = await boot({
    seed: seed((S) => {
      const p = exampleProfile(today);
      p.periodStart = addDays(today, -3);
      S.workplaces[0].profile.cashOffPayroll = true;
      S.workplaces.push({ id: 'w2', name: 'Second Spot', profile: p, calib: [], setupDone: true });
    }),
  });
  try {
    const radios = () => page.$$('[role=radio]', page.app);
    fill(page, '300', '6', '80');
    assert.equal(key(page, 'night-cashoff').checked, true);
    page.click(radios()[1]);
    fill(page, '300', '6', '80');
    assert.equal(key(page, 'night-cashoff').checked, false, 'second restaurant default is off');
    const cb2 = key(page, 'night-cashoff');
    cb2.checked = true;
    page.change(cb2);
    page.click(radios()[0]);
    assert.equal(key(page, 'night-cashoff').checked, true);
    page.click(radios()[1]);
    assert.equal(key(page, 'night-cashoff').checked, true, 'its own tick is kept');
  } finally {
    await page.close();
  }
});

test('pay periods: a night is marked and the period shows the taxes to set aside', async () => {
  const page = await boot({
    seed: seed((S) => {
      S.workplaces[0].profile.periodStart = addDays(today, -3);
      S.nights = [
        { id: 1, date: today, total: 585, cash: 210, pay: { p1: 8 }, barback: true, cashOffPayroll: true },
      ];
    }),
  });
  try {
    page.tab('periods');
    assert.match(page.text(), /cash off payroll/);
    assert.match(page.text(), /Taxes to set aside on cash \(estimate\): \$22\.75/);
  } finally {
    await page.close();
  }
});
