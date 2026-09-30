import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { encodeBackup } from '../../app/js/storage.js';

const dateInputs = (page) => page.$$('input[type=date]', page.app);
const next = (page) => page.click(page.button('Next'));
// The harness unrefs timers, so hold the event loop open while waiting.
const wait = (ms) =>
  new Promise((r) => {
    const keep = setInterval(() => {}, 20);
    keep.ref && keep.ref();
    setTimeout(() => {
      clearInterval(keep);
      r();
    }, ms);
  });

test('guided setup: fields are blank with example placeholders, and Next/Next/Finish with nothing typed is blocked', async () => {
  const page = await boot();
  try {
    page.tab('setup');
    assert.match(page.text(), /Set up TipNet/);
    const gross = page.$('input[placeholder="e.g. 2,000"]', page.app);
    assert.ok(gross, 'gross shows the example as a placeholder');
    assert.equal(gross.value, '');
    dateInputs(page).forEach((d) => assert.equal(d.value, ''));
    next(page);
    assert.match(page.text(), /Pick the day your pay period started/);
    assert.match(page.text(), /Gross pay is needed/);
    assert.match(page.text(), /Pay period and gross pay/, 'still on step 1');
    assert.equal(page.state().profileExample, true, 'example profile untouched');
    assert.equal(page.state().profile.gross, 2000);
    assert.match(page.text(), /Set up with one recent paystub \(about 3 minutes\)/, 'welcome line stays');
  } finally {
    await page.close();
  }
});

test("guided setup: step 2 needs a deduction amount or the no-deductions box; Finish keeps the user's numbers only", async () => {
  const page = await boot();
  try {
    page.tab('setup');
    const [start] = dateInputs(page);
    page.type(start, '2026-09-01');
    page.type(page.$('input[placeholder="e.g. 2,000"]', page.app), '1500');
    next(page);
    assert.match(page.text(), /^.*Deductions/);
    const fed = page.$('input[placeholder="e.g. 180"]', page.app);
    assert.ok(fed && fed.value === '', 'deduction amount blank with placeholder');
    next(page);
    assert.match(page.text(), /at least one line on your stub/);
    assert.match(page.text(), /Deductions/);
    page.type(fed, '120');
    next(page);
    // step 3: main rate needed
    const rate = page.$('input[placeholder="e.g. 12"]', page.app);
    assert.ok(rate);
    page.click(page.button('Finish setup'));
    assert.equal(page.state().profileExample, true, 'blocked without a rate');
    page.type(rate, '10');
    page.click(page.button('Finish setup'));
    const S = page.state();
    assert.equal(S.profileExample, false);
    assert.equal(S.profile.gross, 1500);
    assert.equal(S.profile.periodStart, '2026-09-01');
    assert.equal(S.profile.periodEnd, '');
    assert.deepEqual(
      S.profile.deductions.map((d) => d.amount),
      [120],
    );
    assert.equal(S.profile.payTypes[0].rate, 10);
    assert.equal(S.profile.tipout.on, false);
    assert.doesNotMatch(page.text(), /You are looking at example numbers/);
  } finally {
    await page.close();
  }
});

test('guided setup: "My paystub has no deductions" lets step 2 pass', async () => {
  const page = await boot();
  try {
    page.tab('setup');
    page.type(dateInputs(page)[0], '2026-09-01');
    page.type(page.$('input[placeholder="e.g. 2,000"]', page.app), '1500');
    next(page);
    next(page);
    assert.match(page.text(), /at least one line/);
    const cb = page.$('#no-ded');
    cb.checked = true;
    page.change(cb);
    next(page);
    assert.match(page.text(), /Rates of pay/);
    page.type(page.$('input[placeholder="e.g. 12"]', page.app), '11');
    page.click(page.button('Finish setup'));
    assert.equal(page.state().profileExample, false);
    assert.equal(page.state().profile.deductions.length, 0);
  } finally {
    await page.close();
  }
});

test('guided setup: after Finish, Tonight estimates use the typed numbers', async () => {
  const page = await boot();
  try {
    page.tab('tonight');
    page.click(page.button('See an example first'));
    const example = page.$('.result .hero').textContent;
    page.tab('setup');
    page.type(dateInputs(page)[0], '2026-09-01');
    page.type(page.$('input[placeholder="e.g. 2,000"]', page.app), '1000');
    next(page);
    page.type(page.$('input[placeholder="e.g. 180"]', page.app), '100');
    next(page);
    page.type(page.$('input[placeholder="e.g. 12"]', page.app), '10');
    page.click(page.button('Finish setup'));
    page.tab('tonight');
    page.type(page.$('[data-focus-key="night-total"]', page.app), '500');
    const hero = page.$('.result .hero').textContent;
    assert.notEqual(hero, example);
    // 10% rate on the tax-like line: the tax row shows 10.0%
    assert.match(page.text(), /Taxes and % deductions \(10\.0%\)/);
  } finally {
    await page.close();
  }
});

