// Pay periods screen: nights grouped by pay period, edit/delete, and "Check my accuracy".
import {
  computeNight,
  periodTotals,
  periodIndex,
  nightPeriodIndex,
  nightPeriodChoices,
  nightPeriodMoved,
  nightPeriodStale,
  shiftsPerPeriod,
  calibrate,
  todayISO,
  isFinal,
  indexNights,
  snapshotFor,
  snapWithPay,
  periodToSetup,
  periodSnap,
  nightsInPeriod,
  periodRange,
  totalFromTips,
  hasTips,
  num,
  rate as currentRate,
  tipoutsTonight,
  tipoutSetup,
  nightTipout,
  toCents,
  fromCents,
  dayDiff,
  addDays,
  periodLength,
} from '../math.js';
import { businessDate, cutoffFromSettings, moneyTypo, readMoney } from '../inputs.js';
import { monthlyNeeds, periodsPerYear, perPeriodC, extraGoalC } from '../budget.js';
import { BILLING, isUnlocked } from '../billing.js';
import { openPreview, upgradeBtn } from './budget.js';
import {
  isSetUp,
  isWorkplaceSetUp,
  workplaceOf,
  findWorkplace,
  nightsOf,
  activeWorkplace,
  lockFinished,
  orderNight,
} from '../storage.js';
import {
  el,
  field,
  moneyInput,
  select,
  money,
  minus,
  pct,
  fmtDate,
  fmtShort,
  periodLabel,
  exampleBanner,
  setupFirstCard,
  toast,
  arm,
  save,
  bus,
  getState,
  keepFocus,
  workplaceSwitcher,
  debounce,
  flagTypo,
} from './common.js';
import {
  nightFields,
  draftFromNight,
  storedNight,
  entryCheck,
  showEntryProblem,
  jobsText,
  moneyNum,
  typoProblem,
  tipsProblem,
  typedNow,
  editedMoney,
  alignNight,
  peopleOf,
} from './tonight.js';

/** Pay periods shown at first; "Show older" adds this many more each time. */
export const PAGE = 6;

let editingId = null;
let calMsg = null; // {text}
let calPeriod = null;
let calActual = '';
let calPending = null; // {idx, r, wid}: a comparison waiting for "Apply this adjustment" / "Don't change"
let calWid = null; // the restaurant "Check my accuracy" is about (picked first when there is more than one)
let updating = null; // group key of the finished pay period whose "Update this pay period to today's Setup" is asked
let shown = PAGE;
// last render: {S, ctxs: Map(restaurant id -> ctx), sections: Map(group key -> section)} so Edit/Cancel/Show older only
// rebuild what changed. A group is one restaurant's pay period: key "<restaurant id>:<period index>".
let view = null;

/** Forget screen-local UI state (open editor, accuracy message, older periods shown). Called when leaving the tab and after erase/restore. */
export function reset() {
  editingId = null;
  calMsg = null;
  calPeriod = null;
  calActual = '';
  calPending = null;
  calWid = null;
  updating = null;
  shown = PAGE;
  view = null;
}
const gkey = (wid, idx) => wid + ':' + idx;

function nightSub(n, c, p) {
  const bits = [];
  const worked = jobsText(n, p);
  if (worked) bits.push(worked);
  bits.push('made ' + money(c.total));
  bits.push('tips ' + money(c.tips));
  if (c.tipout) bits.push(money(c.tipout) + ' tip-out');
  else {
    // tip-outs are on for that night, but nobody was tipped out
    const ts = nightTipout(n, p); // as the night was saved (whether tip-outs were on is its own)
    if (ts.on && ts.list.length && !tipoutsTonight(ts, n).length) bits.push('no tip-out');
  }
  if (c.onCheck != null) bits.push(money(c.onCheck) + ' on check');
  if (c.cashOffPayroll) bits.push('cash off payroll');
  return bits.join(' · ');
}

/** Say something to screen readers through the page's existing live region (#toast) without showing a toast. */
function announce(text) {
  const host = document.getElementById('toast');
  if (!host) return;
  const s = el('span', { class: 'sr-only' }, text);
  host.append(s);
  setTimeout(() => s.remove(), 4000);
}

/**
 * Focus follows the editor: Edit (opening) lands on the editor's first field, and Save/Cancel (closing) land back on
 * Edit. Those controls are never on screen together, so they can share one data-focus-key (see keepFocus in common.js).
 */
const editKey = (n) => 'edit-' + n.id + '-cc';

/** Rebuild only the given pay periods' sections (opening/closing the editor), keeping keyboard focus. keys: gkey()s. */
function redrawGroups(keys) {
  const root = document.getElementById('app');
  const secs = keys.map((k) => view && view.sections.get(k));
  if (!root || secs.some((s) => !s || !s.isConnected)) {
    bus.rerender();
    return;
  }
  keepFocus(root, () => {
    [...new Set(keys)].forEach((k) => {
      const old = view.sections.get(k);
      const wid = old.getAttribute('data-workplace');
      const fresh = group(
        view.S,
        workplaceOf(view.S, wid),
        Number(old.getAttribute('data-period')),
        view.ctxs.get(wid),
      );
      old.replaceWith(fresh);
    });
  });
}
/** The group a night is listed in (its restaurant's pay period), or null. */
const keyOfNight = (S, id) => {
  const n = S.nights.find((x) => x.id === id);
  return n ? gkey(n.workplaceId, nightPeriodIndex(workplaceOf(S, n.workplaceId).profile, n)) : null;
};
function openEditor(S, id) {
  const before = editingId == null ? null : keyOfNight(S, editingId);
  editingId = id;
  redrawGroups([keyOfNight(S, id), before].filter((k) => k != null));
}

