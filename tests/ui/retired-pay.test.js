// Sixth review: removing a job in Setup wiped the pay already logged for it in the running pay period ($285.72 became
// $210.71 with no warning), and adding it back made a new id, so those hours never counted again. Now a pay type a saved
// night has an amount for is retired: gone from Setup's list, Tonight's pickers and new nights, kept for the money of
// the nights that used it. Adding a job back with the same name brings back the same one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { todayISO, addDays, computeNight, shiftsPerPeriod } from '../../app/js/math.js';

const seedWith = (pay = { bar: 5, tr: 6, pr: 0 }) =>
  realState((S) => {
    const today = todayISO();
    S.workplaces[0].setupDone = true;
    const p = S.workplaces[0].profile;
    p.periodStart = addDays(today, -3);
    p.periodEnd = addDays(today, 10);
    p.freq = 14;
    p.tipout = { on: false };
    p.tipouts = [];
    p.payTypes = [
      { id: 'bar', k: 'bartender', name: 'Bartender', unit: 'hr', rate: 12, usual: 0 },
      { id: 'tr', k: 'training', name: 'Training', unit: 'hr', rate: 15, usual: 0 },
      { id: 'pr', k: 'prep', name: 'Prep', unit: 'hr', rate: 10, usual: 0 },
    ];
    // $150 CC + $50 cash, Bartender 5 h, Training 6 h
    S.nights = [
      {
        id: 'n1',
        date: addDays(today, -1),
        tips: 200,
        cash: 50,
        total: 200 + 5 * 12 + num(pay.tr) * 15,
        pay,
        barback: false,
        tipouts: {},
        tipoutOn: false,
        workplaceId: S.workplaces[0].id,
      },
    ];
  });
const num = (v) => Number(v) || 0;
const netOf = (page) => {
  const S = page.state();
  const p = S.workplaces[0].profile;
  return computeNight(S.nights[0], p, shiftsPerPeriod(p, S.nights).n).net;
};
const undoButton = (page) => page.$$('#toast button').find((b) => b.textContent === 'Undo') || null;
const pick = (page, sel, v) => {
  sel.value = v;
  page.change(sel);
};

test('removing a job a running-period night used keeps that night’s money; the job is gone from Setup and Tonight', async () => {
  const page = await boot({ seed: seedWith() });
  try {
    assert.equal(netOf(page), 285.72);
    page.openSetup();
    page.click(page.byLabel('Remove Training'));
    await page.saveSetup();
    assert.equal(netOf(page), 285.72, 'the night keeps its Training pay');
    const types = page.state().workplaces[0].profile.payTypes;
    assert.deepEqual(
      types.map((t) => [t.id, !!t.retired]),
      [
        ['bar', false],
        ['tr', true],
        ['pr', false],
      ],
    );
    // Setup no longer lists it
    page.openSetup();
    assert.equal(
      page.$$('button').some((b) => b.getAttribute('aria-label') === 'Remove Training'),
      false,
    );
    assert.ok(page.byLabel('Remove Prep'));
    // Tonight: not a job to pick
    page.tab('tonight');
    await page.settle();
    const sel = page.$('[data-focus-key="night-job-0"]');
    const names = Array.from(sel.querySelectorAll('option')).map((o) => o.textContent);
    assert.deepEqual(names, ['Bartender', 'Prep']);
    // Pay periods: the night still lists its Training hours
    page.tab('periods');
    await page.settle();
    assert.match(page.text(), /Bartender 5 h · Training 6 h · made \$350\.00/);
    // the night editor shows them, and an unchanged save keeps the money
    const { fmtDate } = await import('../../app/js/ui/common.js');
    page.click(page.byLabel('Edit night ' + fmtDate(page.state().nights[0].date)));
    const k = (x) => page.must(page.$('[data-focus-key="edit-n1-' + x + '"]'), x);
    assert.equal(k('job-1').value, 'tr');
    assert.equal(k('pay-tr').value, '6');
    const before = JSON.stringify(page.state().nights[0]);
    page.click(page.button('Save changes'));
    await page.settle();
    assert.equal(JSON.stringify(page.state().nights[0]), before, 'unchanged round trip');
    assert.equal(netOf(page), 285.72);
    // a new night on Tonight doesn't store the retired job
    page.tab('tonight');
    await page.settle();
    page.type(page.$('[data-focus-key="night-cc"]'), '100');
    page.type(page.$('[data-focus-key="night-cash"]'), '0');
    page.type(page.$('[data-focus-key="night-pay-bar"]'), '4');
    page.click(page.$('form button[type=submit]'));
    await page.settle();
    const added = page.state().nights.find((n) => n.id !== 'n1');
    assert.ok(added, 'saved');
    assert.equal('tr' in added.pay, false);
  } finally {
    await page.close();
  }
});

test('a pay type no saved night has an amount for is deleted as before; Undo before Save keeps the job', async () => {
  const page = await boot({ seed: seedWith() });
  try {
    page.openSetup();
    page.click(page.byLabel('Remove Prep'));
    await page.saveSetup();
    assert.deepEqual(
      page.state().workplaces[0].profile.payTypes.map((t) => t.id),
      ['bar', 'tr'],
    );
    page.openSetup();
    page.click(page.byLabel('Remove Training'));
    page.click(page.must(undoButton(page), 'Undo'));
    await page.settle();
    assert.ok(page.byLabel('Remove Training'), 'back in the list');
    page.click(page.byLabel('Remove Training'));
    page.click(page.must(undoButton(page), 'Undo'));
    const t = page.$('#pr-tr');
    page.type(t, '16');
    await page.saveSetup();
    const tr = page.state().workplaces[0].profile.payTypes.find((x) => x.id === 'tr');
    assert.equal(tr.retired, undefined);
    assert.equal(tr.rate, 16);
  } finally {
    await page.close();
  }
});

test('adding the job back (same name) brings back the same one: its nights count again at the current rate', async () => {
  const page = await boot({ seed: seedWith() });
  try {
    page.openSetup();
    page.click(page.byLabel('Remove Training'));
    await page.saveSetup();
    page.openSetup();
    page.click(page.button('+ Add a job'));
    const js = page
      .$$('select[id^="pk-"]', page.app)
      .filter((s) => s.querySelector('option[value="bartender"]'));
    const s = js[js.length - 1];
    pick(page, s, 'training');
    page.type(page.$('#pr-' + s.id.slice(3)), '16');
    await page.saveSetup();
    const types = page.state().workplaces[0].profile.payTypes;
    assert.deepEqual(
      types.map((t) => [t.id, t.rate, !!t.retired]),
      [
        ['bar', 12, false],
        ['tr', 16, false],
        ['pr', 10, false],
      ],
    );
    // the night follows Setup (running period): Training 6 h at $16
    const S = page.state();
    const p = S.workplaces[0].profile;
    assert.equal(computeNight(S.nights[0], p, 10).total, 200 + 60 + 96);
  } finally {
    await page.close();
  }
});
