// Several restaurants in the app: Setup (add, rename, remove), Tonight (switching), Pay periods (filter, accuracy), import.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { exampleProfile, todayISO, addDays } from '../../app/js/math.js';
import { nightsOf } from '../../app/js/storage.js';

const today = todayISO();
/** One restaurant (Voodoo Bayou), set up, typing everything. */
const oneState = (mutate) =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    S.workplaces[0].name = 'Voodoo Bayou';
    if (mutate) mutate(S);
  });
/** Two restaurants, both set up: Voodoo Bayou (every two weeks, Bartender $12) and Second Spot (twice a month, Server $8, tips). */
const twoState = (mutate) =>
  oneState((S) => {
    const p = exampleProfile(today);
    p.freq = 'semimonthly';
    p.periodStart = addDays(today, -20);
    p.periodEnd = '';
    p.payTypes = [{ id: 'p1', k: 'server', name: 'Server', rate: 8, unit: 'hr', usual: 0 }];
    p.tipout = { on: false, mode: 'pct', value: 0, basis: 'before', from: 'cash' };
    p.entryMode = 'tips';
    S.workplaces.push({ id: 'w2', name: 'Second Spot', profile: p, calib: [], setupDone: true });
    if (mutate) mutate(S);
  });
const key = (page, k) => page.must(page.$('[data-focus-key="' + k + '"]'), k);
const radios = (page, label) =>
  page.$$('[role=radiogroup][aria-label="' + label + '"] [role=radio]', page.app);
const checked = (page, label) => radios(page, label).find((b) => b.getAttribute('aria-checked') === 'true');

/* ---------- Setup ---------- */
test('setup: + Set up another restaurant asks the name, then runs the guided setup for that restaurant', async () => {
  const page = await boot({ seed: oneState() });
  try {
    page.tab('setup');
    assert.equal(page.$('[role=radiogroup]', page.app), null, 'one restaurant: no switcher');
    page.click(page.button('+ Set up another restaurant'));
    const name = page.$('#wp-new-name');
    assert.equal(page.doc.activeElement, name, 'focus goes to the name');
    page.click(page.button('Start setup'));
    assert.match(page.text(), /Give the restaurant a name/);
    page.type(name, 'voodoo bayou');
    page.click(page.button('Start setup'));
    assert.match(page.text(), /You already have a restaurant called voodoo bayou/);
    page.type(page.$('#wp-new-name'), 'Second Spot');
    page.click(page.button('Start setup'));
    const S = page.state();
    assert.equal(S.workplaces.length, 2);
    const w = S.workplaces[1];
    assert.equal(w.name, 'Second Spot');
    assert.equal(w.setupDone, false);
    assert.equal(S.settings.activeWorkplaceId, w.id);
    assert.equal(S.settings.guidedDraft.workplaceId, w.id);
    assert.match(page.text(), /Set up Second Spot/);
    assert.match(page.text(), /1\. Pay period and gross/);
    assert.equal(page.$('[aria-current="step"]').textContent, '1. Pay period and gross');
    // the switcher is there, so the other restaurant is one tap away
    assert.deepEqual(
      radios(page, 'Restaurant to set up').map((b) => b.textContent),
      ['Voodoo Bayou', 'Second Spot'],
    );
    // Tonight: only this restaurant shows "Finish setup"; the first one still works
    page.tab('tonight');
    assert.match(page.text(), /Finish setting up Second Spot/);
    page.click(radios(page, 'Restaurant for tonight')[0]);
    assert.ok(page.$('form button[type=submit]', page.app), 'Voodoo Bayou has its entry form');
    assert.doesNotMatch(page.text(), /Finish setting up/);
  } finally {
    await page.close();
  }
});