/** Edit a night within its own restaurant: its jobs, rates, tip-out and pay periods. */
function editor(S, n) {
  const w = workplaceOf(S, n.workplaceId);
  const p = w.profile;
  const mine = nightsOf(S, w.id);
  const d = draftFromNight(n, p); // CC tips and Cash tips: the tips inside the stored total (its own rates if locked)
  d.note = n.note || ''; // the editor's own field; draftFromNight knows nothing about notes
  const opened = typedNow(d); // what was typed when the editor opened (see editedMoney)
  // The estimate follows the typing on screen, but is only spoken after a pause (like Tonight's summary), so a screen
  // reader isn't interrupted on every keystroke.
  const preview = el('p', { class: 'hint' });
  const previewLive = el('p', {
    class: 'sr-only',
    role: 'status',
    'aria-live': 'polite',
    'aria-atomic': 'true',
  });
  const speak = debounce(() => {
    previewLive.textContent = preview.textContent;
  }, 800);
  const shiftsFor = (night) => shiftsPerPeriod(p, mine, todayISO(), nightPeriodIndex(p, night)).n;
  // "Counts toward the pay period that started": the period before the night's date's, its own (the default), or the
  // next, always offered around the date typed now. Every choice can be picked, finished or not (the person's own
  // correction). Whatever changes the pay period the night counts toward (a pick or a new date) and touches a finished
  // pay period asks first (see the submit handler); a night that joins a finished period is locked right away.
  const ownStart = (date) => {
    const k = periodIndex(p, date);
    return Number.isFinite(k) ? periodRange(p, k).start : null;
  };
  // The explicit pick: a pay period other than the date's, picked in this editor or saved before (a valid one only).
  // null: the night follows its date.
  const pickAtOpen = nightPeriodMoved(p, n) ? periodRange(p, nightPeriodIndex(p, n)).start : null;
  let chosen = pickAtOpen;
  let pick = chosen || ownStart(d.date); // the period shown in the select (its start date)
  let confirmed = false; // "Move night" was tapped for the move shown
  /** The night's periodStart as it will be saved: the pick, or none when it is the night's own date's period. */
  const pickedStart = () => {
    const own = ownStart(d.date);
    return pick && pick !== own ? pick : null;
  };
  /** {from, to}: period indexes when the edit (a pick or a new date) changes the pay period the night counts toward. */
  const moveOf = (night) => {
    const from = nightPeriodIndex(p, n),
      to = nightPeriodIndex(p, night);
    return from === to ? null : { from, to };
  };
  /**
   * The night as it will be saved. A locked night keeps its Setup numbers (its pay period's "Update this pay period to
   * today's Setup" gives every night there today's).
   */
  const build = () => {
    const out = storedNight(d, p, n.id);
    const note = d.note.trim().slice(0, 500);
    if (note) out.note = note;
    else delete out.note;
    const ps = pickedStart();
    if (ps) out.periodStart = ps;
    else delete out.periodStart;
    // Moved (by a pick or a new date) into a finished pay period it is locked: with that period's own snapshot when
    // it has locked nights (so its fixed deductions and non-taxable money don't change), else its own snapshot, else
    // one with today's Setup, as locking would. Into one that has not ended it follows the current Setup (no snapshot).
    const mv = moveOf(out);
    const intoFinished = !!mv && isFinal(p, mv.to, todayISO());
    const joined = intoFinished
      ? periodSnap(
          nightsInPeriod(
            p,
            nightsOf(S, w.id).filter((x) => x.id !== n.id),
            mv.to,
          ),
        )
      : null;
    const keepSnap = joined || (mv ? intoFinished && n.snap : n.snap);
    if (keepSnap) {
      // keep amounts for pay types removed from Setup since, so the locked numbers stay whole
      Object.keys(n.pay || {}).forEach((k) => {
        if (!(k in out.pay)) out.pay[k] = n.pay[k];
      });
      out.snap = keepSnap === n.snap ? n.snap : JSON.parse(JSON.stringify(keepSnap));
      // A night recalculated by v37 or earlier carries ITS OLD period's fixed deductions and non-taxable money
      // (snap.period).
      // Moved alone into an empty finished period, that period's check is the night's own snapshot: drop them.
      if (mv && out.snap === n.snap && n.snap.period) {
        out.snap = JSON.parse(JSON.stringify(n.snap));
        delete out.snap.period;
      }
    } else if (intoFinished) out.snap = snapshotFor(p, shiftsFor(out)); // into an empty finished pay period
    // Hours at a job added to Setup after the night was locked: that job at its Setup rate, the rate shown (snapWithPay).
    if (out.snap) out.snap = snapWithPay(out.snap, p, out);
    // Who was tipped out: the boxes are the night's own people (its snapshot's, or Setup's when it isn't locked). A move
    // can give it other ones (the period's snapshot, today's Setup into an empty finished period, or Setup's when a move
    // unlocks it): the ticks are carried over to them (alignNight). With no boxes on screen the night keeps its own.
    alignNight(out, d, p, n, peopleOf(out, p));
    // Tips and cash not changed: they stay exactly as stored (and the total too while the hours aren't changed); else
    // tips = CC tips + Cash tips, and the total is the tips + the pay this night is shown with (its snapshot, the new
    // one, or today's Setup).
    editedMoney(out, n, d, p, opened);
    // just locked by the move: like locking, the stored total becomes the typed tips + pay at the rates it is locked with
    if (out.snap && out.snap !== n.snap && hasTips(out)) out.total = totalFromTips(out.tips, out, p);
    return out;
  };
  /** quiet: the first draw (opening the editor) shows the estimate without speaking it. */
  const upd = (quiet) => {
    if (typoProblem(p, d) || tipsProblem(d)) {
      preview.textContent = 'Fix the number marked above to see the estimate.';
      return quiet === true ? undefined : speak();
    }
    const night = build();
    const c = computeNight(night, p, shiftsFor(night));
    preview.textContent = 'Estimated take-home for this night: ' + money(c.net) + '.';
    if (quiet !== true) speak();
  };
  // A locked night shows the rates it keeps. A job its snapshot doesn't have (added to Setup since) shows its Setup
  // rate, which the night is then saved with (snapWithPay in build).
  const rateOf = (t) => {
    if (!n.snap) return num(t.rate);
    const s = (n.snap.pay || []).find((x) => String(x.id) === String(t.id));
    return s ? num(s.rate) : num(t.rate);
  };
  const weekSel = el('select', { id: 'edit-' + n.id + '-week', 'data-focus-key': 'edit-' + n.id + '-week' });
  const weekField = field('Counts toward the pay period that started:', weekSel, { hint: ' ' });
  const weekHint = weekField.querySelector('p.hint');
  weekSel.setAttribute('aria-describedby', weekHint.id);
  weekHint.textContent =
    'Pick the pay period your paycheck counted this night in, if it isn’t the one for its date.';
  // One line when a new date drops the night's earlier pick (it is more than one pay period away from the new date).
  const weekNoteLine = el('p', { class: 'hint', role: 'status', id: 'edit-' + n.id + '-week-note' });
  weekNoteLine.hidden = true;
  weekField.append(weekNoteLine);
  let shownFor = null;
  /**
   * The choices around a date: the period before its own, its own, the next. While the date is the night's unchanged
   * one, the pick it was saved with is offered too, even further away (e.g. after a 14 -> 7 day schedule change), so
   * opening and saving the night never drops it.
   */
  const choicesFor = (date) => {
    const cs = nightPeriodChoices(p, date);
    if (!cs.length || !pickAtOpen || date !== n.date || cs.some((c) => c.start === pickAtOpen)) return cs;
    const k = nightPeriodIndex(p, n);
    return [...cs, { idx: k, ...periodRange(p, k), own: false }].sort((a, b) => a.idx - b.idx);
  };
  /**
   * Rebuild the choices around the date typed now. The select shows the explicit pick while it is still one of them;
   * otherwise the new date's own period, and a pick dropped that way (only after a date change) says so.
   */
  const syncWeek = () => {
    const cs = choicesFor(d.date);
    if (!cs.length) return; // a half-typed date: keep the options shown
    const own = cs.find((c) => c.own);
    const kept = chosen != null && cs.some((c) => c.start === chosen);
    pick = kept ? chosen : own.start;
    const dropped = chosen != null && !kept && d.date !== n.date;
    const noteText = dropped
      ? 'This night now counts by its new date (pay period ' + periodLabel(p, own.idx) + ').'
      : '';
    // a status line: rewritten only when its words change, so it isn't announced again on every keystroke
    if (weekNoteLine.hidden !== !dropped) weekNoteLine.hidden = !dropped;
    if (weekNoteLine.textContent !== noteText) weekNoteLine.textContent = noteText;
    const sig = d.date + '|' + pick;
    if (sig === shownFor) return;
    shownFor = sig;
    const today = todayISO();
    const opts = cs.map((c) =>
      el(
        'option',
        { value: c.start },
        fmtDate(c.start) +
          ' · ' +
          periodLabel(p, c.idx) +
          (c.own ? ' (this night’s date)' : '') +
          (isFinal(p, c.idx, today) ? ' (finished)' : ''),
      ),
    );
    weekSel.replaceChildren(...opts);
    weekSel.value = pick;
  };
  // Moving into or out of a finished pay period asks first, in the editor (Save does nothing until "Move night").
  const ask = el('div', {
    class: 'note stack-sm',
    role: 'group',
    'aria-label': 'Move to another pay period?',
  });
  ask.hidden = true;
  const hideAsk = () => {
    ask.hidden = true;
    ask.replaceChildren();
    confirmed = false;
  };
  weekSel.addEventListener('change', () => {
    // picking the date's own period means "follow the date" (a later date edit moves it along)
    chosen = weekSel.value === ownStart(d.date) ? null : weekSel.value;
    hideAsk();
    syncWeek();
    upd();
  });
  /** The finished pay periods a move changes, or [] (no move, or neither period has ended). */
  const finishedTouched = (night) => {
    const mv = moveOf(night);
    if (!mv) return [];
    const today = todayISO();
    return [...new Set([mv.from, mv.to])].sort((a, b) => a - b).filter((k) => isFinal(p, k, today));
  };
  const compared = (k) => comparedPeriod(w, k);
  function showAsk(ks) {
    const moveBtn = el(
      'button',
      { type: 'button', class: 'btn btn-small', 'data-focus-key': 'edit-' + n.id + '-move' },
      'Move night',
    );
    const keepBtn = el(
      'button',
      { type: 'button', class: 'btn btn-secondary btn-small', 'data-focus-key': 'edit-' + n.id + '-keep' },
      'Keep where it is',
    );
    moveBtn.addEventListener('click', () => {
      confirmed = true;
      saveBtn.click();
    });
    keepBtn.addEventListener('click', () => {
      hideAsk();
      // Back to the pay period it counts toward now: picked explicitly when the date typed still offers it, else the
      // date goes back too (a date further away can't stay in that period).
      const at = periodRange(p, nightPeriodIndex(p, n)).start;
      const back = () => {
        chosen = at === ownStart(d.date) ? null : at;
        shownFor = null;
        syncWeek();
        upd();
      };
      if (choicesFor(d.date).some((c) => c.start === at)) {
        back();
        weekSel.focus();
        return;
      }
      const dateInput = f.root.querySelector('input[type=date]');
      dateInput.value = n.date;
      d.date = n.date;
      lastDate = d.date;
      f.refresh();
      back();
      dateInput.focus();
    });
    const what = ks.map((k) => periodLabel(p, k)).join(' and ');
    ask.replaceChildren(
      el(
        'p',
        null,
        'This changes a finished pay period’s totals (' + what + '). Move it?',
        ks.some(compared)
          ? ' You already compared this pay period’s paycheck; the comparison won’t change automatically.'
          : null,
      ),
      el('div', { class: 'cluster' }, moveBtn, keepBtn),
    );
    ask.hidden = false;
    moveBtn.focus();
  }
  let lastDate = d.date;
  const fieldOpts = {
    key: 'edit-' + n.id,
    rateOf,
    onInput: () => {
      if (d.date !== lastDate) {
        // a new date: the choices follow it, and a "Move night?" asked for the old date no longer applies
        lastDate = d.date;
        hideAsk();
      }
      syncWeek();
      upd();
    },
  };
  const f = nightFields(p, d, fieldOpts);
  const noteInput = el('input', {
    type: 'text',
    maxlength: '500',
    autocomplete: 'off',
    value: d.note,
    id: 'edit-' + n.id + '-note',
  });
  noteInput.addEventListener('input', () => {
    d.note = noteInput.value;
  });
  const noteField = field('Note', noteInput, { optional: true });
  // Whether tip-outs were on is the night's own (d.tipoutOn, from draftFromNight): Setup's switch doesn't change it.
  // One plain line says so when Setup's switch is different now.
  const ownOn = d.tipoutOn;
  const switchLine =
    ownOn !== tipoutSetup(p).on
      ? el(
          'p',
          { class: 'hint', id: 'edit-' + n.id + '-tipout-on' },
          ownOn
            ? 'Saved with “I tip out” on; Setup has it off now.'
            : 'Saved with “I tip out” off, so no tip-outs are taken out of this night.',
        )
      : null;
  // A locked night keeps the Setup it was saved with; its whole pay period can be updated to today's (below the period).
  const lockNote = n.snap
    ? el(
        'p',
        { class: 'hint', id: 'edit-' + n.id + '-locked' },
        'This night keeps the pay rates and deductions it was saved with, so later Setup changes don’t rewrite it.' +
          (isFinal(p, nightPeriodIndex(p, n), todayISO())
            ? ' To use today’s Setup, update its pay period with “Update this pay period to today’s Setup”.'
            : ''),
      )
    : null;
  const saveBtn = el(
    'button',
    { type: 'submit', class: 'btn btn-small', 'data-focus-key': editKey(n) },
    'Save changes',
  );
  const cancel = el(
    'button',
    {
      type: 'button',
      class: 'btn btn-secondary btn-small',
      'data-focus-key': editKey(n),
      onclick: () => {
        editingId = null;
        redrawGroups([gkey(w.id, nightPeriodIndex(p, n))]);
      },
    },
    'Cancel',
  );
  const form = el(
    'form',
    { class: 'card stack', novalidate: true },
    el('div', { class: 'card-title' }, 'Edit night'),
    f.root,
    switchLine,
    noteField,
    weekField,
    lockNote,
    preview,
    previewLive,
    ask,
    el('div', { class: 'cluster' }, saveBtn, cancel),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const prob = entryCheck(p, d, {
      when: 'that night',
      today: businessDate(new Date(), cutoffFromSettings(S.settings)),
    });
    if (prob) return showEntryProblem(f, prob);
    // Looked up by id now: the night may have been locked or merged from another window since the editor opened.
    const i = S.nights.findIndex((x) => x.id === n.id);
    if (i >= 0 && !confirmed) {
      n = S.nights[i];
      const ks = finishedTouched(build());
      if (ks.length) return showAsk(ks);
    }
    editingId = null;
    if (i < 0) {
      bus.rerender();
      toast('That night was deleted, so nothing was changed.');
      return;
    }
    n = S.nights[i]; // build() reads the current night (its lock, its stored total)
    const was = nightPeriodIndex(p, n);
    // in the order loading writes, so saving a night unchanged writes the same JSON (copies of TipNet merge by it)
    const out = orderNight({ ...build(), workplaceId: w.id });
    S.nights[i] = out;
    save();
    lockFinished({ force: true }); // e.g. a pick into a period that has ended: locked before anything is drawn
    bus.rerender();
    // Says what was saved: the pay period it counts toward when that is not its date's, or when the edit changed it.
    const k = nightPeriodIndex(p, out);
    const start = fmtDate(periodRange(p, k).start);
    toast(
      nightPeriodMoved(p, out)
        ? 'Night updated. It counts in the pay period that started ' + start + '.'
        : k !== was
          ? 'Night updated. It counts by its date, in the pay period that started ' + start + '.'
          : 'Night updated.',
    );
  });
  syncWeek();
  upd(true);
  return form;
}

