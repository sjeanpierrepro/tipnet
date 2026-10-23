// Budget "Room to put aside" with mostly-cash nights, and a goal when the logged pay does not cover the bills yet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { exampleBudget, possibleAside, roundDownStep } from '../../app/js/budget.js';
import { addDays, todayISO, periodIndex, periodRange } from '../../app/js/math.js';

const DEV = 'http://localhost/?unlock=dev';
/** The review repro: this and the last pay period x 10 nights, $300 made / $220 cash; rent $1,200, groceries $300 a month. */
const seed = ({ rent = 1200 } = {}) =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    const p = S.workplaces[0].profile;
    const now = periodIndex(p, todayISO());
    S.nights = [];
    [now - 1, now].forEach((k) => {
      const r = periodRange(p, k);
      for (let i = 0; i < 10; i++)
        S.nights.push({
          id: 'n' + k + '-' + i,
          date: addDays(r.start, i),
          total: 300,
          cash: 220,
          pay: {},
          barback: false,
          workplaceId: S.workplaces[0].id,
        });
    });
    S.budget = exampleBudget();
    S.budget.bills = [{ id: 'b1', name: 'Rent', amount: rent, dueDay: 1, since: addDays(todayISO(), -60) }];
    S.budget.categories = [{ id: 'c1', name: 'Groceries', monthly: 300 }];
    S.budget.goals = [];
    S.budget.balance = { amount: 2000, asOf: new Date().toISOString() };
  });
const key = (page, k) => page.must(page.$('[data-focus-key="' + k + '"]'), k);
const goalForm = (page) => page.must(page.$('form[aria-label="Add a savings goal"]'), 'goal form');

test('mostly-cash nights: there is room to put aside, labelled as check + cash, and a goal can be added', async () => {
  const page = await boot({ url: DEV, seed: seed() });
  try {
    page.tab('budget');
    page.type(key(page, 'ef-goal-new-name'), 'Car');
    page.type(key(page, 'ef-goal-new-cost'), '5000');
    const S = page.state();
    const pa = possibleAside(S.budget, S.workplaces[0].profile, S.nights, todayISO());
    assert.ok(pa.possible > 1500, 'about $1,750 a pay period, not $0: ' + pa.possible);
    const max = roundDownStep(pa.possible);
    const t = page.text(goalForm(page));
    assert.match(t, /Up to \$1,7\d\d a paycheck is safe to put aside/);
    assert.match(t, /Take-home logged this pay period \(check \+ cash you keep\)/);
    assert.match(t, /Cash you keep/);
    assert.equal(key(page, 'ef-goal-new-slider').disabled, false);
    assert.equal(Number(key(page, 'ef-goal-new-slider').max), max);
    page.click(page.button('Add goal', goalForm(page)));
    const g = page.state().budget.goals.find((x) => x.name === 'Car');
    assert.ok(g, 'goal saved');
    assert.equal(g.perPaycheck, max);
  } finally {
    await page.close();
  }
});

test('after payday counts only the check from the logged nights, no future cash', async () => {
  const page = await boot({ url: DEV, seed: seed() });
  try {
    page.tab('budget');
    const after = page.text(page.byText('section', 'After payday ('));
    assert.match(after, /Check from your logged nights\$[\d,]+\.\d\d/);
    assert.doesNotMatch(after, /likely|expect|typical|projected/i);
    assert.doesNotMatch(after, /Cash tips/);
    assert.match(after, /from \d+ nights? logged so far/);
  } finally {
    await page.close();
  }
});

test('logged pay that does not cover the bills yet: no slider, the amount is typed with no cap, and Budget shows the true result', async () => {
  const page = await boot({ url: DEV, seed: seed({ rent: 9000 }) });
  try {
    page.tab('budget');
    page.type(key(page, 'ef-goal-new-name'), 'Rainy day');
    page.type(key(page, 'ef-goal-new-cost'), '5000');
    const S = page.state();
    assert.equal(possibleAside(S.budget, S.workplaces[0].profile, S.nights, todayISO()).possible, 0);
    const t = page.text(goalForm(page));
    assert.match(
      t,
      /Your logged pay so far doesn’t cover this pay period’s bills, spending and other goals yet, so TipNet can’t suggest an amount\. Type the amount you want to put aside\./,
    );
    assert.doesNotMatch(t, /Your budget doesn’t leave anything/);
    assert.ok(key(page, 'ef-goal-new-slider').closest('[hidden]'), 'no slider');
    assert.equal(key(page, 'ef-goal-new-per').disabled, false);
    page.type(key(page, 'ef-goal-new-per'), '300');
    assert.equal(key(page, 'ef-goal-new-per').value, '300', 'not capped');
    assert.match(page.text(goalForm(page)), /\$300 a paycheck → about 17 paychecks/);
    page.click(page.button('Add goal', goalForm(page)));
    const g = page.state().budget.goals.find((x) => x.name === 'Rainy day');
    assert.ok(g, 'goal saved');
    assert.equal(g.perPaycheck, 300, 'saved as typed, not clamped to the room');
    // Budget shows what is stored: the full $300 comes out after payday, and what is left can be below zero
    const after = page.text(page.byText('section', 'After payday ('));
    assert.match(after, /Savings goals−\$300\.00/);
    assert.match(after, /What is left−\$/);
  } finally {
    await page.close();
  }
});