test('setup: the guided flow for a second restaurant fills in its own paystub and Finish lands on its Tonight', async () => {
  const page = await boot({ seed: oneState() });
  try {
    page.tab('setup');
    page.click(page.button('+ Set up another restaurant'));
    page.type(page.$('#wp-new-name'), 'Second Spot');
    page.click(page.button('Start setup'));
    const first = JSON.stringify(page.state().workplaces[0].profile);
    page.type(page.$$('input[type=date]', page.app)[0], '2026-09-01');
    const freq = page.$('select', page.app);
    freq.value = 'semimonthly';
    page.change(freq);
    page.type(page.must(page.$('input[placeholder="e.g. 2,000"]', page.app), 'gross'), '900');
    page.click(page.button('Next'));
    page.type(page.must(page.$('input[placeholder="e.g. 180"]', page.app), 'fed'), '60');
    page.click(page.button('Next'));
    page.type(page.must(page.$('input[placeholder="e.g. 12"]', page.app), 'rate'), '8');
    page.click(page.button('Finish setup'));
    const S = page.state();
    const w = S.workplaces[1];
    assert.equal(w.setupDone, true);
    assert.equal(w.profile.freq, 'semimonthly');
    assert.equal(w.profile.gross, 900);
    assert.deepEqual(
      w.profile.deductions.map((d) => d.amount),
      [60],
      'blank rows dropped',
    );
    assert.equal(w.profile.payTypes[0].rate, 8);
    assert.equal(w.profile.entryMode, 'tips');
    assert.equal(JSON.stringify(S.workplaces[0].profile), first, 'the first restaurant is untouched');
    assert.equal(S.settings.guidedDraft, undefined);
    assert.match(page.text(), /Tonight/);
    assert.equal(checked(page, 'Restaurant for tonight').textContent, 'Second Spot');
    assert.match(page.text(), /Tips you made tonight/);
  } finally {
    await page.close();
  }
});

test('setup: rename and remove (two taps, says how many nights go, Undo brings both back); the last one stays', async () => {
  const seed = twoState((S) => {
    S.settings.activeWorkplaceId = 'w2';
    S.nights = [
      { id: 'n1', date: today, total: 300, cash: 50, pay: { p1: 6 }, barback: true, workplaceId: 'w1' },
      { id: 'n2', date: today, total: 120, cash: 20, pay: { p1: 4 }, barback: true, workplaceId: 'w2' },
      {
        id: 'n3',
        date: addDays(today, -1),
        total: 90,
        cash: 0,
        pay: { p1: 3 },
        barback: true,
        workplaceId: 'w2',
      },
    ];
  });
  const page = await boot({ seed });
  try {
    page.tab('setup');
    assert.match(page.text(), /Setup: Second Spot/);
    page.type(page.$('#wp-name'), 'Spot 2');
    assert.equal(page.state().workplaces[1].name, 'Spot 2');
    page.type(page.$('#wp-name'), 'Voodoo Bayou');
    assert.match(page.text(), /You already have a restaurant called Voodoo Bayou/);
    assert.equal(page.state().workplaces[1].name, 'Spot 2', 'a repeated name is not saved');
    page.type(page.$('#wp-name'), 'Second Spot');
    const rm = page.$('#wp-remove');
    assert.equal(rm.textContent, 'Remove Second Spot');
    page.click(rm);
    assert.equal(rm.textContent, 'Tap again: this also removes its 2 nights');
    assert.equal(page.state().workplaces.length, 2, 'one tap removes nothing');
    page.click(rm);
    let S = page.state();
    assert.equal(S.workplaces.length, 1);
    assert.equal(S.nights.length, 1);
    assert.equal(S.settings.activeWorkplaceId, 'w1');
    assert.equal(page.$('#wp-remove'), null, 'the last restaurant cannot be removed');
    page.click(page.button('Undo', page.doc.getElementById('toast')));
    S = page.state();
    assert.equal(S.workplaces.length, 2);
    assert.equal(nightsOf(S, 'w2').length, 2);
    assert.equal(S.settings.activeWorkplaceId, 'w2');
  } finally {
    await page.close();
  }
});

test('setup: shared settings (late nights, theme, backup) stay global; the importer asks which restaurant', async () => {
  const page = await boot({ seed: twoState() });
  try {
    page.tab('setup');
    assert.match(page.text(), /Late nights, appearance and backups are shared by all your restaurants/);
    const sel = page.$('#day-cutoff');
    sel.value = '4';
    page.change(sel);
    page.click(radios(page, 'Restaurant to set up')[1]);
    assert.equal(page.$('#day-cutoff').value, '4', 'the same Late nights setting for both');
    assert.equal(page.state().settings.dayCutoffHour, 4);
    // The hint describes the setting that is actually chosen, including "off".
    const hint = () => page.$('#day-cutoff').closest('.field').querySelector('.hint').textContent;
    assert.match(hint(), /before 4 a\.m\./);
    const sel2 = page.$('#day-cutoff');
    sel2.value = '0';
    page.change(sel2);
    assert.match(hint(), /^Off: a night is dated the day you enter it/);
  } finally {
    await page.close();
  }
});