/** A row's line about its pay period: counted in another one, or a picked one the schedule no longer has. Else null. */
function weekNote(n, p) {
  if (nightPeriodStale(p, n))
    return el('div', { class: 'hint' }, 'pay period no longer matches your schedule, counted by its date');
  if (nightPeriodMoved(p, n))
    return el('div', { class: 'hint' }, 'counted in the pay period starting ' + fmtShort(n.periodStart));
  return null;
}

const ARM_MS = 4000;
function nightRow(S, w, n, shifts) {
  const p = w.profile;
  if (editingId === n.id) return editor(S, n);
  const c = computeNight(n, p, shifts);
  const label = 'Delete night ' + fmtDate(n.date);
  const del = el('button', { type: 'button', class: 'btn btn-danger btn-small', 'aria-label': label });
  arm(del, {
    label: 'Delete',
    armedLabel: 'Delete?',
    ms: ARM_MS,
    onConfirm: () => {
      const i = S.nights.findIndex((x) => x.id === n.id);
      if (i < 0) return;
      const [gone] = S.nights.splice(i, 1);
      save();
      bus.rerender();
      toast('Night deleted.', {
        undo: () => {
          if (S.nights.some((x) => x.id === gone.id)) return; // already back (e.g. from another window)
          S.nights.push(gone);
          save();
          bus.rerender();
        },
      });
    },
  });
  // The accessible name follows the two-tap state, so the armed "Delete?" is announced (arm() only changes the visible text).
  const syncName = () => {
    const armed = del.hasAttribute('data-armed');
    del.setAttribute('aria-label', armed ? 'Confirm delete night of ' + fmtDate(n.date) : label);
    return armed;
  };
  del.addEventListener('click', () => {
    if (!syncName()) return;
    announce('Tap Delete again to delete the night of ' + fmtDate(n.date) + '.');
    setTimeout(syncName, ARM_MS + 50);
  });
  del.addEventListener('blur', syncName);
  return el(
    'li',
    { class: 'list-row wrap' },
    el(
      'div',
      { class: 'main' },
      el('div', null, fmtDate(n.date)),
      el('div', { class: 'hint' }, nightSub(n, c, p)),
      weekNote(n, p),
      n.note
        ? el(
            'div',
            {
              class: 'hint night-note',
              title: n.note,
              style:
                'opacity:.8;font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:32ch',
            },
            n.note,
          )
        : null,
    ),
    el('div', { class: 'amount' }, money(c.net)),
    el(
      'div',
      { class: 'row-actions' },
      el(
        'button',
        {
          type: 'button',
          class: 'btn btn-secondary btn-small',
          'aria-label': 'Edit night ' + fmtDate(n.date),
          'data-focus-key': editKey(n),
          onclick: () => openEditor(S, n.id),
        },
        'Edit',
      ),
      del,
    ),
  );
}

