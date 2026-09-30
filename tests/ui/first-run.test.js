import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './harness.js';
import { computeNight, shiftsPerPeriod } from '../../app/js/math.js';
import { money } from '../../app/js/ui/common.js';

test('first run: example banner, example estimate, first real night clears examples and matches the preview', async () => {
  const page = await boot();
  try {
    assert.match(page.text(), /You are looking at example numbers/);
    const hero = page.$('.result .hero').textContent;
    const S = page.state();
    const ex = computeNight(
      { id: 'x', date: S.nights[0].date, total: 585, cash: 210, pay: { p1: 8 }, barback: true },
      S.profile,
      shiftsPerPeriod(S.profile, []).n,
    );
    assert.equal(hero, money(ex.net), 'hero shows the example estimate');
    assert.equal(S.nights.length, 4);
    assert.equal(S.nightsExample, true);

    page.click(page.$('form button[type=submit]'));
    const saved = page.$('p.hint[role=status]').textContent;
    assert.equal(saved.includes(hero), true, 'saved amount equals preview: ' + saved + ' vs ' + hero);
    const S2 = page.state();
    assert.equal(S2.nights.length, 1);
    assert.equal(S2.nightsExample, false);
    assert.equal(S2.nights[0].total, 585);
    assert.doesNotMatch(page.text(), /nights listed are examples/);
  } finally {
    await page.close();
  }
});
