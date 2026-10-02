// Pay periods screen: nights grouped by pay period, edit/delete, and "Check my accuracy".
import {
  computeNight,
  periodTotals,
  nightPeriodIndex,
  shiftsPerPeriod,
  calibrate,
  todayISO,
  isFinal,
  indexNights,
  snapshotFor,
  periodRange,
  totalFromTips,
  hasTips,
  round2,
  num,
} from '../math.js';
import { businessDate, cutoffFromSettings } from '../inputs.js';
import { isSetUp, workplaceOf, findWorkplace, nightsOf, activeWorkplace } from '../storage.js';
import {
  el,
  field,
  moneyInput,
  select,
  numOf,
  money,
  money0,
  pct,
  fmtDate,
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
} from './common.js';
import {
  nightFields,
  draftFromNight,
  storedNight,
  tipsMode,
  entryCheck,
  showEntryProblem,
  jobsText,
} from './tonight.js';

/** Pay periods shown at first; "Show older" adds this many more each time. */
export const PAGE = 6;

let editingId = null;
let calMsg = null; // {text}
let calPeriod = null;
let calActual = '';
let calPending = null; // {idx, r, wid}: a comparison waiting for "Apply this adjustment" / "Don't change"
let calWid = null; // the restaurant "Check my accuracy" is about (picked first when there is more than one)
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
  shown = PAGE;
  view = null;
}
const gkey = (wid, idx) => wid + ':' + idx;

function nightSub(n, c, p) {
  const bits = [];
  const worked = jobsText(n, p);
  if (worked) bits.push(worked);
  bits.push('made ' + money(c.total));
  if (tipsMode(p)) bits.push('tips ' + money(c.tips));
  if (c.tipout) bits.push(money(c.tipout) + ' tip-out');
  else if ((n.snap ? n.snap.tipout.on : p.tipout.on) && !n.barback) bits.push('no barback');
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
const editKey = (n) => 'edit-' + n.id + '-total';

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
  const d = draftFromNight(n, p); // in tips mode d.total is the tips inside the stored total (the night's own rates if locked)
  d.note = n.note || ''; // the editor's own field; draftFromNight knows nothing about notes
  const typedAtOpen = JSON.stringify([d.total, d.pay]);
  let recalc = false;
  const preview = el('p', { class: 'hint', 'aria-live': 'polite' });
  const shiftsFor = (night) => shiftsPerPeriod(p, mine, todayISO(), nightPeriodIndex(p, night)).n;
  /** The night as it will be saved. A locked night keeps its Setup numbers unless "Recalculate with current Setup" is ticked. */
  const build = () => {
    const out = storedNight(d, p, n.id);
    const note = d.note.trim().slice(0, 500);
    if (note) out.note = note;
    else delete out.note;
    if (n.snap && !recalc) {
      // keep amounts for pay types removed from Setup since, so the locked numbers stay whole
      Object.keys(n.pay || {}).forEach((k) => {
        if (!(k in out.pay)) out.pay[k] = n.pay[k];
      });
      out.snap = n.snap;
    } else if (n.snap && recalc) out.snap = snapshotFor(p, shiftsFor(out));
    // Tips and hours untouched and no recalculation: the stored total (and typed tips) stay exactly as they were.
    const untouched = !recalc && JSON.stringify([d.total, d.pay]) === typedAtOpen;
    if (untouched && (tipsMode(p) || hasTips(n))) {
      out.total = num(n.total);
      if (hasTips(n)) out.tips = n.tips;
      else delete out.tips;
    } else if (tipsMode(p)) {
      // Tips back to a stored total, with the pay this night is shown with (its snapshot, the new one, or today's Setup).
      out.tips = round2(numOf(d.total));
      out.total = totalFromTips(out.tips, out, p);
    }
    return out;
  };
  const upd = () => {
    const night = build();
    const c = computeNight(night, p, shiftsFor(night));
    preview.textContent = 'Estimated take-home for this night: ' + money(c.net) + '.';
  };
  // A locked night shows the rates it keeps, unless "Recalculate with current Setup" is ticked.
  const rateOf = (t) => {
    if (!n.snap || recalc) return num(t.rate);
    const s = (n.snap.pay || []).find((x) => String(x.id) === String(t.id));
    return s ? num(s.rate) : num(t.rate);
  };
  const f = nightFields(p, d, {
    key: 'edit-' + n.id,
    rateOf,
    onInput: () => {
      f.setTotalError('');
      upd();
    },
  });
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
  let lockNote = null;
  if (n.snap) {
    const cb = el('input', { type: 'checkbox', id: 'edit-' + n.id + '-recalc' });
    cb.addEventListener('change', () => {
      recalc = cb.checked;
      f.refresh();
      upd();
    });
    lockNote = el(
      'div',
      { class: 'stack-sm' },
      el(
        'p',
        { class: 'hint' },
        'This night keeps the pay rates and deductions it was saved with, so later Setup changes don’t rewrite it.',
      ),
      el(
        'label',
        { class: 'check', for: cb.id },
        cb,
        el(
          'span',
          null,
          'Recalculate with current Setup',
          el('small', null, 'Uses today’s pay rates, deductions and tip-out for this night.'),
        ),
      ),
    );
  }
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
    noteField,
    lockNote,
    preview,
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
    editingId = null;
    if (i < 0) {
      bus.rerender();
      toast('That night was deleted, so nothing was changed.');
      return;
    }
    n = S.nights[i]; // build() reads the current night (its lock, its stored total)
    S.nights[i] = { ...build(), workplaceId: w.id };
    save();
    bus.rerender();
    toast('Night updated.');
  });
  upd();
  return form;
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
    el('div', { class: 'amount' }, money0(c.net)),
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

