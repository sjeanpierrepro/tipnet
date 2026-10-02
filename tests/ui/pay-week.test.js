// Pay periods: "Counts toward the pay week that started" in the night editor (owner request).
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { addDays, todayISO } from '../../app/js/math.js';

const today = todayISO();
const fmt = (iso, o) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { ...o, timeZone: 'UTC' });
const long = (iso) => fmt(iso, { weekday: 'short', month: 'short', day: 'numeric' });
const short = (iso) => fmt(iso, { month: 'short', day: 'numeric' });
/** 14-day pay periods starting `start`; nights as given. */
const seed = (start, nights) =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    S.workplaces[0].profile.periodStart = start;
    S.workplaces[0].profile.periodEnd = addDays(start, 13);
    S.workplaces[0].profile.shifts = 5;
    S.settings.dayCutoffHour = 0; // Late nights off, so a night dated tomorrow saves at any hour
    S.nights = nights.map((n, i) => ({
      id: 'n' + (i + 1),
      total: 300,
      cash: 80,
      pay: { p1: 6 },
      barback: true,
      ...n,
    }));
  });
const sections = (page) => page.$$('section[data-period]', page.app);
const sectionOf = (page, start) =>
  sections(page).find((s) => s.querySelector('.label').textContent.includes(short(start)));
const openEdit = (page, date) => page.click(page.byLabel('Edit night ' + long(date)));
const weekSel = (page) => page.must(page.$('select[id$="-week"]', page.app), 'pay week select');

test('the editor offers the previous, own and next pay week, labelled with start and range', async () => {
  const start = addDays(today, -3); // current period: today-3 .. today+10
  const page = await boot({ seed: seed(start, [{ date: addDays(today, -1) }]) });
  try {
    page.tab('periods');
    openEdit(page, addDays(today, -1));
    const sel = weekSel(page);
    const label = page.$('label[for="' + sel.id + '"]');
    assert.equal(label.textContent.trim(), 'Counts toward the pay week that started:');
    assert.equal(sel.getAttribute('data-focus-key'), sel.id, 'stable focus key');
    const opts = [...sel.options];
    assert.equal(opts.length, 3);
    const prev = addDays(start, -14),
      next = addDays(start, 14);
    assert.deepEqual(
      opts.map((o) => o.value),
      [prev, start, next],
    );
    assert.equal(
      opts[1].textContent,
      long(start) + ' · ' + short(start) + ' – ' + short(addDays(start, 13)) + ' (this night’s date)',
    );
    assert.equal(sel.value, start, 'its own pay week by default');
    assert.equal(opts[0].disabled, true, 'a finished pay week can’t be picked');
    assert.match(opts[0].textContent, /\(finished\)$/);
    assert.equal(opts[2].disabled, false);
    assert.equal(sel.disabled, false);
  } finally {
    await page.close();
  }
});

test('saving a pick moves the night to that pay week with a row note; picking its own week again removes it', async () => {
  const start = addDays(today, -13); // the current period ends today; the night is dated tomorrow (next period)
  const date = addDays(today, 1);
  const page = await boot({ seed: seed(start, [{ date }, { id: 'other', date: addDays(today, -2) }]) });
  try {
    page.tab('periods');
    const next = addDays(start, 14);
    assert.equal(sectionOf(page, next).querySelectorAll('.list-row').length, 1);
    const curBefore = page.text(sectionOf(page, start).querySelector('b'));
    openEdit(page, date);
    const sel = weekSel(page);
    assert.equal(sel.options[0].disabled, false, 'the current pay week has not finished');
    sel.value = start;
    page.change(sel);
    page.click(page.button('Save changes'));
    await page.settle();
    const n = page.state().nights.find((x) => x.date === date);
    assert.equal(n.periodStart, start);
    assert.equal(sectionOf(page, next), undefined, 'the next pay week has no nights now');
    const cur = sectionOf(page, start);
    assert.equal(cur.querySelectorAll('.list-row').length, 2, 'listed under the pay week it counts toward');
    assert.ok(page.text(cur).includes('counted in pay week of ' + short(start)));
    assert.notEqual(page.text(cur.querySelector('b')), curBefore, 'the totals moved with it');
    assert.match(page.text(page.doc.getElementById('toast')), /counts in the pay week that started/);

    // and back to its own week: periodStart is removed
    openEdit(page, date);
    const sel2 = weekSel(page);
    assert.equal(sel2.value, start);
    sel2.value = next;
    page.change(sel2);
    page.click(page.button('Save changes'));
    await page.settle();
    assert.equal('periodStart' in page.state().nights.find((x) => x.date === date), false);
    assert.equal(sectionOf(page, next).querySelectorAll('.list-row').length, 1);
    assert.equal(page.text(sectionOf(page, start).querySelector('b')), curBefore);
    assert.ok(!page.text(page.app).includes('counted in pay week of'));
  } finally {
    await page.close();
  }
});

test('a night in a finished pay period stays there: the select is off and says why', async () => {
  const start = addDays(today, -3);
  const old = addDays(today, -10); // previous period, finished (locked at start-up)
  const page = await boot({ seed: seed(start, [{ date: old }]) });
  try {
    page.tab('periods');
    openEdit(page, old);
    const sel = weekSel(page);
    assert.equal(sel.disabled, true);
    assert.equal(sel.value, addDays(start, -14));
    const hint = page.$('#' + sel.getAttribute('aria-describedby'));
    assert.equal(hint.textContent, 'This pay period is finished, so this night stays in it.');
    page.click(page.button('Save changes'));
    await page.settle();
    assert.equal('periodStart' in page.state().nights[0], false);
  } finally {
    await page.close();
  }
});

test('after a schedule change a stale pick is counted by its date, with a note', async () => {
  const start = addDays(today, -3);
  const date = addDays(today, -1);
  // a pick that is not a pay period start in this schedule (as after moving the start date in Setup)
  const page = await boot({ seed: seed(start, [{ date, periodStart: addDays(start, 1) }]) });
  try {
    page.tab('periods');
    const cur = sectionOf(page, start);
    assert.equal(cur.querySelectorAll('.list-row').length, 1, 'counted by its date');
    assert.ok(page.text(cur).includes('pay week no longer matches your schedule, counted by its date'));
    openEdit(page, date);
    assert.equal(weekSel(page).value, start);
    page.click(page.button('Save changes'));
    await page.settle();
    assert.equal('periodStart' in page.state().nights[0], false, 'saving the default clears the stale pick');
    assert.ok(!page.text(page.app).includes('no longer matches'));
  } finally {
    await page.close();
  }
});
