import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/js/math.js';
import * as B from '../app/js/budget.js';

const TODAY = '2026-09-28'; // a Monday; the pay period is 09-21..10-04, payday 10-05
const P = () => M.exampleProfile(TODAY);
const weekly = (over) => ({ id: 'w', name: 'Groceries', monthly: 70, freq: 'weekly', ...over });
const fortnight = (over) => ({
  id: 'f',
  name: 'Fun',
  monthly: 140,
  freq: 'biweekly',
  anchor: '2026-09-21',
  ...over,
});
const month = (over) => ({ id: 'm', name: 'Gas', monthly: 310, ...over });
const budget = (categories, spends = []) => ({ ...B.emptyBudget(), categories, spends });
const spend = (date, amount, categoryId) => ({ id: 's' + date + amount, date, amount, categoryId });

test('migrateBudget: freq must be weekly or biweekly, anchor a real date; monthly stays the default', () => {
  const m = B.migrateBudget({
    categories: [
      { id: 'a', name: 'A', monthly: 10 },
      { id: 'b', name: 'B', monthly: 10, freq: 'monthly', anchor: '2026-01-01' },
      { id: 'c', name: 'C', monthly: 10, freq: 'daily' },
      { id: 'd', name: 'D', monthly: 10, freq: 'weekly', anchor: '2026-09-30' },
      { id: 'e', name: 'E', monthly: 10, freq: 'biweekly', anchor: '2026-09-02' },
      { id: 'f', name: 'F', monthly: 10, freq: 'biweekly', anchor: 'nope' },
    ],
  });
  assert.deepEqual(m.categories[0], { id: 'a', name: 'A', monthly: 10 });
  assert.deepEqual(m.categories[1], { id: 'b', name: 'B', monthly: 10 });
  assert.deepEqual(m.categories[2], { id: 'c', name: 'C', monthly: 10 });
  assert.deepEqual(m.categories[3], {
    id: 'd',
    name: 'D',
    monthly: 10,
    freq: 'weekly',
    anchor: '2026-09-30',
  });
  assert.deepEqual(m.categories[4], {
    id: 'e',
    name: 'E',
    monthly: 10,
    freq: 'biweekly',
    anchor: '2026-09-02',
  });
  assert.equal(m.categories[5].freq, 'biweekly');
  assert.match(m.categories[5].anchor, /^\d{4}-\d{2}-\d{2}$/, 'a bad anchor falls back to a real date');
});

test('catPeriod: weeks run Monday to Sunday, fortnights count from the anchor, months are the calendar month', () => {
  assert.deepEqual(B.catPeriod(weekly(), '2026-09-27'), { start: '2026-09-21', end: '2026-09-27', len: 7 }); // Sunday
  assert.deepEqual(B.catPeriod(weekly(), '2026-09-28'), { start: '2026-09-28', end: '2026-10-04', len: 7 }); // Monday
  assert.deepEqual(B.catPeriod(fortnight(), '2026-10-04'), {
    start: '2026-09-21',
    end: '2026-10-04',
    len: 14,
  });
  assert.deepEqual(B.catPeriod(fortnight(), '2026-10-05'), {
    start: '2026-10-05',
    end: '2026-10-18',
    len: 14,
  });
  assert.deepEqual(B.catPeriod(fortnight(), '2026-09-20'), {
    start: '2026-09-07',
    end: '2026-09-20',
    len: 14,
  }); // before the anchor
  assert.deepEqual(B.catPeriod(month(), '2028-02-10'), { start: '2028-02-01', end: '2028-02-29', len: 29 });
});

