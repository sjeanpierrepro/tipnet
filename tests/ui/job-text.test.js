// Tonight: with only one job to pick, the job is plain text with its rate ("Job: Bartender"), not a one-choice dropdown.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';

const seed = (mutate) =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    if (mutate) mutate(S);
  });
const row = (page, i) => page.$$('.job-row', page.app)[i];

test('one job: its name and rate as labelled text, no dropdown; hours still work', async () => {
  const page = await boot({
    seed: seed((S) => {
      const p = S.workplaces[0].profile;
      p.payTypes = p.payTypes.filter((t) => t.id !== 'p2'); // Bartender and the Bonus (other pay) only
    }),
  });
  try {
    const r = row(page, 0);
    assert.equal(r.querySelector('select'), null, 'no single-choice dropdown');
    const txt = page.must(r.querySelector('.job-fixed'), 'job text');
    assert.equal(txt.textContent, 'Job: Bartender · $12.00/h');
    assert.equal(txt.querySelector('.sr-only').textContent, 'Job: ', 'screen readers hear "Job: Bartender"');
    assert.equal(page.$('[data-focus-key="night-add-job"]'), null, 'nothing to add');
    page.type(page.$('[data-focus-key="night-cc"]'), '489');
    page.type(page.$('[data-focus-key="night-pay-p1"]'), '8');
    assert.equal(page.$('.result .hero').textContent, '$420.46');
  } finally {
    await page.close();
  }
});

test('two jobs: a dropdown; once the other job has its own row, each row has one choice and shows text', async () => {
  const page = await boot({ seed: seed() });
  try {
    const sel = row(page, 0).querySelector('select');
    assert.ok(sel, 'two jobs: a dropdown');
    assert.equal(sel.options.length, 2);
    page.click(page.$('[data-focus-key="night-add-job"]'));
    assert.equal(row(page, 0).querySelector('select'), null);
    assert.equal(row(page, 0).querySelector('.job-fixed').textContent, 'Job: Bartender · $12.00/h');
    assert.equal(row(page, 1).querySelector('.job-fixed').textContent, 'Job 2: Training · $15.00/h');
    page.click(page.byLabel('Remove Training'));
    assert.ok(row(page, 0).querySelector('select'), 'the dropdown is back');
  } finally {
    await page.close();
  }
});
