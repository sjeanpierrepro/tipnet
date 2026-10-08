// Who was tipped out on screen vs the people a night is worked out with: Tonight's Replace / Add onto a locked night after
// the tip-out people changed in Setup, the night editor's "Recalculate with current Setup" and moves, and edits while
// tip-outs are switched off or set to "after tip-out".
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { todayISO, addDays, snapshotFor, computeNight, exampleProfile } from '../../app/js/math.js';

const today = todayISO();
const BARBACK = { id: 't1', k: 'barback', who: 'Barback', mode: 'pctTips', value: 15, from: 'cash' };
const BARBACK2 = { ...BARBACK, id: 't9' }; // the same barback, row removed and added again in Setup
const RUNNER = { id: 't2', k: 'runner', who: 'Runner', mode: 'pctTips', value: 5, from: 'payroll' };
const key = (page, k) => page.must(page.$('[data-focus-key="' + k + '"]'), k);
const clone = (o) => JSON.parse(JSON.stringify(o));

// A 14-day schedule whose pay period [today-28, today-15] has ended; the night of today-20 in it was locked with the barback.
const start = addDays(today, -28);
const oldSetup = () => ({
  ...exampleProfile(today),
  periodStart: start,
  periodEnd: addDays(start, 13),
  shifts: 10,
  tipout: { on: true, basis: 'before' },
  tipouts: [{ ...BARBACK }],
});
const lockedDate = addDays(today, -20);
// $500 made, 8 hours at $12, $200 cash: $404 tips, 15% for the barback is $60.60
const lockedNight = (ticks = { t1: true }) => ({
  id: 'n1',
  date: lockedDate,
  total: 500,
  cash: 200,
  pay: { p1: 8 },
  barback: true,
  tipouts: ticks,
  snap: snapshotFor(oldSetup(), 10),
  workplaceId: 'w1',
});
const seedWith = (setupList, nights) =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    S.workplaces[0].profile = { ...clone(oldSetup()), tipouts: setupList.map((x) => ({ ...x })) };
    S.nights = nights;
  });
/** Type the same night again on Tonight for that date and Save (the same-date question shows). */
function retype(page, date) {
  page.type(key(page, 'night-total'), '500');
  page.type(key(page, 'night-pay-p1'), '8');
  page.type(key(page, 'night-cash'), '200');
  page.type(key(page, 'night-date'), date);
  page.click(page.button('Save night'));
}
/** The Edit button of a night on Pay periods. */
const editBtn = (page, id) =>
  page.must(
    page
      .$$('button', page.app)
      .find(
        (b) =>
          b.getAttribute('data-focus-key') === 'edit-' + id + '-total' && b.textContent.trim() === 'Edit',
      ),
    'Edit ' + id,
  );
const nightOf = (page, id) => page.state().nights.find((n) => n.id === id);
const money = (page, n) => computeNight(n, page.state().workplaces[0].profile, 10);

test('a) Tonight "Replace it" on a locked night after Setup lost the barback and got a runner: $60.60 stays', async () => {
  const page = await boot({ seed: seedWith([BARBACK, RUNNER], [lockedNight()]) });
  try {
    const before = money(page, nightOf(page, 'n1'));
    assert.equal(before.tipout, 60.6);
    // Setup now: the barback is gone, a runner was added
    page.state().workplaces[0].profile.tipouts = [{ ...RUNNER }];
    page.tab('periods');
    page.tab('tonight');
    assert.ok(key(page, 'night-tipout-t2').checked, 'today’s people are on screen');
    retype(page, lockedDate);
    page.click(page.button('Replace it'));
    const after = nightOf(page, 'n1');
    assert.deepEqual(
      after.snap.tipouts.map((r) => r.id),
      ['t1'],
      'still locked with its own people',
    );
    assert.equal(after.tipouts.t1, true);
    const c = money(page, after);
    assert.deepEqual(
      c.tipouts.map((l) => [l.who, l.amount]),
      [['Barback', 60.6]],
    );
    assert.equal(c.net, before.net);
  } finally {
    await page.close();
  }
});

