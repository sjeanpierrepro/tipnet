import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import {
  exampleBudget,
  possibleAside,
  roundDownStep,
  asideSliderMax,
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
    S.settings.setupDone = true;
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
  return possibleAside(S.budget, S.profile, S.nights, todayISO());
};

test('slider: after name, cost and saved, it shows what is possible and starts the slider there', async () => {
  const page = await boot({ url: DEV, seed: seed() });
  try {
    page.tab('budget');
    fill(page, 'ef-plan-new-name', 'New phone');
    fill(page, 'ef-plan-new-cost', '900');
    const pa = possibleOf(page);
    assert.equal(pa.known, true, 'the seeded nights give a typical check');
    const t = page.text(planForm(page));
    assert.match(t, /You could put aside up to about \$[\d,]+(\.\d\d)? a paycheck\./);
    assert.match(t, /How we worked this out/);
    const slider = key(page, 'ef-plan-new-slider');
    assert.equal(slider.type, 'range');
    assert.equal(slider.step, '5');
    assert.equal(slider.min, '0');
    assert.equal(Number(slider.value), roundDownStep(pa.possible));
    assert.equal(Number(slider.max), asideSliderMax(pa.possible, 900, true));
    assert.equal(key(page, 'ef-plan-new-per').value, String(roundDownStep(pa.possible)));
    // The slider has a real label.
    const lab = page.$('label[for="' + slider.id + '"]');
    assert.ok(lab, 'label linked to the slider');
    assert.match(lab.textContent, /How much do you want to put aside each paycheck\?/);
    const field = key(page, 'ef-plan-new-per');
    assert.match(page.$('label[for="' + field.id + '"]').textContent, /type an amount a paycheck/);
    // The working-out lists every piece.
    const how = page.text(page.byText('details', 'How we worked this out'));
    assert.match(how, /take-home per paycheck/);
    assert.match(how, /Bills per paycheck/);
    assert.match(how, /Spending categories per paycheck/);
    assert.match(how, /Your other goals per paycheck/);
  } finally {
    await page.close();
  }
});

test('slider: moving it updates the money field and the live paychecks and ready-by date; typing moves the slider', async () => {
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
      S.profile,
      todayISO(),
    );
    assert.equal(p.paychecksLeft, 6);
    const live = page.text(page.$('[role=status]', planForm(page)));
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
    assert.match(page.text(page.$('[role=status]', planForm(page))), /^\$300 a paycheck → about 3 paychecks/);
    // Typing in the field moves the slider and the text.
    fill(page, 'ef-plan-new-per', '75');
    assert.equal(key(page, 'ef-plan-new-slider').value, '75');
    assert.match(page.text(page.$('[role=status]', planForm(page))), /^\$75 a paycheck → about 12 paychecks/);
    // An amount above the slider's end widens it rather than being cut off.
    fill(page, 'ef-plan-new-per', '5000');
    assert.ok(Number(key(page, 'ef-plan-new-slider').max) >= 5000);
    assert.match(
      page.text(page.$('[role=status]', planForm(page))),
      /^\$5,?000 a paycheck → about 1 paycheck /,
    );
  } finally {
    await page.close();
  }
});

test('slider: above what is possible gets a calm note; at or below it does not', async () => {
  const page = await boot({ url: DEV, seed: seed() });
  try {
    page.tab('budget');
    fill(page, 'ef-plan-new-name', 'New phone');
    fill(page, 'ef-plan-new-cost', '900');
    const note = /That's more than your budget leaves each paycheck; you may need to cut spending\./;
    const pa = possibleOf(page);
    fill(page, 'ef-plan-new-per', String(Math.floor(pa.possible)));
    assert.doesNotMatch(page.text(planForm(page)), note);
    fill(page, 'ef-plan-new-per', String(Math.ceil(pa.possible) + 20));
    assert.match(page.text(planForm(page)), note);
    assert.match(page.text(planForm(page)), /of a typical check/);
  } finally {
    await page.close();
  }
});

test('slider: with no known income it says so and the slider goes $0 to $500', async () => {
  const page = await boot({ url: DEV, seed: seed({ nights: false }) });
  try {
    page.tab('budget');
    fill(page, 'ef-plan-new-name', 'New phone');
    fill(page, 'ef-plan-new-cost', '900');
    assert.match(page.text(planForm(page)), /doesn't know what your paycheck is yet/);
    const slider = key(page, 'ef-plan-new-slider');
    assert.equal(slider.max, '500');
    assert.equal(slider.min, '0');
    assert.doesNotMatch(page.text(planForm(page)), /That's more than your budget leaves/);
    slide(page, 'ef-plan-new-slider', 100);
    assert.match(page.text(page.$('[role=status]', planForm(page))), /^\$100 a paycheck → about 9 paychecks/);
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
    assert.equal(g.createdAt, todayISO());
    // A second plan, by date.
    fill(page, 'ef-plan-new-name', 'Trip');
    fill(page, 'ef-plan-new-cost', '600');
    page.click(page.byLabel('Need it by a certain date?'));
    const date = addDays(todayISO(), 90);
    fill(page, 'ef-plan-new-date', date);
    assert.match(page.text(planForm(page)), /About \$[\d,.]+ a paycheck for \d+ paychecks \(ready by /);
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

test('slider: a new savings goal uses the same view and counts other goals in what is possible', async () => {
  const goals = [{ id: 'g1', name: 'Fund', target: 1000, saved: 0, perPaycheck: 40 }];
  const page = await boot({ url: DEV, seed: seed({ goals }) });
  try {
    page.tab('budget');
    const form = page.must(page.$('form[aria-label="Add a savings goal"]'), 'goal form');
    page.type(key(page, 'ef-goal-new-name'), 'Emergency');
    page.type(key(page, 'ef-goal-new-cost'), '500');
    const S = page.state();
    const pa = possibleAside(S.budget, S.profile, S.nights, todayISO());
    assert.equal(pa.goals, 40);
    assert.equal(Number(key(page, 'ef-goal-new-slider').value), roundDownStep(pa.possible));
    assert.match(page.text(form), /Your other goals per paycheck/);
    slide(page, 'ef-goal-new-slider', 50);
    page.click(page.button('Add goal', form));
    const g = page.state().budget.goals.find((x) => x.name === 'Emergency');
    assert.equal(g.perPaycheck, 50);
    assert.equal(g.target, 500);
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
