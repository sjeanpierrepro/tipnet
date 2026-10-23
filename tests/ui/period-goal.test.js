// Pay periods, bottom of the page: "So far this pay period" (free) and the Budget goal card (TipNet Budget).
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import {
  addDays,
  dayDiff,
  todayISO,
  periodIndex,
  periodTotals,
  snapshotFor,
  computeNight,
} from '../../app/js/math.js';
import { encodeBackup, decodeBackup } from '../../app/js/storage.js';

const DEV = 'http://localhost/?unlock=dev';
const today = todayISO();
const clone = (o) => JSON.parse(JSON.stringify(o));
const start = addDays(today, -5); // 14-day periods: the one in progress is [today-5, today+8]; payday today+9
const dayOf = (iso) => Number(iso.slice(8, 10));
const usd = (c) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
const money = (s) => Math.round(parseFloat(s.replace(/[^0-9.]/g, '')) * 100);

const profileOf = (rate = 10) => {
  const p = realState().workplaces[0].profile;
  Object.assign(p, { periodStart: start, periodEnd: addDays(start, 13), freq: 14, shifts: 10, payDelay: 1 });
  p.payTypes[0].rate = rate;
  p.tipout = { on: true, mode: 'pct', value: 10, basis: 'before', from: 'cash' };
  return p;
};
const night = (id, ago, tips, cash, w = 'w1', tipoutOn = true) => ({
  id,
  date: addDays(today, -ago),
  total: tips + 80,
  tips,
  cash,
  pay: { p1: 8 },
  tipoutOn,
  workplaceId: w,
});
const one = (mutate) =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    S.workplaces[0].profile = profileOf();
    S.nights = [night('a', 3, 300, 120), night('b', 2, 255.55, 0, 'w1', false), night('c', 1, 410.1, 60.4)];
    if (mutate) mutate(S);
  });
const two = () =>
  one((S) => {
    const w2 = clone(S.workplaces[0]);
    w2.id = 'w2';
    w2.name = 'Second Spot';
    w2.profile = profileOf(14);
    S.workplaces.push(w2);
    S.nights.push(night('d', 4, 200, 50, 'w2'), night('e', 1, 333.33, 33.33, 'w2'));
    S.settings.periodsFilter = 'all';
  });
/** bills and a savings goal so the automatic goal is known: a $2,000 bill due 2 days from now, a $77 one after payday. */
const budgeted = (S) => {
  S.budget.bills = [
    { id: 'b1', name: 'Rent', amount: 2000, dueDay: dayOf(addDays(today, 2)), since: addDays(today, -60) },
    { id: 'b2', name: 'Phone', amount: 77, dueDay: dayOf(addDays(today, 12)), since: addDays(today, -60) },
  ];
  S.budget.goals = [{ id: 'g1', name: 'Trip', target: 1000, saved: 0, perPaycheck: 50 }];
};
const periodNums = (S, wid) => {
  const w = S.workplaces.find((x) => x.id === wid);
  const ns = S.nights.filter((n) => n.workplaceId === wid);
  const idx = periodIndex(w.profile, today);
  return periodTotals(w.profile, ns, idx, today, 10);
};
const text = (page, sel) => page.text(page.must(page.$(sel), sel));

test('So far this pay period: equals the period section to the cent (cash, check, tip-outs)', async () => {
  const page = await boot({ seed: one() });
  try {
    page.tab('periods');
    const S = page.state();
    const t = periodNums(S, 'w1');
    const idx = periodIndex(S.workplaces[0].profile, today);
    const sec = page.must(page.$('section[data-period="' + idx + '"]', page.app), 'current period');
    const head = page.text(sec.querySelector('.spread b.num'));
    assert.equal(money(head), Math.round(t.net * 100));
    assert.equal(money(text(page, '#so-far-net-w1')), Math.round(t.net * 100));
    assert.equal(money(text(page, '#so-far-cash-w1')), Math.round(t.cash * 100));
    assert.equal(money(text(page, '#so-far-check-w1')), Math.round(t.chk * 100));
    assert.equal(text(page, '#so-far-nights-w1'), '3');
    assert.equal(text(page, '#so-far-net-w1'), head.replace(' take-home', ''), 'same text as the section');
    assert.match(text(page, '#so-far'), /So far this pay period/);
  } finally {
    await page.close();
  }
});

