// A "% of sales" tip-out on a night with no sales counts $0: every screen says so instead of leaving it out silently
// (Tonight's result card, Pay periods rows and the night editor, and Setup when someone is
// switched to "% of sales" while saved nights have no sales).
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { addDays, computeNight } from '../../app/js/math.js';

const BARBACK = { id: 't1', k: 'barback', who: 'Barback', mode: 'pctTips', value: 15, from: 'cash' };
const RUNNER = { id: 't2', k: 'runner', who: 'Runner', mode: 'pctSales', value: 1.25, from: 'payroll' };
const seed = (list = [BARBACK, RUNNER], mutate) =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    S.workplaces[0].profile.tipout = { on: true, basis: 'before' };
    S.workplaces[0].profile.tipouts = list.map((x) => ({ ...x }));
    if (mutate) mutate(S);
  });
const key = (page, k) => page.must(page.$('[data-focus-key="' + k + '"]'), k);
const NEEDS = 'Runner (1.25% of sales): enter tonight’s sales to count it.';

test('Tonight: a ticked % of sales person with no sales yet gets a line saying to enter the sales', async () => {
  const page = await boot({ seed: seed() });
  try {
    page.type(key(page, 'night-total'), '585');
    page.type(key(page, 'night-pay-p1'), '8');
    page.type(key(page, 'night-cash'), '210');
    const result = () => page.text(page.$('.result', page.app));
    assert.ok(result().includes(NEEDS), result());
    page.type(key(page, 'night-sales'), '1000');
    assert.ok(!result().includes(NEEDS));
    assert.match(result(), /Runner \(1\.25% of sales\)−\$12\.50/);
    // unticked: nothing to say
    page.type(key(page, 'night-sales'), '');
    const rn = key(page, 'night-tipout-t2');
    rn.checked = false;
    page.change(rn);
    assert.ok(!result().includes(NEEDS));
  } finally {
    await page.close();
  }
});

test('Pay periods: a night without sales says who isn’t counted; the editor asks for the sales', async () => {
  const page = await boot({
    seed: seed(undefined, (S) => {
      const p = S.workplaces[0].profile;
      const n = (id, extra) => ({
        id,
        date: addDays(p.periodStart, 6), // the running pay period
        total: 585,
        cash: 210,
        pay: { p1: 8 },
        barback: true,
        workplaceId: 'w1',
        ...extra,
      });
      S.nights = [
        n('n1', { tipouts: { t1: true, t2: true } }),
        n('n2', { tipouts: { t1: true, t2: true }, sales: 800 }),
      ];
      S.nights[1].date = addDays(p.periodStart, 5);
    }),
  });
  try {
    page.tab('periods');
    const row = (id) =>
      page.must(page.$('[data-focus-key="edit-' + id + '-total"]', page.app), id).closest('li');
    assert.match(page.text(row('n1')), /sales missing: Runner not counted/);
    assert.doesNotMatch(page.text(row('n2')), /sales missing/);
    page.click(page.must(page.$('[data-focus-key="edit-n1-total"]', page.app), 'Edit'));
    const sales = key(page, 'edit-n1-sales');
    assert.equal(sales.closest('.field').hidden, false, 'the sales box is shown');
    assert.match(page.text(), /Runner \(1\.25% of sales\) isn’t counted until you enter the night’s sales\./);
    page.click(page.button('Save changes'));
    assert.match(page.text(), /Enter that night’s sales for the % of sales tip-out\./);
    assert.equal(page.doc.activeElement, sales);
    assert.equal(page.state().nights[0].sales, undefined, 'nothing saved');
    page.type(sales, '1000');
    page.click(page.button('Save changes'));
    const n1 = page.state().nights.find((x) => x.id === 'n1');
    assert.equal(n1.sales, 1000);
    assert.doesNotMatch(page.text(row('n1')), /sales missing/);
    assert.deepEqual(
      computeNight(n1, page.state().workplaces[0].profile, 10).tipouts.map((l) => [l.who, l.amount]),
      [
        ['Barback', 73.35],
        ['Runner', 12.5],
      ],
    );
  } finally {
    await page.close();
  }
});

/* ---------- Setup ---------- */
test('Setup: switching someone to % of sales says which saved nights without sales count $0 for them', async () => {
  const runnerTips = { ...RUNNER, mode: 'pctTips', value: 3 };
  const page = await boot({
    seed: seed([BARBACK, runnerTips], (S) => {
      const p = S.workplaces[0].profile;
      const n = (id, extra) => ({
        id,
        date: addDays(p.periodStart, 3),
        total: 496,
        cash: 200,
        pay: { p1: 8 },
        barback: true,
        workplaceId: 'w1',
        ...extra,
      });
      S.nights = [
        n('a', { tipouts: { t1: true, t2: true } }), // no sales, runner ticked: counts $0 once switched
        n('b', { tipouts: { t1: true, t2: true }, sales: 900, date: addDays(p.periodStart, 4) }),
        n('c', { tipouts: { t1: true, t2: false }, date: addDays(p.periodStart, 5) }),
        // a finished pay period: locked, never changed by Setup
        n('d', { tipouts: { t1: true, t2: true }, date: addDays(p.periodStart, -3) }),
      ];
    }),
  });
  try {
    page.openSetup();
    const hint = () => page.$('#tsh-t2');
    assert.ok(!hint() || hint().hidden, 'nothing to say while it is a % of tips');
    const mode = page.$('#tm-t2');
    mode.value = 'pctSales';
    page.change(mode);
    assert.equal(hint().hidden, false);
    assert.equal(
      hint().textContent,
      '1 saved night without sales counts $0 for Runner until you add its sales in Pay periods.',
    );
    assert.ok(
      mode.getAttribute('aria-describedby').split(' ').includes('tsh-t2'),
      'read with the How choice',
    );
    // and the barback (a % of tips) has none
    assert.ok(!page.$('#tsh-t1') || page.$('#tsh-t1').hidden);
    mode.value = 'pctTips';
    page.change(mode);
    assert.equal(hint().hidden, true);
  } finally {
    await page.close();
  }
});
