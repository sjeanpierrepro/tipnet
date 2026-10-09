// "Update this pay period to today's Setup" on a finished pay period (Pay periods): it shows what changes first, updates
// every night of that period on confirm, and Undo puts the nights back exactly. The running period has no button.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import {
  addDays,
  todayISO,
  periodIndex,
  periodTotals,
  snapshotFor,
  computeNight,
} from '../../app/js/math.js';
import { periodLabel } from '../../app/js/ui/common.js';

const today = todayISO();
const clone = (o) => JSON.parse(JSON.stringify(o));
const BARBACK = { id: 't1', k: 'barback', who: 'Barback', mode: 'pctTips', value: 15, from: 'cash' };
// 14-day pay periods: [today-28, today-15] has ended (its nights were locked at $10/h); the running one starts today.
const start = addDays(today, -28);
const setup = (rate) => {
  const S = realState();
  const p = S.workplaces[0].profile;
  Object.assign(p, {
    periodStart: start,
    periodEnd: addDays(start, 13),
    freq: 14,
    shifts: 10,
    tipout: { on: true },
    tipouts: [{ ...BARBACK }],
  });
  p.payTypes[0].rate = rate;
  return p;
};
const night = (id, ago, extra = {}) => ({
  id,
  date: addDays(today, -ago),
  total: 480, // $400 tips + 8 h at $10
  tips: 400,
  cash: 150,
  pay: { p1: 8 },
  barback: true,
  tipouts: { t1: true },
  tipoutOn: true,
  workplaceId: 'w1',
  ...extra,
});
const seed = (mutate) =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    S.workplaces[0].profile = setup(12); // a raise to $12 since
    const snap = snapshotFor(setup(10), 10);
    S.nights = [
      night('a', 26, { snap: clone(snap) }),
      night('b', 20, { snap: clone(snap), tipouts: { t1: false }, barback: false }),
      night('c', 0, { total: 496 }), // the running period: $12
    ];
    if (mutate) mutate(S);
  });
const sec = (page, ago) => {
  const p = page.state().workplaces[0].profile;
  const idx = periodIndex(p, addDays(today, -ago));
  return page.must(page.$('section[data-period="' + idx + '"]', page.app), 'period ' + idx);
};
const updateBtn = (page) => page.$('button[data-focus-key^="update-"]', page.app);

test('a finished pay period shows the change first; Update gives every night today’s Setup; Undo puts it back exactly', async () => {
  const page = await boot({ seed: seed() });
  try {
    page.tab('periods');
    const S = page.state();
    const p = S.workplaces[0].profile;
    const fin = periodIndex(p, addDays(today, -20));
    const before = clone(S.nights);
    const t0 = periodTotals(p, S.nights, fin, today);
    // only the finished period has the button, named for screen readers with its dates
    assert.equal(sec(page, 0).querySelector('button[data-focus-key^="update-"]') === null, true);
    const btn = page.must(updateBtn(page), 'update button');
    assert.equal(btn.textContent, 'Update this pay period to today’s Setup');
    assert.equal(
      btn.getAttribute('aria-label'),
      'Update the pay period ' + periodLabel(p, fin) + ' to today’s Setup',
    );
    page.click(btn);
    const ask = page.must(sec(page, 20).querySelector('[role=group]'), 'question');
    // what it will be: each night $16 more pay ($8 x 2), taxed
    const t1 = periodTotals(
      p,
      S.nights.map((n) => (n.snap ? { ...n, total: 496, snap: snapshotFor(p, 10) } : n)),
      fin,
      today,
    );
    assert.match(
      ask.textContent,
      new RegExp(
        'Take-home for ' +
          periodLabel(p, fin) +
          ': \\$' +
          t0.net.toFixed(2).replace('.', '\\.') +
          ' → \\$' +
          t1.net.toFixed(2).replace('.', '\\.'),
      ),
    );
    assert.match(ask.textContent, /On your check: \$[\d,.]+ → \$[\d,.]+/);
    assert.doesNotMatch(ask.textContent, /compared/);
    assert.equal(page.doc.activeElement, page.button('Update pay period', ask), 'focus on the choice');
    // Cancel: nothing changes
    page.click(page.button('Cancel', ask));
    assert.deepEqual(page.state().nights, before);
    assert.equal(page.doc.activeElement, updateBtn(page), 'back on the button');
    // Update
    page.click(updateBtn(page));
    page.click(page.button('Update pay period', sec(page, 20)));
    const [a, b, c] = page.state().nights;
    assert.equal(a.snap.pay[0].rate, 12);
    assert.equal(b.snap.pay[0].rate, 12);
    assert.equal(a.tips, 400, 'the tips stay');
    assert.equal(a.total, 496);
    assert.deepEqual(b.tipouts, { t1: false }, 'who was tipped out stays');
    assert.deepEqual(c, before[2], 'the running period is untouched');
    assert.equal(
      periodTotals(p, page.state().nights, fin, today).net,
      t1.net,
      'what was shown is what is stored',
    );
    assert.match(page.text(page.$('#toast')), /The pay period .* now uses today’s Setup\./);
    // Undo: the nights exactly as they were
    page.click(page.button('Undo', page.$('#toast')));
    assert.deepEqual(page.state().nights, before);
  } finally {
    await page.close();
  }
});

test('a pay period compared in Check my accuracy says the comparison used the old numbers', async () => {
  const page = await boot({
    seed: seed((S) => {
      const p = S.workplaces[0].profile;
      const r = { start, end: addDays(start, 13) };
      S.workplaces[0].calib = [
        {
          label: 'x',
          pred: 700,
          actual: 690,
          err: 0.01,
          idx: periodIndex(p, start),
          ...r,
          rateBefore: 0.17,
          rateAfter: 0.17,
        },
      ];
    }),
  });
  try {
    page.tab('periods');
    page.click(updateBtn(page));
    assert.match(
      sec(page, 20).textContent,
      /You compared this pay period with your paycheck using the old numbers\./,
    );
  } finally {
    await page.close();
  }
});

test('a pay period already on today’s Setup says so and changes nothing', async () => {
  const page = await boot({
    seed: seed((S) => {
      S.workplaces[0].profile = setup(10);
    }),
  });
  try {
    page.tab('periods');
    const before = clone(page.state().nights);
    page.click(updateBtn(page));
    assert.match(
      sec(page, 20).textContent,
      /This pay period already uses today’s Setup\. Nothing to update\./,
    );
    page.click(page.button('OK', sec(page, 20)));
    assert.deepEqual(page.state().nights, before);
    assert.ok(updateBtn(page), 'the button is back');
  } finally {
    await page.close();
  }
});

test('if the nights changed while the question was open, it is asked again with the new numbers', async () => {
  const page = await boot({ seed: seed() });
  try {
    page.tab('periods');
    page.click(updateBtn(page));
    // another window changed a night of that period meanwhile
    page.state().nights[0].tips = 500;
    page.state().nights[0].total = 580;
    page.click(page.button('Update pay period', sec(page, 20)));
    assert.equal(page.state().nights[0].snap.pay[0].rate, 10, 'not stored yet');
    assert.ok(sec(page, 20).querySelector('[role=group]'), 'asked again');
    page.click(page.button('Update pay period', sec(page, 20)));
    assert.equal(page.state().nights[0].snap.pay[0].rate, 12);
    assert.equal(page.state().nights[0].total, 596);
    const p = page.state().workplaces[0].profile;
    assert.equal(computeNight(page.state().nights[0], p, 10).tips, 500);
  } finally {
    await page.close();
  }
});
