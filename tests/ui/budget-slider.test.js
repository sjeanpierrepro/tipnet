import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import {
  exampleBudget,
  possibleAside,
  roundDownStep,
  roundUpStep,
  purchasePlan,
} from '../../app/js/budget.js';
import { addDays, todayISO } from '../../app/js/math.js';

const DEV = 'http://localhost/?unlock=dev';
// Eight nights over the last 20 days, every one with its cash entered, so TipNet can tell what a typical check is.
const nightsList = () =>
  [1, 3, 5, 7, 10, 13, 16, 19].map((ago, i) => ({
    id: i + 1,
    date: addDays(todayISO(), -ago),
    total: 400,
    cash: 120,
    pay: { p1: 6 },
    barback: false,
  }));
const seed = ({ nights = true, goals = [], categories = [], bills = [] } = {}) =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    S.budget = exampleBudget();
    S.budget.bills = bills;
    S.budget.categories = categories;
    S.budget.goals = goals;
    S.budget.balance = { amount: 2000, asOf: new Date().toISOString() };
    if (nights) S.nights = nightsList();
  });
const key = (page, k) => page.must(page.$('[data-focus-key="' + k + '"]'), k);
const planForm = (page) => page.must(page.$('form[aria-label="Plan a big purchase"]'), 'plan form');
const fill = (page, k, v) => page.type(key(page, k), v);
const slide = (page, k, v) => {
  const r = key(page, k);
  r.value = String(v);
  r.dispatchEvent(new page.win.Event('input', { bubbles: true }));
};
const possibleOf = (page) => {
  const S = page.state();
  return possibleAside(S.budget, S.workplaces[0].profile, S.nights, todayISO());
};
const CAP = /That’s the most your budget leaves each paycheck\. Lower spending or other goals to save more\./;

test('slider: it only goes as high as the budget leaves, and says so', async () => {
  const page = await boot({ url: DEV, seed: seed() });
  try {
    page.tab('budget');
    fill(page, 'ef-plan-new-name', 'New phone');
    fill(page, 'ef-plan-new-cost', '5000');
    const pa = possibleOf(page);
    assert.equal(pa.known, true, 'the seeded nights give a typical check');
    const max = roundDownStep(pa.possible);
    assert.ok(max > 300 && max < 5000, 'this seed leaves room, but less than the whole cost');
    const t = page.text(planForm(page));
    assert.ok(
      t.includes(
        'Up to $' +
          max.toLocaleString('en-US') +
          ' a paycheck is safe to put aside — that’s what your budget leaves after bills, spending and your other goals.',
      ),
    );
    assert.match(t, /How we worked this out/);
    const slider = key(page, 'ef-plan-new-slider');
    assert.equal(slider.type, 'range');
    assert.equal(slider.step, '5');
    assert.equal(slider.min, '0');
    assert.equal(Number(slider.max), max, 'the top end is what is possible, rounded down to $5');
    // It starts at the most that is safe (finishing in one paycheck would take more).
    assert.equal(Number(slider.value), max);
    assert.equal(key(page, 'ef-plan-new-per').value, String(max));
    // The slider has a real label.
    const lab = page.$('label[for="' + slider.id + '"]');
    assert.ok(lab, 'label linked to the slider');
    assert.match(lab.textContent, /How much do you want to put aside each paycheck\?/);
    const field = key(page, 'ef-plan-new-per');
    assert.match(page.$('label[for="' + field.id + '"]').textContent, /type an amount a paycheck/);
    // The working-out lists every piece.
    const how = page.text(page.byText('details', 'How we worked this out'));
    assert.match(how, /take-home per pay period \(check \+ cash you keep\)/);
    assert.match(how, /Bills per paycheck/);
    assert.match(how, /Spending categories per paycheck/);
    assert.match(how, /Your other goals per paycheck/);
    // The old "more than your budget leaves" note is gone: nothing can go over now.
    assert.doesNotMatch(t, /you may need to cut spending/);
  } finally {
    await page.close();
  }
});

