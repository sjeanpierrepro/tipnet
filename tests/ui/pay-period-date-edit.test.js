// Pay periods editor: editing a night's DATE moves it with its date (independent review). The pay period select is
// rebuilt around the new date; an explicit pick is kept only while the new date still offers it; moving into or out
// of a finished pay period by date asks first and locks/unlocks like an explicit move.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import {
  addDays,
  todayISO,
  fixedTotal,
  periodIndex,
  nightsInPeriod,
  periodFixed,
  periodNontax,
} from '../../app/js/math.js';

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
    // one paragraph, then the buttons: nothing empty between them
    assert.equal(ask(page).querySelectorAll('p').length, 1);
    assert.equal(ask(page).querySelector('p').childNodes.length, 1);
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

test('the editor estimate updates as typed but is spoken only after a pause (no live region on every keystroke)', async () => {
  const page = await boot({ seed: seed([{ date: addDays(today, -1) }]) });
  try {
    page.tab('periods');
    page.click(page.byLabel('Edit night ' + long(addDays(today, -1))));
    const form = page.must(page.$('form', page.app), 'editor');
    const shown = page.must(
      [...form.querySelectorAll('p.hint')].find((x) => /Estimated take-home/.test(x.textContent)),
      'estimate',
    );
    assert.equal(shown.getAttribute('aria-live'), null, 'the visible line is not a live region');
    const live = page.must(form.querySelector('[role=status][aria-live=polite].sr-only'), 'spoken estimate');
    assert.equal(live.textContent, '', 'nothing spoken on opening');
    const before = shown.textContent;
    page.type(page.must(form.querySelector('[data-focus-key$="-total"]'), 'total'), '450');
    assert.notEqual(shown.textContent, before, 'the visible estimate follows the typing');
    assert.equal(live.textContent, '', 'not spoken yet');
    // (the harness unrefs timers: an interval keeps the process alive while waiting)
    await new Promise((r) => {
      const keep = setInterval(() => {}, 50);
      setTimeout(() => {
        clearInterval(keep);
        r();
      }, 900);
    });
    assert.equal(live.textContent, shown.textContent, 'spoken after the pause');
  } finally {
    await page.close();
  }
});

// 7-day pay periods (e.g. after a 14 -> 7 day schedule change): week W0 is today-3 .. today+3.
const seed7 = (nights) =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    S.workplaces[0].profile.periodStart = CUR;
    S.workplaces[0].profile.freq = 7;
    S.workplaces[0].profile.periodEnd = addDays(CUR, 6);
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

test('a saved pick two pay periods from the night’s date is kept while the date is unchanged', async () => {
  // dated in the finished week before CUR's, counted two weeks later (the week after CUR's)
  const date = addDays(today, -10),
    far = addDays(CUR, 7);
  const page = await boot({ seed: seed7([{ date, periodStart: far }]) });
  try {
    page.tab('periods');
    page.click(page.byLabel('Edit night ' + long(date)));
    assert.equal(weekSel(page).value, far, 'offered and selected on opening');
    assert.equal(note(page).hidden, true, 'no "now counts by its new date": the date did not change');
    page.type(page.must(page.$('[data-focus-key$="-total"]', page.app), 'total'), '310');
    await save(page);
    assert.equal(ask(page), null, 'the pay period does not change: nothing to confirm');
    assert.equal(night(page).total, 310);
    assert.equal(night(page).periodStart, far, 'the pick is kept');
  } finally {
    await page.close();
  }
});

test('a far pick dropped by a date edit comes back with “Keep where it is” (the date goes back)', async () => {
  const date = addDays(today, -10),
    far = addDays(CUR, 7);
  const page = await boot({ seed: seed7([{ date, periodStart: far }]) });
  try {
    page.tab('periods');
    await editDate(page, date, addDays(today, -9)); // same finished week: the far pick isn't offered around it
    assert.notEqual(weekSel(page).value, far);
    assert.equal(note(page).hidden, false);
    await save(page);
    page.click(page.button('Keep where it is', page.must(ask(page), 'confirmation')));
    await page.settle();
    assert.equal(dateInput(page).value, date);
    assert.equal(weekSel(page).value, far);
    assert.equal(note(page).hidden, true);
    await save(page);
    assert.equal(ask(page), null);
    assert.equal(night(page).date, date);
    assert.equal(night(page).periodStart, far);
  } finally {
    await page.close();
  }
});

test('the dropped-pick status line is not rewritten while typing elsewhere', async () => {
  const from = addDays(today, -5);
  const page = await boot({ seed: seed([{ date: from, periodStart: CUR }]) });
  try {
    page.tab('periods');
    await editDate(page, from, addDays(today, -20));
    const line = note(page);
    assert.equal(line.hidden, false);
    let records = 0;
    const mo = new page.win.MutationObserver((l) => (records += l.length));
    mo.observe(line, { attributes: true, childList: true, characterData: true, subtree: true });
    const total = page.must(page.$('[data-focus-key$="-total"]', page.app), 'total');
    for (const v of ['3', '31', '310']) page.type(total, v);
    await page.settle();
    mo.disconnect();
    assert.equal(records, 0, 'no rewrites, so it is not announced again');
    assert.equal(line.hidden, false);
  } finally {
    await page.close();
  }
});

for (const first of ['n2', 'n1']) {
  test(
    'Recalculate with current Setup in a finished pay period keeps the period’s fixed deductions (' +
      (first === 'n2' ? 'newest night first' : 'older night first') +
      ')',
    async () => {
      const snap = () => ({
        v: 1,
        r: 0.2,
        rf: 0.1,
        fixed: 50,
        nontax: 7,
        n: 5,
        pay: [{ id: 'p1', rate: 9, unit: 'hr', usual: 6 }],
        tipout: { on: false, mode: 'pct', value: 0, basis: 'before', from: 'cash' },
      });
      const d1 = addDays(today, -10),
        d2 = addDays(today, -6); // both in the finished PREV; n2 is the newest
      const page = await boot({
        seed: seed([
          { date: d1, snap: snap() },
          { date: d2, snap: snap() },
        ]),
      });
      try {
        page.tab('periods');
        const p = page.state().workplaces[0].profile;
        const fixedNow = fixedTotal(p);
        assert.notEqual(fixedNow, 50, 'today’s Setup differs from the period’s');
        const k = periodIndex(p, d1);
        const period = () => {
          const ns = nightsInPeriod(p, page.state().nights, k);
          return [periodFixed(p, ns), periodNontax(p, ns)];
        };
        assert.deepEqual(period(), [50, 7]);
        for (const id of first === 'n2' ? ['n2', 'n1'] : ['n1', 'n2']) {
          page.click(page.byLabel('Edit night ' + long(id === 'n1' ? d1 : d2)));
          const cb = page.must(page.$('#edit-' + id + '-recalc'), 'recalculate');
          const hint = page.must(page.doc.getElementById(cb.getAttribute('aria-describedby')), 'hint');
          assert.equal(
            page.text(hint),
            'This night uses today’s Setup; the pay period’s fixed deductions stay as they were.',
          );
          cb.checked = true;
          page.change(cb);
          await save(page);
          assert.equal(night(page, id).snap.fixed, fixedNow, 'the night itself uses today’s Setup');
          assert.deepEqual(period(), [50, 7], 'after recalculating ' + id);
        }
      } finally {
        await page.close();
      }
    },
  );
}
