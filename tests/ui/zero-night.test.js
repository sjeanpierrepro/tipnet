// A real night that comes to $0 in tips and hourly pay is still a night: both tips boxes typed (0 is fine) and hours
// (at a job with no rate) or Other pay (a bonus, paid on top) entered. Only a night with nothing entered at all is
// refused ("Enter your tips or your hours first.").
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { computeNight } from '../../app/js/math.js';
import { NOTHING_MSG } from '../../app/js/ui/tonight.js';

const box = (page, k) => page.must(page.$('[data-focus-key="' + k + '"]'), k);
const submit = (page) => page.click(page.$('form button[type=submit]'));
const errors = (page) =>
  page
    .$$('.field-error')
    .filter((e) => !e.hidden)
    .map((e) => e.textContent)
    .join(' | ');

test('$0 CC, $0 cash and 5 hours at a job with no rate: saved, and the preview shows it', async () => {
  const page = await boot({
    seed: realState((S) => {
      S.workplaces[0].setupDone = true;
      S.workplaces[0].profile.payTypes[0].rate = 0;
    }),
  });
  try {
    page.type(box(page, 'night-cc'), '0');
    page.type(box(page, 'night-cash'), '0');
    page.type(box(page, 'night-pay-p1'), '5');
    assert.doesNotMatch(page.text(page.$('.result')), /Enter tonight’s tips above/);
    assert.match(page.$('.quick-net').textContent, /^Estimated take-home: /);
    submit(page);
    assert.equal(errors(page), '');
    const S = page.state();
    assert.equal(S.nights.length, 1);
    assert.equal(S.nights[0].pay.p1, 5);
    assert.match(page.$('#night-saved').textContent, /^Saved\. /);
  } finally {
    await page.close();
  }
});

test('$0 CC, $0 cash, 0 hours and a $50 bonus (Other pay): saved with the bonus, and the preview shows it', async () => {
  const page = await boot({
    seed: realState((S) => {
      S.workplaces[0].setupDone = true;
    }),
  });
  try {
    page.type(box(page, 'night-cc'), '0');
    page.type(box(page, 'night-cash'), '0');
    page.type(box(page, 'night-pay-p1'), '0');
    page.click(page.button('+ Add other pay'));
    page.type(box(page, 'night-pay-p3'), '50');
    assert.doesNotMatch(page.text(page.$('.result')), /Enter tonight’s tips above/);
    const quick = page.$('.quick-net').textContent;
    assert.match(quick, /^Estimated take-home: \$\d/);
    submit(page);
    assert.equal(errors(page), '');
    const S = page.state();
    assert.equal(S.nights.length, 1);
    assert.equal(S.nights[0].pay.p3, 50);
    const c = computeNight(S.nights[0], S.workplaces[0].profile, 10);
    assert.equal(c.extra, 50);
    assert.ok(page.$('#night-saved').textContent.includes(quick.replace('Estimated take-home: ', '')));
  } finally {
    await page.close();
  }
});

test('nothing entered ($0, $0 and 0 hours): still refused', async () => {
  const page = await boot({
    seed: realState((S) => {
      S.workplaces[0].setupDone = true;
    }),
  });
  try {
    page.type(box(page, 'night-cc'), '0');
    page.type(box(page, 'night-cash'), '0');
    page.type(box(page, 'night-pay-p1'), '0');
    assert.match(page.text(page.$('.result')), /Enter tonight’s tips above/);
    submit(page);
    assert.equal(page.state().nights.length, 0);
    assert.match(errors(page), new RegExp(NOTHING_MSG.replace('.', '\\.')));
  } finally {
    await page.close();
  }
});