test('slider: a small goal starts at the amount that finishes it in one paycheck (rounded up to $5)', async () => {
  const page = await boot({ url: DEV, seed: seed() });
  try {
    page.tab('budget');
    fill(page, 'ef-plan-new-name', 'Shoes');
    fill(page, 'ef-plan-new-cost', '142');
    assert.equal(roundUpStep(142), 145);
    assert.equal(key(page, 'ef-plan-new-slider').value, '145');
    assert.equal(key(page, 'ef-plan-new-per').value, '145');
    assert.match(
      page.text(page.$('[role=status][aria-live]', planForm(page))),
      /^\$145 a paycheck → about 1 paycheck/,
    );
    // with some already saved, what is still missing counts
    fill(page, 'ef-plan-new-saved', '100');
    assert.equal(key(page, 'ef-plan-new-per').value, '45');
  } finally {
    await page.close();
  }
});

test('slider: moving it updates the money field and the live paychecks; typing moves the slider; more than the budget leaves is held at the most', async () => {
  const page = await boot({ url: DEV, seed: seed() });
  try {
    page.tab('budget');
    fill(page, 'ef-plan-new-name', 'New phone');
    fill(page, 'ef-plan-new-cost', '900');
    slide(page, 'ef-plan-new-slider', 150);
    const S = page.state();
    assert.equal(key(page, 'ef-plan-new-per').value, '150');
    const p = purchasePlan(
      { kind: 'purchase', target: 900, saved: 0, perPaycheck: 150 },
      S.workplaces[0].profile,
      todayISO(),
    );
    assert.equal(p.paychecksLeft, 6);
    const live = page.text(page.$('[role=status][aria-live]', planForm(page)));
    assert.match(
      live,
      /^\$150 a paycheck → about 6 paychecks → ready by about [A-Z][a-z]{2}, [A-Z][a-z]{2} \d+$/,
    );
    assert.ok(
      live.endsWith(
        new Date(p.readyBy + 'T00:00:00Z').toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        }),
      ),
    );
    slide(page, 'ef-plan-new-slider', 300);
    assert.match(
      page.text(page.$('[role=status][aria-live]', planForm(page))),
      /^\$300 a paycheck → about 3 paychecks/,
    );
    // Typing in the field moves the slider and the text.
    fill(page, 'ef-plan-new-per', '75');
    assert.equal(key(page, 'ef-plan-new-slider').value, '75');
    assert.match(
      page.text(page.$('[role=status][aria-live]', planForm(page))),
      /^\$75 a paycheck → about 12 paychecks/,
    );
    assert.doesNotMatch(page.text(planForm(page)), CAP);
    // Typing more than the budget leaves is held at the most, with a calm note.
    const max = roundDownStep(possibleOf(page).possible);
    fill(page, 'ef-plan-new-per', '5000');
    assert.equal(key(page, 'ef-plan-new-per').value, String(max));
    assert.equal(key(page, 'ef-plan-new-slider').value, String(max));
    assert.equal(key(page, 'ef-plan-new-slider').max, String(max));
    assert.match(page.text(planForm(page)), CAP);
    page.click(page.button('Make this plan', planForm(page)));
    assert.equal(page.state().budget.goals.find((x) => x.name === 'New phone').perPaycheck, max);
  } finally {
    await page.close();
  }
});

test('slider: when the budget leaves nothing, the slider and field are off and it says how to make room', async () => {
  const bills = [{ id: 'b1', name: 'Rent', amount: 5000, dueDay: 1 }];
  const page = await boot({ url: DEV, seed: seed({ bills }) });
  try {
    page.tab('budget');
    fill(page, 'ef-plan-new-name', 'New phone');
    fill(page, 'ef-plan-new-cost', '900');
    assert.equal(possibleOf(page).possible, 0);
    const t = page.text(planForm(page));
    assert.match(t, /Your budget doesn’t leave anything to put aside from each paycheck right now/);
    assert.match(t, /Lower a spending category or another goal to make room\./);
    assert.ok(page.byText('button', 'Edit spending', planForm(page)));
    assert.ok(page.byText('button', 'Edit your other goals', planForm(page)));
    assert.equal(key(page, 'ef-plan-new-slider').disabled, true);
    assert.equal(key(page, 'ef-plan-new-per').disabled, true);
    // "Edit spending" takes keyboard focus to the Spending card
    page.click(page.byText('button', 'Edit spending', planForm(page)));
    assert.equal(page.doc.activeElement.id, 'budget-spending-heading');
    // the date path still shows what is needed, and says it is more than the budget leaves
    page.click(page.byLabel('Need it by a certain date?'));
    fill(page, 'ef-plan-new-date', addDays(todayISO(), 90));
    const d = page.text(planForm(page));
    assert.match(d, /About \$[\d,.]+ a paycheck for \d+ paychecks/);
    assert.match(d, /That’s more than your budget leaves each paycheck \(up to \$0\)/);
  } finally {
    await page.close();
  }
});

