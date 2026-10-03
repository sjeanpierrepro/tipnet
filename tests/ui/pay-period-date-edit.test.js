// Pay periods editor: editing a night's DATE moves it with its date (independent review). The pay period select is
// rebuilt around the new date; an explicit pick is kept only while the new date still offers it; moving into or out
// of a finished pay period by date asks first and locks/unlocks like an explicit move.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { addDays, todayISO } from '../../app/js/math.js';

const today = todayISO();
const fmt = (iso, o) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { ...o, timeZone: 'UTC' });
const long = (iso) => fmt(iso, { weekday: 'short', month: 'short', day: 'numeric' });
const short = (iso) => fmt(iso, { month: 'short', day: 'numeric' });
// 14-day periods. Current: today-3 .. today+10 (CUR). PREV (today-17 .. today-4) and PREV2 (today-31 .. today-18) are
// finished; NEXT starts today+11.
const CUR = addDays(today, -3);
const PREV = addDays(CUR, -14);
const PREV2 = addDays(CUR, -28);
const PREV3 = addDays(CUR, -42);
const NEXT = addDays(CUR, 14);
const label = (s) => short(s) + ' – ' + short(addDays(s, 13));
const seed = (nights) =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    S.workplaces[0].profile.periodStart = CUR;
    S.workplaces[0].profile.periodEnd = addDays(CUR, 13);
    S.workplaces[0].profile.shifts = 5;
    S.settings.dayCutoffHour = 0;
    S.nights = nights.map((n, i) => ({
      id: 'n' + (i + 1),
      total: 300,
      cash: 80,
      pay: { p1: 6 },
      barback: true,
      ...n,
    }));
  });
const weekSel = (page) => page.must(page.$('select[id$="-week"]', page.app), 'pay period select');
const ask = (page) => page.$('[role=group][aria-label="Move to another pay period?"]', page.app);
const note = (page) => page.$('[id$="-week-note"]', page.app);
const dateInput = (page) => page.must(page.$('input[type=date]', page.app), 'date');
const toastText = (page) => page.text(page.doc.getElementById('toast'));
const night = (page, id = 'n1') => page.state().nights.find((x) => x.id === id);
async function editDate(page, from, to) {
  page.click(page.byLabel('Edit night ' + long(from)));
  page.type(dateInput(page), to);
  await page.settle();
}
async function save(page) {
  page.click(page.button('Save changes'));
  await page.settle();
}
async function move(page) {
  page.click(page.button('Move night', page.must(ask(page), 'confirmation')));
  await page.settle();
}

test('date edit within one pay period: no pick saved, no question', async () => {
  const page = await boot({ seed: seed([{ date: addDays(today, -1) }]) });
  try {
    page.tab('periods');
    await editDate(page, addDays(today, -1), today);
    assert.equal(weekSel(page).value, CUR);
    await save(page);
    assert.equal(ask(page), null);
    assert.equal(night(page).date, today);
    assert.equal('periodStart' in night(page), false);
    assert.equal(toastText(page), 'Night updated.');
  } finally {
    await page.close();
  }
});

test('reviewer repro: current to the adjacent finished period by date asks, then lands by its new date and locks', async () => {
  const from = addDays(today, -1),
    to = addDays(today, -5);
  const page = await boot({ seed: seed([{ date: from }]) });
  try {
    page.tab('periods');
    await editDate(page, from, to);
    const sel = weekSel(page);
    assert.deepEqual(
      [...sel.options].map((o) => o.value),
      [PREV2, PREV, CUR],
      'choices rebuilt around the new date',
    );
    assert.equal(sel.value, PREV, 'the new date’s own pay period');
    assert.match(sel.options[1].textContent, /\(this night’s date\)/);
    await save(page);
    assert.ok(page.text(page.must(ask(page), 'confirmation')).includes(label(PREV)));
    assert.equal(night(page).date, from, 'nothing saved before Move night');
    await move(page);
    const n = night(page);
    assert.equal(n.date, to);
    assert.equal('periodStart' in n, false, 'follows its date (was saved with the OLD period)');
    assert.ok(n.snap, 'locked: it joined a finished pay period');
    assert.equal(
      toastText(page),
      'Night updated. It counts by its date, in the pay period that started ' + long(PREV) + '.',
    );
  } finally {
    await page.close();
  }
});

test('reviewer repro: a date two pay periods back lands in that period (no pick kept)', async () => {
  const from = addDays(today, -1),
    to = addDays(today, -20);
  const page = await boot({ seed: seed([{ date: from }]) });
  try {
    page.tab('periods');
    await editDate(page, from, to);
    assert.deepEqual(
      [...weekSel(page).options].map((o) => o.value),
      [PREV3, PREV2, PREV],
    );
    assert.equal(weekSel(page).value, PREV2);
    await save(page);
    await move(page);
    const n = night(page);
    assert.equal(n.date, to);
    assert.equal('periodStart' in n, false);
    assert.ok(n.snap);
  } finally {
    await page.close();
  }
});

