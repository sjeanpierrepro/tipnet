import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { addDays, todayISO } from '../../app/js/math.js';
import { PAGE } from '../../app/js/ui/periods.js';

const today = todayISO();
// 14-day periods; the current one started 3 days ago. One night every 3 days for ~20 periods.
const seed = (count = 90) => realState((S) => {
  S.settings.setupDone = true;
  S.profile.periodStart = addDays(today, -3 - 14 * 20);
  S.profile.periodEnd = addDays(S.profile.periodStart, 13);
  S.profile.shifts = 5;
  S.nights = Array.from({ length: count }, (_, i) => ({ id: i + 1, date: addDays(today, -i * 3), total: 300, cash: 80, pay: { p1: 6 }, barback: true }));
});
const sections = (page) => page.$$('section[data-period]', page.app);

test('Pay periods shows the latest periods; "Show older" adds more in place and keeps focus', async () => {
  const page = await boot({ seed: seed() });
  try {
    page.tab('periods');
    assert.equal(sections(page).length, PAGE);
    const first = sections(page)[0];
    const more = page.$('#periods-older');
    assert.match(more.textContent, /Show older pay periods \(\d+ more\)/);
    more.focus();
    page.click(more);
    assert.equal(sections(page).length, PAGE * 2);
    assert.equal(sections(page)[0], first, 'existing periods were not rebuilt');
    assert.equal(page.doc.activeElement, more, 'focus stays on the button');
    while (page.$('#periods-older')) page.click(page.$('#periods-older'));
    assert.equal(page.$$('.list-row', page.app).length, 90, 'every night reachable');
    assert.ok(page.doc.activeElement.classList.contains('label'), 'focus moved to the first newly shown period');
  } finally { await page.close(); }
});

test('Edit opens the editor by rebuilding only that period', async () => {
  const page = await boot({ seed: seed(20) });
  try {
    page.tab('periods');
    const [a, b] = sections(page);
    const edit = page.byLabel('Edit night ' + page.$('.list-row .main div', b).textContent);
    edit.focus();
    page.click(edit);
    const [a2, b2] = sections(page);
    assert.equal(a2, a, 'the other period is untouched');
    assert.notEqual(b2, b);
    assert.ok(page.$('form', b2), 'editor open');
    assert.equal(page.doc.activeElement.getAttribute('data-focus-key'), edit.getAttribute('data-focus-key'), 'focus lands in the editor');
    page.click(page.button('Cancel', b2));
    assert.ok(!page.$('form', sections(page)[1]));
  } finally { await page.close(); }
});

test('two-tap Delete: the armed state is in the accessible name and announced', async () => {
  const page = await boot({ seed: seed(3) });
  try {
    page.tab('periods');
    const del = page.$$('.btn-danger', page.app)[0];
    const name = del.getAttribute('aria-label');
    assert.match(name, /^Delete night /);
    page.click(del);
    assert.equal(del.getAttribute('aria-label'), name.replace('Delete night ', 'Confirm delete night of '));
    assert.match(page.$('#toast').textContent, /Tap Delete again to delete the night of/);
    del.dispatchEvent(new page.win.Event('blur'));
    assert.equal(del.getAttribute('aria-label'), name, 'back to normal when it disarms');
  } finally { await page.close(); }
});

test('a raise after a finished period leaves it unchanged; the open period follows Setup; the editor can recalculate', async () => {
  const page = await boot({ seed: seed(20) });
  try {
    page.tab('periods');
    const total = (i) => sections(page)[i].querySelector('b.num').textContent;
    const cur0 = total(0), fin0 = total(1);
    const S = page.state();
    const finishedNight = S.nights.find((n) => n.snap);
    assert.ok(finishedNight, 'nights in finished periods were locked at load');
    assert.ok(S.nights.filter((n) => n.date >= addDays(today, -3)).every((n) => !n.snap), 'the open period stays unlocked');
    S.profile.payTypes[0].rate = 20; // a raise
    page.tab('tonight'); page.tab('periods');
    assert.equal(total(1), fin0, 'finished period unchanged');
    assert.notEqual(total(0), cur0, 'open period follows Setup');

    // Editing a locked night keeps its numbers unless "Recalculate with current Setup" is ticked
    const row = sections(page)[1].querySelector('.list-row');
    page.click(page.byLabel('Edit night ' + row.querySelector('.main div').textContent));
    const form = page.$('form', sections(page)[1]);
    assert.match(form.textContent, /Recalculate with current Setup/);
    page.click(page.button('Save changes', form));
    assert.equal(total(1), fin0, 'plain save keeps the lock');
    page.click(page.byLabel('Edit night ' + sections(page)[1].querySelector('.list-row .main div').textContent));
    const form2 = page.$('form', sections(page)[1]);
    const cb = form2.querySelector('input[type=checkbox][id$="-recalc"]');
    cb.checked = true; page.change(cb);
    page.click(page.button('Save changes', form2));
    assert.notEqual(total(1), fin0, 'recalculated with the raise');
  } finally { await page.close(); }
});