test('slider: with no known income there is no slider; a typed amount is saved as an estimate', async () => {
  const page = await boot({ url: DEV, seed: seed({ nights: false }) });
  try {
    page.tab('budget');
    fill(page, 'ef-plan-new-name', 'New phone');
    fill(page, 'ef-plan-new-cost', '900');
    const t = page.text(planForm(page));
    assert.match(t, /We’ll know what’s safe to put aside after your first pay period\./);
    assert.doesNotMatch(t, /\$0 to \$500/);
    assert.equal(key(page, 'ef-plan-new-slider').closest('.field').hidden, true, 'no made-up slider range');
    assert.match(
      page.$('label[for="' + key(page, 'ef-plan-new-per').id + '"]').textContent,
      /an estimate for now/,
    );
    fill(page, 'ef-plan-new-per', '1000');
    assert.equal(key(page, 'ef-plan-new-per').value, '1000', 'no cap until income is known');
    assert.match(
      page.text(page.$('[role=status][aria-live]', planForm(page))),
      /^\$1,?000 a paycheck \(estimate\) → about 1 paycheck/,
    );
    page.click(page.button('Make this plan', planForm(page)));
    assert.equal(page.state().budget.goals.find((x) => x.name === 'New phone').perPaycheck, 1000);
  } finally {
    await page.close();
  }
});

