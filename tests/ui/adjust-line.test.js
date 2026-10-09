// "Exact amounts on this check" (a finished pay period in Pay periods) says what it corrects: the check's fixed
// deductions, its recurring non-taxable pay, or both, from what is really in the line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { addDays, todayISO } from '../../app/js/math.js';

const t = todayISO();
const night = (id, date, wid) => ({
  id,
  date,
  total: 250,
  tips: 210,
  cash: 50,
  pay: { p1: 8 },
  barback: false,
  tipouts: {},
  tipoutOn: false,
  workplaceId: wid,
});
/** A finished pay period with 3 nights while Setup says 10 shifts: each night carries a tenth of the check's amounts. */
const seed = ({ fixed, nontax }) =>
  realState((S) => {
    const w = S.workplaces[0];
    w.setupDone = true;
    const p = w.profile;
    p.freq = 14;
    p.periodStart = addDays(t, -20);
    p.periodEnd = '';
    p.shifts = 10;
    p.tipout = { on: false };
    p.tipouts = [];
    p.deductions.find((d) => d.mode === 'fixed').amount = fixed;
    if (nontax)
      p.nontaxable = [{ id: 'x1', k: 'other', name: 'Meal allowance', amount: nontax, recurring: true }];
    for (let i = 0; i < 3; i++) S.nights.push(night('n' + i, addDays(t, -19 + i), w.id));
  });
const hintOf = async (page) => {
  page.tab('periods');
  await page.settle();
  return page.text(page.must(page.$('.period-adjust .hint'), 'the exact-amounts line'));
};

test('only non-taxable pay on the check: the line says non-taxable pay, not fixed deductions', async () => {
  const page = await boot({ seed: seed({ fixed: 0, nontax: 100 }) });
  try {
    const h = await hintOf(page);
    assert.match(h, /non-taxable pay/);
    assert.doesNotMatch(h, /fixed deductions/);
  } finally {
    await page.close();
  }
});

test('only fixed deductions: the line says fixed deductions', async () => {
  const page = await boot({ seed: seed({ fixed: 60, nontax: 0 }) });
  try {
    const h = await hintOf(page);
    assert.match(h, /fixed deductions/);
    assert.doesNotMatch(h, /non-taxable/);
  } finally {
    await page.close();
  }
});

test('both: the line says fixed deductions and non-taxable pay', async () => {
  const page = await boot({ seed: seed({ fixed: 60, nontax: 100 }) });
  try {
    assert.match(await hintOf(page), /fixed deductions and non-taxable pay/);
  } finally {
    await page.close();
  }
});