test('guided setup: Skip swaps the example paystub for a blank one, and Tonight stays locked until the basics are in', async () => {
  const page = await boot();
  try {
    page.click(page.button('Skip guided setup'));
    const S = page.state();
    assert.equal(S.profileExample, false);
    assert.equal(S.profile.gross, 0, 'no example gross');
    assert.ok(
      S.profile.deductions.every((d) => d.amount === 0),
      'no example deductions',
    );
    assert.equal(S.nightsExample, false);
    assert.match(page.text(), /import nights from a spreadsheet once your paystub numbers are in/);
    assert.equal(page.$('input[type=file]', page.app), null, 'no importer before the basics');
    assert.equal(S.nights.length, 0);
    assert.equal(S.settings.setupDone, undefined, 'skipping is not finishing');
    assert.match(page.text(), /Tonight shows your take-home once they are in/);
    const [start] = dateInputs(page);
    page.type(start, '2026-01-01');
    assert.equal(page.state().profile.periodEnd, '');

    page.tab('tonight');
    assert.match(page.text(), /Finish setup to see your take-home/);
    assert.equal(page.$('form button[type=submit]', page.app), null, 'no Save before the basics');

    page.tab('setup');
    page.type(page.must(page.$('#pr-p1'), 'main rate'), '12');
    page.type(page.byText('.field', 'Gross pay', page.app).querySelector('input'), '1800');
    page.tab('tonight');
    assert.match(page.text(), /Finish setup/, 'still locked: no deduction yet');
    page.tab('setup');
    const cb = page.must(page.$('#no-ded'), 'no deductions box on the full page');
    cb.checked = true;
    page.change(cb);
    assert.equal(page.state().settings.noDeductions, true);
    page.tab('tonight');
    assert.ok(page.$('form button[type=submit]', page.app), 'Tonight unlocked');
    assert.match(page.text(), /Tips you made tonight/);
  } finally {
    await page.close();
  }
});

test('restore: reachable from the first-launch Setup (twice), and lands on a working Tonight', async () => {
  const S = realState();
  S.profile.gross = 4321;
  S.settings.setupDone = true;
  const code = encodeBackup(S);
  for (const from of ['banner', 'guided']) {
    const page = await boot();
    try {
      if (from === 'guided') page.tab('setup');
      page.click(page.button('Moving from another phone?', page.app));
      const box = page.must(page.$('#bk-code'), 'restore box');
      page.type(box, code);
      page.click(page.button('Restore from code'));
      assert.equal(page.state().profile.gross, 4321, from);
      assert.equal(page.state().profileExample, false);
      assert.equal(page.$('#tabs [aria-selected=true]').dataset.tab, 'tonight', 'restored: Tonight');
      assert.ok(page.$('form button[type=submit]', page.app), 'saving works');
      assert.match(page.text(), /What you made tonight/, 'a restored old code keeps its meaning: totals');
    } finally {
      await page.close();
    }
  }
});

test('toast: Undo stays past 5 s while hovered, and Escape dismisses', async () => {
  const S = realState();
  S.settings.setupDone = true;
  const page = await boot({ seed: S });
  try {
    page.tab('setup');
    page.click(page.byLabel('Remove Training'));
    const t = page.must(page.$('#toast .toast'), 'toast');
    assert.match(t.textContent, /Undo/);
    t.dispatchEvent(new page.win.Event('mouseenter'));
    await wait(30);
    assert.ok(page.$('#toast .toast'), 'still open while hovered');
    page.doc.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(page.$('#toast .toast'), null, 'Escape closes it');
  } finally {
    await page.close();
  }
});

test('pay types: Remove has an Undo that puts the row back', async () => {
  const S = realState();
  S.settings.setupDone = true;
  const page = await boot({ seed: S });
  try {
    page.tab('setup');
    const n = page.state().profile.payTypes.length;
    page.click(page.byLabel('Remove Training'));
    assert.equal(page.state().profile.payTypes.length, n - 1);
    page.click(page.button('Undo', page.$('#toast')));
    assert.equal(page.state().profile.payTypes.length, n);
    assert.equal(page.state().profile.payTypes[1].name, 'Training');
  } finally {
    await page.close();
  }
});

