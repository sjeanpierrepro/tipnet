// Sixth review: an establishment updated from v37 with no shift count and no past pay periods gets the default (about
// 4 shifts a week), but Setup said "TipNet filled this in from your past pay periods", though there were none. The
// default now says what it is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './harness.js';
import { todayISO, addDays } from '../../app/js/math.js';
import { migrate } from '../../app/js/storage.js';

const v37 = (nights) => {
  const today = todayISO();
  return {
    schemaVersion: 3,
    profileExample: false,
    nightsExample: false,
    workplaces: [
      {
        id: 'w1',
        name: 'Bar',
        setupDone: true,
        calib: [],
        profile: {
          freq: 14,
          periodStart: addDays(today, -3),
          periodEnd: '',
          shifts: 0,
          gross: 1500,
          deductions: [{ id: 'd1', k: 'fed', name: 'Fed', amount: 150, mode: 'pct' }],
          payTypes: [{ id: 'p1', k: 'bartender', name: 'Bartender', rate: 12, unit: 'hr', usual: 7 }],
          tipout: { on: false, mode: 'pct', value: 0, basis: 'before', from: 'cash' },
          entryMode: 'tips',
        },
      },
    ],
    nights: nights.map((ago, i) => ({
      id: 'n' + i,
      date: addDays(today, -ago),
      total: 300,
      tips: 204,
      cash: 100,
      pay: { p1: 8 },
      barback: false,
      workplaceId: 'w1',
    })),
    budget: {},
    settings: { theme: 'auto', lastTab: 'tonight', activeWorkplaceId: 'w1' },
  };
};

test('no past pay periods: the default count says it is the default, not "from your past pay periods"', async () => {
  const S = migrate(v37([1]));
  assert.equal(S.workplaces[0].profile.shifts, 8);
  assert.equal(S.workplaces[0].profile.shiftsAuto, 'default');
  assert.equal(
    migrate(JSON.parse(JSON.stringify(S))).workplaces[0].profile.shiftsAuto,
    'default',
    'kept on load',
  );
  const page = await boot({ seed: v37([1]) });
  try {
    page.openSetup();
    await page.settle();
    const n = page.must(page.$('#shifts-auto'), 'note');
    assert.equal(n.hidden, false);
    assert.equal(
      n.textContent,
      'TipNet set this to about 4 shifts a week. Change it to what you usually work; the nights of this pay period follow it.',
    );
    await page.saveSetup();
    assert.equal(page.state().workplaces[0].profile.shiftsAuto, undefined, 'confirmed by Save');
  } finally {
    await page.close();
  }
});

test('past pay periods: still "filled this in from your past pay periods"', async () => {
  const S = migrate(v37([20, 19, 18, 17, 16, 15]));
  assert.equal(S.workplaces[0].profile.shiftsAuto, true);
  const page = await boot({ seed: v37([20, 19, 18, 17, 16, 15]) });
  try {
    page.openSetup();
    await page.settle();
    assert.match(page.$('#shifts-auto').textContent, /^TipNet filled this in from your past pay periods/);
  } finally {
    await page.close();
  }
});