/** True when pay period k of restaurant w was compared with a paycheck in "Check my accuracy" (by its dates). */
function comparedPeriod(w, k) {
  const rg = periodRange(w.profile, k);
  return (w.calib || []).some((c) =>
    c.start && c.end ? c.start === rg.start && c.end === rg.end : c.idx === k,
  );
}
const focusKey = (k) => {
  const n = [...document.querySelectorAll('[data-focus-key]')].find(
    (x) => x.getAttribute('data-focus-key') === k,
  );
  if (n) n.focus();
};
/**
 * "Update this pay period to today's Setup", under a FINISHED pay period (the running one already follows Setup). It
 * asks first, showing what changes (take-home, and the check when every night has its cash), then gives every night in
 * the period a fresh snapshot of today's Setup (math.periodToSetup) and offers Undo, which puts the nights back exactly
 * as they were. If the period was compared in Check my accuracy, the question says that comparison used the old numbers.
 */
function updateControl(S, w, idx, ctx) {
  const p = w.profile;
  const key = gkey(w.id, idx);
  const label = periodLabel(p, idx);
  const fk = 'update-' + w.id + '-' + idx;
  if (updating !== key) {
    const b = el(
      'button',
      {
        type: 'button',
        class: 'btn btn-secondary btn-small',
        'data-focus-key': fk,
        'aria-label': 'Update the pay period ' + label + ' to today’s Setup',
      },
      'Update this pay period to today’s Setup',
    );
    b.addEventListener('click', () => {
      updating = key;
      redrawGroups([key]);
      focusKey(fk + '-yes');
      focusKey(fk + '-close');
    });
    return el('div', null, b);
  }
  const today = ctx.today;
  const shownR = periodToSetup(p, ctx.nights, idx, today);
  const sig = (r) => JSON.stringify([r.before, r.after]);
  const same = JSON.stringify(shownR.after) === JSON.stringify(shownR.before);
  const close = () => {
    updating = null;
    redrawGroups([key]);
    focusKey(fk);
  };
  const lines = [];
  const buttons = [];
  if (same) {
    lines.push(el('p', null, 'This pay period already uses today’s Setup. Nothing to update.'));
    const ok = el(
      'button',
      { type: 'button', class: 'btn btn-secondary btn-small', 'data-focus-key': fk + '-close' },
      'OK',
    );
    ok.addEventListener('click', close);
    buttons.push(ok);
  } else {
    const after = ctx.nights.map((n) => shownR.after.find((x) => x.id === n.id) || n);
    const t0 = periodTotals(p, ctx.nights, idx, today);
    const t1 = periodTotals(p, after, idx, today);
    lines.push(el('p', null, 'Take-home for ' + label + ': ' + money(t0.net) + ' → ' + money(t1.net)));
    if (t0.allCash && t1.allCash)
      lines.push(el('p', null, 'On your check: ' + money(t0.chk) + ' → ' + money(t1.chk)));
    lines.push(
      el(
        'p',
        { class: 'hint' },
        'Every night in this pay period will use today’s pay rates, deductions and tip-outs. Their tips stay the same.',
      ),
    );
    if (comparedPeriod(w, idx))
      lines.push(
        el('p', { class: 'note' }, 'You compared this pay period with your paycheck using the old numbers.'),
      );
    const yes = el(
      'button',
      { type: 'button', class: 'btn btn-small', 'data-focus-key': fk + '-yes' },
      'Update pay period',
    );
    const no = el(
      'button',
      { type: 'button', class: 'btn btn-secondary btn-small', 'data-focus-key': fk + '-no' },
      'Cancel',
    );
    no.addEventListener('click', close);
    yes.addEventListener('click', () => {
      // worked out again now: if anything changed since the question was shown (another window, a midnight lock), the
      // question is shown again with the new numbers instead of storing something else than what was shown
      const r = periodToSetup(p, nightsOf(S, w.id), idx, todayISO());
      if (sig(r) !== sig(shownR)) {
        redrawGroups([key]);
        focusKey(fk + '-yes');
        return;
      }
      const was = r.before.map((n) => JSON.parse(JSON.stringify(n)));
      r.after.forEach((n) => {
        const i = S.nights.findIndex((x) => x.id === n.id);
        if (i >= 0) S.nights[i] = orderNight(n);
      });
      updating = null;
      if (r.before.some((n) => n.id === editingId)) editingId = null;
      save();
      bus.rerender();
      focusKey('period-' + w.id + '-' + idx);
      toast('The pay period ' + label + ' now uses today’s Setup.', {
        undo: () => {
          // the nights exactly as they were (a night deleted since stays deleted)
          was.forEach((n) => {
            const i = S.nights.findIndex((x) => x.id === n.id);
            if (i >= 0) S.nights[i] = n;
          });
          save();
          bus.rerender();
        },
      });
    });
    buttons.push(yes, no);
  }
  return el(
    'div',
    { class: 'note stack-sm', role: 'group', 'aria-label': 'Update this pay period to today’s Setup?' },
    lines,
    el('div', { class: 'cluster' }, buttons),
  );
}

/**
 * One restaurant's pay period. The shift count for period idx: Setup's count is the same for every period,
 * so they are worked out once per restaurant (ctx.base). ctx.named: start the label with the restaurant's name (the All list).
 * A finished pay period can be updated to today's Setup (updateControl).
 */
/**
 * One pay period's numbers, worked out the one way every part of this page uses (the period sections and the cards at
 * the bottom), so they agree to the cent. {t: periodTotals, shifts: the shift count it was spread over}.
 */
function totalsFor(w, idx, ctx) {
  const { shifts } = shiftsOf(w, idx, ctx);
  return { t: periodTotals(w.profile, ctx.nights, idx, ctx.today, shifts, ctx.index), shifts };
}
/** The shift count one pay period's nights are spread over (the same one its section uses). {shifts} */
function shiftsOf(w, idx, ctx) {
  const p = w.profile;
  return {
    shifts:
      ctx.base.source === 'default'
        ? shiftsPerPeriod(p, ctx.nights, ctx.today, idx, ctx.index).n
        : ctx.base.n,
  };
}
/** The shared look-ups for one establishment's periods (one pass over its nights). */
function makeCtx(S, w, today, named) {
  const nights = nightsOf(S, w.id);
  const index = indexNights(w.profile, nights);
  const base = shiftsPerPeriod(w.profile, nights, today, undefined, index);
  return { today, index, base, nights, named };
}

