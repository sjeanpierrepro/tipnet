// "Add to that night": the "Saved" line says the night's new take-home as it is stored, and how much the part added
// changed it (stored after minus stored before), never the part worked out as a night of its own (a second share of
// fixed deductions, a flat tip-out charged again).
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { computeNight, shiftsPerPeriod, fromCents, toCents } from '../../app/js/math.js';
import { money } from '../../app/js/ui/common.js';

const box = (page, k) => page.must(page.$('[data-focus-key="' + k + '"]'), k);
const submit = (page) => page.click(page.$('form button[type=submit]'));

test('Add to that night (flat $20 barback from cash, $100 fixed): the Saved line is the stored night', async () => {
  const page = await boot({
    seed: realState((S) => {
      S.workplaces[0].setupDone = true;
      const p = S.workplaces[0].profile;
      p.tipouts = [{ id: 't1', k: 'barback', who: 'Barback', mode: 'flat', value: 20, from: 'cash' }];
      p.tipout = { on: true };
      p.deductions.push({ id: 'dx', k: 'health', name: 'Health', amount: 100, mode: 'fixed' });
    }),
  });
  try {
    page.type(box(page, 'night-cc'), '200');
    page.type(box(page, 'night-cash'), '100');
    page.type(box(page, 'night-pay-p1'), '8');
    submit(page);
    const S = page.state();
    const p = S.workplaces[0].profile;
    const sh = shiftsPerPeriod(p, S.nights).n;
    const before = computeNight(S.nights[0], p, sh).net;
    page.type(box(page, 'night-cc'), '50');
    page.type(box(page, 'night-cash'), '0');
    page.type(box(page, 'night-pay-p1'), '2');
    submit(page);
    page.click(page.button('Add to that night'));
    const S2 = page.state();
    assert.equal(S2.nights.length, 1);
    const after = computeNight(S2.nights[0], p, sh).net;
    const added = fromCents(toCents(after) - toCents(before));
    const line = page.$('#night-saved').textContent;
    assert.ok(line.startsWith('Saved. ' + money(after) + ' take-home for '), line + ' | stored ' + after);
    assert.ok(line.endsWith(' (+' + money(added) + ' from what you added).'), line + ' | added ' + added);
  } finally {
    await page.close();
  }
});
