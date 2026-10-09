// Tonight's preview on a date that already has a saved night: it says so and shows what "Add to it", "Replace it" and
// "As its own night" will each come to, worked out as Save stores them, so the numbers equal the stored night's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { computeNight, shiftsPerPeriod } from '../../app/js/math.js';
import { money } from '../../app/js/ui/common.js';

const box = (page, k) => page.must(page.$('[data-focus-key="' + k + '"]'), k);
const submit = (page) => page.click(page.$('form button[type=submit]'));
const seed = () =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    const p = S.workplaces[0].profile;
    p.tipouts = [{ id: 't1', k: 'barback', who: 'Barback', mode: 'flat', value: 20, from: 'cash' }];
    p.tipout = { on: true };
    p.deductions.push({ id: 'dx', k: 'health', name: 'Health', amount: 100, mode: 'fixed' });
  });
const fill = (page, cc, cash, hrs) => {
  page.type(box(page, 'night-cc'), cc);
  page.type(box(page, 'night-cash'), cash);
  page.type(box(page, 'night-pay-p1'), hrs);
};
const stored = (page) => {
  const S = page.state();
  const p = S.workplaces[0].profile;
  const sh = shiftsPerPeriod(p, S.nights).n;
  return S.nights.map((n) => computeNight(n, p, sh).net);
};
const preview = (page) => {
  const t = page.$('#night-dup-preview').textContent;
  const m = t.match(
    /\((\$[\d,.]+)\)\. Add to it: (\$[\d,.]+) \(\+(\$[\d,.]+)\)\. Replace it: (\$[\d,.]+)\. As its own night: (\$[\d,.]+)\./,
  );
  assert.ok(m, t);
  return { was: m[1], add: m[2], plus: m[3], rep: m[4], own: m[5] };
};

for (const [verb, pick] of [
  ['Add to that night', 'add'],
  ['Replace it', 'rep'],
  ['Save as a separate night', 'own'],
]) {
  test('dup preview: "' + verb + '" stores what the preview said', async () => {
    const page = await boot({ seed: seed() });
    try {
      fill(page, '200', '100', '8');
      submit(page);
      const first = stored(page)[0];
      fill(page, '50', '0', '2');
      const pv = preview(page);
      assert.equal(pv.was, money(first));
      const own = page.$('#tonight-result, .result') ? page.text() : '';
      assert.ok(own.includes(pv.own), 'the take-home shown is the "own night" number');
      submit(page);
      page.click(page.button(verb));
      const after = stored(page);
      const want = pv[pick];
      const got = pick === 'own' ? after[after.length - 1] : after[0];
      assert.equal(money(got), want);
      if (pick === 'add')
        assert.ok(page.$('#night-saved').textContent.startsWith('Saved. ' + want + ' take-home'));
    } finally {
      await page.close();
    }
  });
}

test('dup preview: no saved night on that date, no note', async () => {
  const page = await boot({ seed: seed() });
  try {
    fill(page, '50', '0', '2');
    assert.equal(page.$('#night-dup-preview'), null);
  } finally {
    await page.close();
  }
});
