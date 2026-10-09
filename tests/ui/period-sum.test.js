// Pay periods add up (owner: accuracy and consistency first): every amount shows cents, and in a finished pay period the
// nights' take-home plus the "Exact amounts on this check" line is the period's take-home to the cent. Each night
// carries an estimated share of the check's fixed deductions; the finished check takes them exactly once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { addDays, todayISO, periodIndex, snapshotFor } from '../../app/js/math.js';

const today = todayISO();
const clone = (o) => JSON.parse(JSON.stringify(o));
const start = addDays(today, -28); // 14-day periods: [today-28, today-15] has ended
const profile = () => {
  const p = realState().workplaces[0].profile;
  Object.assign(p, { periodStart: start, periodEnd: addDays(start, 13), freq: 14, shifts: 10 });
  p.payTypes[0].rate = 10;
  p.deductions = [
    ...(p.deductions || []).filter((d) => d.mode !== 'fixed'),
    { id: 'dx', k: 'health', name: 'Health insurance', amount: 90, mode: 'fixed' },
  ];
  return p;
};
const night = (id, ago, tips, cash) => ({
  id,
  date: addDays(today, -ago),
  total: tips + 80,
  tips,
  cash,
  pay: { p1: 8 },
  tipoutOn: false,
  workplaceId: 'w1',
});
/** "$1,234.56" / "−$45.00" / "+$3.00" -> cents */
const cents = (s) => {
  const m = /([+−-]?)\$([\d,]+\.\d{2})/.exec(s);
  assert.ok(m, 'an amount with cents: ' + s);
  const v = Math.round(parseFloat(m[2].replace(/,/g, '')) * 100);
  return m[1] === '−' || m[1] === '-' ? -v : v;
};

test('a finished pay period: the nights plus "Exact amounts on this check" equal the period take-home to the cent', async () => {
  const page = await boot({
    seed: realState((S) => {
      S.workplaces[0].setupDone = true;
      S.workplaces[0].profile = profile();
      const snap = snapshotFor(profile(), 10); // 10 expected shifts: each night carries $9 of the $90
      S.nights = [night('a', 26, 300, 100), night('b', 22, 255.55, 0), night('c', 18, 410.1, 60.4)];
      S.nights.forEach((n) => (n.snap = clone(snap)));
    }),
  });
  try {
    page.tab('periods');
    const p = page.state().workplaces[0].profile;
    const idx = periodIndex(p, addDays(today, -20));
    const sec = page.must(page.$('section[data-period="' + idx + '"]', page.app), 'finished period');
    const head = cents(page.text(sec.querySelector('.spread b.num')));
    const amounts = page.$$('.list-row .amount', sec).map((a) => cents(page.text(a)));
    const adj = page.must(sec.querySelector('.period-adjust'), 'the exact-amounts line');
    assert.match(page.text(adj), /Exact amounts on this check/);
    assert.equal(amounts.length, 4, 'three nights and the line');
    assert.equal(
      amounts.reduce((s, x) => s + x, 0),
      head,
      'the rows add up to the header',
    );
    // 3 nights carried 3 × $9 of the $90: the line takes the other $63
    assert.equal(cents(page.text(adj.querySelector('.amount'))), -6300);
  } finally {
    await page.close();
  }
});

test('a running pay period shows cents and has no exact-amounts line (its nights add up on their own)', async () => {
  const page = await boot({
    seed: realState((S) => {
      S.workplaces[0].setupDone = true;
      S.workplaces[0].profile = profile();
      S.nights = [night('c', 0, 200.15, 50), night('d', 1, 99.99, 10)];
    }),
  });
  try {
    page.tab('periods');
    const p = page.state().workplaces[0].profile;
    const sec = page.must(
      page.$('section[data-period="' + periodIndex(p, today) + '"]', page.app),
      'running period',
    );
    assert.equal(sec.querySelector('.period-adjust'), null);
    const head = cents(page.text(sec.querySelector('.spread b.num')));
    const rows = page.$$('.list-row .amount', sec).map((a) => cents(page.text(a)));
    assert.equal(
      rows.reduce((s, x) => s + x, 0),
      head,
    );
  } finally {
    await page.close();
  }
});