function group(S, w, idx, ctx) {
  const p = w.profile;
  const { t, shifts } = totalsFor(w, idx, ctx);
  const rows = t.ns.map((n) => nightRow(S, w, n, shifts));
  const editingRow = rows.length && t.ns.some((n) => n.id === editingId);
  // A finished check takes its fixed deductions (and non-taxable pay) exactly once, while each night carries an
  // estimated share: this line shows the difference, so the nights plus this line are the period's take-home to the cent.
  const adjRow =
    t.exact && t.adjust !== 0
      ? el(
          'li',
          { class: 'list-row period-adjust' },
          el(
            'div',
            { class: 'main' },
            el('div', null, 'Exact amounts on this check'),
            el(
              'div',
              { class: 'hint' },
              'Each night above used an estimated share of this check’s ' +
                // what this line really corrects: the fixed deductions, the recurring non-taxable pay, or both
                (t.adjustFixed !== 0 && t.adjustNontax !== 0
                  ? 'fixed deductions and non-taxable pay'
                  : t.adjustNontax !== 0
                    ? 'non-taxable pay'
                    : 'fixed deductions') +
                '. This line makes the nights add up to the real check.',
            ),
          ),
          el('div', { class: 'amount' }, t.adjust < 0 ? minus(t.adjust) : '+' + money(t.adjust)),
        )
      : null;
  const sec = el(
    'section',
    { class: 'stack-sm', 'data-period': idx, 'data-workplace': w.id },
    el(
      'div',
      { class: 'spread' },
      el(
        'span',
        { class: 'label', tabindex: '-1', 'data-focus-key': 'period-' + w.id + '-' + idx },
        (ctx.named ? w.name + ' · ' : '') + periodLabel(p, idx) + (t.exact ? ' · final' : ''),
      ),
      el('b', { class: 'num' }, money(t.net) + ' take-home'),
    ),
    t.setAside > 0
      ? el('p', { class: 'hint' }, 'Taxes to set aside on cash (estimate): ' + money(t.setAside))
      : null,
    editingRow
      ? el(
          'div',
          { class: 'stack-sm' },
          rows.map((r) => (r.tagName === 'LI' ? el('ul', { class: 'list' }, r) : r)),
          adjRow ? el('ul', { class: 'list' }, adjRow) : null,
        )
      : el('ul', { class: 'list' }, rows, adjRow),
    t.exact ? updateControl(S, w, idx, ctx) : null,
  );
  if (view && view.ctxs.get(w.id) === ctx) view.sections.set(gkey(w.id, idx), sec);
  return sec;
}

/** Newest FINISHED pay period (idxs is newest first), or the newest one if none has finished. */
export function defaultCalibPeriod(idxs, finished) {
  const done = idxs.find((i) => finished(i));
  return done !== undefined ? done : idxs.length ? idxs[0] : null;
}
const NOT_FINAL_TEXT =
  'This pay period is still in progress, so there is no paycheck to compare yet. Come back once it ends and the check lands.';
const MATCHED_TEXT = 'Your estimate matched — no change needed.';
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const points = (x) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x * 100).toFixed(2) + ' points';
function focusId(id) {
  const n = document.getElementById(id);
  if (n && !n.disabled) {
    try {
      n.focus({ preventScroll: true });
    } catch (e) {
      /* ignore */
    }
  }
}

/** The "old rate -> new rate" box shown before anything changes. */
function pendingBox(S, w, r, idx, prev) {
  const p = w.profile;
  const warnMissing = r.missingNights > 0;
  const warn = warnMissing || r.suspect;
  // Replacing: the change is shown from the rate in use now (the earlier adjustment's), not the rate before it.
  const from = prev ? currentRate(p) : r.rOld;
  const lines = [];
  if (prev)
    lines.push(
      el(
        'p',
        { class: 'note' },
        'You already compared this pay period: predicted ' +
          money(prev.pred) +
          ', actual ' +
          money(prev.actual) +
          (typeof prev.rateBefore === 'number' && typeof prev.rateAfter === 'number'
            ? ', tax rate ' + pct(prev.rateBefore, 2) + ' → ' + pct(prev.rateAfter, 2)
            : '') +
          '. A pay period adjusts the rate once. Replacing starts again from the rate before that earlier adjustment, so nothing stacks.',
      ),
    );
  lines.push(
    el(
      'p',
      null,
      'Predicted ' +
        money(r.pred) +
        ', actual ' +
        money(r.actual) +
        ': off by ' +
        Math.abs(r.err * 100).toFixed(1) +
        '%.',
    ),
    el(
      'p',
      null,
      'Tax rate: ' +
        pct(from, 2) +
        ' → ' +
        pct(r.rateOverride, 2) +
        ' (' +
        points(r.rateOverride - from) +
        ').',
    ),
  );
  if (r.capped)
    lines.push(
      el(
        'p',
        { class: 'hint' },
        'One paycheck can move the rate by 3 points at most, so this adjustment is capped (it would have gone to ' +
          pct(r.uncapped, 2) +
          ').',
      ),
    );
  if (warnMissing)
    lines.push(
      el(
        'p',
        { class: 'field-error' },
        'You logged ' +
          plural(r.nightsLogged, 'night') +
          ' but usually work ' +
          r.expectedShifts +
          '. If you missed some, add them first, or the adjustment will be off.',
      ),
    );
  if (r.suspect)
    lines.push(
      el(
        'p',
        { class: 'field-error' },
        'That is off by more than 25%, which usually means a night is missing or the check amount was typed wrong. Check both before applying.',
      ),
    );
  const apply = el(
    'button',
    { type: 'button', class: 'btn btn-small', id: 'cal-apply', disabled: warn },
    prev ? 'Replace my earlier comparison for this pay period' : 'Apply this adjustment',
  );
  const keep = el(
    'button',
    { type: 'button', class: 'btn btn-secondary btn-small', id: 'cal-keep' },
    'Don’t change',
  );
  let confirm = null;
  if (warn) {
    // Not applying is the default: Apply stays off until this is ticked.
    const cb = el('input', { type: 'checkbox', id: 'cal-confirm' });
    cb.addEventListener('change', () => {
      apply.disabled = !cb.checked;
    });
    confirm = el(
      'label',
      { class: 'check', for: cb.id },
      cb,
      el('span', null, 'I checked my nights and the check amount. Apply it anyway.'),
    );
  }
  apply.addEventListener('click', () => {
    p.rateOverride = r.rateOverride;
    const rg = periodRange(p, idx);
    const entry = {
      label: periodLabel(p, idx),
      pred: r.pred,
      actual: r.actual,
      err: r.err,
      idx,
      start: rg.start,
      end: rg.end,
      rateBefore: r.rOld,
      rateAfter: r.rateOverride,
    };
    const at = prev ? w.calib.indexOf(prev) : -1;
    if (at >= 0) w.calib[at] = entry;
    else w.calib.push(entry);
    save();
    calPending = null;
    calMsg = {
      text:
        'Tax rate adjusted from ' +
        pct(from, 2) +
        ' to ' +
        pct(r.rateOverride, 2) +
        '. Nights in finished pay periods keep the numbers they were saved with.',
    };
    bus.rerender();
    focusId('cal-run');
  });
  keep.addEventListener('click', () => {
    calPending = null;
    calMsg = { text: 'No change made. Your tax rate stays at ' + pct(from, 2) + '.' }; // the rate in use now
    bus.rerender();
    focusId('cal-run');
  });
  return el(
    'div',
    {
      class: 'note stack-sm',
      id: 'cal-pending',
      role: 'group',
      'aria-label': 'Proposed tax rate adjustment',
    },
    lines,
    confirm,
    el('div', { class: 'cluster' }, apply, keep),
  );
}

/**
 * "Check my accuracy" for one restaurant: its own pay periods, nights, tax rate and history. With more than one
 * restaurant, the restaurant is picked first (a paycheck comes from one employer).
 */
