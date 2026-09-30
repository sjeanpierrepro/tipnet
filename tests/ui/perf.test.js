import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { boot, realState } from './harness.js';
import { exampleBudget } from '../../app/js/budget.js';
import { addDays, todayISO } from '../../app/js/math.js';

test('performance smoke: 700 nights with blank shifts render Pay periods and Budget in under a second each', async () => {
  const today = todayISO();
  const S = realState((s) => {
    s.settings.setupDone = true;
    s.profile.shifts = 0; // blank: the app averages history for every period
    s.budget = exampleBudget();
    s.nights = Array.from({ length: 700 }, (_, i) => ({ id: i + 1, date: addDays(today, -i), total: 200 + (i % 90), cash: 40 + (i % 30), pay: { p1: 6 }, barback: i % 3 !== 0 }));
  });
  const page = await boot({ url: 'http://localhost/?unlock=dev', seed: S });
  try {
    assert.equal(page.state().nights.length, 700);
    let t = performance.now();
    page.tab('periods');
    const periodsMs = performance.now() - t;
    assert.ok(page.$$('.list-row', page.app).length >= 700, 'every night is listed');
    t = performance.now();
    page.tab('budget');
    const budgetMs = performance.now() - t;
    assert.ok(page.$('#budget-balance'), 'budget rendered');
    console.log('# periods ' + Math.round(periodsMs) + ' ms, budget ' + Math.round(budgetMs) + ' ms');
    assert.ok(periodsMs < 1000, 'Pay periods took ' + periodsMs + ' ms');
    assert.ok(budgetMs < 1000, 'Budget took ' + budgetMs + ' ms');
  } finally { await page.close(); }
});
