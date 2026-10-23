// Owner decision: Budget never projects. It uses only typed numbers and estimates of the nights that were logged.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/js/math.js';
import * as B from '../app/js/budget.js';

const TODAY = '2026-09-30'; // pay period 09-21..10-04 runs; payday 10-05
const P = (over = {}) => ({ ...M.exampleProfile('2026-09-28'), shifts: 8, ...over });
const night = (id, date, total = 300, cash = 80) => ({
  id,
  date,
  total,
  cash,
  pay: { p1: 6 },
  barback: false,
});
const three = () => [night('a', '2026-09-22'), night('b', '2026-09-24'), night('c', '2026-09-26', 420, 120)];
const empty = () => B.emptyBudget();
const earlier = () => Array.from({ length: 8 }, (_, i) => night('p' + i, M.addDays('2026-09-07', i)));

test('the next check is the logged nights check to the cent, with no scaling, when 3 of 8 shifts are logged', () => {
  const p = P();
  const nights = three();
  const want = M.periodTotals(p, nights, 0, TODAY, 8).chk;
  assert.ok(want > 0);
  const r = B.safeToSpend(empty(), p, nights, TODAY, { cashOnHand: 100 });
  assert.equal(r.sources[0].check, want);
  assert.equal(r.after.checksTotal, want);
  assert.equal(r.after.checkNights, 3);
  assert.equal(r.after.checkState, 'running');
  assert.notEqual(r.after.checksTotal, M.round2((want * 8) / 3), 'not scaled up to the 8 expected shifts');
  assert.equal(B.loggedCheckLine(3, 'running'), 'from 3 nights logged so far');
  assert.equal(B.loggedCheckLine(1, 'running'), 'from 1 night logged so far');
});

test('once the pay period ended the line says the nights you logged', () => {
  const p = { ...P(), payDelay: 4 };
  const today = '2026-10-06'; // 09-21..10-04 ended; its check arrives 10-08
  const r = B.safeToSpend(empty(), p, three(), today, { cashOnHand: 100 });
  assert.equal(r.after.checkState, 'ended');
  assert.equal(B.loggedCheckLine(r.after.checkNights, r.after.checkState), 'from the nights you logged');
});

test('no nights logged: $0 and the plain line, never an average of earlier checks', () => {
  // earlier pay periods are full of nights; the current one has none
  const r = B.safeToSpend(empty(), P(), earlier(), TODAY, { cashOnHand: 100 });
  assert.equal(r.sources[0].check, 0);
  assert.equal(r.after.checksTotal, 0);
  assert.equal(r.after.checkNights, 0);
  assert.equal(
    B.loggedCheckLine(r.after.checkNights, r.after.checkState),
    'No nights logged for this check yet.',
  );
  assert.equal(r.after.checks[0].amount, 0);
  const none = B.safeToSpend(empty(), P(), [], TODAY, { cashOnHand: 100 });
  assert.equal(none.after.checksTotal, 0);
});

test('safe to spend excludes future cash: no expected cash tips anywhere', () => {
  const p = P();
  const b = { ...empty(), bills: [{ id: 'r', name: 'Rent', amount: 100, dueDay: 2, since: '2000-01-01' }] };
  const lots = [...three(), night('d', '2026-09-27', 500, 400), night('e', '2026-09-28', 500, 400)];
  const a = B.safeToSpend(b, p, [], TODAY, { cashOnHand: 1000 });
  const c = B.safeToSpend(b, p, lots, TODAY, { cashOnHand: 1000 });
  // what you typed, less bills due before payday: logged nights add nothing to the money you have now
  assert.equal(a.safe, 900);
  assert.equal(c.safe, 900);
  assert.equal(c.income.source, 'entered');
  assert.equal('cashExpected' in c.after, false);
  assert.equal('cashExpectedTotal' in c.after, false);
  const t = M.periodTotals(p, lots, 0, TODAY, 8);
  assert.equal(
    c.after.left,
    M.round2(
      t.chk + c.after.otherIncomeTotal - c.after.billsTotal - c.after.goalsTotal - c.after.categoriesTotal,
    ),
  );
  // with nothing typed, the money you have is the cash tips logged this pay period (not more)
  const own = B.safeToSpend(b, p, lots, TODAY);
  assert.equal(own.income.source, 'cash');
  assert.equal(own.income.cash, t.cash);
});