test('So far this pay period: two establishments get a line each; the filter narrows it', async () => {
  const page = await boot({ seed: two() });
  try {
    page.tab('periods');
    const S = page.state();
    for (const wid of ['w1', 'w2']) {
      const t = periodNums(S, wid);
      assert.equal(money(text(page, '#so-far-net-' + wid)), Math.round(t.net * 100), wid);
      assert.equal(money(text(page, '#so-far-cash-' + wid)), Math.round(t.cash * 100), wid);
      assert.equal(money(text(page, '#so-far-check-' + wid)), Math.round(t.chk * 100), wid);
    }
    assert.match(text(page, '#so-far'), /Second Spot/);
    page.click(page.byText('button', 'Second Spot', page.$('#periods-filter') || page.app));
    assert.equal(page.$('#so-far-net-w1'), null, 'only the establishment picked');
    assert.ok(page.$('#so-far-net-w2'));
  } finally {
    await page.close();
  }
});

test('So far this pay period: no night yet gives a calm line', async () => {
  const page = await boot({ seed: one((S) => (S.nights = [])) });
  try {
    page.tab('periods');
    assert.match(text(page, '#so-far'), /No nights logged yet in this pay period/);
    assert.equal(page.$('#so-far-net-w1'), null);
  } finally {
    await page.close();
  }
});

// The budget's needs in the fixtures: bills $2,000 + $77 a month; the Trip goal $50 a paycheck from a two-week job =
// $50 x 26 / 12 = $108.33 a month. Needs $2,185.33 a month = $2,185.33 x 12 / 26 = $1,008.61 per two-week pay period.
const NEEDS_MONTH_C = 200000 + 7700 + Math.round((5000 * 26) / 12);
const NEEDS_PERIOD_C = Math.round((NEEDS_MONTH_C * 12) / 26);
const monthOf = (iso) => iso.slice(0, 7);
const daysLeftInMonth = () => {
  const next = addDays(today.slice(0, 8) + '01', 32).slice(0, 8) + '01';
  return dayDiff(today, addDays(next, -1)) + 1;
};
const select = (page, sel, value) => {
  const s = page.must(page.$(sel), sel);
  s.value = value;
  page.change(s);
};

test('goal card: the budget needs a month, converted to the pay period; short by, and the per-night line', async () => {
  assert.equal(NEEDS_PERIOD_C, 100861);
  const page = await boot({ url: DEV, seed: one(budgeted) });
  try {
    page.tab('periods');
    const net = Math.round(periodNums(page.state(), 'w1').net * 100);
    assert.equal(text(page, '#goal-card-h'), 'Budget goal for this pay period');
    assert.equal(
      text(page, '#goal-line'),
      'Your budget needs ' +
        usd(NEEDS_MONTH_C) +
        ' a month = ' +
        usd(NEEDS_PERIOD_C) +
        ' per two-week pay period.',
    );
    assert.equal(text(page, '#goal-breakdown'), 'bills $2,077.00 a month + savings goals $108.33 a month');
    assert.equal(text(page, '#goal-made'), 'Made so far ' + usd(net) + ' (estimated take-home)');
    assert.equal(text(page, '#goal-result'), 'Short by ' + usd(NEEDS_PERIOD_C - net));
    // 10 shifts a pay period, 3 nights logged: 7 left (9 days left in the period, so the cap does not bind)
    assert.match(
      text(page, '#goal-pace'),
      new RegExp(
        '^About \\$' + ((NEEDS_PERIOD_C - net) / 100 / 7).toFixed(2) + ' a night over your next 7 shifts',
      ),
    );
  } finally {
    await page.close();
  }
});

