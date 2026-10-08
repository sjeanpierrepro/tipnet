// Tonight, a night dated in a FINISHED pay period whose nights are already locked: it is locked with that period's
// snapshot as soon as it is saved, so Tonight works it out with that snapshot from the start (its tip-out people, its
// rates), and the preview and the "Saved." message are what is stored (second v38 review: $343.40 shown, $360.24 stored).
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { todayISO, addDays, computeNight, exampleProfile, snapshotFor } from '../../app/js/math.js';
import { fmtDate, fmtShort } from '../../app/js/ui/common.js';

const today = todayISO();
const BARBACK = { id: 't1', k: 'barback', who: 'Barback', mode: 'pctTips', value: 15, from: 'cash' };
const BARBACK2 = { ...BARBACK, id: 't9' }; // the same barback, its Setup row removed and added again
const RUNNER = { id: 't2', k: 'runner', who: 'Runner', mode: 'pctTips', value: 5, from: 'payroll' };
const key = (page, k) => page.must(page.$('[data-focus-key="' + k + '"]'), k);
const clone = (o) => JSON.parse(JSON.stringify(o));

// A 14-day schedule: [today-28, today-15] has ended; its night of today-26 was locked with the Barback only.
const start = addDays(today, -28);
const end = addDays(start, 13);
const oldSetup = () => ({
  ...exampleProfile(today),
  periodStart: start,
  periodEnd: end,
  freq: 14,
  shifts: 10,
  tipout: { on: true, basis: 'before' },
  tipouts: [{ ...BARBACK }],
});
const lockedNight = (snapSetup = oldSetup()) => ({
  id: 'n1',
  date: addDays(start, 2),
  total: 500,
  cash: 200,
  pay: { p1: 8 },
  barback: true,
  tipouts: { t1: true },
  snap: snapshotFor(snapSetup, 10),
  workplaceId: 'w1',
});
/** Setup now: the old one with `list` as the people (and `patch` on top), plus the given nights. */
const seed = (list, nights = [lockedNight()], patch = {}) =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    S.workplaces[0].profile = { ...clone(oldSetup()), tipouts: list.map((x) => ({ ...x })), ...patch };
    S.nights = nights;
  });
const people = (page) =>
  page
    .$$('.tipouts-tonight label')
    .map((l) => l.querySelector('span').firstChild.textContent)
    .join(', ');
const note = (page) => {
  const n = page.$('#night-locked-note');
  return n && !n.hidden ? n.textContent : '';
};
const NOTE =
  'This date is in a finished pay period (' +
  fmtShort(start) +
  ' – ' +
  fmtShort(end) +
  '), so it’s worked out with the Setup that period was saved with.';
function enter(page, date) {
  page.type(key(page, 'night-total'), '500');
  page.type(key(page, 'night-pay-p1'), '8');
  page.type(key(page, 'night-cash'), '200');
  page.type(key(page, 'night-date'), date);
}

test('a forgotten night in a finished pay period: the boxes, the preview and the message are what is stored', async () => {
  const page = await boot({ seed: seed([BARBACK, RUNNER]) });
  try {
    assert.equal(people(page), 'Barback, Runner', 'tonight (current pay period): today’s Setup');
    assert.equal(note(page), '');
    const date = addDays(start, 5);
    const dateBox = key(page, 'night-date');
    dateBox.focus();
    enter(page, date);
    assert.equal(people(page), 'Barback', 'the period’s snapshot has no runner');
    assert.equal(
      page.$('[data-focus-key="night-date"]'),
      dateBox,
      'the date box itself is kept (a half-typed date stays)',
    );
    assert.equal(page.doc.activeElement, dateBox);
    assert.equal(note(page), NOTE);
    assert.equal(page.$('.quick-net').textContent, 'Estimated take-home: $360.24');
    page.click(page.button('Save night'));
    await page.settle();
    const n = page.state().nights.find((x) => x.date === date);
    assert.deepEqual(
      n.snap.tipouts.map((r) => r.who),
      ['Barback'],
    );
    const stored = computeNight(n, page.state().workplaces[0].profile, 10).net;
    assert.equal(stored, 360.24);
    assert.equal(page.text(page.$('#night-saved')), 'Saved. $360.24 take-home for ' + fmtDate(date) + '.');
    // the fresh entry is tonight's again: today's Setup, no note
    assert.equal(people(page), 'Barback, Runner');
    assert.equal(note(page), '');
  } finally {
    await page.close();
  }
});