test('goal planning with nothing logged asks for an amount instead of using a typical check', () => {
  const p = P();
  const pa = B.possibleAside(empty(), p, earlier(), TODAY); // earlier periods only
  assert.equal(pa.known, false);
  assert.equal(pa.possible, 0);
  assert.equal(pa.checkFrom, null);
  assert.deepEqual(B.loggedTakeHome(p, earlier(), TODAY), {
    amount: null,
    from: null,
    check: null,
    cash: null,
  });
  assert.deepEqual(B.asideRange(pa.possible, 500, pa.known), {
    capped: false,
    max: null,
    start: null,
    short: false,
  });
  // once a night is logged this period, the suggestion comes from it alone
  const some = B.possibleAside(empty(), p, three(), TODAY);
  assert.equal(some.known, true);
  assert.equal(some.checkFrom, 'logged');
  assert.equal(some.possible, B.loggedTakeHome(p, three(), TODAY).amount);
});

test('two establishments: each check comes from its own logged nights, none is guessed', () => {
  const pa = { ...P(), id: 'A' };
  const pb = {
    ...M.exampleProfile('2026-09-28'),
    shifts: 8,
    freq: 'semimonthly',
    periodStart: '2026-09-16',
    payDelay: 2,
  };
  const sources = [
    { id: 'A', name: 'Main', profile: pa, nights: three() },
    { id: 'B', name: 'Second', profile: pb, nights: [] },
  ];
  const r = B.safeToSpendAll(empty(), sources, TODAY, { cashOnHand: 300 });
  const bySource = Object.fromEntries(r.sources.map((s) => [s.id, s]));
  assert.equal(bySource.A.check, M.periodTotals(pa, three(), 0, TODAY, 8).chk);
  assert.equal(bySource.A.checkNights, 3);
  assert.equal(bySource.B.check, 0);
  assert.equal(bySource.B.checkNights, 0);
  assert.equal(r.after.checksTotal, M.round2(r.after.checks.reduce((s, k) => s + k.amount, 0)));
  // the room to put aside counts the other establishment as logged, never scaled up; its 15-day pay period's money is
  // shared over Main's 14 days, so it is not counted again at each of Main's paychecks
  sources[1].nights = [night('s1', '2026-09-26', 200, 50)];
  const room = B.possibleAside(empty(), null, null, TODAY, { sources, funderId: 'A' });
  const logged = B.loggedTakeHome(pb, sources[1].nights, TODAY).amount;
  assert.equal(room.otherChecksList[0].logged, logged);
  assert.equal(room.otherChecksList[0].shared, true);
  assert.equal(room.otherChecks, Math.round((M.toCents(logged) * 14) / 15) / 100);
  // from Second (15 days) instead: Main's 14 days are shorter, so they count exactly as logged
  const fromB = B.possibleAside(empty(), null, null, TODAY, { sources, funderId: 'B' });
  assert.equal(fromB.otherChecks, B.loggedTakeHome(pa, three(), TODAY).amount);
  assert.equal(fromB.otherChecksList[0].shared, false);
});

test('a weekly paycheck never counts a two-week pay period of logged money at every payday', () => {
  const two = { ...P(), id: 'A' }; // every two weeks, 09-21..10-04
  const wk = { ...P(), freq: 7, periodStart: '2026-09-28', id: 'W' }; // weekly, 09-28..10-04
  const sources = [
    { id: 'A', name: 'Main', profile: two, nights: three() },
    { id: 'W', name: 'Weekly', profile: wk, nights: [night('w1', '2026-09-29', 250, 60)] },
  ];
  const room = B.possibleAside(empty(), null, null, TODAY, { sources, funderId: 'W' });
  assert.equal(room.periodDays, 7);
  const logged = B.loggedTakeHome(two, three(), TODAY).amount;
  assert.equal(room.otherChecks, Math.round(M.toCents(logged) / 2) / 100, 'half of the 14 days logged');
});

