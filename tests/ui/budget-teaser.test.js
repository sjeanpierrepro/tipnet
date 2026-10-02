import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { BILLING } from '../../app/js/billing.js';

const setUp = () => realState((S) => (S.workplaces[0].setupDone = true));
const teaser = (page) => page.$('#budget-teaser');
const isLast = (page) => page.app.lastElementChild === teaser(page);
const selected = (page) => page.$('#tabs [aria-selected="true"]').dataset.tab;

test('Budget card: at the very bottom of Tonight, Pay periods and Setup; Coming soon while payments are off', async () => {
  const page = await boot({ seed: setUp() });
  try {
    for (const t of ['tonight', 'periods', 'setup']) {
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
    }
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
    page.tab('tonight');
    assert.equal(selected(page), 'tonight');
    assert.ok(teaser(page));
  } finally {
    await page.close();
  }
});

test('Budget card: payments on shows the buy buttons and "I have a license key" focuses the key box', async () => {
  const page = await boot({ seed: setUp(), payments: true });
  try {
    BILLING.checkout.monthly = 'https://example.test/m';
    BILLING.checkout.yearly = 'https://example.test/y';
    page.tab('periods');
    const box = teaser(page);
    assert.ok(box && isLast(page));
    assert.doesNotMatch(page.text(box), /Coming soon/);
    const links = page.$$('a', box);
    assert.equal(links.length, 2);
    assert.equal(links[0].getAttribute('href'), 'https://example.test/m');
    page.click(page.button('I have a license key', box));
    assert.equal(selected(page), 'budget');
    assert.equal(page.doc.activeElement, page.$('#license-key'));
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
