import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { BILLING } from '../../app/js/billing.js';

const setUp = () => realState((S) => (S.workplaces[0].setupDone = true));
const teaser = (page) => page.$('#budget-teaser');
const isLast = (page) => page.app.lastElementChild === teaser(page);
const selected = (page) => page.$('#tabs [aria-selected="true"]').dataset.tab;

test('Budget card: at the very bottom of Tonight and Setup; Coming soon while payments are off', async () => {
  const page = await boot({ seed: setUp() });
  try {
    for (const t of ['tonight', 'setup']) {
      page.tab(t);
      assert.ok(teaser(page), t + ': card shown');
      assert.ok(isLast(page), t + ': card is last');
      const text = page.text(teaser(page));
      assert.match(text, /TipNet Budget/);
      assert.match(text, /Plan your bills, spending and savings around your take-home\./);
      assert.match(
        text,
        new RegExp('\\' + BILLING.prices.monthly + ' a month or \\' + BILLING.prices.yearly),
      );
      assert.match(text, /Coming soon/);
      assert.equal(page.byText('button', 'I have a license key', teaser(page)), null, t + ': no key button');
      assert.equal(page.$$('a', teaser(page)).length, 0, t + ': no buy links');
      assert.equal(page.$$('h2', teaser(page)).length, 1);
      // two buttons (owner request): "See what's inside" and "Upgrade"
      assert.deepEqual(
        page.$$('button', teaser(page)).map((b) => b.textContent.trim()),
        ['See what’s inside', 'Upgrade'],
        t,
      );
    }
    // Pay periods: one locked card only, the Budget goal card, with the price line and the same two buttons
    page.tab('periods');
    assert.equal(teaser(page), null, 'periods: no second locked card');
    const goal = page.must(page.$('#goal-card'), 'locked goal card');
    assert.equal(page.$$('.upsell', page.app).length, 1, 'periods: one locked card');
    assert.match(
      page.text(goal),
      new RegExp('\\' + BILLING.prices.monthly + ' a month or \\' + BILLING.prices.yearly),
    );
    assert.match(page.text(goal), /Coming soon/);
    assert.deepEqual(
      page.$$('button', goal).map((b) => b.textContent.trim()),
      ['See what’s inside', 'Upgrade'],
    );
    page.click(page.button('Upgrade', goal));
    assert.equal(selected(page), 'budget');
    assert.equal(page.doc.activeElement, page.$('#budget-upgrade-h'));
    page.tab('tonight');
    assert.equal(page.tabHidden('budget'), true);
    // "See what's inside" opens the preview although the tab stays hidden
    page.click(page.button('See what’s inside', teaser(page)));
    assert.equal(selected(page), 'budget');
    assert.equal(page.tabHidden('budget'), true, 'the tab stays hidden');
    assert.match(page.text(), /Unlock Budget/);
    assert.match(page.text(), /Coming soon/);
    assert.equal(page.$('#license-key'), null, 'no key box while payments are off');
    assert.equal(page.$('#budget-teaser'), null, 'no card on the Budget page');
    assert.equal(page.doc.activeElement, page.$('#app h1'));
    // the preview has its own Upgrade button: it goes to the "Unlock Budget" card (Coming soon for now)
    page.click(page.must(page.$('#budget-preview-upgrade'), 'preview Upgrade'));
    assert.equal(page.doc.activeElement, page.$('#budget-upgrade-h'));
    assert.match(page.text(page.$('#budget-upgrade')), /Coming soon/);
    page.tab('tonight');
    assert.equal(selected(page), 'tonight');
    assert.ok(teaser(page));
    // "Upgrade" on the card goes straight there too
    page.click(page.button('Upgrade', teaser(page)));
    assert.equal(selected(page), 'budget');
    assert.equal(page.tabHidden('budget'), true, 'the tab stays hidden');
    assert.equal(page.doc.activeElement, page.$('#budget-upgrade-h'));
  } finally {
    await page.close();
  }
});

test('Budget card: payments on, "Upgrade" goes straight to the plans and the key box', async () => {
  const page = await boot({ seed: setUp(), payments: true });
  const ids = BILLING.productIds;
  try {
    BILLING.checkout.monthly = 'https://example.test/m';
    BILLING.checkout.yearly = 'https://example.test/y';
    BILLING.productIds = [123]; // a live store has its product ids filled in
    page.tab('tonight');
    const box = teaser(page);
    assert.ok(box && isLast(page));
    assert.doesNotMatch(page.text(box), /Coming soon/);
    assert.equal(page.$$('a', box).length, 0, 'the plans are one tap away, on the Unlock Budget card');
    page.click(page.button('Upgrade', box));
    assert.equal(selected(page), 'budget');
    assert.equal(page.doc.activeElement, page.$('#budget-upgrade-h'));
    const links = page.$$('a', page.$('#budget-upgrade'));
    assert.deepEqual(
      links.map((a) => a.getAttribute('href')),
      ['https://example.test/m', 'https://example.test/y'],
    );
    assert.ok(page.$('#license-key'), 'the key box is right there');
  } finally {
    BILLING.productIds = ids;
    BILLING.checkout.monthly = '';
    BILLING.checkout.yearly = '';
    await page.close();
  }
});

test('"Update available" sits at the bottom of the page, right above the TipNet Budget card', async () => {
  const page = await boot({ seed: setUp() });
  try {
    const bar = page.must(page.doc.getElementById('update-bar'), 'bar');
    assert.equal(bar.hidden, true);
    bar.hidden = false; // as the service worker code does when an update is waiting
    page.tab('periods');
    assert.equal(page.app.lastElementChild, bar, 'periods (no TipNet Budget card there): last on the page');
    for (const t of ['tonight', 'setup']) {
      page.tab(t);
      assert.equal(bar.parentElement, page.app, t + ': inside the page');
      assert.equal(bar.nextElementSibling, teaser(page), t + ': right above the Budget card');
      assert.ok(isLast(page), t + ': the card is still last');
    }
  } finally {
    await page.close();
  }
});

test('Budget card: none once Budget is unlocked on this device, and none during guided setup', async () => {
  const page = await boot({ url: 'http://localhost/?unlock=dev', seed: setUp() });
  try {
    for (const t of ['tonight', 'periods', 'setup']) {
      page.tab(t);
      assert.equal(teaser(page), null, t);
    }
  } finally {
    await page.close();
  }
  const fresh = await boot();
  try {
    assert.equal(selected(fresh), 'setup');
    assert.equal(teaser(fresh), null, 'first-run guided setup has no card');
  } finally {
    await fresh.close();
  }
});
