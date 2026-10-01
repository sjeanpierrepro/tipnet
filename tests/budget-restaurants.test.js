// Budget with several restaurants: the next money arriving, every check in the after-payday window, goals per restaurant.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../app/js/budget.js';
import { exampleProfile, toCents } from '../app/js/math.js';

const TODAY = '2026-10-01';
// Voodoo Bayou: every two weeks, Sep 21 - Oct 4, paid the day after (Oct 5).
const A = () => ({
  ...exampleProfile(TODAY),
  freq: 14,
  periodStart: '2026-09-21',
  periodEnd: '',
  payDelay: 1,
});
// Second Spot: twice a month from the 1st, paid 2 days after the period ends (Sep 16-30 is paid Oct 2).
const Bp = () => ({
  ...exampleProfile(TODAY),
  freq: 'semimonthly',
  periodStart: '2026-09-01',
  periodEnd: '',
  payDelay: 2,
  shifts: 4,
});
// Third: once a month from the 1st, paid 20 days after the month ends (Sep is paid Oct 20).
const C = () => ({
  ...exampleProfile(TODAY),
  freq: 'monthly',
  periodStart: '2026-09-01',
  periodEnd: '',
  payDelay: 20,
});
const night = (id, date, total, cash) => ({ id, date, total, cash, pay: { p1: 6 }, barback: false });
const sources = () => [
  {
    id: 'A',
    name: 'Voodoo Bayou',
    profile: A(),
    nights: [night(1, '2026-09-22', 400, 100), night(2, '2026-09-27', 380, 90)],
  },
  {
    id: 'B',
    name: 'Second Spot',
    profile: Bp(),
    nights: [night(3, '2026-09-18', 200, 60), night(4, '2026-09-25', 220, 50)],
  },
];
const sumC = (list) => list.reduce((s, x) => s + toCents(x), 0) / 100;

test('safe to spend runs until the next money from any restaurant, and says whose check it is', () => {
  const r = B.safeToSpendAll(B.emptyBudget(), sources(), TODAY, { cashOnHand: 500 });
  assert.equal(r.payday, '2026-10-02');
  assert.equal(r.daysAway, 1);
  assert.deepEqual(r.paydaySource, { id: 'B', name: 'Second Spot' });
  // each restaurant's next check, soonest first
  assert.deepEqual(
    r.sources.map((s) => [s.id, s.payday]),
    [
      ['B', '2026-10-02'],
      ['A', '2026-10-05'],
    ],
  );
  assert.ok(
    r.sources.every((s) => s.check != null),
    'both checks can be worked out from nights with cash',
  );
  assert.equal(r.safe, 500);
});

test('after payday: every check arriving in the window, per restaurant, added up', () => {
  const r = B.safeToSpendAll(B.emptyBudget(), sources(), TODAY, { cashOnHand: 500 });
  const a = r.after;
  assert.equal(a.periodStart, '2026-10-02');
  assert.equal(a.periodEnd, '2026-10-16', 'until the day before Second Spot pays again (Oct 17)');
  assert.deepEqual(
    a.checks.map((k) => [k.name, k.date]),
    [
      ['Second Spot', '2026-10-02'],
      ['Voodoo Bayou', '2026-10-05'],
    ],
  );
  assert.equal(a.projectedCheck, sumC(a.checks.map((k) => k.amount)));
  assert.equal(a.unknownChecks, 0);
  // the first check is the same estimate the single-restaurant math gives
  const alone = B.safeToSpend(B.emptyBudget(), Bp(), sources()[1].nights, TODAY, { cashOnHand: 500 });
  assert.equal(a.checks[0].amount, alone.after.projectedCheck);
  // a restaurant with no nights yet: its check is unknown, the others still count
  const s = sources();
  s[0].nights = [];
  const r2 = B.safeToSpendAll(B.emptyBudget(), s, TODAY, { cashOnHand: 500 });
  assert.equal(r2.after.unknownChecks, 1);
  assert.equal(r2.after.projectedCheck, r2.after.checks[0].amount);
});

test('cash tips from every restaurant count when no balance is entered; spending since the earliest period start comes off', () => {
  const s = sources();
  s[1].nights.push(night(5, '2026-10-01', 150, 70)); // Second Spot's new period (Oct 1-15)
  const budget = B.emptyBudget();
  budget.spends = [
    { id: 's1', date: '2026-09-25', amount: 20, categoryId: '' },
    { id: 's2', date: '2026-09-20', amount: 99, categoryId: '' }, // before both periods began
  ];
  const r = B.safeToSpendAll(budget, s, TODAY);
  assert.equal(r.income.source, 'cash');
  // Voodoo Bayou's current period: 100 + 90 cash; Second Spot's: 70
  assert.equal(r.income.cash, 260);
  assert.equal(r.income.spent, 20);
});

