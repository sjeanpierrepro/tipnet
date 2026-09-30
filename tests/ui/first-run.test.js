import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { computeNight, shiftsPerPeriod } from '../../app/js/math.js';
import { encodeBackup } from '../../app/js/storage.js';
import { money } from '../../app/js/ui/common.js';

const selectedTab = (page) => page.$('#tabs [aria-selected=true]').dataset.tab;
const dateInputs = (page) => page.$$('input[type=date]', page.app);
const byPh = (page, ph) => page.must(page.$('input[placeholder="' + ph + '"]', page.app), ph);
const next = (page) => page.click(page.button('Next'));

/** Guided setup with the example paystub's numbers typed by hand (tip-out left off). */
function finishSetup(page) {
  page.tab('setup');
  page.type(dateInputs(page)[0], '2026-09-01');
  page.type(byPh(page, 'e.g. 10'), '10');
  page.type(byPh(page, 'e.g. 2,000'), '2000');
  next(page);
  page.type(byPh(page, 'e.g. 180'), '180');
  page.type(byPh(page, 'e.g. 124'), '124');
  page.type(byPh(page, 'e.g. 29'), '29');
  page.type(byPh(page, 'e.g. 60'), '60');
  next(page);
  page.type(byPh(page, 'e.g. 12'), '12');
  page.click(page.button('Finish setup'));
}

test('first launch opens Setup at step 1 with the welcome line, whatever the last tab was', async () => {
  const page = await boot();
  try {
    assert.equal(selectedTab(page), 'setup');
    assert.match(
      page.text(),
      /Set up with one recent paystub \(about 3 minutes\) so TipNet can estimate your real take-home\./,
    );
    assert.match(page.text(), /Moving from another phone\? Restore a backup code/);
    assert.equal(page.$('.steps [aria-current=step]').textContent, '1. Pay period and gross');
    assert.doesNotMatch(page.text(), /You are looking at example numbers/);
  } finally {
    await page.close();
  }
});

test('first launch: a stored lastTab does not skip Setup while nothing is set up', async () => {
  const page = await boot({
    seed: (() => {
      const S = realState();
      S.profileExample = true;
      S.settings.lastTab = 'periods';
      return S;
    })(),
  });
  try {
    assert.equal(selectedTab(page), 'setup');
  } finally {
    await page.close();
  }
});

test('before setup: Tonight shows the setup card, no estimate and no Save; Set up now focuses the first field', async () => {
  const page = await boot();
  try {
    page.tab('tonight');
    assert.match(page.text(), /Finish setup to see your take-home/);
    assert.equal(page.$('.result', page.app), null, 'no estimate');
    assert.equal(page.$('form', page.app), null, 'no entry form');
    assert.equal(page.byText('button', 'Save'), null, 'no Save anywhere');
    page.click(page.button('Set up now'));
    assert.equal(selectedTab(page), 'setup');
    assert.equal(page.doc.activeElement, dateInputs(page)[0], 'focus on the first field');
  } finally {
    await page.close();
  }
});

test('before setup: "See an example first" shows the example estimate with a clear banner and no Save', async () => {
  const page = await boot();
  try {
    page.tab('tonight');
    page.click(page.button('See an example first'));
    assert.match(page.text(), /These are example numbers, not yours/);
    assert.equal(page.doc.activeElement, page.$('#example-heading'), 'focus on the banner heading');
    assert.equal(page.$('.result .hero').textContent, '$420.46');
    // new installs type tips: the $585 example night is $489 of tips plus 8 hours at $12
    assert.match(page.text(), /Tips typed \(cash \+ card\)\$489\.00/);
    assert.match(page.text(), /Cash you keep\$136\.65/);
    assert.equal(page.$('form', page.app), null);
    assert.equal(page.byText('button', 'Save'), null, 'no Save anywhere');
    page.click(page.button('Set up with my paystub'));
    assert.equal(selectedTab(page), 'setup');
    assert.equal(page.doc.activeElement, dateInputs(page)[0]);
  } finally {
    await page.close();
  }
});

test('before setup: Pay periods shows the setup card and no example nights', async () => {
  const page = await boot();
  try {
    assert.equal(page.state().nights.length, 4, 'the example nights exist in the state');
    page.tab('periods');
    assert.match(page.text(), /Finish setup first/);
    assert.equal(page.$('.list-row', page.app), null, 'example nights are not listed');
    assert.doesNotMatch(page.text(), /Check my accuracy/);
    assert.ok(page.button('Set up now', page.app));
  } finally {
    await page.close();
  }
});