test('categoryStatus: a spend counts against the week or fortnight it falls in', () => {
  const b = budget(
    [weekly({ monthly: 100 }), fortnight({ monthly: 100 })],
    [
      spend('2026-09-27', 30, 'w'), // last week's Sunday
      spend('2026-09-28', 20, 'w'), // this week's Monday
      spend('2026-10-04', 10, 'w'), // this week's Sunday
      spend('2026-10-05', 99, 'w'), // next week
      spend('2026-10-04', 40, 'f'), // last day of this fortnight
      spend('2026-10-05', 7, 'f'), // next fortnight
    ],
  );
  const [w, f] = B.categoryStatus(b, TODAY);
  assert.deepEqual(w, {
    id: 'w',
    name: 'Groceries',
    monthly: 100,
    spent: 30,
    remaining: 70,
    pct: 30,
    freq: 'weekly',
    periodStart: '2026-09-28',
    periodEnd: '2026-10-04',
  });
  assert.equal(f.spent, 40); // 10-04 is the last day of the fortnight; the 10-05 spend is in the next one
  assert.equal(B.categoryStatus(b, '2026-10-05')[0].spent, 99);
  assert.equal(B.categoryStatus(b, '2026-10-05')[1].spent, 7);
  assert.equal(B.categoryStatus(b, '2026-09-27')[0].spent, 30, 'the Sunday before belongs to the old week');
});

test('categoryStatus: overspent weekly category shows a negative remaining and pct over 100', () => {
  const b = budget([weekly({ monthly: 50 })], [spend('2026-09-29', 80, 'w')]);
  const [w] = B.categoryStatus(b, TODAY);
  assert.equal(w.remaining, -30);
  assert.equal(w.pct, 160);
});

test('categoryStatus: a month string still works and monthly categories carry no freq fields', () => {
  const b = budget([month({ monthly: 400 })], [spend('2026-09-10', 85.5, 'm'), spend('2026-10-02', 99, 'm')]);
  assert.deepEqual(B.categoryStatus(b, '2026-09')[0], {
    id: 'm',
    name: 'Gas',
    monthly: 400,
    spent: 85.5,
    remaining: 314.5,
    pct: 21,
  });
  assert.equal(B.categoryStatus(b, '2026-10')[0].spent, 99);
});

test('monthly equivalents: a week is 52/12 of a month, two weeks 26/12', () => {
  const b = budget([weekly({ monthly: 100 }), fortnight({ monthly: 100 }), month({ monthly: 400 })]);
  assert.equal(B.catMonthlyC(b.categories[0]), 43333);
  assert.equal(B.catMonthlyC(b.categories[1]), 21667);
  assert.equal(B.spendingMonthly(b), 1050);
});

test('safe to spend: a weekly category sets aside amount / 7 a day and never more than is left this week', () => {
  // Today Monday 09-28, payday 10-05: the window is exactly this week (7 days), $10 a day.
  const opt = { cashOnHand: 1000 };
  const r = B.safeToSpend(budget([weekly()]), P(), [], TODAY, opt);
  assert.equal(r.daysAway, 7);
  assert.equal(r.categories[0].reserved, 70);
  // $30 already spent this week: only $40 is left.
  const r2 = B.safeToSpend(budget([weekly()], [spend('2026-09-28', 30, 'w')]), P(), [], TODAY, opt);
  assert.equal(r2.categories[0].reserved, 40);
  // Wednesday: 5 days left in the week and the window, $50.
  const r3 = B.safeToSpend(budget([weekly()]), P(), [], '2026-09-30', opt);
  assert.equal(r3.categories[0].reserved, 50);
  // Overspent this week: nothing is set aside for it until the week turns over.
  const r4 = B.safeToSpend(budget([weekly()], [spend('2026-09-28', 90, 'w')]), P(), [], '2026-09-30', opt);
  assert.equal(r4.categories[0].reserved, 0);
});

test('safe to spend: a window that crosses a week boundary uses the full per-day allowance for the next week', () => {
  // Sunday 10-04 is the last day of the week; payday 10-05 is 1 day away. Use a 14-day pay period: payday 10-19 from 10-05.
  const p = { freq: 14, periodStart: '2026-09-21', shifts: 6, payTypes: [], deductions: [] };
  // Today Wednesday 09-30: payday 10-05 (5 days): 09-30..10-04 are all this week = 5 x $10.
  assert.equal(
    B.safeToSpend(budget([weekly()]), p, [], '2026-09-30', { cashOnHand: 0 }).categories[0].reserved,
    50,
  );
  // A 21-day pay period (payday 10-12): the window from 09-30 spans the rest of this week (5 days, but only $20 is left) and next week in full.
  const p21 = { freq: 21, periodStart: '2026-09-21', shifts: 6, payTypes: [], deductions: [] };
  const r = B.safeToSpend(budget([weekly()], [spend('2026-09-28', 50, 'w')]), p21, [], '2026-09-30', {
    cashOnHand: 0,
  });
  assert.equal(r.daysAway, 12);
  // 09-30..10-04 (5 days): min(20 left, 50) = 20. 10-05..10-11 is a whole new week: 70.
  assert.equal(r.categories[0].reserved, 20 + 70);
});

