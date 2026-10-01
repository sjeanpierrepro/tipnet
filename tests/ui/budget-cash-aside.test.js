// Budget "Room to put aside" with mostly-cash nights, and a goal when the budget leaves nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { exampleBudget, possibleAside, roundDownStep } from '../../app/js/budget.js';
import { addDays, todayISO, periodIndex, periodRange } from '../../app/js/math.js';

const DEV = 'http://localhost/?unlock=dev';
/** The review repro: two finished pay periods x 10 nights, $300 made / $220 cash; rent $1,200, groceries $300 a month. */
const seed = ({ rent = 1200 } = {}) =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    const p = S.workplaces[0].profile;
    const now = periodIndex(p, todayISO());
    S.nights = [];
    [now - 2, now - 1].forEach((k) => {
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
    assert.match(t, /Typical take-home per pay period \(check \+ cash you keep\)/);
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

test('after payday counts the cash tips you will likely keep', async () => {
  const page = await boot({ url: DEV, seed: seed() });
  try {
    page.tab('budget');
    assert.match(page.text(), /Cash tips you’ll likely keep in that window \(estimated\)\+\$[\d,]+\.\d\d/);
  } finally {
    await page.close();
  }
});

test('nothing left to put aside: a goal can still be added at $0 a paycheck, and the form says why', async () => {
  const page = await boot({ url: DEV, seed: seed({ rent: 9000 }) });
  try {
    page.tab('budget');
    page.type(key(page, 'ef-goal-new-name'), 'Rainy day');
    page.type(key(page, 'ef-goal-new-cost'), '500');
    const t = page.text(goalForm(page));
    assert.match(t, /Your budget doesn’t leave anything to put aside/);
    assert.match(t, /You can still add this goal at \$0 a paycheck and save when you can/);
    assert.equal(key(page, 'ef-goal-new-slider').disabled, true, 'the slider stays capped');
    page.click(page.button('Add goal', goalForm(page)));
    const g = page.state().budget.goals.find((x) => x.name === 'Rainy day');
    assert.ok(g, 'goal saved at $0');
    assert.equal(g.perPaycheck, 0);
    assert.match(page.text(page.$('#toast')), /Saving when you can\./);
    assert.match(page.text(), /Saving when you can: no set amount a paycheck yet\./);
  } finally {
    await page.close();
  }
});