test('before setup: Budget (dev unlock) shows the same card', async () => {
  const page = await boot({ url: 'http://localhost/?unlock=dev' });
  try {
    assert.equal(page.tabHidden('budget'), false, 'the dev switch shows Budget');
    page.tab('budget');
    assert.match(page.text(), /Finish setup first/);
    assert.equal(page.$('#budget-balance'), null);
  } finally {
    await page.close();
  }
});

test('after Finish: Tonight asks for tips, $400 + 8 h x $12 saves 496 and shows the real estimate', async () => {
  const page = await boot();
  try {
    finishSetup(page);
    assert.equal(selectedTab(page), 'tonight');
    const S = page.state();
    assert.equal(S.profile.entryMode, 'tips');
    assert.equal(S.settings.setupDone, true);
    assert.match(page.text(), /Tips you made tonight/);
    assert.match(page.text(), /Cash tips \+ card tips\. TipNet adds your hourly pay for the hours below\./);
    page.type(page.$('[data-focus-key="night-total"]'), '400');
    page.type(page.$('[data-focus-key="night-pay-p1"]'), '8');
    const hero = page.$('.result .hero').textContent;
    const expected = computeNight(
      { id: 'x', date: '2026-09-02', total: 496, cash: null, pay: { p1: 8 }, barback: true },
      S.profile,
      shiftsPerPeriod(S.profile, []).n,
    );
    assert.equal(hero, money(expected.net));
    assert.ok(expected.net > 407 && expected.net < 408, 'about $407: ' + expected.net);
    assert.match(page.text(), /Made tonight\$496\.00/);
    assert.match(page.text(), /of which base pay\$96\.00/);
    assert.match(page.text(), /of which tips\$400\.00/);
    page.click(page.$('form button[type=submit]'));
    const n = page.state().nights;
    assert.equal(n.length, 1);
    assert.equal(n[0].total, 496);
    assert.equal(n[0].pay.p1, 8);
    assert.ok(page.$('p.hint[role=status]').textContent.includes(hero), 'saved amount equals the preview');
  } finally {
    await page.close();
  }
});

test('restore from the first launch lands on a working Tonight', async () => {
  const code = encodeBackup(
    realState((S) => {
      S.nights = [{ id: 1, date: '2026-01-05', total: 300, cash: 50, pay: { p1: 6 }, barback: true }];
    }),
  );
  const page = await boot();
  try {
    page.click(page.button('Moving from another phone?'));
    page.type(page.$('#bk-code'), code);
    page.click(page.button('Restore from code'));
    assert.equal(selectedTab(page), 'tonight');
    assert.ok(page.$('form button[type=submit]', page.app));
    assert.ok(page.$('.result', page.app));
    assert.equal(page.state().profile.entryMode, 'total', 'an old code with real nights keeps typing totals');
  } finally {
    await page.close();
  }
});

test('erase everything goes back to the first-launch Setup, in tips mode', async () => {
  const page = await boot({ seed: realState((S) => (S.settings.setupDone = true)) });
  try {
    assert.equal(selectedTab(page), 'tonight');
    page.tab('setup');
    const erase = page.button('Erase everything');
    page.click(erase);
    page.click(erase);
    assert.equal(selectedTab(page), 'setup');
    assert.match(page.text(), /Set up with one recent paystub/);
    assert.equal(page.state().profile.entryMode, 'tips');
    page.tab('tonight');
    assert.match(page.text(), /Finish setup to see your take-home/);
  } finally {
    await page.close();
  }
});

test('existing users (real nights, no entry mode saved) open on their last tab and keep typing totals', async () => {
  const page = await boot({
    seed: realState((S) => {
      S.settings.lastTab = 'periods';
      S.nights = [{ id: 1, date: '2026-01-05', total: 300, cash: 50, pay: { p1: 6 }, barback: true }];
    }),
  });
  try {
    assert.equal(selectedTab(page), 'periods');
    assert.equal(page.state().profile.entryMode, 'total');
    page.tab('tonight');
    assert.match(page.text(), /What you made tonight/);
  } finally {
    await page.close();
  }
});
