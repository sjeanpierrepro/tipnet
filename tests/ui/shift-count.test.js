// The shift count is Setup's "Shifts you work in a pay period" (required, a whole number): Tonight's preview, the
// "Saved" line and every saved night use it, so logging a forgotten night never moves the others.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { addDays, todayISO, computeNight, shiftsPerPeriod } from '../../app/js/math.js';

const box = (page, k) => page.must(page.$('[data-focus-key="' + k + '"]'), k);
const shiftsBox = (page) =>
  page
    .must(page.byText('.field', 'Shifts you work in a pay period', page.app), 'shifts field')
    .querySelector('input');
const night = (id, date, wid) => ({
  id,
  date,
  total: 300,
  tips: 204,
  cash: 100,
  pay: { p1: 8 },
  barback: false,
  tipouts: {},
  tipoutOn: false,
  workplaceId: wid,
});
/** A v37 save: no shift count; 6 nights in an older pay period, none in the one after it, 2 in the running one. */
const seed = (mutate) =>
  realState((S) => {
    const t = todayISO();
    const w = S.workplaces[0];
    w.setupDone = true;
    const p = w.profile;
    p.freq = 14;
    p.periodStart = addDays(t, -41);
    p.periodEnd = '';
    p.shifts = 0;
    p.deductions.push({ id: 'dx', k: 'health', name: 'Health', amount: 100, mode: 'fixed' });
    p.tipout = { on: false };
    p.tipouts = [];
    for (let i = 0; i < 6; i++) S.nights.push(night('o' + i, addDays(t, -40 + i), w.id));
    for (let i = 0; i < 2; i++) S.nights.push(night('r' + i, addDays(t, -3 + i), w.id));
    if (mutate) mutate(S);
  });
const netOf = (S, id) => {
  const p = S.workplaces[0].profile;
  return computeNight(
    S.nights.find((n) => n.id === id),
    p,
    shiftsPerPeriod(p, S.nights).n,
  ).net;
};

test('a forgotten night logged on Tonight: the preview is what is saved, and the running nights stay as they were', async () => {
  const page = await boot({ seed: seed() });
  try {
    const before = netOf(page.state(), 'r0');
    page.type(box(page, 'night-date'), addDays(todayISO(), -20)); // the empty finished pay period
    page.type(box(page, 'night-cc'), '204');
    page.type(box(page, 'night-cash'), '100');
    page.type(box(page, 'night-pay-p1'), '8');
    const preview = page.$('.result .hero').textContent;
    page.click(page.$('form button[type=submit]'));
    const saved = page.$('#night-saved').textContent;
    assert.match(saved, /^Saved\. \$[\d,.]+ take-home/);
    assert.ok(saved.includes(preview.trim()), preview + ' | ' + saved);
    assert.equal(netOf(page.state(), 'r0'), before, 'a running night');
    assert.equal(page.state().workplaces[0].profile.shifts, 6, 'the count it was shown with (6 nights)');
  } finally {
    await page.close();
  }
});

test('Setup: "Shifts you work in a pay period" is required, a whole number of 1 or more', async () => {
  const page = await boot({
    seed: realState((S) => {
      S.workplaces[0].setupDone = true;
    }),
  });
  try {
    page.openSetup();
    const sh = shiftsBox(page);
    assert.equal(sh.value, '10');
    page.type(sh, '');
    page.leave(sh);
    assert.equal(page.$('#draft-save').disabled, true);
    assert.match(page.$('#draft-reasons').textContent, /Enter how many shifts you work in a pay period/);
    assert.match(page.text(), /Enter how many shifts you work in a pay period, like 10\./);
    page.type(sh, '0');
    assert.match(page.text(), /Use a whole number of shifts, 1 or more/);
    assert.equal(page.$('#draft-save').disabled, true);
    page.type(sh, '6.5');
    assert.match(page.text(), /Use a whole number of shifts, 1 or more/);
    assert.equal(page.$('#draft-save').disabled, true);
    page.type(sh, '9');
    assert.doesNotMatch(page.text(), /Use a whole number of shifts/);
    await page.saveSetup();
    assert.equal(page.state().workplaces[0].profile.shifts, 9);
  } finally {
    await page.close();
  }
});

test('Setup: the count the update gave (an average of 6.5) is shown, kept on Save, and replaced when one is typed', async () => {
  const page = await boot({
    seed: seed((S) => {
      // one more older period with 7 nights: the running period was shown with (6 + 7) / 2 = 6.5
      const t = todayISO();
      const w = S.workplaces[0];
      w.profile.periodStart = addDays(t, -55);
      for (let i = 0; i < 7; i++) S.nights.push(night('q' + i, addDays(t, -54 + i), w.id));
      S.nights = S.nights
        .filter((n) => !n.id.startsWith('o'))
        .concat(Array.from({ length: 6 }, (x, i) => night('o' + i, addDays(t, -40 + i), w.id)));
    }),
  });
  try {
    const p0 = page.state().workplaces[0].profile;
    assert.equal(p0.shiftsAvg, 6.5);
    const before = netOf(page.state(), 'r0');
    page.openSetup();
    const sh = shiftsBox(page);
    assert.equal(sh.value, '6.5');
    assert.match(
      page.$('#shifts-auto').textContent,
      /TipNet filled this in from your past pay periods \(their average, 6\.5\)/,
    );
    // another change saved: the count stays exactly as it was
    const gross = page.byText('.field', 'Gross pay', page.app).querySelector('input');
    page.type(gross, '2001');
    page.change(gross);
    await page.saveSetup();
    const p1 = page.state().workplaces[0].profile;
    assert.equal(p1.shiftsAvg, 6.5);
    assert.equal(p1.shiftsAuto, undefined, 'confirmed by Save');
    page.openSetup();
    assert.equal(page.$('#shifts-auto').hidden, true);
    page.type(shiftsBox(page), '7');
    await page.saveSetup();
    const p2 = page.state().workplaces[0].profile;
    assert.equal(p2.shifts, 7);
    assert.equal(p2.shiftsAvg, undefined);
    assert.notEqual(netOf(page.state(), 'r0'), before, 'the running nights follow the new count');
  } finally {
    await page.close();
  }
});

test('guided setup: step 1 needs the shifts you work in a pay period', async () => {
  const page = await boot();
  try {
    page.tab('setup');
    page.type(page.$$('input[type=date]', page.app)[0], '2026-09-01');
    page.type(page.$('input[placeholder="e.g. 2,000"]', page.app), '1500');
    page.click(page.button('Next'));
    assert.doesNotMatch(page.text(), /Add a row for each line in the deductions/, 'still on step 1');
    assert.match(page.text(), /Enter how many shifts you work in a pay period, like 10\./);
    page.type(page.$('input[placeholder="e.g. 10"]', page.app), '8');
    page.click(page.button('Next'));
    assert.match(page.text(), /Add a row for each line in the deductions/, 'step 2');
    assert.equal(page.state().settings.guidedDraft.profile.shifts, 8);
  } finally {
    await page.close();
  }
});