test('goal card: "$X extra" when made is over the goal, and no per-night line', async () => {
  const page = await boot({
    url: DEV,
    seed: one((S) => {
      budgeted(S);
      S.budget.bills = [S.budget.bills[0]];
      S.budget.bills[0].amount = 26; // $26 a month = $12.00 per two-week pay period
      S.budget.goals = [];
    }),
  });
  try {
    page.tab('periods');
    const net = Math.round(periodNums(page.state(), 'w1').net * 100);
    assert.equal(
      text(page, '#goal-line'),
      'Your budget needs $26.00 a month = $12.00 per two-week pay period.',
    );
    assert.equal(text(page, '#goal-result'), usd(net - 1200) + ' extra');
    assert.equal(page.$('#goal-pace'), null);
  } finally {
    await page.close();
  }
});

test('goal card: short with every shift already worked gives no per-night line', async () => {
  const page = await boot({
    url: DEV,
    seed: one((S) => {
      budgeted(S);
      S.workplaces[0].profile.shifts = 3;
      const snap = snapshotFor(S.workplaces[0].profile, 3);
      S.nights.forEach((n) => (n.snap = clone(snap)));
      S.budget.bills[0].amount = 5000;
    }),
  });
  try {
    page.tab('periods');
    assert.match(text(page, '#goal-result'), /^Short by /);
    assert.equal(page.$('#goal-pace'), null);
  } finally {
    await page.close();
  }
});

test('goal card: two establishments on the same schedule add their take-home for the pay period', async () => {
  const page = await boot({
    url: DEV,
    seed: (() => {
      const S = two();
      budgeted(S);
      return S;
    })(),
  });
  try {
    page.tab('periods');
    const S = page.state();
    const net = Math.round((periodNums(S, 'w1').net + periodNums(S, 'w2').net) * 100);
    assert.match(text(page, '#goal-line'), /per two-week pay period\.$/);
    assert.equal(money(text(page, '#goal-made')), net);
    assert.equal(
      net,
      money(text(page, '#so-far-net-w1')) + money(text(page, '#so-far-net-w2')),
      'the two lines of the card above',
    );
  } finally {
    await page.close();
  }
});

/** w2 paid every week: the two schedules differ, so "All" shows the calendar month. */
const mixed = () => {
  const S = two();
  budgeted(S);
  const p2 = S.workplaces[1].profile;
  p2.freq = 7;
  p2.periodStart = addDays(today, -2);
  p2.periodEnd = addDays(today, 4);
  S.budget.goals[0].fundedBy = 'w1'; // saved from the two-week job, so the needs stay the same
  return S;
};

test('goal card: "All" with different schedules shows this month, nights dated this month from every establishment', async () => {
  const page = await boot({ url: DEV, seed: mixed() });
  try {
    page.tab('periods');
    const S = page.state();
    const m = monthOf(today);
    let madeC = 0,
      remaining = 0;
    for (const w of S.workplaces) {
      const mine = S.nights.filter((n) => n.workplaceId === w.id && monthOf(n.date) === m);
      mine.forEach((n) => (madeC += Math.round(computeNight(n, w.profile, 10).net * 100)));
      const perMonth = Math.round((10 * (w.profile.freq === 7 ? 52 : 26)) / 12);
      remaining += Math.min(daysLeftInMonth(), Math.max(0, perMonth - mine.length));
    }
    assert.equal(text(page, '#goal-card-h'), 'Budget goal for this month');
    assert.equal(text(page, '#goal-line'), 'This month: budget needs ' + usd(NEEDS_MONTH_C) + '.');
    assert.equal(
      text(page, '#goal-made'),
      'Made so far ' + usd(madeC) + ' (nights dated this month, all establishments)',
    );
    const diff = NEEDS_MONTH_C - madeC;
    assert.equal(text(page, '#goal-result'), diff > 0 ? 'Short by ' + usd(diff) : usd(-diff) + ' extra');
    if (diff > 0 && remaining > 0)
      assert.equal(
        text(page, '#goal-pace'),
        'About ' +
          usd(Math.round(diff / remaining)) +
          ' a night over your next ' +
          (remaining === 1 ? 'shift' : remaining + ' shifts') +
          ' this month (estimate).',
      );
    // the filter on one establishment: back to its own pay period
    page.click(page.byText('button', 'Second Spot', page.$('#periods-filter') || page.app));
    assert.equal(
      text(page, '#goal-line'),
      'Your budget needs ' +
        usd(NEEDS_MONTH_C) +
        ' a month = ' +
        usd(Math.round((NEEDS_MONTH_C * 12) / 52)) +
        ' per one-week pay period.',
    );
    assert.equal(money(text(page, '#goal-made')), Math.round(periodNums(page.state(), 'w2').net * 100));
  } finally {
    await page.close();
  }
});