/* ---------- Tonight ---------- */
test('tonight: one restaurant has no switcher; two get a radio group at the top that switches everything', async () => {
  const one = await boot({ seed: oneState() });
  try {
    assert.equal(one.$('[role=radiogroup]', one.app), null);
    assert.match(one.text(), /Saved\.|Save night/);
  } finally {
    await one.close();
  }
  const page = await boot({ seed: twoState() });
  try {
    const group = page.$('[role=radiogroup]', page.app);
    assert.ok(group);
    assert.equal(page.app.querySelector('.stack').firstElementChild, group, 'at the very top');
    const [a, b] = radios(page, 'Restaurant for tonight');
    assert.equal(a.getAttribute('aria-checked'), 'true');
    assert.equal(a.tabIndex, 0);
    assert.equal(b.tabIndex, -1);
    assert.match(page.text(), /What you made tonight/, 'Voodoo Bayou types everything');
    assert.match(page.text(), /Bartender/);
    page.click(b);
    assert.equal(page.state().settings.activeWorkplaceId, 'w2');
    assert.equal(checked(page, 'Restaurant for tonight').textContent, 'Second Spot');
    assert.match(page.text(), /Tips you made tonight/, 'Second Spot types tips');
    assert.match(page.text(), /Server/);
    assert.doesNotMatch(page.text(), /Barback tip-out tonight/, 'no tip-out at Second Spot');
    assert.match(page.text(), /\$8\.00\/h/);
    // keyboard: arrows move the pick and keep focus on it
    const b2 = checked(page, 'Restaurant for tonight');
    b2.focus();
    page.key(b2, 'ArrowRight');
    assert.equal(page.state().settings.activeWorkplaceId, 'w1', 'wraps around');
    assert.equal(page.doc.activeElement.textContent, 'Voodoo Bayou');
    page.key(page.doc.activeElement, 'End');
    assert.equal(page.state().settings.activeWorkplaceId, 'w2');
    assert.equal(page.doc.activeElement.getAttribute('aria-checked'), 'true');
  } finally {
    await page.close();
  }
});

test('tonight: each restaurant keeps its own half-typed entry; saving says where; same date at two places is two nights', async () => {
  const page = await boot({ seed: twoState() });
  try {
    const total = () => key(page, 'night-total');
    page.type(total(), '400');
    page.type(page.must(page.$('[data-focus-key^="night-pay-"]', page.app), 'hours'), '8');
    page.click(radios(page, 'Restaurant for tonight')[1]);
    assert.equal(total().value, '', 'Second Spot starts blank');
    page.type(total(), '150');
    page.type(page.must(page.$('[data-focus-key^="night-pay-"]', page.app), 'hours'), '5');
    page.click(radios(page, 'Restaurant for tonight')[0]);
    assert.equal(total().value, '400', 'Voodoo Bayou entry is back');
    page.click(page.button('Save night at Voodoo Bayou'));
    assert.match(page.text(), /Saved to Voodoo Bayou: \$[\d,.]+ take-home for /);
    page.click(radios(page, 'Restaurant for tonight')[1]);
    assert.equal(total().value, '150', 'Second Spot entry is still there');
    page.click(page.button('Save night at Second Spot'));
    assert.match(page.text(), /Saved to Second Spot: /);
    assert.doesNotMatch(
      page.text(),
      /You already saved/,
      'a night at the other restaurant is not a duplicate',
    );
    const S = page.state();
    assert.equal(S.nights.length, 2);
    assert.equal(nightsOf(S, 'w1')[0].total, 400);
    // tips mode at Second Spot: $150 tips + 5 h x $8
    assert.equal(nightsOf(S, 'w2')[0].total, 190);
    assert.equal(nightsOf(S, 'w2')[0].tips, 150);
    // a second night at Second Spot on the same date asks
    page.type(total(), '20');
    page.type(page.must(page.$('[data-focus-key^="night-pay-"]', page.app), 'hours'), '1');
    page.click(page.button('Save night at Second Spot'));
    assert.match(page.text(), /You already saved .* at Second Spot/);
  } finally {
    await page.close();
  }
});

