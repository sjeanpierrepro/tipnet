import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, quiet, toCode, realState } from './harness.js';
import { encodeBackup, seedState } from '../../app/js/storage.js';
import { bus } from '../../app/js/ui/common.js';
import { isUnlocked } from '../../app/js/billing.js';

const future = new Date(Date.now() + 5 * 864e5).toISOString();
const forged = () => {
  const S = seedState();
  S.settings.entitlement = {
    status: 'active',
    instanceId: null,
    validatedAt: future,
    plan: 'monthly',
    key: 'FORGED-KEY',
  };
  S.nightsExample = false;
  S.nights = [];
  return toCode(S);
};
const restoreVia = (page, code) => {
  page.tab('setup');
  const skip = page.byText('button', 'Skip guided setup');
  if (skip) page.click(skip);
  page.type(page.must(page.$('#bk-code'), '#bk-code'), code);
  page.click(page.button('Restore from code'));
};

test('restore: a hand-made code with an entitlement does not unlock Budget (payments off)', async () => {
  const page = await boot();
  try {
    assert.equal(page.tabHidden('budget'), true);
    restoreVia(page, forged());
    assert.equal(page.state().settings.entitlement, undefined);
    assert.equal(page.tabHidden('budget'), true);
    assert.equal(isUnlocked(page.state().settings.entitlement), false);
  } finally {
    await page.close();
  }
});

test('restore: a hand-made code with an entitlement stays locked when payments are on', async () => {
  const page = await boot({ payments: true });
  try {
    assert.equal(page.tabHidden('budget'), false, 'Budget tab is visible (locked) when payments are on');
    restoreVia(page, forged());
    assert.equal(page.state().settings.entitlement, undefined);
    page.tab('budget');
    assert.match(page.text(), /Unlock Budget/);
    assert.equal(page.$('#budget-balance'), null, 'no unlocked budget controls');
  } finally {
    await page.close();
  }
});

test('restore: a garbage but decodable code restores to a working app', async () => {
  const page = await boot({ payments: true });
  try {
    restoreVia(page, toCode({ profile: { deductions: {} }, nights: [null, { date: 'x' }] }));
    assert.equal(page.state().nights.length, 0);
    for (const t of ['tonight', 'periods', 'budget', 'setup']) {
      page.tab(t);
      assert.doesNotMatch(page.text(), /Something went wrong/, t);
      assert.ok(page.app.firstChild, t + ' rendered');
    }
  } finally {
    await page.close();
  }
});

/** Force a render error by poisoning the in-memory state (nights is not a list). */
const poison = (page) => {
  page.state().nights = null;
  bus.rerender();
};

test('error screen: shows, restores from a code, and erases with two taps', async () => {
  const page = await boot();
  try {
    await quiet(async () => poison(page));
    assert.match(page.text(), /Something went wrong/);
    const box = page.$('#err-code');

    // a bad code says so and changes nothing
    page.type(box, 'not a code');
    page.click(page.button('Restore from a backup code'));
    assert.match(page.text(), /That code did not work/);

    // a good code restores
    const good = realState((S) => {
      S.nights = [{ id: 1, date: '2026-01-05', total: 300, cash: 50, pay: { p1: 6 }, barback: true }];
    });
    page.type(box, encodeBackup(good));
    page.click(page.button('Restore from a backup code'));
    assert.doesNotMatch(page.text(), /Something went wrong/);
    assert.equal(page.state().nights.length, 1);
    assert.ok(page.$('.result'), 'Tonight renders again');

    // erase needs two taps
    await quiet(async () => poison(page));
    const erase = page.button('Erase everything');
    page.click(erase);
    assert.match(page.text(), /Something went wrong/, 'one tap does not erase');
    assert.match(erase.textContent, /Tap again/);
    page.click(erase);
    assert.doesNotMatch(page.text(), /Something went wrong/);
    assert.equal(page.state().nights.length, 0);
    assert.ok(page.$('.result'));
  } finally {
    await page.close();
  }
});
