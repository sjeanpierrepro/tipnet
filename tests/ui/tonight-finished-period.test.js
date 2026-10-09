// Tonight, a night dated in a FINISHED pay period whose nights are already locked: it is locked with that period's
// snapshot as soon as it is saved, so Tonight works it out with that snapshot from the start (its tip-out people, its
// rates), and the preview and the "Saved." message are what is stored (second v38 review: $343.40 shown, $360.24 stored).
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { todayISO, addDays, computeNight, exampleProfile, snapshotFor } from '../../app/js/math.js';
import { fmtDate, fmtShort, money } from '../../app/js/ui/common.js';

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
  tipout: { on: true },
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
/** $500 made: $204 CC + $200 cash tips + 8 hours at $12. */
function enter(page, date) {
  page.type(key(page, 'night-cc'), '204');
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
    page.type(key(page, 'night-cc'), '304'); // $600 made
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

test('finished pay period locked with the same Setup as today (e.g. after midnight): no note; Add says the night as stored', async () => {
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
    // the same date again: "Add to that night" says the night's new take-home as stored (locked), and what this part
    // changed it by: $366.24, not $360.24 (the part as a night of its own carried a second $6 of fixed deductions)
    enter(page, date);
    page.click(page.button('Save night'));
    page.click(page.button('Add to that night'));
    await page.settle();
    const n = page.state().nights.find((x) => x.date === date);
    assert.equal(n.total, 1000);
    const now = computeNight(n, page.state().workplaces[0].profile, 10).net;
    assert.equal(
      page.text(page.$('#night-saved')),
      'Saved. ' + money(now) + ' take-home for ' + fmtDate(date) + ' (+$366.24 from what you added).',
    );
  } finally {
    await page.close();
  }
});

/* ---------- a job added to Setup after the period was locked (third v38 review) ---------- */
// Locked with Bartender, Training and Bonus; Setup now also has a Server job at $10/h. Before: the job line said
// "$10.00/h → $60.00" but the night got $0 base pay ($200 stored when tips were typed; when a total was typed the $260
// all counted as tips, barback $39 instead of $30).
const SERVER = { id: 'p9', k: 'server', name: 'Server', rate: 10, unit: 'hr', usual: 0 };
const withServer = () => ({ payTypes: [...clone(oldSetup().payTypes), { ...SERVER }] });
const rowText = (page) => page.$$('.job-rate').map((x) => x.textContent);
const baseLine = (page) =>
  page.text(page.must(page.byText('.breakdown div', 'of which base pay', page.app), 'base pay line'));
/** 6 hours as Server, $100 CC + $100 cash tips: $260 made. */
function asServer(page) {
  const sel = key(page, 'night-job-0');
  sel.value = 'p9';
  page.change(sel);
  page.type(key(page, 'night-cc'), '100');
  page.type(key(page, 'night-pay-p9'), '6');
  page.type(key(page, 'night-cash'), '100');
}
{
  test('finished pay period, a job added to Setup since: shown, previewed and stored at its rate', async () => {
    const page = await boot({ seed: seed([BARBACK], [lockedNight()], withServer()) });
    try {
      const date = addDays(start, 5);
      page.type(key(page, 'night-date'), date);
      asServer(page);
      assert.deepEqual(rowText(page), ['$10.00/h → $60.00']);
      assert.equal(baseLine(page), 'of which base pay$60.00');
      assert.match(page.text(page.$('.result', page.app)), /Barback \(15% of tips\)−\$30\.00/);
      const preview = page.$('.quick-net').textContent;
      page.click(page.button('Save night'));
      await page.settle();
      const S = page.state();
      const n = S.nights.find((x) => x.date === date);
      assert.equal(n.total, 260);
      assert.ok(n.snap, 'locked with the period’s snapshot');
      assert.deepEqual(n.snap.pay[n.snap.pay.length - 1], { id: 'p9', rate: 10, unit: 'hr' });
      const c = computeNight(n, S.workplaces[0].profile, 10);
      assert.equal(c.basePay, 60);
      assert.equal(c.tips, 200);
      assert.equal(c.tipout, 30);
      assert.equal(preview, 'Estimated take-home: $' + c.net.toFixed(2), 'the preview is what is stored');
      assert.equal(
        page.text(page.$('#night-saved')),
        'Saved. $' + c.net.toFixed(2) + ' take-home for ' + fmtDate(date) + '.',
      );
      // the night locked before keeps its own snapshot (no Server)
      const n1 = S.nights.find((x) => x.id === 'n1');
      assert.deepEqual(n1.snap, lockedNight().snap);
    } finally {
      await page.close();
    }
  });
}

test('finished pay period, a job added since: Add to / Replace a locked night pay it at its rate too', async () => {
  for (const verb of ['Add to that night', 'Replace it']) {
    const page = await boot({ seed: seed([BARBACK], [lockedNight()], withServer()) });
    try {
      page.type(key(page, 'night-date'), lockedNight().date);
      asServer(page);
      page.click(page.button('Save night'));
      page.click(page.button(verb));
      await page.settle();
      const S = page.state();
      const n = S.nights.find((x) => x.id === 'n1');
      const c = computeNight(n, S.workplaces[0].profile, 10);
      assert.equal(c.basePay, verb === 'Replace it' ? 60 : 96 + 60, verb);
      assert.deepEqual(n.snap.pay[n.snap.pay.length - 1], { id: 'p9', rate: 10, unit: 'hr' }, verb);
      assert.deepEqual(
        { ...n.snap, pay: [] },
        { ...lockedNight().snap, pay: [] },
        verb + ': nothing else changes',
      );
    } finally {
      await page.close();
    }
  }
});

test('night editor: a locked night given hours at a job added since is paid at the rate it shows', async () => {
  const page = await boot({ seed: seed([BARBACK], [lockedNight()], withServer()) });
  try {
    page.tab('periods');
    page.click(page.must(page.$('[data-focus-key="edit-n1-cc"]', page.app), 'Edit'));
    page.click(page.must(page.$('[data-focus-key="edit-n1-add-job"]'), '+ Add another job'));
    const sel = key(page, 'edit-n1-job-1');
    sel.value = 'p9';
    page.change(sel);
    page.type(key(page, 'edit-n1-pay-p9'), '6');
    assert.ok(rowText(page).includes('$10.00/h → $60.00'));
    const preview = page.text(
      page.must(page.byText('p.hint', 'Estimated take-home for this night'), 'preview'),
    );
    page.click(page.button('Save changes'));
    await page.settle();
    const S = page.state();
    const n = S.nights.find((x) => x.id === 'n1');
    const c = computeNight(n, S.workplaces[0].profile, 10);
    assert.equal(c.basePay, 96 + 60);
    assert.equal(preview, 'Estimated take-home for this night: $' + c.net.toFixed(2) + '.');
    assert.deepEqual({ ...n.snap, pay: [] }, { ...lockedNight().snap, pay: [] }, 'nothing else changes');
  } finally {
    await page.close();
  }
});