test('tonight: the restaurant picked last is the one shown on open', async () => {
  const page = await boot({ seed: twoState((S) => (S.settings.activeWorkplaceId = 'w2')) });
  try {
    assert.equal(checked(page, 'Restaurant for tonight').textContent, 'Second Spot');
    assert.match(page.text(), /Tips you made tonight/);
  } finally {
    await page.close();
  }
});

/* ---------- Pay periods ---------- */
test('pay periods: All / one restaurant filter (remembered), names under All, editor and accuracy per restaurant', async () => {
  const seed = twoState((S) => {
    S.nights = [
      { id: 'n1', date: today, total: 300, cash: 50, pay: { p1: 6 }, barback: true, workplaceId: 'w1' },
      { id: 'n2', date: today, total: 120, cash: 20, pay: { p1: 4 }, barback: true, workplaceId: 'w2' },
    ];
  });
  const page = await boot({ seed });
  try {
    page.tab('periods');
    const labels = () => page.$$('[data-period] .label', page.app).map((n) => n.textContent);
    assert.deepEqual(
      radios(page, 'Show pay periods for').map((b) => b.textContent),
      ['All', 'Voodoo Bayou', 'Second Spot'],
    );
    assert.equal(checked(page, 'Show pay periods for').textContent, 'All');
    assert.equal(labels().length, 2);
    assert.ok(labels().some((t) => t.startsWith('Voodoo Bayou · ')));
    assert.ok(labels().some((t) => t.startsWith('Second Spot · ')));
    page.click(radios(page, 'Show pay periods for')[2]);
    assert.equal(page.state().settings.periodsFilter, 'w2');
    assert.equal(labels().length, 1);
    assert.ok(!labels()[0].startsWith('Second Spot'), 'one restaurant: no name needed');
    // the editor works inside its restaurant: Second Spot types tips
    page.click(page.must(page.$('[data-period] button[aria-label^="Edit night"]', page.app), 'edit'));
    assert.match(page.text(), /Tips you made/);
    // accuracy: the restaurant is picked first
    const wsel = page.$('#cal-workplace');
    assert.ok(wsel);
    assert.equal(wsel.value, 'w2');
    page.tab('tonight');
    page.tab('periods');
    assert.equal(checked(page, 'Show pay periods for').textContent, 'Second Spot', 'remembered');
  } finally {
    await page.close();
  }
});

/* ---------- Spreadsheet import ---------- */
test('import: with two restaurants it asks which one; duplicate dates are looked for at that restaurant only', async () => {
  const seed = twoState((S) => {
    S.nights = [
      {
        id: 'ex',
        date: addDays(todayISO(), -40),
        total: 50,
        cash: 10,
        pay: {},
        barback: true,
        workplaceId: 'w1',
      },
    ];
  });
  const page = await boot({ seed });
  try {
    page.tab('setup');
    const input = page.must(page.$('input[type=file]', page.app), 'file input');
    // dated relative to (fake) today, so the file is never in the future (tools/run-dates.mjs)
    const d = (n) => addDays(todayISO(), n);
    const csv = ['Date,Total,Cash', d(-41) + ',120,40', d(-40) + ',90,30'].join('\n');
    Object.defineProperty(input, 'files', {
      value: [{ name: 'spot.csv', text: async () => csv }],
      configurable: true,
    });
    page.change(input);
    await page.settle();
    const sel = page.must(page.$('#map-workplace'), 'restaurant select');
    assert.match(page.text(), /Which restaurant are these nights from\?/);
    assert.match(page.text(), /Choose the restaurant above to see a preview/);
    assert.equal(
      page.byText('button', 'Import 2 nights'),
      null,
      'nothing to import until a restaurant is picked',
    );
    sel.value = 'w2';
    page.change(sel);
    assert.match(page.text(), /2 nights ready to import to Second Spot/);
    assert.doesNotMatch(page.text(), /already ha/, 'the Sep 2 night is at Voodoo Bayou, not here');
    page.click(page.button('Import 2 nights'));
    const S = page.state();
    assert.equal(nightsOf(S, 'w2').length, 2);
    assert.equal(nightsOf(S, 'w1').length, 1);
  } finally {
    await page.close();
  }
});