test('a) Tonight "Replace it" / "Add to that night" carry the choice to the re-created barback’s locked row', async () => {
  // the night was saved with the barback NOT tipped out; tonight's entry ticks the re-created barback
  const page = await boot({ seed: seedWith([BARBACK2], [lockedNight({ t1: false })]) });
  try {
    assert.equal(money(page, nightOf(page, 'n1')).tipout, 0);
    retype(page, lockedDate);
    page.click(page.button('Replace it'));
    assert.equal(nightOf(page, 'n1').tipouts.t1, true);
    assert.equal(money(page, nightOf(page, 'n1')).tipout, 60.6);
    // Replace again with the barback unticked: unticked on the night's own row
    page.type(key(page, 'night-total'), '500');
    page.type(key(page, 'night-pay-p1'), '8');
    page.type(key(page, 'night-cash'), '200');
    page.type(key(page, 'night-date'), lockedDate);
    // a date in that finished pay period: Tonight's boxes are its snapshot's people (the night's own barback row)
    const bb = key(page, 'night-tipout-t1');
    bb.checked = false;
    page.change(bb);
    page.click(page.button('Save night'));
    page.click(page.button('Replace it'));
    assert.equal(nightOf(page, 'n1').tipouts.t1, false);
    assert.equal(money(page, nightOf(page, 'n1')).tipout, 0);
    // Add (barback ticked tonight): ticked in either part = ticked; the totals add up
    page.type(key(page, 'night-total'), '100');
    page.type(key(page, 'night-pay-p1'), '0');
    page.type(key(page, 'night-date'), lockedDate);
    page.click(page.button('Save night'));
    page.click(page.button('Add to that night'));
    const merged = nightOf(page, 'n1');
    assert.equal(page.state().nights.length, 1);
    assert.equal(merged.total, 600);
    assert.equal(merged.tipouts.t1, true);
    // $600 made with $96 pay: $504 tips, 15% = $75.60
    assert.equal(money(page, merged).tipout, 75.6);
  } finally {
    await page.close();
  }
});

test('b) night editor "Recalculate with current Setup" after the barback row was re-created: $60.60 stays', async () => {
  const page = await boot({ seed: seedWith([BARBACK2], [lockedNight()]) });
  try {
    const before = money(page, nightOf(page, 'n1'));
    page.tab('periods');
    page.click(editBtn(page, 'n1'));
    assert.equal(key(page, 'edit-n1-tipout-t1').checked, true, 'the night’s own barback is ticked');
    const cb = page.must(page.$('#edit-n1-recalc'), 'recalc');
    cb.checked = true;
    page.change(cb);
    assert.match(page.text(), /Estimated take-home for this night: \$360\.24\./);
    page.click(page.button('Save changes'));
    const n = nightOf(page, 'n1');
    assert.deepEqual(
      n.snap.tipouts.map((r) => r.id),
      ['t9'],
      'the new snapshot has today’s people',
    );
    assert.equal(n.tipouts.t9, true);
    const c = money(page, n);
    assert.equal(c.tipout, 60.6);
    assert.equal(c.net, before.net);
    assert.equal(c.net, 360.24);
  } finally {
    await page.close();
  }
});

test('b) night editor: ticking "Recalculate with current Setup" shows today’s people to tick, and its note only then', async () => {
  // Setup now: the barback row was added again (t9) and a runner joined; the locked night only knows its barback (t1)
  const page = await boot({ seed: seedWith([BARBACK2, RUNNER], [lockedNight()]) });
  try {
    page.tab('periods');
    page.click(editBtn(page, 'n1'));
    assert.ok(page.$('[data-focus-key="edit-n1-tipout-t1"]'), 'the night’s own barback');
    assert.equal(page.$('[data-focus-key="edit-n1-tipout-t2"]'), null, 'no runner on the locked night');
    const hint = page.must(page.$('#edit-n1-recalc-hint'), 'hint');
    assert.equal(hint.hidden, true, 'the "uses today’s Setup" note waits for the box');
    const cb = page.must(page.$('#edit-n1-recalc'), 'recalc');
    cb.checked = true;
    page.change(cb);
    assert.equal(hint.hidden, false);
    assert.equal(page.$('[data-focus-key="edit-n1-tipout-t1"]'), null, 'the old row is gone');
    assert.equal(key(page, 'edit-n1-tipout-t9').checked, true, 'the barback’s tick carried over');
    assert.equal(key(page, 'edit-n1-tipout-t2').checked, false, 'the runner wasn’t tipped out that night');
    // tick the runner too and save: both count
    const runner = key(page, 'edit-n1-tipout-t2');
    runner.checked = true;
    page.change(runner);
    page.click(page.button('Save changes'));
    const n = nightOf(page, 'n1');
    assert.deepEqual(
      money(page, n).tipouts.map((l) => l.who),
      ['Barback', 'Runner'],
    );
    // unticking the box again goes back to the night's own people
    page.click(editBtn(page, 'n1'));
    const cb2 = page.must(page.$('#edit-n1-recalc'), 'recalc');
    assert.ok(page.$('[data-focus-key="edit-n1-tipout-t9"]'));
    cb2.checked = true;
    page.change(cb2);
    cb2.checked = false;
    page.change(cb2);
    assert.equal(key(page, 'edit-n1-tipout-t9').checked, true);
    assert.equal(key(page, 'edit-n1-tipout-t2').checked, true);
  } finally {
    await page.close();
  }
});