/**
 * One restaurant's pay period. The shift count for period idx: entered and history counts are the same for every period,
 * so they are worked out once per restaurant (ctx.base). ctx.named: start the label with the restaurant's name (the All list).
 */
function group(S, w, idx, ctx) {
  const p = w.profile,
    today = ctx.today;
  const shifts =
    ctx.base.source === 'default' ? shiftsPerPeriod(p, ctx.nights, today, idx, ctx.index).n : ctx.base.n;
  const t = periodTotals(p, ctx.nights, idx, today, shifts, ctx.index);
  const rows = t.ns.map((n) => nightRow(S, w, n, shifts));
  const editingRow = rows.length && t.ns.some((n) => n.id === editingId);
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
      el('b', { class: 'num' }, money0(t.net) + ' take-home'),
    ),
    t.setAside > 0
      ? el('p', { class: 'hint' }, 'Taxes to set aside on cash (estimate): ' + money(t.setAside))
      : null,
    editingRow
      ? el(
          'div',
          { class: 'stack-sm' },
          rows.map((r) => (r.tagName === 'LI' ? el('ul', { class: 'list' }, r) : r)),
        )
      : el('ul', { class: 'list' }, rows),
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
      'Tax rate: ' + pct(r.rOld, 2) + ' → ' + pct(r.rateOverride, 2) + ' (' + points(r.change) + ').',
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
        pct(r.rOld, 2) +
        ' to ' +
        pct(r.rateOverride, 2) +
        '. Nights in finished pay periods keep the numbers they were saved with.',
    };
    bus.rerender();
    focusId('cal-run');
  });
  keep.addEventListener('click', () => {
    calPending = null;
    calMsg = { text: 'No change made. Your tax rate stays at ' + pct(r.rOld, 2) + '.' };
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
      ? calibrate(p, mine, idx, numOf(actual.value), today, undefined, base)
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
    wsel ? field('Restaurant', wsel) : null,
    field('Pay period', sel),
    field('Actual paycheck amount (take-home on the stub)', actual),
    el('div', { class: 'cluster' }, run, undo),
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
    const nights = nightsOf(S, w.id);
    const index = indexNights(w.profile, nights);
    const base = shiftsPerPeriod(w.profile, nights, today, undefined, index);
    ctxs.set(w.id, { today, index, base, nights, named: many && pick === 'all' });
    index.forEach((list, idx) => items.push({ w, idx, end: periodRange(w.profile, idx).end }));
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
    ),
  );
}