test('goals follow their own restaurant: what it pays, when, and the after window counts only goals with a check in it', () => {
  const budget = B.emptyBudget();
  budget.goals = [
    { id: 'g1', name: 'Fund', target: 1000, saved: 0, perPaycheck: 50, fundedBy: 'A' },
    { id: 'g2', name: 'Car', target: 1000, saved: 0, perPaycheck: 30, fundedBy: 'B' },
    { id: 'g3', name: 'Trip', target: 1000, saved: 0, perPaycheck: 70, fundedBy: 'C' },
  ];
  const s = sources().concat([{ id: 'C', name: 'Third', profile: C(), nights: [] }]);
  const r = B.safeToSpendAll(budget, s, TODAY, { cashOnHand: 1000 });
  assert.deepEqual(
    r.goals.map((g) => [g.id, g.funderId]),
    [
      ['g1', 'A'],
      ['g2', 'B'],
      ['g3', 'C'],
    ],
  );
  assert.equal(r.goalsTotal, 150);
  // Third pays on Oct 20, outside Oct 2 - Oct 16: its goal waits for its own check
  assert.equal(r.after.goalsTotal, 80);
  // the check a contribution is recorded against is the goal's own restaurant's most recent one (Sep 1-15, paid Sep 17)
  assert.equal(B.purchasePlan(budget.goals[1], Bp(), TODAY).payday, '2026-09-17');
  assert.equal(B.purchasePlan(budget.goals[0], A(), TODAY).payday, '2026-09-21');
});

test('default restaurant for a goal: the one that pays most often; a tie goes to the first', () => {
  const weekly = { id: 'W', name: 'W', profile: { ...A(), freq: 7 }, nights: [] };
  const s = sources();
  assert.equal(B.paydaysPerYear(A(), TODAY), 26);
  assert.equal(B.paydaysPerYear(Bp(), TODAY), 24);
  assert.equal(B.defaultFunder(s, TODAY).id, 'A', 'every two weeks pays 26 times a year, twice a month 24');
  assert.equal(B.defaultFunder([s[0], weekly], TODAY).id, 'W');
  assert.equal(B.defaultFunder([s[0], { ...s[0], id: 'A2' }], TODAY).id, 'A', 'a tie keeps the first');
  assert.equal(B.funderOf({ fundedBy: 'B' }, s, TODAY).id, 'B');
  assert.equal(B.funderOf({ fundedBy: 'gone' }, s, TODAY).id, 'A');
  assert.equal(B.funderOf({}, s, TODAY).id, 'A');
});

test('what is possible from one restaurant: its check plus the others over the same days, minus everything, capped at what its check brings', () => {
  const budget = B.emptyBudget();
  budget.bills = [{ id: 'b1', name: 'Rent', amount: 1200, dueDay: 1 }];
  budget.goals = [{ id: 'g1', name: 'Fund', target: 5000, saved: 0, perPaycheck: 40, fundedBy: 'A' }];
  const s = sources();
  const pb = B.possibleAside(budget, null, null, TODAY, { sources: s, funderId: 'B' });
  assert.equal(pb.funderId, 'B');
  assert.equal(pb.funderName, 'Second Spot');
  assert.equal(pb.periodDays, 15, 'Second Spot pay period Oct 1-15');
  assert.equal(pb.known, true);
  assert.equal(pb.otherChecksList.length, 1);
  const tcA = B.typicalCheck(A(), s[0].nights, TODAY);
  assert.equal(
    pb.otherChecks,
    Math.round((toCents(tcA.check) * 15) / 14) / 100,
    'Voodoo Bayou scaled to 15 days',
  );
  assert.equal(pb.bills, Math.round((120000 * 12 * 15) / 365) / 100);
  assert.equal(
    pb.goals,
    Math.round((4000 * 15) / 14) / 100,
    "the other restaurant's goal, scaled the same way",
  );
  const free = pb.check + pb.otherChecks + pb.other - pb.bills - pb.spending - pb.goals;
  const cap = pb.check + pb.other; // no goal is saved from Second Spot yet
  assert.equal(pb.possible, Math.max(0, Math.round(Math.min(free, cap) * 100) / 100));
  // from Voodoo Bayou instead: its own goal counts in full, and its own check sets the cap
  const pa = B.possibleAside(budget, null, null, TODAY, { sources: s, funderId: 'A' });
  assert.equal(pa.periodDays, 14);
  assert.equal(pa.goals, 40);
  assert.ok(pa.possible <= pa.check + pa.other - 40 + 0.001);
  // one restaurant: the same numbers as before restaurants existed
  const one = B.possibleAside(budget, A(), s[0].nights, TODAY);
  const viaSources = B.possibleAside(budget, null, null, TODAY, { sources: [s[0]] });
  assert.equal(one.possible, viaSources.possible);
  assert.equal(one.otherChecks, 0);
});