test('tonight: only a short summary is in the live region, announced after typing pauses', async () => {
  const S = realState();
  S.settings.setupDone = true;
  const page = await boot({ seed: S });
  try {
    const live = page.$$('[aria-live]', page.app);
    assert.ok(live.length);
    live.forEach((n) =>
      assert.ok(
        !n.querySelector('.result') && !n.classList.contains('result'),
        'result card is not inside a live region',
      ),
    );
    const summary = page.$('.sr-only[aria-live]', page.app);
    page.type(page.$('input[inputmode=decimal]', page.app), '300');
    assert.equal(summary.textContent, '', 'not announced on each keystroke');
    await wait(900);
    assert.match(summary.textContent, /^Estimated take-home \$/);
  } finally {
    await page.close();
  }
});

test('late nights: changing the rule re-dates an untouched Tonight entry but not a chosen date', async () => {
  const S = realState();
  S.settings.setupDone = true;
  const page = await boot({ seed: S });
  try {
    const dateOf = () => page.$('input[type=date]', page.app).value;
    const before = dateOf();
    page.tab('setup');
    const sel = page.$('#day-cutoff');
    sel.value = '8';
    page.change(sel);
    page.tab('tonight');
    const hoursAgo = new Date(Date.now()); // with an 8 a.m. cutoff before 8 a.m. the date is yesterday
    const expected = new Date(
      hoursAgo.getFullYear(),
      hoursAgo.getMonth(),
      hoursAgo.getDate() - (hoursAgo.getHours() < 8 ? 1 : 0),
    );
    const iso = (d) =>
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0');
    assert.equal(dateOf(), iso(expected));
    page.type(page.$('input[type=date]', page.app), '2026-01-05');
    page.tab('setup');
    const sel2 = page.$('#day-cutoff');
    sel2.value = '0';
    page.change(sel2);
    page.tab('tonight');
    assert.equal(dateOf(), '2026-01-05', 'chosen date kept');
    assert.ok(before);
  } finally {
    await page.close();
  }
});

test('guided setup: no red errors before the user types; errors appear on blur or Next', async () => {
  const page = await boot();
  try {
    page.tab('setup');
    const visible = () => page.$$('.field-error', page.app).filter((e) => !e.hidden && e.textContent);
    assert.equal(visible().length, 0, 'clean first render');
    const gross = page.$('input[placeholder="e.g. 2,000"]', page.app);
    gross.dispatchEvent(new page.win.Event('blur'));
    assert.match(page.text(), /Gross pay is needed/, 'blur reveals the missing gross');
    assert.equal(visible().length, 1, 'only the field that was left');
    next(page);
    assert.match(page.text(), /Pick the day your pay period started/);
  } finally {
    await page.close();
  }
});

test('guided setup: ticking the tip-out box shows no error until the amount is left or Finish is pressed', async () => {
  const page = await boot();
  try {
    page.tab('setup');
    page.type(dateInputs(page)[0], '2026-09-01');
    page.type(page.$('input[placeholder="e.g. 2,000"]', page.app), '1500');
    next(page);
    page.click(page.$('#no-ded'));
    next(page);
    const tick = page.$('#to-on');
    tick.checked = true;
    page.change(tick);
    const visible = () => page.$$('.field-error', page.app).filter((e) => !e.hidden && e.textContent);
    assert.equal(visible().length, 0, 'no error on tick');
    page.click(page.button('Finish setup'));
    assert.match(page.text(), /Enter the tip-out amount/);
  } finally {
    await page.close();
  }
});

test('guided setup: Finish clears the example nights and says so', async () => {
  const page = await boot();
  try {
    assert.equal(page.state().nightsExample, true);
    assert.ok(page.state().nights.length > 0);
    page.tab('setup');
    page.type(dateInputs(page)[0], '2026-09-01');
    page.type(page.$('input[placeholder="e.g. 2,000"]', page.app), '1500');
    next(page);
    page.click(page.$('#no-ded'));
    next(page);
    page.type(page.$('input[placeholder="e.g. 12"]', page.app), '10');
    page.click(page.button('Finish setup'));
    const S = page.state();
    assert.equal(S.nightsExample, false);
    assert.equal(S.nights.length, 0);
    assert.match(page.doc.body.textContent, /Example nights cleared\./);
  } finally {
    await page.close();
  }
});