test('finished pay period: the snapshot’s rates are shown and used; moving the date back brings today’s Setup back', async () => {
  // Setup's bartender rate is $14 now; the finished period was locked at $12
  const now = clone(oldSetup().payTypes);
  now[0].rate = 14;
  const page = await boot({ seed: seed([BARBACK2, RUNNER], [lockedNight()], { payTypes: now }) });
  try {
    const rateLine = () => page.text(key(page, 'night-pay-p1').closest('.job-row'));
    page.type(key(page, 'night-pay-p1'), '8');
    assert.match(rateLine(), /\$14\.00\/h → \$112\.00/);
    // unticked tonight: the barback stays unticked when the boxes become the snapshot's (its own barback row)
    const box = page
      .$$('.tipouts-tonight input')
      .find((c) => c.closest('label').textContent.startsWith('Barback'));
    box.checked = false;
    page.change(box);
    enter(page, addDays(start, 5));
    assert.equal(people(page), 'Barback');
    assert.equal(
      page.$('.tipouts-tonight input').checked,
      false,
      'the untick is carried over to the snapshot’s barback',
    );
    assert.match(rateLine(), /\$12\.00\/h → \$96\.00/, 'the rate the period was saved with');
    // $500 at $12 x 8 h: $404 tips, nobody tipped out
    const expect = computeNight(
      {
        date: addDays(start, 5),
        total: 500,
        cash: 200,
        pay: { p1: 8, p2: 0, p3: 0 },
        barback: false,
        tipouts: { t1: false },
        snap: snapshotFor(oldSetup(), 10),
      },
      oldSetup(),
      10,
    ).net;
    assert.equal(page.$('.quick-net').textContent, 'Estimated take-home: $' + expect.toFixed(2));
    // back to tonight's date: today's people and rates, the untick still there
    page.type(key(page, 'night-date'), today);
    assert.equal(people(page), 'Barback, Runner');
    assert.equal(note(page), '');
    assert.match(rateLine(), /\$14\.00\/h → \$112\.00/);
    const bb = page.$$('.tipouts-tonight input')[0];
    assert.equal(bb.checked, false);
    page.type(key(page, 'night-date'), addDays(start, 5));
    page.click(page.button('Save night'));
    await page.settle();
    const n = page.state().nights.find((x) => x.date === addDays(start, 5));
    assert.equal(n.tipouts.t1, false);
    assert.equal(computeNight(n, page.state().workplaces[0].profile, 10).net, expect);
    assert.match(
      page.text(page.$('#night-saved')),
      new RegExp('^Saved\\. \\$' + expect.toFixed(2).replace('.', '\\.')),
    );
  } finally {
    await page.close();
  }
});

test('a finished pay period with no locked night yet, and the current one: Tonight works as before (today’s Setup)', async () => {
  const page = await boot({ seed: seed([BARBACK, RUNNER], []) });
  try {
    const date = addDays(start, 5);
    enter(page, date);
    assert.equal(people(page), 'Barback, Runner');
    assert.equal(note(page), '');
    const preview = page.$('.quick-net').textContent;
    page.click(page.button('Save night'));
    await page.settle();
    const n = page.state().nights.find((x) => x.date === date);
    assert.ok(n.snap, 'locked when saved, with today’s Setup');
    const net = computeNight(n, page.state().workplaces[0].profile, 10).net;
    assert.equal(preview, 'Estimated take-home: $' + net.toFixed(2));
    assert.match(
      page.text(page.$('#night-saved')),
      new RegExp('^Saved\\. \\$' + net.toFixed(2).replace('.', '\\.')),
    );
  } finally {
    await page.close();
  }
});

test('finished pay period, same date: Replace keeps the night’s snapshot and says what is stored', async () => {
  const page = await boot({ seed: seed([BARBACK, RUNNER]) });
  try {
    enter(page, lockedNight().date);
    page.type(key(page, 'night-total'), '600');
    page.click(page.button('Save night'));
    page.click(page.button('Replace it'));
    await page.settle();
    const n = page.state().nights.find((x) => x.id === 'n1');
    assert.equal(n.total, 600);
    assert.deepEqual(
      n.snap.tipouts.map((r) => r.who),
      ['Barback'],
    );
    const net = computeNight(n, page.state().workplaces[0].profile, 10).net;
    assert.equal(
      page.text(page.$('#night-saved')),
      'Saved. $' + net.toFixed(2) + ' take-home for ' + fmtDate(n.date) + '.',
    );
  } finally {
    await page.close();
  }
});

test('finished pay period locked with the same Setup as today (e.g. after midnight): no note; Add says the part added', async () => {
  const page = await boot({ seed: seed([BARBACK]) });
  try {
    const date = addDays(start, 5);
    enter(page, date);
    assert.equal(people(page), 'Barback');
    assert.equal(note(page), '', 'nothing works out differently, so nothing to explain');
    assert.equal(page.$('.quick-net').textContent, 'Estimated take-home: $360.24');
    page.click(page.button('Save night'));
    await page.settle();
    assert.equal(page.text(page.$('#night-saved')), 'Saved. $360.24 take-home for ' + fmtDate(date) + '.');
    // the same date again: "Add to that night" says what this part adds, as the locked night counts it
    enter(page, date);
    page.click(page.button('Save night'));
    page.click(page.button('Add to that night'));
    await page.settle();
    const n = page.state().nights.find((x) => x.date === date);
    assert.equal(n.total, 1000);
    assert.equal(page.text(page.$('#night-saved')), 'Saved. $360.24 take-home for ' + fmtDate(date) + '.');
  } finally {
    await page.close();
  }
});