test('old saves load unchanged: no stored budget field is added, dropped or reinterpreted', () => {
  const old = {
    bills: [{ id: 'b1', name: 'Rent', amount: 1200, dueDay: 1 }],
    categories: [{ id: 'c1', name: 'Groceries', monthly: 400 }],
    goals: [
      { id: 'g1', name: 'Fund', target: 1000, saved: 100, perPaycheck: 50 },
      {
        id: 'g2',
        name: 'Car',
        kind: 'purchase',
        target: 3000,
        saved: 0,
        perPaycheck: 0,
        targetDate: '2027-03-01',
      },
    ],
    balance: { amount: 640.5, asOf: '2026-09-01T10:00:00.000Z' },
  };
  const once = B.migrateBudget(JSON.parse(JSON.stringify(old)), undefined, '2026-09-01');
  const twice = B.migrateBudget(JSON.parse(JSON.stringify(once)), undefined, '2026-09-01');
  assert.deepEqual(twice, once);
  assert.deepEqual(
    once.bills.map((b) => [b.id, b.amount, b.dueDay]),
    [['b1', 1200, 1]],
  );
  assert.deepEqual(
    once.goals.map((g) => [g.id, g.target, g.saved, g.perPaycheck]),
    [
      ['g1', 1000, 100, 50],
      ['g2', 3000, 0, 0],
    ],
  );
  assert.equal(once.goals[1].targetDate, '2027-03-01');
  assert.deepEqual(once.balance, old.balance);
  assert.equal(JSON.stringify(once).match(/projected|average|typical|expected/i), null);
});

test('a check below $0 (taxes on cash in hand) is shown as Pay periods shows it, never clamped to $0', () => {
  const p = P();
  const nights = [night('n', '2026-09-22', 100, 100)]; // all cash: the taxes on it come out of the check
  const want = M.periodTotals(p, nights, 0, TODAY).chk;
  assert.ok(want < 0);
  const r = B.safeToSpend(empty(), p, nights, TODAY, { cashOnHand: 100 });
  assert.equal(r.sources[0].check, want);
  assert.equal(r.after.checksTotal, want);
  // ended but not paid yet: the same amount as the period's nights add up to on Pay periods
  const q = { ...p, payDelay: 4 };
  const e = B.safeToSpend(empty(), q, nights, '2026-10-06', { cashOnHand: 100 });
  assert.equal(e.after.checkState, 'ended');
  assert.equal(e.after.checksTotal, M.periodTotals(q, nights, 0, '2026-10-06').chk);
});

test('nights with no cash entered are named, so the line never reads as fewer nights than were logged', () => {
  const p = P();
  const nights = [...three(), night('d', '2026-09-27', 300, '')];
  const r = B.safeToSpend(empty(), p, nights, TODAY, { cashOnHand: 100 });
  assert.equal(r.after.checkNights, 3);
  assert.equal(r.after.checkLogged, 4);
  assert.equal(
    B.loggedCheckLine(r.after.checkNights, r.after.checkState, r.after.checkLogged),
    'from 3 nights logged so far; 1 more has no cash in hand entered',
  );
  const only = B.safeToSpend(empty(), p, [night('d', '2026-09-27', 300, '')], TODAY, { cashOnHand: 100 });
  assert.equal(only.after.checksTotal, 0);
  assert.equal(
    B.loggedCheckLine(only.after.checkNights, only.after.checkState, only.after.checkLogged),
    'No cash in hand entered for this check’s nights yet.',
  );
});