function calibCard(S, today) {
  const w = workplaceOf(S, calWid);
  calWid = w.id;
  const p = w.profile;
  const mine = nightsOf(S, w.id);
  const idxs = [...indexNights(p, mine).keys()].sort((a, b) => b - a);
  const finished = (i) => isFinal(p, i, today);
  if (calPeriod == null || !idxs.includes(calPeriod)) calPeriod = defaultCalibPeriod(idxs, finished);
  let wsel = null;
  if (S.workplaces.length > 1) {
    wsel = select(
      S.workplaces.map((x) => [x.id, x.name]),
      w.id,
      { id: 'cal-workplace' },
    );
    wsel.addEventListener('change', () => {
      calWid = wsel.value;
      calPeriod = null;
      calPending = null;
      calMsg = null;
      calActual = '';
      bus.rerender();
    });
  }
  const sel = select(
    idxs.length
      ? idxs.map((i) => [i, periodLabel(p, i) + (finished(i) ? '' : ' (in progress)')])
      : [['', 'No pay periods yet']],
    calPeriod == null ? '' : calPeriod,
    { id: 'cal-period' },
  );
  const actual = moneyInput({ placeholder: '0.00', id: 'cal-actual', value: calActual });
  const actualField = field('Actual paycheck amount (take-home on the stub)', actual);
  flagTypo(actual, actualField); // a typo kept from before this redraw shows at once
  const msg = el('p', { class: 'note', 'aria-live': 'polite', hidden: !calMsg }, calMsg ? calMsg.text : '');
  const run = el(
    'button',
    { type: 'button', class: 'btn btn-small', id: 'cal-run' },
    'Compare with my estimate',
  );
  const inProgress = () => idxs.length > 0 && !finished(Number(sel.value));
  const syncRun = () => {
    run.disabled = inProgress();
  };
  let pendingNode = null;
  const dropPending = () => {
    if (calPending) {
      calPending = null;
      if (pendingNode) {
        pendingNode.remove();
        pendingNode = null;
      }
    }
  };
  sel.addEventListener('change', () => {
    calPeriod = Number(sel.value);
    dropPending();
    syncRun();
    if (inProgress()) {
      calMsg = { text: NOT_FINAL_TEXT };
      msg.hidden = false;
      msg.textContent = NOT_FINAL_TEXT;
    } else if (calMsg && calMsg.text === NOT_FINAL_TEXT) {
      calMsg = null;
      msg.hidden = true;
      msg.textContent = '';
    }
  });
  actual.addEventListener('input', () => {
    calActual = actual.value;
    flagTypo(actual, actualField, moneyTypo, { now: false }); // after a pause in typing, or when the box is left
    dropPending();
  });
  if (inProgress() && !calMsg)
    calMsg = {
      text: idxs.some(finished) ? NOT_FINAL_TEXT : 'No pay period has finished yet. ' + NOT_FINAL_TEXT,
    };
  msg.hidden = !calMsg;
  msg.textContent = calMsg ? calMsg.text : '';
  syncRun();
  const undo = el('button', { type: 'button', class: 'btn btn-secondary btn-small', id: 'cal-undo' });
  const show = (text) => {
    calPending = null;
    calMsg = { text };
    bus.rerender();
  };
  run.addEventListener('click', () => {
    const idx = Number(sel.value);
    calActual = actual.value;
    // a typo like 1.2.3 is never read as 1.2: nothing is compared until it is fixed
    if (moneyTypo(calActual)) {
      actualField.setError(moneyTypo(calActual));
      actual.focus();
      return;
    }
    // One adjustment per pay period: an earlier comparison of this period is replaced, measured from the rate before it.
    // Matched by the period's dates, so moving the start date in Setup (which renumbers periods) can't adjust the same
    // dates twice. Only old entries saved without dates fall back to the period number.
    const rg = periodRange(p, idx);
    const prev =
      w.calib.find((c) => (c.start && c.end ? c.start === rg.start && c.end === rg.end : c.idx === idx)) ||
      null;
    // Only the most recent comparison can be replaced: redoing an older one would throw away the later ones.
    if (prev && w.calib.indexOf(prev) !== w.calib.length - 1)
      return show(
        'You already compared this pay period (predicted ' +
          money(prev.pred) +
          ', actual ' +
          money(prev.actual) +
          ') and have compared a later one since, so it can’t be redone. To start over, use “Undo adjustments”.',
      );
    const base = prev && typeof prev.rateBefore === 'number' ? prev.rateBefore : undefined;
    const r = idxs.length
      ? calibrate(p, mine, idx, moneyNum(actual.value), today, undefined, base)
      : { ok: false, reason: 'nonights' };
    if (!r.ok) {
      if (r.reason === 'notFinal') return show(NOT_FINAL_TEXT);
      if (r.reason === 'missingCash') {
        const m = r.missingCash;
        return show(
          m +
            ' night' +
            (m > 1 ? 's' : '') +
            ' in this period ' +
            (m > 1 ? 'have' : 'has') +
            ' no cash amount, so the check can’t be predicted. Add cash to every night first.',
        );
      }
      return show('Pick a pay period with nights in it and enter the check amount.');
    }
    // Within 0.5% of the check and implying the current rate: nothing to adjust, nothing to ask, nothing recorded.
    // With an earlier comparison of this period, Replace is still offered (from its rate before), so a mistyped
    // check that was applied is undone by comparing the right amount.
    if (r.matched && !prev) return show(MATCHED_TEXT);
    // Nothing changes yet: show old -> new and ask.
    calMsg = null;
    calPending = { idx, r, prev, wid: w.id };
    bus.rerender();
    focusId(r.missingNights > 0 || r.suspect ? 'cal-keep' : 'cal-apply');
  });
  arm(undo, {
    label: 'Undo adjustments',
    armedLabel: 'Undo all adjustments?',
    onConfirm: () => {
      const was = { rate: p.rateOverride, calib: w.calib };
      p.rateOverride = null;
      w.calib = [];
      calPending = null;
      save();
      calMsg = { text: 'Back to the rates from your paystub.' };
      bus.rerender();
      focusId('cal-run'); // Undo adjustments is off now (nothing left to undo), so focus moves to Compare with my estimate
      toast('Adjustments undone.', {
        undo: () => {
          p.rateOverride = was.rate;
          w.calib = was.calib;
          calMsg = null;
          save();
          bus.rerender();
        },
      });
    },
  });
  // Nothing adjusted yet (no rate change, no history): nothing to undo, and the button says why it is off.
  const nothingToUndo = p.rateOverride == null && !(w.calib || []).length;
  const undoWhy = nothingToUndo
    ? el(
        'p',
        { class: 'hint', id: 'cal-undo-why' },
        'Nothing to undo yet. TipNet hasn’t adjusted your rates.',
      )
    : null;
  if (nothingToUndo) {
    undo.disabled = true;
    undo.setAttribute('aria-describedby', 'cal-undo-why');
  }
  if (calPending && calPending.idx === calPeriod && calPending.wid === w.id)
    pendingNode = pendingBox(S, w, calPending.r, calPending.idx, calPending.prev);
  else calPending = null;
  const hist = w.calib
    .slice(-4)
    .reverse()
    .map((c) =>
      el(
        'li',
        { class: 'spread' },
        el(
          'span',
          { class: 'hint' },
          c.label + ': predicted ' + money(c.pred) + ', actual ' + money(c.actual),
        ),
        el(
          'span',
          { class: Math.abs(c.err) <= 0.05 ? 'pill pill-good' : 'pill pill-bad' },
          (c.err > 0 ? '+' : '') + (c.err * 100).toFixed(1) + '%',
        ),
      ),
    );
  return el(
    'section',
    { class: 'card stack' },
    el('h2', null, 'Check my accuracy'),
    el(
      'p',
      { class: 'note' },
      'When a paycheck lands, enter its amount. TipNet compares it with what it predicted for that pay period and suggests a tax rate adjustment so the next estimate is closer. Nothing changes until you apply it. Every night in the period needs a cash amount, and every shift you worked should be logged.',
    ),
    wsel ? field('Establishment', wsel) : null,
    field('Pay period', sel),
    actualField,
    el('div', { class: 'cluster' }, run, undo),
    undoWhy,
    pendingNode,
    msg,
    hist.length ? el('ul', { class: 'stack-sm', style: 'list-style:none;margin:0;padding:0' }, hist) : null,
  );
}

/** "Show older pay periods": adds the next PAGE periods in place (nothing else is rebuilt) and keeps focus. */
function olderButton(S, items, host) {
  const left = () => items.length - shown;
  const btn = el('button', { type: 'button', class: 'btn btn-secondary', id: 'periods-older' });
  const label = () => {
    btn.textContent = 'Show older pay periods (' + left() + ' more)';
  };
  label();
  btn.addEventListener('click', () => {
    const from = shown;
    shown = Math.min(items.length, shown + PAGE);
    const added = items.slice(from, shown).map((g) => group(S, g.w, g.idx, view.ctxs.get(g.w.id)));
    added.forEach((sec) => host.insertBefore(sec, btn));
    if (left() > 0) {
      label();
      return;
    } // focus stays on the button
    btn.remove();
    // The button is gone: land on the first period just shown.
    const first = added[0] && added[0].querySelector('.label');
    if (first) {
      try {
        first.focus({ preventScroll: true });
      } catch (e) {
        /* ignore */
      }
    }
  });
  return btn;
}

