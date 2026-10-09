// Tonight's pay period summary and Pay periods agree to the cent, also between midnight and the Late-nights cutoff
// on a pay period's first day, when tonight's shift still belongs to the period that just ended (and is locked:
// a period is finished, everywhere, once its last calendar day is over).
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { addDays, todayISO } from '../../app/js/math.js';

const night = (id, date, wid) => ({
  id,
  date,
  total: 300,
  tips: 204,
  cash: 100,
  pay: { p1: 8 },
  barback: false,
  tipouts: {},
  tipoutOn: false,
  workplaceId: wid,
});

test('01:30 on the first day of a pay period: Tonight shows the period that just ended as Pay periods does, with cents', async () => {
  const t = todayISO();
  const page = await boot({
    time: '01:30',
    seed: realState((S) => {
      const w = S.workplaces[0];
      w.setupDone = true;
      const p = w.profile;
      p.freq = 14;
      p.periodStart = t; // a new pay period starts today; tonight (until the cutoff) is still yesterday
      p.periodEnd = '';
      p.deductions.push({ id: 'dx', k: 'health', name: 'Health', amount: 100, mode: 'fixed' });
      for (let i = 16; i <= 21; i++) S.nights.push(night('o' + i, addDays(t, -i), w.id));
      for (let i = 1; i <= 3; i++) S.nights.push(night('n' + i, addDays(t, -i * 2), w.id));
    }),
  });
  try {
    const strip = page.must(page.$('.strip'), 'strip');
    const label = page.text(strip.parentElement.querySelector('.label'));
    const shown = page.text(strip.querySelector('b'));
    assert.match(shown, /^\$\d[\d,]*\.\d\d$/, 'cents: ' + shown);
    assert.match(label, /· final$/, label);
    const cap = page.text(strip.parentElement.querySelector('p.hint'));
    page.tab('periods');
    await page.settle();
    const sec = page.must(page.$$('section[data-period]')[0], 'newest period');
    const head = page.text(sec.querySelector('.spread'));
    assert.match(head, /· final/);
    assert.equal(page.text(sec.querySelector('b.num')), shown + ' take-home', head + ' | ' + label);
    // the check line is the finished period's, worked out the same way
    assert.match(cap, /^This pay period’s check \(3 nights\): \$\d[\d,]*\.\d\d\.$/, cap);
  } finally {
    await page.close();
  }
});

test('Tonight’s pay period summary shows cents in the middle of a running period too', async () => {
  const t = todayISO();
  const page = await boot({
    seed: realState((S) => {
      const w = S.workplaces[0];
      w.setupDone = true;
      w.profile.periodStart = addDays(t, -3);
      w.profile.periodEnd = '';
      w.profile.freq = 14;
      S.nights.push(night('a', addDays(t, -2), w.id));
    }),
  });
  try {
    const strip = page.must(page.$('.strip'), 'strip');
    const [take, , perHour] = Array.from(strip.querySelectorAll('b')).map((b) => page.text(b));
    assert.match(take, /^\$\d[\d,]*\.\d\d$/, take);
    assert.match(perHour, /^\$\d[\d,]*\.\d\d$/, perHour);
    assert.doesNotMatch(page.text(strip.parentElement.querySelector('.label')), /final/);
    page.tab('periods');
    await page.settle();
    assert.equal(page.text(page.$$('section[data-period]')[0].querySelector('b.num')), take + ' take-home');
  } finally {
    await page.close();
  }
});
