// Pay periods, bottom of the page: "So far this pay period" (free) and the Budget goal card (TipNet Budget).
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { addDays, todayISO, periodIndex, periodTotals, snapshotFor } from '../../app/js/math.js';
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

test('goal card: automatic goal from bills before payday and savings, short by, and the per-night line', async () => {
  const page = await boot({ url: DEV, seed: one(budgeted) });
  try {
    page.tab('periods');
    const net = Math.round(periodNums(page.state(), 'w1').net * 100);
    assert.equal(text(page, '#goal-line'), 'Goal: $2,050.00 (from your budget)');
    assert.match(
      text(page, '#goal-breakdown'),
      /^bills due before payday \([A-Z][a-z]{2}, [A-Z][a-z]{2} \d+\) \$2,000\.00 \+ savings \$50\.00$/,
    );
    assert.equal(money(text(page, '#goal-made').replace('Made so far:', '')), net, 'matches the card above');
    assert.equal(text(page, '#goal-result'), 'Short by ' + usd(205000 - net));
    // 10 shifts a pay period, 3 nights logged: 7 left
    assert.match(
      text(page, '#goal-pace'),
      new RegExp('^About \\$' + ((205000 - net) / 100 / 7).toFixed(2) + ' a night over your next 7 shifts'),
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
      S.budget.bills[0].amount = 10;
      S.budget.goals = [];
    }),
  });
  try {
    page.tab('periods');
    const net = Math.round(periodNums(page.state(), 'w1').net * 100);
    assert.equal(text(page, '#goal-line'), 'Goal: $10.00 (from your budget)');
    assert.equal(text(page, '#goal-result'), '$' + ((net - 1000) / 100).toFixed(2) + ' extra');
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

test('goal card: two establishments add their take-home, as Budget combines paychecks', async () => {
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
    assert.equal(money(text(page, '#goal-made').replace('Made so far:', '')), net);
    assert.equal(
      net,
      money(text(page, '#so-far-net-w1')) + money(text(page, '#so-far-net-w2')),
      'the two lines of the card above',
    );
  } finally {
    await page.close();
  }
});

test('goal card: "Use my own goal" replaces the automatic goal, is stored in Budget, and going back clears it', async () => {
  const page = await boot({ url: DEV, seed: one(budgeted) });
  try {
    page.tab('periods');
    const net = Math.round(periodNums(page.state(), 'w1').net * 100);
    const box = page.must(page.$('#goal-own'), 'own goal box');
    assert.equal(page.$('#goal-back').hidden, true);
    page.type(box, '1,000');
    page.change(box);
    assert.equal(text(page, '#goal-line'), 'Goal: $1,000.00 (your own)');
    assert.equal(page.$('#goal-breakdown'), null, 'the budget goal is not added on top');
    assert.equal(text(page, '#goal-result'), 'Short by ' + usd(100000 - net));
    assert.equal(page.state().budget.ownGoal, 1000);
    page.click(page.$('#goal-back'));
    assert.equal(page.state().budget.ownGoal, undefined, 'clearing removes it');
    assert.equal(text(page, '#goal-line'), 'Goal: $2,050.00 (from your budget)');
    assert.equal(page.$('#goal-own').value, '');
  } finally {
    await page.close();
  }
});

test('goal card: a money typo is refused and never stored', async () => {
  const page = await boot({ url: DEV, seed: one(budgeted) });
  try {
    page.tab('periods');
    const box = page.must(page.$('#goal-own'), 'own goal box');
    page.type(box, '12abc');
    page.change(box);
    assert.equal(page.state().budget.ownGoal, undefined);
    assert.match(page.text(page.app), /That isn’t an amount/);
    assert.equal(text(page, '#goal-line'), 'Goal: $2,050.00 (from your budget)');
  } finally {
    await page.close();
  }
});

test('goal card: the own goal survives a backup round trip', async () => {
  const S = one(budgeted);
  S.budget.ownGoal = 640.5;
  const back = decodeBackup(encodeBackup(S));
  assert.equal(back.budget.ownGoal, 640.5);
  const page = await boot({ url: DEV, seed: back });
  try {
    page.tab('periods');
    assert.equal(text(page, '#goal-line'), 'Goal: $640.50 (your own)');
    assert.equal(page.$('#goal-own').value, '640.5');
  } finally {
    await page.close();
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