export function render(root) {
  const S = getState(),
    today = todayISO();
  if (!isSetUp(S)) {
    // Example nights are not listed as if they were real: nothing here until setup is done.
    root.append(
      el(
        'div',
        { class: 'stack' },
        el('h1', null, 'Pay periods'),
        setupFirstCard({
          text: 'Your nights and paychecks show up here once TipNet knows your paystub. It takes about 3 minutes.',
        }),
      ),
    );
    return;
  }
  const many = S.workplaces.length > 1;
  // The filter: All (every restaurant, each period labelled with its name) or one restaurant. Remembered.
  const pick = many ? S.settings.periodsFilter || 'all' : S.workplaces[0].id;
  const shownW = pick === 'all' ? S.workplaces : [findWorkplace(S, pick) || S.workplaces[0]];
  if (calWid == null || !findWorkplace(S, calWid))
    calWid = pick !== 'all' ? shownW[0].id : activeWorkplace(S).id;
  // One pass over each restaurant's nights, shared by every period below (a long history stays fast).
  const ctxs = new Map();
  const items = [];
  shownW.forEach((w) => {
    const ctx = makeCtx(S, w, today, many && pick === 'all');
    ctxs.set(w.id, ctx);
    ctx.index.forEach((list, idx) => items.push({ w, idx, end: periodRange(w.profile, idx).end }));
  });
  // Newest first; the same end date keeps the restaurants in their Setup order.
  const order = new Map(S.workplaces.map((w, i) => [w.id, i]));
  items.sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : order.get(a.w.id) - order.get(b.w.id)));
  view = { S, ctxs, sections: new Map() };
  // The period with the open editor always stays visible.
  if (editingId != null) {
    const k = keyOfNight(S, editingId);
    const at = items.findIndex((g) => gkey(g.w.id, g.idx) === k);
    if (at >= shown) shown = Math.ceil((at + 1) / PAGE) * PAGE;
  }
  let list;
  if (items.length) {
    list = el('div', { class: 'stack' });
    items.slice(0, shown).forEach((g) => list.append(group(S, g.w, g.idx, ctxs.get(g.w.id))));
    if (items.length > shown) list.append(olderButton(S, items, list));
  } else
    list = el(
      'div',
      { class: 'card' },
      el(
        'p',
        { class: 'hint' },
        pick === 'all' || !many
          ? 'No nights yet. Log your first shift on the Tonight tab.'
          : 'No nights at ' + shownW[0].name + ' yet. Log one on the Tonight tab.',
      ),
    );
  const filter = workplaceSwitcher(
    S,
    pick,
    (id) => {
      S.settings.periodsFilter = id;
      shown = PAGE;
      editingId = null;
      if (id !== 'all') {
        calWid = id;
        calPeriod = null;
        calPending = null;
        calMsg = null;
      }
      save();
      bus.rerender();
    },
    { key: 'periods-filter', label: 'Show pay periods for', all: 'All' },
  );
  root.append(
    el(
      'div',
      { class: 'stack' },
      el('h1', null, 'Pay periods'),
      filter,
      exampleBanner(),
      list,
      calibCard(S, today),
      ...bottomCards(S, today, shownW, ctxs, many && pick === 'all'),
    ),
  );
}

/* ---------- the pay period in progress: "So far this pay period" and the Budget goal ---------- */
/** Each set-up establishment's pay period in progress, from the same numbers as its section above. */
function soFarOf(S, list, ctxs, today, named) {
  return list
    .filter((w) => isWorkplaceSetUp(S, w))
    .map((w) => {
      const ctx = ctxs.get(w.id) || makeCtx(S, w, today, named);
      const idx = periodIndex(w.profile, today);
      const { t, shifts } = totalsFor(w, idx, ctx);
      return { w, idx, t, shifts, nights: t.ns.length, all: ctx.nights, ctx };
    });
}
function bottomCards(S, today, shownW, ctxs, named) {
  const shown = soFarOf(S, shownW, ctxs, today, named);
  if (!shown.length) return [];
  const cards = [soFarCard(shown, named)];
  // The goal compares the establishments shown (the filter) with the whole budget's needs; every establishment is listed so
  // each savings goal is converted with its own restaurant's pay schedule.
  const goal = goalCard(S, today, shown, soFarOf(S, S.workplaces, ctxs, today, named));
  if (goal) cards.push(goal);
  return cards;
}
function soRow(label, value, id) {
  return el('div', { class: 'spread' }, el('dt', null, label), el('dd', { class: 'num', id }, value));
}
function soFarCard(lines, named) {
  const block = (l) =>
    el(
      'div',
      { class: 'stack-sm', 'data-workplace': l.w.id },
      named ? el('div', { class: 'label' }, l.w.name + ' · ' + periodLabel(l.w.profile, l.idx)) : null,
      l.nights
        ? el(
            'dl',
            { class: 'stack-sm' },
            soRow('Estimated take-home so far', money(l.t.net), 'so-far-net-' + l.w.id),
            soRow('Cash you keep so far', money(l.t.cash), 'so-far-cash-' + l.w.id),
            soRow('On your check so far', money(l.t.chk), 'so-far-check-' + l.w.id),
            soRow('Nights logged', String(l.nights), 'so-far-nights-' + l.w.id),
          )
        : el('p', { class: 'hint' }, 'No nights logged yet in this pay period.'),
    );
  const none = lines.every((l) => !l.nights);
  return el(
    'section',
    { class: 'card stack', id: 'so-far', 'aria-labelledby': 'so-far-h' },
    el('h2', { id: 'so-far-h' }, 'So far this pay period'),
    none && !named
      ? el(
          'p',
          { class: 'hint' },
          'No nights logged yet in this pay period. Your totals show up here once you log one.',
        )
      : lines.map(block),
    el(
      'p',
      { class: 'hint' },
      'Estimated, from the nights you logged. The same numbers as the pay period above.',
    ),
  );
}

/** The extra goal typed but not saved yet (its 400 ms pause has not passed): the debounced save, or null. */
let goalPending = null;
/** The page is being hidden or closed (app.js, pagehide / visibilitychange): save a typed extra goal now. */
export function flushEdits() {
  if (goalPending) goalPending.flush();
}