test('b) night editor: a night moved into a finished pay period takes its people from that period’s snapshot', async () => {
  // the night of today-14 (the pay period after, also finished) was locked with the re-created barback t9
  const moved = {
    id: 'n2',
    date: addDays(today, -14),
    total: 500,
    cash: 200,
    pay: { p1: 8 },
    barback: true,
    tipouts: { t9: true },
    workplaceId: 'w1',
  };
  const page = await boot({ seed: seedWith([BARBACK2], [lockedNight(), moved]) });
  try {
    assert.deepEqual(
      nightOf(page, 'n2').snap.tipouts.map((r) => r.id),
      ['t9'],
    );
    page.tab('periods');
    page.click(editBtn(page, 'n2'));
    const sel = page.must(page.$('#edit-n2-week'), 'pay period select');
    sel.value = start; // the pay period before (finished, with the barback night locked in it)
    page.change(sel);
    page.click(page.button('Save changes'));
    page.click(page.button('Move night'));
    const n = nightOf(page, 'n2');
    assert.equal(n.periodStart, start);
    assert.deepEqual(
      n.snap.tipouts.map((r) => r.id),
      ['t1'],
      'that period’s snapshot',
    );
    assert.equal(n.tipouts.t1, true);
    assert.equal(money(page, n).tipout, 60.6);
  } finally {
    await page.close();
  }
});

/* ---------- d) tip-outs switched off or "after tip-out" while a night is edited ---------- */
const PEOPLE = [
  { id: 't1', k: 'barback', who: 'Barback', mode: 'pctTips', value: 10, from: 'cash' },
  { id: 't2', k: 'runner', who: 'Runner', mode: 'flat', value: 40, from: 'payroll' },
];
const offSeed = (tipout) =>
  realState((S) => {
    const p = S.workplaces[0].profile;
    S.workplaces[0].setupDone = true;
    p.tipout = tipout;
    p.tipouts = PEOPLE.map((x) => ({ ...x }));
    S.nights = [
      {
        id: 'n1',
        date: addDays(p.periodStart, 6), // in the running pay period: not locked
        total: 500,
        cash: 200,
        pay: { p1: 8 },
        barback: true,
        tipouts: { t1: true, t2: false },
        workplaceId: 'w1',
      },
    ];
  });

for (const [what, tipout] of [
  ['switched off', { on: false, basis: 'before' }],
  ['"after tip-out"', { on: true, basis: 'after' }],
]) {
  test('d) editing a night while tip-outs are ' + what + ' keeps who was tipped out', async () => {
    const page = await boot({ seed: offSeed(tipout) });
    try {
      page.tab('periods');
      page.click(editBtn(page, 'n1'));
      assert.equal(page.$('[data-focus-key="edit-n1-tipout-t1"]'), null, 'no boxes on screen');
      page.type(page.must(page.$('#edit-n1-note'), 'note'), 'double shift'); // any edit and Save
      page.click(page.button('Save changes'));
      const n = nightOf(page, 'n1');
      assert.equal(n.note, 'double shift');
      assert.deepEqual(n.tipouts, { t1: true, t2: false });
      assert.equal(page.state().nights.length, 1);
      // switched back on ("before"): the runner, never tipped out that night, is still not counted ($40 flat would
      // make it $343.24)
      const p = { ...clone(page.state().workplaces[0].profile), tipout: { on: true, basis: 'before' } };
      const c = computeNight(n, p, 10);
      assert.deepEqual(
        c.tipouts.map((l) => [l.who, l.amount]),
        [['Barback', 40.4]],
      );
      assert.equal(c.net, 377.08);
      // and the hours edited while still off: still only the barback
      page.click(editBtn(page, 'n1'));
      page.type(key(page, 'edit-n1-pay-p1'), '7.5');
      page.click(page.button('Save changes'));
      assert.deepEqual(nightOf(page, 'n1').tipouts, { t1: true, t2: false });
      assert.deepEqual(
        computeNight(nightOf(page, 'n1'), p, 10).tipouts.map((l) => [l.who, l.amount]),
        [['Barback', 41]],
      );
    } finally {
      await page.close();
    }
  });
}

