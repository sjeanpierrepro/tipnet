import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pages = ['privacy', 'terms'];
for (const name of pages) {
  test(`${name}.html is finished and wired to legal.js`, () => {
    const html = readFileSync(new URL(`../app/${name}.html`, import.meta.url), 'utf8');
    assert.doesNotMatch(html, /\[[A-Z][A-Z ]+\]/, 'no [PLACEHOLDER] left');
    assert.match(html, /data-contact-email/);
    assert.match(html, /<script type="module" src="js\/legal\.js"><\/script>/);
    assert.match(html, /http-equiv="Content-Security-Policy"/);
  });
}

const fakeDoc = () => {
  const mk = () => ({ textContent: '', href: '' });
  const els = { name: [mk(), mk()], cancel: [mk()], privacy: [mk()] };
  const bySel = {
    '[data-provider-name]': els.name,
    '[data-provider-cancel]': els.cancel,
    'a[data-provider-privacy]': els.privacy,
  };
  return { els, querySelectorAll: (sel) => bySel[sel] || [] };
};
const POLAR_CFG = {
  provider: 'polar',
  organizationId: '21069ded-8117-4125-a4da-1e9c11e82ea8',
  benefitId: 'b74169ed-9c5f-4dab-96c9-d1a9dbacd974',
};

test('legal pages: markup defaults say Lemon Squeezy (also while payments are off) and carry the fill hooks', () => {
  for (const name of pages) {
    const html = readFileSync(new URL(`../app/${name}.html`, import.meta.url), 'utf8');
    assert.match(html, /<span data-provider-name>Lemon Squeezy<\/span>/);
    assert.doesNotMatch(html, /Polar/);
    assert.doesNotMatch(
      html
        .replace(/<span data-provider-name>Lemon Squeezy<\/span>/g, '')
        .replace(/<span data-provider-cancel>[^<]*<\/span>/g, ''),
      /(?<!>)Lemon Squeezy(?!<)(?! \(?[a-z]*\))/,
      'every Lemon Squeezy mention is fillable',
    );
  }
  const priv = readFileSync(new URL('../app/privacy.html', import.meta.url), 'utf8');
  assert.match(priv, /href="https:\/\/www\.lemonsqueezy\.com\/privacy"[^>]*data-provider-privacy/);
  const terms = readFileSync(new URL('../app/terms.html', import.meta.url), 'utf8');
  assert.match(terms, /data-provider-cancel/);
});

test('legal pages: fillProvider names the provider in use, with its privacy link', async () => {
  globalThis.document = { querySelectorAll: () => [] };
  const { fillProvider } = await import('../app/js/legal.js');
  const { providerInfo } = await import('../app/js/billing.js');
  const polar = fakeDoc();
  fillProvider(polar, providerInfo(POLAR_CFG));
  assert.deepEqual(
    polar.els.name.map((e) => e.textContent),
    ['Polar', 'Polar'],
  );
  assert.equal(polar.els.cancel[0].textContent, 'the Polar customer portal');
  assert.equal(polar.els.privacy[0].href, 'https://polar.sh/legal/privacy');
  assert.equal(polar.els.privacy[0].textContent, 'polar.sh/legal/privacy');
  for (const cfg of [{ provider: 'lemonsqueezy', productIds: [1] }, {}, { provider: 'polar' }]) {
    const d = fakeDoc();
    fillProvider(d, providerInfo(cfg));
    assert.deepEqual(
      d.els.name.map((e) => e.textContent),
      ['Lemon Squeezy', 'Lemon Squeezy'],
    );
    assert.equal(d.els.cancel[0].textContent, "Lemon Squeezy's My Orders page");
    assert.equal(d.els.privacy[0].href, 'https://www.lemonsqueezy.com/privacy');
  }
});

test('legal.js exports a valid-looking email', async () => {
  globalThis.document = { querySelectorAll: () => [] };
  const { CONTACT_EMAIL } = await import('../app/js/legal.js');
  assert.match(CONTACT_EMAIL, /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
});