test('reviewer repro: a locked night moved by date out of a finished period asks, then unlocks in the running one', async () => {
  const from = addDays(today, -5),
    to = addDays(today, -1);
  const page = await boot({ seed: seed([{ date: from }]) });
  try {
    page.tab('periods');
    assert.ok(night(page).snap, 'locked at start (its period has ended)');
    await editDate(page, from, to);
    assert.equal(weekSel(page).value, CUR);
    await save(page);
    await move(page);
    const n = night(page);
    assert.equal(n.date, to);
    assert.equal('periodStart' in n, false, 'was saved with the old finished period');
    assert.equal(n.snap, undefined, 'follows Setup again in a period that has not ended');
  } finally {
    await page.close();
  }
});

test('“Keep where it is” after a date move puts the date back', async () => {
  const from = addDays(today, -1);
  const page = await boot({ seed: seed([{ date: from }]) });
  try {
    page.tab('periods');
    const was = JSON.stringify(page.state().nights);
    await editDate(page, from, addDays(today, -20));
    await save(page);
    page.click(page.button('Keep where it is', ask(page)));
    await page.settle();
    assert.equal(ask(page).hidden, true);
    assert.equal(dateInput(page).value, from);
    assert.equal(weekSel(page).value, CUR);
    assert.equal(JSON.stringify(page.state().nights), was);
    await save(page);
    assert.equal(night(page).date, from);
  } finally {
    await page.close();
  }
});

test('an explicit pick is kept when the new date still offers it', async () => {
  // dated in PREV, counted in CUR (picked before)
  const from = addDays(today, -5);
  const page = await boot({ seed: seed([{ date: from, periodStart: CUR }]) });
  try {
    page.tab('periods');
    await editDate(page, from, addDays(today, -10)); // still in PREV: CUR is its "next"
    assert.equal(weekSel(page).value, CUR);
    assert.equal(note(page).hidden, true);
    await save(page);
    assert.equal(ask(page), null, 'still counted in the same pay period: nothing to confirm');
    assert.equal(night(page).date, addDays(today, -10));
    assert.equal(night(page).periodStart, CUR);
    assert.equal(
      toastText(page),
      'Night updated. It counts in the pay period that started ' + long(CUR) + '.',
    );
  } finally {
    await page.close();
  }
});

test('an explicit pick is cleared with a note when the new date is too far from it', async () => {
  const from = addDays(today, -5);
  const page = await boot({ seed: seed([{ date: from, periodStart: CUR }]) });
  try {
    page.tab('periods');
    await editDate(page, from, addDays(today, -20)); // PREV2 offers PREV3, PREV2, PREV (not CUR)
    assert.equal(weekSel(page).value, PREV2);
    assert.equal(note(page).hidden, false);
    assert.equal(
      page.text(note(page)),
      'This night now counts by its new date (pay period ' + label(PREV2) + ').',
    );
    // back to a date that offers it: the pick comes back and the note goes
    page.type(dateInput(page), addDays(today, -6));
    await page.settle();
    assert.equal(weekSel(page).value, CUR);
    assert.equal(note(page).hidden, true);
    page.type(dateInput(page), addDays(today, -20));
    await page.settle();
    await save(page);
    await move(page); // out of CUR into the finished PREV2
    const n = night(page);
    assert.equal('periodStart' in n, false);
    assert.ok(n.snap);
    assert.equal(
      toastText(page),
      'Night updated. It counts by its date, in the pay period that started ' + long(PREV2) + '.',
    );
  } finally {
    await page.close();
  }
});

test('a pick made in the editor stays while offered; picking the date’s own period means follow the date', async () => {
  const page = await boot({ seed: seed([{ date: today }]) });
  try {
    page.tab('periods');
    await editDate(page, today, addDays(today, 1));
    assert.equal(weekSel(page).value, CUR);
    const sel = weekSel(page);
    sel.value = NEXT;
    page.change(sel);
    page.type(dateInput(page), today);
    await page.settle();
    assert.equal(weekSel(page).value, NEXT, 'still offered: kept');
    weekSel(page).value = CUR;
    page.change(weekSel(page));
    await save(page);
    assert.equal('periodStart' in night(page), false);
  } finally {
    await page.close();
  }
});

test('joining a finished pay period that has locked nights copies that period’s snapshot', async () => {
  const snap = {
    v: 1,
    r: 0.2,
    rf: 0.1,
    fixed: 123.45,
    nontax: 7,
    n: 5,
    pay: [{ id: 'p1', rate: 9, unit: 'hr', usual: 6 }],
    tipout: { on: false, mode: 'pct', value: 0, basis: 'before', from: 'cash' },
  };
  const page = await boot({
    seed: seed([
      { date: addDays(today, -8), snap },
      { id: 'n2', date: addDays(today, -1) },
    ]),
  });
  try {
    page.tab('periods');
    await editDate(page, addDays(today, -1), addDays(today, -6));
    await save(page);
    await move(page);
    const moved = night(page, 'n2');
    assert.deepEqual(moved.snap, night(page, 'n1').snap, 'the period’s own snapshot, not today’s Setup');
    assert.equal(moved.snap.fixed, 123.45);
    assert.notEqual(moved.snap, night(page, 'n1').snap, 'a copy');
  } finally {
    await page.close();
  }
});