test('safe to spend: a fortnight category sets aside amount / 14 a day, capped at what is left in the fortnight', () => {
  const opt = { cashOnHand: 1000 };
  // Today 09-28 is day 8 of the fortnight 09-21..10-04; 7 days left: $10 a day = $70.
  assert.equal(B.safeToSpend(budget([fortnight()]), P(), [], TODAY, opt).categories[0].reserved, 70);
  // $100 already spent: $40 left, less than the $70.
  const spent = budget([fortnight()], [spend('2026-09-22', 100, 'f')]);
  assert.equal(B.safeToSpend(spent, P(), [], TODAY, opt).categories[0].reserved, 40);
  // Spending in the previous fortnight does not count against this one.
  const old = budget([fortnight()], [spend('2026-09-20', 140, 'f')]);
  assert.equal(B.safeToSpend(old, P(), [], TODAY, opt).categories[0].reserved, 70);
});

test('safe to spend: mixed weekly, fortnight and monthly categories add up', () => {
  const b = budget([weekly(), fortnight(), month()]);
  const r = B.safeToSpend(b, P(), [], TODAY, { cashOnHand: 1000 });
  // weekly 70 + fortnight 70 + monthly (Sep 3 days of 30 = 31, Oct 4 days of 31 = 40)
  assert.deepEqual(
    r.categories.map((c) => c.reserved),
    [70, 70, 71],
  );
  assert.equal(r.categoriesTotal, 211);
});

test('after payday: the window from payday to the next payday uses the same per-day rule, full allowance for later periods', () => {
  // Payday 10-05; the window is 10-05..10-18 (14 days).
  const b = budget([weekly(), fortnight(), month()]);
  const r = B.safeToSpend(b, P(), [], TODAY, { cashOnHand: 1000 });
  // weekly: two full weeks 140. fortnight: one full fortnight 140. monthly: 14 x 310/31 = 140.
  assert.equal(r.after.categoriesTotal, 140 + 140 + 140);
  const base = B.safeToSpend(B.emptyBudget(), P(), M.exampleNights(TODAY), TODAY, { cashOnHand: 1000 }).after;
  const withCats = B.safeToSpend(b, P(), M.exampleNights(TODAY), TODAY, { cashOnHand: 1000 }).after;
  assert.equal(withCats.left, M.round2(base.left - 420));
});

test('after payday: when the window after payday starts in the current month, its remainder is not reserved twice', () => {
  // Monthly 310, nothing spent, today 09-20 with payday 10-05 would cross the month; use a payday inside one month instead.
  const p = { freq: 14, periodStart: '2026-10-05', shifts: 6, payTypes: [], deductions: [] };
  const r = B.safeToSpend(
    budget([month({ monthly: 31 })], [spend('2026-10-06', 25, 'm')]),
    p,
    [],
    '2026-10-10',
    {
      cashOnHand: 0,
    },
  );
  // Today 10-10, period 10-05..10-18, payday 10-19. Window 9 days (10-10..10-18) but only $6 is left this month.
  assert.equal(r.categories[0].reserved, 6);
  // After payday (10-19..11-01): the $6 left of October is already used, so only Nov 1 (31 / 30, a full day) is added.
  assert.equal(r.after.categoriesTotal, 1.03);
});

test('spendingPerPaycheck: per-day allowance times the days in a pay period', () => {
  const b = budget([weekly({ monthly: 100 }), fortnight({ monthly: 200 }), month({ monthly: 400 })]);
  // Per year: 100 x 52 + 200 x 26 + 400 x 12 = 15200. A 14-day period: 15200 x 14 / 365 = 583.01
  assert.equal(B.spendingPerPaycheck(b, P(), TODAY), 583.01);
});