/** The Budget goal card: locked for free users, the real one for TipNet Budget; null when it cannot be worked out. */
function goalCard(S, today, shown, all) {
  const heading = 'Budget goal for this pay period';
  if (!isUnlocked(S.settings.entitlement)) {
    return el(
      'section',
      { class: 'card stack upsell', id: 'goal-card', 'aria-labelledby': 'goal-card-h' },
      el('h2', { id: 'goal-card-h' }, heading),
      el(
        'p',
        null,
        'TipNet Budget shows what your bills and savings need each month, and how close this pay period gets you.',
      ),
      el(
        'p',
        null,
        el('strong', null, BILLING.prices.monthly + ' a month or ' + BILLING.prices.yearly + ' a year'),
      ),
      BILLING.provider
        ? null
        : el(
            'p',
            { class: 'hint' },
            el('strong', null, 'Coming soon. '),
            'You’ll be able to unlock it here soon.',
          ),
      // On Pay periods this card takes the place of the "TipNet Budget" card (app.js), so it has the same two buttons.
      el(
        'div',
        { class: 'stack-sm' },
        el(
          'button',
          {
            type: 'button',
            class: 'btn btn-secondary btn-block',
            id: 'goal-card-see',
            onclick: () => openPreview(null),
          },
          'See what’s inside',
        ),
        upgradeBtn('goal-card-upgrade'),
      ),
    );
  }
  if (!shown.length) return null;
  const sources = all.map((l) => ({ id: l.w.id, name: l.w.name, profile: l.w.profile, nights: l.all }));
  let needs;
  try {
    needs = monthlyNeeds(S.budget, sources, today);
  } catch (e) {
    return null;
  }
  const needsMonthC = toCents(needs.amount);
  if (!Number.isFinite(needsMonthC)) return null;
  // One pay period when the establishments shown share it (one establishment, the filter on one, or the same schedule);
  // otherwise the calendar month, so pay periods of different lengths are never mixed.
  const p0 = shown[0].w.profile;
  const r0 = periodRange(p0, shown[0].idx);
  const ppy0 = periodsPerYear(p0, today);
  const sameWindow = shown.every((l) => {
    const r = periodRange(l.w.profile, l.idx);
    return r.start === r0.start && r.end === r0.end && periodsPerYear(l.w.profile, today) === ppy0;
  });
  const month = !sameWindow;
  const monthStart = today.slice(0, 8) + '01';
  const monthEnd = addDays(addDays(monthStart, 32).slice(0, 8) + '01', -1);
  // Made so far: this pay period's take-home (the cards above), or the nights dated this month as each night row shows them.
  let madeC = 0,
    remaining = 0;
  if (!month) {
    madeC = shown.reduce((s, l) => s + toCents(l.t.net), 0);
    // Shifts still to work: Setup's count minus nights logged, never more than the days left in that pay period.
    remaining = shown.reduce((s, l) => {
      const daysLeft = Math.max(0, dayDiff(today, periodRange(l.w.profile, l.idx).end) + 1);
      return s + Math.min(daysLeft, Math.max(0, l.shifts - l.nights));
    }, 0);
  } else {
    const daysLeft = dayDiff(today, monthEnd) + 1;
    shown.forEach((l) => {
      const p = l.w.profile;
      let count = 0;
      l.ctx.index.forEach((list, idx) => {
        const inMonth = list.filter((n) => n.date >= monthStart && n.date <= monthEnd);
        if (!inMonth.length) return;
        const { shifts } = shiftsOf(l.w, idx, l.ctx);
        inMonth.forEach((n) => (madeC += toCents(computeNight(n, p, shifts).net)));
        count += inMonth.length;
      });
      // Setup's shifts a pay period x pay periods a year / 12, less the nights logged this month, at most the days left
      const perMonth = Math.round((l.ctx.base.n * periodsPerYear(p, today)) / 12);
      remaining += Math.min(daysLeft, Math.max(0, perMonth - count));
    });
  }
  const periodWord = (ppy) =>
    ppy === 52
      ? 'one-week'
      : ppy === 26
        ? 'two-week'
        : ppy === 24
          ? 'half-month'
          : ppy === 12
            ? 'monthly'
            : periodLength(p0, shown[0].idx) + '-day';
  const host = el('div', { class: 'stack-sm', 'aria-live': 'polite' });
  const eg0 = S.budget.extraGoal;
  const box = el('input', {
    type: 'text',
    inputmode: 'decimal',
    autocomplete: 'off',
    spellcheck: 'false',
    id: 'goal-extra',
    placeholder: 'e.g. 200',
    value: eg0 ? String(eg0.amount) : '',
  });
  const unit = select(
    [
      ['month', 'a month'],
      ['week', 'a week'],
    ],
    eg0 && eg0.per === 'week' ? 'week' : 'month',
    { id: 'goal-extra-per', 'aria-label': 'Extra goal: per month or per week' },
  );
  const f = field('Extra goal', box, {
    optional: true,
    hint: 'Added on top of what your budget needs, on this card only. It doesn’t change any Budget number.',
  });
  // the amount box and its "a month / a week" choice side by side, in the field's place for the box
  const row = el('div', { class: 'amount-per' });
  box.replaceWith(row);
  row.append(box, unit);
  const remove = el(
    'button',
    { type: 'button', class: 'btn-link', id: 'goal-extra-remove' },
    'Remove extra goal',
  );
  const draw = () => {
    const eg = S.budget.extraGoal || null;
    const needC = month ? needsMonthC : perPeriodC(needsMonthC, p0, today);
    const extraC = month ? extraGoalC(eg) : extraGoalC(eg, p0, today);
    const goalC = needC + extraC;
    const kids = [];
    kids.push(
      el(
        'p',
        { id: 'goal-line' },
        el(
          'strong',
          null,
          month
            ? 'This month: budget needs ' + money(fromCents(needsMonthC)) + '.'
            : 'Your budget needs ' +
                money(fromCents(needsMonthC)) +
                ' a month = ' +
                money(fromCents(needC)) +
                ' per ' +
                periodWord(ppy0) +
                ' pay period.',
        ),
      ),
    );
    kids.push(
      el(
        'p',
        { class: 'hint', id: 'goal-breakdown' },
        'bills ' + money(needs.bills) + ' a month + savings goals ' + money(needs.goals) + ' a month',
      ),
    );
    if (extraC > 0)
      kids.push(
        el(
          'p',
          { id: 'goal-extra-line' },
          '+ extra ' +
            money(fromCents(toCents(eg.amount))) +
            (eg.per === 'week' ? ' a week' : ' a month') +
            ' = ' +
            money(fromCents(extraC)) +
            (month ? ' this month' : ' this pay period'),
        ),
      );
    if (goalC > 0) {
      kids.push(
        el(
          'p',
          { id: 'goal-made' },
          'Made so far ' +
            money(fromCents(madeC)) +
            (month ? ' (nights dated this month, all establishments)' : ' (estimated take-home)'),
        ),
      );
      const diff = goalC - madeC;
      kids.push(
        el(
          'p',
          { id: 'goal-result' },
          el(
            'strong',
            null,
            diff > 0 ? 'Short by ' + money(fromCents(diff)) : money(fromCents(-diff)) + ' extra',
          ),
        ),
      );
      if (diff > 0 && remaining > 0)
        kids.push(
          el(
            'p',
            { class: 'hint', id: 'goal-pace' },
            'About ' +
              money(fromCents(Math.round(diff / remaining))) +
              ' a night over your next ' +
              (remaining === 1 ? 'shift' : remaining + ' shifts') +
              (month ? ' this month' : '') +
              ' (estimate).',
          ),
        );
    } else
      kids.push(
        el(
          'p',
          { class: 'hint', id: 'goal-none' },
          'Your budget has no bills or savings goals yet. You can add an extra goal below.',
        ),
      );
    host.replaceChildren(...kids);
    remove.hidden = !eg;
  };
  const commit = () => {
    if (goalPending === later) goalPending = null;
    if (moneyTypo(box.value)) return; // a typo is never saved; the last goal stays
    const n = readMoney(box.value);
    if (n !== null && n < 0) return f.setError('A goal can’t be negative.');
    if (n === null || n === 0) delete S.budget.extraGoal;
    else
      S.budget.extraGoal = { amount: fromCents(toCents(n)), per: unit.value === 'week' ? 'week' : 'month' };
    save();
    draw();
  };
  const later = debounce(commit, 400);
  remove.addEventListener('click', () => {
    box.value = '';
    f.setError('');
    later.cancel();
    commit();
    box.focus();
  });
  box.addEventListener('input', () => {
    f.setError('');
    flagTypo(box, f, moneyTypo, { now: false });
    goalPending = later; // saved at once if the page is hidden or closed first (flushEdits)
    later();
  });
  box.addEventListener('change', () => {
    flagTypo(box, f, moneyTypo); // at once when the box is left
    later.flush();
  });
  // Switching the unit keeps the amount typed and only changes what it is per.
  unit.addEventListener('change', () => {
    later.cancel();
    commit();
  });
  draw();
  return el(
    'section',
    { class: 'card stack', id: 'goal-card', 'aria-labelledby': 'goal-card-h' },
    el('h2', { id: 'goal-card-h' }, month ? 'Budget goal for this month' : 'Budget goal for this pay period'),
    host,
    f,
    remove,
    el(
      'p',
      { class: 'hint' },
      'Estimated. What your budget needs is your bills plus the savings planned for your goals, each turned into a monthly amount, then spread evenly over the year.',
    ),
  );
}
