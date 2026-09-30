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

test('legal.js exports a valid-looking email', async () => {
  globalThis.document = { querySelectorAll: () => [] };
  const { CONTACT_EMAIL } = await import('../app/js/legal.js');
  assert.match(CONTACT_EMAIL, /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
});