test('d) Tonight Replace and Add while tip-outs are off keep the night’s ticks and sales', async () => {
  const page = await boot({ seed: offSeed({ on: false, basis: 'before' }) });
  try {
    const date = nightOf(page, 'n1').date;
    nightOf(page, 'n1').sales = 900;
    page.tab('periods');
    page.tab('tonight');
    retype(page, date);
    page.click(page.button('Replace it'));
    assert.deepEqual(nightOf(page, 'n1').tipouts, { t1: true, t2: false });
    assert.equal(nightOf(page, 'n1').sales, 900);
    page.type(key(page, 'night-total'), '50');
    page.type(key(page, 'night-pay-p1'), '1');
    page.type(key(page, 'night-date'), date);
    page.click(page.button('Save night'));
    page.click(page.button('Add to that night'));
    assert.deepEqual(nightOf(page, 'n1').tipouts, { t1: true, t2: false });
    assert.equal(nightOf(page, 'n1').total, 550);
  } finally {
    await page.close();
  }
});

test('e) Setup: Remove the barback, add a barback again and Save: the nights logged this pay period keep the tip-out', async () => {
  // second v38 review: each night went from $360.24 to $410.75 and said "no tip-out" (the new row has a new id)
  const cur = addDays(today, -5);
  const nights = [1, 2, 3].map((i) => ({
    id: 'c' + i,
    date: addDays(cur, i),
    total: 500,
    cash: 200,
    pay: { p1: 8 },
    barback: true,
    tipouts: { t1: i !== 2 }, // the barback wasn't tipped out on the second night
    workplaceId: 'w1',
  }));
  const page = await boot({
    seed: realState((S) => {
      S.workplaces[0].setupDone = true;
      S.workplaces[0].profile = {
        ...exampleProfile(today),
        periodStart: cur,
        periodEnd: addDays(cur, 13),
        freq: 14,
        tipout: { on: true, basis: 'before' },
        tipouts: [{ ...BARBACK }],
      };
      S.nights = [...nights, lockedNight()]; // and a locked night of an older pay period
    }),
  });
  try {
    const net = () => page.state().nights.map((n) => money(page, n).net);
    assert.deepEqual(net().slice(0, 3), [360.24, 410.75, 360.24]);
    const lockedBefore = clone(nightOf(page, 'n1'));
    page.openSetup();
    page.click(page.byLabel('Remove Barback'));
    page.click(page.button('+ Add someone you tip out'));
    const rows = page.$$('select[id^="tw-"]');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].value, 'barback');
    page.type(page.$$('input[id^="tv-"]')[0], '15');
    await page.saveSetup();
    const list = page.state().workplaces[0].profile.tipouts;
    assert.equal(list.length, 1);
    assert.notEqual(list[0].id, 't1', 'a new row');
    assert.deepEqual(net().slice(0, 3), [360.24, 410.75, 360.24], 'the barback still counts where ticked');
    assert.deepEqual(
      page
        .state()
        .nights.slice(0, 3)
        .map((n) => n.tipouts[list[0].id]),
      [true, false, true],
    );
    assert.deepEqual(nightOf(page, 'n1'), lockedBefore, 'a locked night is untouched');
    page.tab('periods');
    assert.equal((page.text().match(/no tip-out/g) || []).length, 1, 'only the night without the barback');
  } finally {
    await page.close();
  }
});

test('e) Setup: two barbacks removed and one added: nothing is guessed', async () => {
  const cur = addDays(today, -5);
  const B3 = { ...BARBACK, id: 't3', value: 10 };
  const page = await boot({
    seed: realState((S) => {
      S.workplaces[0].setupDone = true;
      S.workplaces[0].profile = {
        ...exampleProfile(today),
        periodStart: cur,
        periodEnd: addDays(cur, 13),
        freq: 14,
        tipout: { on: true, basis: 'before' },
        tipouts: [{ ...BARBACK }, { ...B3 }, { ...RUNNER }],
      };
      S.nights = [
        {
          id: 'a',
          date: addDays(cur, 1),
          total: 500,
          cash: 200,
          pay: { p1: 8 },
          barback: true,
          tipouts: { t1: false, t3: true, t2: true },
          workplaceId: 'w1',
        },
      ];
    }),
  });
  try {
    page.openSetup();
    page.click(page.$$('button[aria-label="Remove Barback"]')[0]);
    page.click(page.$$('button[aria-label="Remove Barback"]')[0]);
    page.click(page.button('+ Add someone you tip out')); // the next unused preset: Barback
    const sel = page.$$('select[id^="tw-"]').pop();
    assert.equal(sel.value, 'barback');
    page.type(page.$$('input[id^="tv-"]').pop(), '15');
    await page.saveSetup();
    const list = page.state().workplaces[0].profile.tipouts;
    const fresh = list.find((r) => r.k === 'barback');
    const n = page.state().nights[0];
    assert.equal(n.tipouts[fresh.id], undefined, 'two barbacks removed for one: nothing is guessed');
    assert.equal(n.tipouts.t2, true);
  } finally {
    await page.close();
  }
});