test('goal card: the extra goal is added on top, per month or per week, and never changes a Budget number', async () => {
  const page = await boot({ url: DEV, seed: one(budgeted) });
  try {
    page.tab('budget');
    const budgetBefore = page.text();
    page.tab('periods');
    const net = Math.round(periodNums(page.state(), 'w1').net * 100);
    const box = page.must(page.$('#goal-extra'), 'extra goal box');
    const per = page.must(page.$('#goal-extra-per'), 'per month / per week');
    assert.equal(per.tagName, 'SELECT');
    assert.equal(per.getAttribute('aria-label'), 'Extra goal: per month or per week');
    assert.equal(per.value, 'month', 'a month by default');
    assert.equal(page.$('#goal-extra-remove').hidden, true);
    page.type(box, '200');
    page.change(box);
    assert.deepEqual(page.state().budget.extraGoal, { amount: 200, per: 'month' });
    // $200 a month x 12 / 26 = $92.31
    assert.equal(text(page, '#goal-extra-line'), '+ extra $200.00 a month = $92.31 this pay period');
    assert.equal(text(page, '#goal-result'), 'Short by ' + usd(NEEDS_PERIOD_C + 9231 - net));
    // switching the unit keeps the amount: $200 a week x 52 / 26 = $400.00
    select(page, '#goal-extra-per', 'week');
    assert.deepEqual(page.state().budget.extraGoal, { amount: 200, per: 'week' });
    assert.equal(page.$('#goal-extra').value, '200');
    assert.equal(text(page, '#goal-extra-line'), '+ extra $200.00 a week = $400.00 this pay period');
    assert.equal(text(page, '#goal-result'), 'Short by ' + usd(NEEDS_PERIOD_C + 40000 - net));
    page.tab('budget');
    assert.equal(page.text(), budgetBefore, 'the Budget tab is exactly the same');
    page.tab('periods');
    page.click(page.$('#goal-extra-remove'));
    assert.equal(page.state().budget.extraGoal, undefined, 'removing clears it');
    assert.equal(page.$('#goal-extra-line'), null);
    assert.equal(page.$('#goal-extra').value, '');
  } finally {
    await page.close();
  }
});

test('goal card: the extra goal in the month view is converted to the month', async () => {
  const S = mixed();
  S.budget.extraGoal = { amount: 100, per: 'week' };
  const page = await boot({ url: DEV, seed: S });
  try {
    page.tab('periods');
    // $100 a week x 52 / 12 = $433.33
    assert.equal(text(page, '#goal-extra-line'), '+ extra $100.00 a week = $433.33 this month');
  } finally {
    await page.close();
  }
});

test('goal card: a money typo is refused and never stored', async () => {
  const page = await boot({ url: DEV, seed: one(budgeted) });
  try {
    page.tab('periods');
    const box = page.must(page.$('#goal-extra'), 'extra goal box');
    page.type(box, '12abc');
    page.change(box);
    assert.equal(page.state().budget.extraGoal, undefined);
    assert.match(page.text(page.app), /That isn’t an amount/);
    assert.equal(page.$('#goal-extra-line'), null);
  } finally {
    await page.close();
  }
});