test('slider: saving makes the plan with that amount; the date link switches to a date plan', async () => {
  const page = await boot({ url: DEV, seed: seed() });
  try {
    page.tab('budget');
    fill(page, 'ef-plan-new-name', 'New phone');
    fill(page, 'ef-plan-new-cost', '900');
    slide(page, 'ef-plan-new-slider', 150);
    page.click(page.button('Make this plan', planForm(page)));
    let g = page.state().budget.goals.find((x) => x.name === 'New phone');
    assert.equal(g.kind, 'purchase');
    assert.equal(g.perPaycheck, 150);
    assert.equal('targetDate' in g, false);
    assert.equal('fundedBy' in g, false, 'one restaurant: nothing to pick');
    assert.equal(g.createdAt, todayISO());
    // A second plan, by date.
    fill(page, 'ef-plan-new-name', 'Trip');
    fill(page, 'ef-plan-new-cost', '600');
    page.click(page.byLabel('Need it by a certain date?'));
    const date = addDays(todayISO(), 90);
    fill(page, 'ef-plan-new-date', date);
    assert.match(page.text(planForm(page)), /About \$[\d,.]+ a paycheck for \d+ paychecks \(ready by /);
    assert.doesNotMatch(page.text(planForm(page)), /more than your budget leaves/);
    page.click(page.byLabel('Choose an amount a paycheck instead'));
    page.click(page.byLabel('Need it by a certain date?'));
    page.click(page.button('Make this plan', planForm(page)));
    g = page.state().budget.goals.find((x) => x.name === 'Trip');
    assert.equal(g.targetDate, date);
    assert.ok(g.perPaycheck > 0);
  } finally {
    await page.close();
  }
});

test('slider: editing a plan or a goal reopens the slider view at its amount', async () => {
  const goals = [
    {
      id: 'g1',
      name: 'Fund',
      target: 1000,
      saved: 100,
      perPaycheck: 40,
      createdAt: todayISO(),
      startSaved: 100,
    },
    {
      id: 'p1',
      name: 'Car',
      kind: 'purchase',
      target: 2400,
      saved: 0,
      startSaved: 0,
      perPaycheck: 120,
      createdAt: todayISO(),
    },
  ];
  const page = await boot({ url: DEV, seed: seed({ goals }) });
  try {
    page.tab('budget');
    page.click(page.byLabel('Edit Fund'));
    assert.equal(key(page, 'ef-goal-g1-slider').value, '40');
    assert.equal(key(page, 'ef-goal-g1-per').value, '40');
    assert.equal(page.$('[data-focus-key="ef-goal-g1-to-date"]'), null, 'a plain goal has no date option');
    slide(page, 'ef-goal-g1-slider', 60);
    page.click(page.button('Save goal'));
    assert.equal(page.state().budget.goals[0].perPaycheck, 60);
    page.click(page.byLabel('Edit plan Car'));
    assert.equal(key(page, 'ef-plan-p1-slider').value, '120');
    assert.match(
      page.text(page.$('form[aria-label="Edit plan Car"]')),
      /\$120 a paycheck → about 20 paychecks/,
    );
    // "Possible" leaves the plan being edited out of its own total.
    assert.ok(page.$('[data-focus-key="ef-plan-p1-to-date"]'));
  } finally {
    await page.close();
  }
});

test('slider: editing a goal saved above what is safe now holds it at the most (the cap applies on the next edit)', async () => {
  const goals = [
    {
      id: 'g1',
      name: 'Fund',
      target: 9000,
      saved: 0,
      perPaycheck: 2000,
      createdAt: todayISO(),
      startSaved: 0,
    },
  ];
  const page = await boot({ url: DEV, seed: seed({ goals }) });
  try {
    page.tab('budget');
    page.click(page.byLabel('Edit Fund'));
    const S = page.state();
    const max = roundDownStep(
      possibleAside(S.budget, S.workplaces[0].profile, S.nights, todayISO(), { excludeId: 'g1' }).possible,
    );
    assert.equal(key(page, 'ef-goal-g1-per').value, String(max));
    assert.match(page.text(page.$('form[aria-label="Edit goal Fund"]')), CAP);
  } finally {
    await page.close();
  }
});

test('slider: a new savings goal uses the same view and counts other goals in what is possible', async () => {
  const goals = [{ id: 'g1', name: 'Fund', target: 1000, saved: 0, perPaycheck: 40 }];
  const page = await boot({ url: DEV, seed: seed({ goals }) });
  try {
    page.tab('budget');
    const form = page.must(page.$('form[aria-label="Add a savings goal"]'), 'goal form');
    page.type(key(page, 'ef-goal-new-name'), 'Emergency');
    page.type(key(page, 'ef-goal-new-cost'), '5000');
    const S = page.state();
    const pa = possibleAside(S.budget, S.workplaces[0].profile, S.nights, todayISO());
    assert.equal(pa.goals, 40);
    assert.equal(Number(key(page, 'ef-goal-new-slider').value), roundDownStep(pa.possible));
    assert.equal(Number(key(page, 'ef-goal-new-slider').max), roundDownStep(pa.possible));
    assert.match(page.text(form), /Your other goals per paycheck/);
    slide(page, 'ef-goal-new-slider', 50);
    page.click(page.button('Add goal', form));
    const g = page.state().budget.goals.find((x) => x.name === 'Emergency');
    assert.equal(g.perPaycheck, 50);
    assert.equal(g.target, 5000);
    assert.equal(g.kind, undefined);
  } finally {
    await page.close();
  }
});

test('spending categories: weekly and every two weeks, shown as this week / these two weeks / this month', async () => {
  const page = await boot({ url: DEV, seed: seed() });
  try {
    page.tab('budget');
    page.type(key(page, 'ef-category-new-name'), 'Groceries');
    page.type(key(page, 'ef-category-new-monthly'), '100');
    const f = key(page, 'ef-category-new-freq');
    assert.deepEqual(
      Array.from(f.options).map((o) => o.textContent),
      ['per week', 'per two weeks', 'per month'],
    );
    assert.equal(f.value, 'monthly');
    f.value = 'weekly';
    page.change(f);
    page.click(page.button('Add category'));
    let c = page.state().budget.categories.find((x) => x.name === 'Groceries');
    assert.equal(c.freq, 'weekly');
    assert.equal(c.monthly, 100);
    assert.ok(page.$('[aria-label="Groceries spending this week"]'));
    assert.match(page.text(page.byText('li', 'Groceries')), /\$0\.00 of \$100\.00 this week/);
    page.type(key(page, 'ef-category-new-name'), 'Fun');
    page.type(key(page, 'ef-category-new-monthly'), '140');
    const f2 = key(page, 'ef-category-new-freq');
    f2.value = 'biweekly';
    page.change(f2);
    page.click(page.button('Add category'));
    c = page.state().budget.categories.find((x) => x.name === 'Fun');
    assert.equal(c.freq, 'biweekly');
    assert.equal(c.anchor, todayISO());
    assert.ok(page.$('[aria-label="Fun spending these two weeks"]'));
    assert.match(page.text(), /about \$\d[\d,.]+ a month/);
    // An existing category stays monthly.
    assert.equal(
      page.state().budget.categories.every((x) => x.name === 'Groceries' || x.name === 'Fun' || !x.freq),
      true,
    );
  } finally {
    await page.close();
  }
});