/* ---------- Budget ---------- */
const DEV = 'http://localhost/?unlock=dev';
/** Two restaurants with nights that have cash, so both checks can be estimated. */
const budgetState = () =>
  twoState((S) => {
    S.workplaces[0].profile.payDelay = 1;
    S.workplaces[1].profile.payDelay = 2;
    S.nights = [];
    [2, 4, 6, 9, 12, 15, 18].forEach((ago, i) => {
      S.nights.push({
        id: 'a' + i,
        date: addDays(today, -ago),
        total: 400,
        cash: 100,
        pay: { p1: 6 },
        barback: false,
        workplaceId: 'w1',
      });
      S.nights.push({
        id: 'b' + i,
        date: addDays(today, -ago),
        total: 150,
        cash: 30,
        pay: { p1: 4 },
        barback: false,
        workplaceId: 'w2',
      });
    });
  });

test('budget: safe to spend runs until the next money from either restaurant and lists both checks', async () => {
  const page = await boot({ url: DEV, seed: budgetState() });
  try {
    page.tab('budget');
    const label = page.$('.hero-label', page.app).textContent;
    assert.match(
      label,
      /^Safe to spend until [A-Z][a-z]{2}, [A-Z][a-z]{2} \d+ — (Voodoo Bayou|Second Spot) check$/,
    );
    const how = page.text(page.byText('details', 'How this is worked out'));
    assert.match(how, /Next checks \(counted once they arrive\)/);
    assert.match(how, /Voodoo Bayou, [A-Z]/);
    assert.match(how, /Second Spot, [A-Z]/);
    const after = page.text(page.byText('section', 'After payday ('));
    assert.match(after, /(Voodoo Bayou|Second Spot) check, [A-Z][a-z]{2}, [A-Z][a-z]{2} \d+ \(estimated\)/);
  } finally {
    await page.close();
  }
});

test('budget: a goal asks which paycheck it is saved from, uses that restaurant, and says so', async () => {
  const page = await boot({ url: DEV, seed: budgetState() });
  try {
    page.tab('budget');
    const form = page.must(page.$('form[aria-label="Add a savings goal"]'), 'goal form');
    page.type(key(page, 'ef-goal-new-name'), 'Emergency');
    page.type(key(page, 'ef-goal-new-cost'), '3000');
    const sel = key(page, 'ef-goal-new-funder');
    assert.match(page.$('label[for="' + sel.id + '"]').textContent, /Save from which paycheck\?/);
    assert.deepEqual(
      Array.from(sel.options).map((o) => o.textContent),
      ['Voodoo Bayou', 'Second Spot'],
    );
    // Voodoo Bayou pays every two weeks (26 a year), Second Spot twice a month (24): Voodoo Bayou by default
    assert.equal(sel.value, 'w1');
    assert.match(page.text(form), /a paycheck is safe to put aside from Voodoo Bayou/);
    const fromA = key(page, 'ef-goal-new-slider').max;
    sel.value = 'w2';
    page.change(sel);
    assert.match(page.text(form), /a paycheck is safe to put aside from Second Spot/);
    assert.notEqual(key(page, 'ef-goal-new-slider').max, fromA, 'its own check and pay period');
    page.click(page.button('Add goal', form));
    const g = page.state().budget.goals.find((x) => x.name === 'Emergency');
    assert.equal(g.fundedBy, 'w2');
    const row = page.byText('li', 'Emergency');
    assert.match(page.text(row), /Saved from Second Spot paychecks\./);
    const amount = page.must(row.querySelector('[data-focus-key="goal-rec-' + g.id + '"]'), 'tracker field');
    assert.match(amount.getAttribute('aria-label'), /from the Second Spot [A-Z][a-z]{2} \d+ check/);
  } finally {
    await page.close();
  }
});

test('setup: renaming a restaurant updates the switcher button, heading and Remove label at once', async () => {
  const page = await boot({ seed: twoState((S) => (S.settings.activeWorkplaceId = 'w2')) });
  try {
    page.tab('setup');
    const btn = () => page.$('[data-workplace="w2"]');
    assert.equal(btn().textContent, 'Second Spot');
    page.type(page.$('#wp-name'), 'Spot 2');
    assert.equal(btn().textContent, 'Spot 2');
    assert.match(page.$('#setup-h1').textContent, /Setup: Spot 2/);
    assert.match(page.$('#wp-remove').textContent, /Remove Spot 2/);
  } finally {
    await page.close();
  }
});