test('goal card: the extra goal survives a backup round trip, with its unit', async () => {
  for (const per of ['month', 'week']) {
    const S = one(budgeted);
    S.budget.extraGoal = { amount: 640.5, per };
    const back = decodeBackup(encodeBackup(S));
    assert.deepEqual(back.budget.extraGoal, { amount: 640.5, per });
    const page = await boot({ url: DEV, seed: back });
    try {
      page.tab('periods');
      assert.equal(page.$('#goal-extra').value, '640.5');
      assert.equal(page.$('#goal-extra-per').value, per);
      assert.match(text(page, '#goal-extra-line'), new RegExp('^\\+ extra \\$640\\.50 a ' + per + ' = '));
    } finally {
      await page.close();
    }
  }
});

test('goal card: free users see it locked with one line and "See what’s inside"; payments off says Coming soon', async () => {
  const page = await boot({ seed: one(budgeted) });
  try {
    page.tab('periods');
    const card = page.must(page.$('#goal-card'), 'locked card');
    assert.match(page.text(card), /TipNet Budget shows what your bills and savings need/);
    assert.match(page.text(card), /Coming soon/);
    assert.equal(page.$('#goal-own'), null, 'no numbers and no box');
    assert.equal(page.$('#goal-line'), null);
    assert.ok(page.$('#so-far'), 'the free card is still there');
    page.click(page.$('#goal-card-see'));
    assert.equal(page.$('#tabs [aria-selected="true"]').dataset.tab, 'budget', 'opens the preview');
  } finally {
    await page.close();
  }
});

test('goal card: nothing shown when it cannot be worked out (not set up yet)', async () => {
  const page = await boot({ url: DEV });
  try {
    page.tab('periods');
    assert.equal(page.$('#goal-card'), null);
    assert.equal(page.$('#so-far'), null);
  } finally {
    await page.close();
  }
});

/** A goal with $10 left, saved $40 a week: the month counts $10.00 (it finishes within the month), never $43.33. */
const almostWeekly = (S, funder) => {
  S.budget.goals = [{ id: 'g1', name: 'Almost', target: 100, saved: 90, perPaycheck: 40, fundedBy: funder }];
};

test('goal card: a goal that finishes within the month counts only what is left (pay period view)', async () => {
  const page = await boot({
    url: DEV,
    seed: one((S) => {
      budgeted(S);
      const p = S.workplaces[0].profile;
      Object.assign(p, { freq: 7, periodStart: addDays(today, -2), periodEnd: addDays(today, 4) });
      almostWeekly(S, 'w1');
    }),
  });
  try {
    page.tab('periods');
    // ($2,077.00 + $10.00) x 12 / 52 = $481.62
    assert.equal(
      text(page, '#goal-line'),
      'Your budget needs $2,087.00 a month = $481.62 per one-week pay period.',
    );
    assert.equal(text(page, '#goal-breakdown'), 'bills $2,077.00 a month + savings goals $10.00 a month');
  } finally {
    await page.close();
  }
});

test('goal card: a goal that finishes within the month counts only what is left (month view)', async () => {
  const S = mixed();
  almostWeekly(S, 'w2');
  const page = await boot({ url: DEV, seed: S });
  try {
    page.tab('periods');
    assert.equal(text(page, '#goal-line'), 'This month: budget needs $2,087.00.');
  } finally {
    await page.close();
  }
});

test('goal card: an extra goal still in its pause is saved when the page is hidden or closed', async () => {
  for (const how of ['pagehide', 'hidden']) {
    const page = await boot({ url: DEV, seed: one(budgeted) });
    try {
      page.tab('periods');
      page.type(page.must(page.$('#goal-extra'), 'extra goal box'), '75');
      assert.equal(page.state().budget.extraGoal, undefined, 'still in its 400 ms pause');
      if (how === 'pagehide') page.win.dispatchEvent(new page.win.Event('pagehide'));
      else {
        Object.defineProperty(page.doc, 'visibilityState', { value: 'hidden', configurable: true });
        page.doc.dispatchEvent(new page.win.Event('visibilitychange'));
      }
      assert.deepEqual(page.state().budget.extraGoal, { amount: 75, per: 'month' }, how);
    } finally {
      await page.close();
    }
  }
});
