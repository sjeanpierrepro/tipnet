// Pay periods screen: nights grouped by pay period, edit/delete, and "Check my accuracy".
import {
  computeNight,
  periodTotals,
  periodIndex,
  shiftsPerPeriod,
  calibrate,
  todayISO,
  isFinal,
  indexNights,
  snapshotFor,
} from '../math.js';
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
  toast,
  arm,
  save,
  bus,
  getState,
  keepFocus,
} from './common.js';
import { nightFields, draftFromNight, storedNight } from './tonight.js';

/** Pay periods shown at first; "Show older" adds this many more each time. */
export const PAGE = 6;

let editingId = null;
let calMsg = null; // {text}
let calPeriod = null;
let calActual = '';
let calPending = null; // {idx, r}: a comparison waiting for "Apply this adjustment" / "Don't change"
let shown = PAGE;
let view = null; // last render: {S, ctx, sections: Map(period idx -> section)} so Edit/Cancel/Show older only rebuild what changed

/** Forget screen-local UI state (open editor, accuracy message, older periods shown). Called when leaving the tab and after erase/restore. */
export function reset() {
  editingId = null;
  calMsg = null;
  calPeriod = null;
  calActual = '';
  calPending = null;
  shown = PAGE;
  view = null;
}

function nightSub(n, c, p) {
  const bits = [money(c.total) + ' made'];
  if (c.tipout) bits.push(money(c.tipout) + ' tip-out');
  else if ((n.snap ? n.snap.tipout.on : p.tipout.on) && !n.barback) bits.push('no barback');
  if (c.onCheck != null) bits.push(money(c.onCheck) + ' on check');
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

/** Rebuild only the given pay periods' sections (opening/closing the editor), keeping keyboard focus. */
function redrawGroups(idxList) {
  const root = document.getElementById('app');
  const secs = idxList.map((i) => view && view.sections.get(i));
  if (!root || secs.some((s) => !s || !s.isConnected)) {
    bus.rerender();
    return;
  }
  keepFocus(root, () => {
    [...new Set(idxList)].forEach((i) => {
      const old = view.sections.get(i);
      const fresh = group(view.S, i, view.ctx);
      old.replaceWith(fresh);
    });
  });
}
const idxOfNight = (S, id) => {
  const n = S.nights.find((x) => x.id === id);
  return n ? periodIndex(S.profile, n.date) : null;
};
function openEditor(S, id) {
  const before = editingId == null ? null : idxOfNight(S, editingId);
  editingId = id;
  redrawGroups([idxOfNight(S, id), before].filter((i) => i != null));
}

function editor(S, n) {
  const p = S.profile;
  const d = draftFromNight(n, p);
  let recalc = false;
  const preview = el('p', { class: 'hint', 'aria-live': 'polite' });
  const shiftsFor = (date) => shiftsPerPeriod(p, S.nights, todayISO(), periodIndex(p, date)).n;
  /** The night as it will be saved. A locked night keeps its Setup numbers unless "Recalculate with current Setup" is ticked. */
  const build = () => {
    const out = storedNight(d, p, n.id);
    if (n.note && out.note === undefined) out.note = n.note;
    if (n.snap && !recalc) {
      // keep amounts for pay types removed from Setup since, so the locked numbers stay whole
      Object.keys(n.pay || {}).forEach((k) => {
        if (!(k in out.pay)) out.pay[k] = n.pay[k];
      });
      out.snap = n.snap;
    } else if (n.snap && recalc) out.snap = snapshotFor(p, shiftsFor(out.date));
    return out;
  };
  const upd = () => {
    const night = build();
    const c = computeNight(night, p, shiftsFor(night.date));
    preview.textContent = 'Estimated take-home for this night: ' + money(c.net) + '.';
  };
  const f = nightFields(p, d, {
    key: 'edit-' + n.id,
    onInput: () => {
      f.setTotalError('');
      upd();
    },
  });
  let lockNote = null;
  if (n.snap) {
    const cb = el('input', { type: 'checkbox', id: 'edit-' + n.id + '-recalc' });
    cb.addEventListener('change', () => {
      recalc = cb.checked;
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
        const i = periodIndex(p, n.date);
        editingId = null;
        redrawGroups([i]);
      },
    },
    'Cancel',
  );
  const form = el(
    'form',
    { class: 'card stack', novalidate: true },
    el('div', { class: 'card-title' }, 'Edit night'),
    f.root,
    lockNote,
    preview,
    el('div', { class: 'cluster' }, saveBtn, cancel),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!(numOf(d.total) > 0)) {
      f.setTotalError('Enter what you made that night.');
      f.totalInput.focus();
      return;
    }
    const i = S.nights.findIndex((x) => x.id === n.id);
    if (i >= 0) S.nights[i] = build();
    save();
    editingId = null;
    bus.rerender();
    toast('Night updated.');
  });
  upd();
  return form;
}

const ARM_MS = 4000;
function nightRow(S, n, shifts) {
  const p = S.profile;
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

/** The shift count for period idx. Entered and history counts are the same for every period, so they are worked out once (in `base`). */
function group(S, idx, ctx) {
  const p = S.profile,
    today = ctx.today;
  const shifts =
    ctx.base.source === 'default' ? shiftsPerPeriod(p, S.nights, today, idx, ctx.index).n : ctx.base.n;
  const t = periodTotals(p, S.nights, idx, today, shifts, ctx.index);
  const rows = t.ns.map((n) => nightRow(S, n, shifts));
  const editingRow = rows.length && t.ns.some((n) => n.id === editingId);
  const sec = el(
    'section',
    { class: 'stack-sm', 'data-period': idx },
    el(
      'div',
      { class: 'spread' },
      el(
        'span',
        { class: 'label', tabindex: '-1', 'data-focus-key': 'period-' + idx },
        periodLabel(p, idx) + (t.exact ? ' · final' : ''),
      ),
      el('b', { class: 'num' }, money0(t.net) + ' take-home'),
    ),
    editingRow
      ? el(
          'div',
          { class: 'stack-sm' },
          rows.map((r) => (r.tagName === 'LI' ? el('ul', { class: 'list' }, r) : r)),
        )
      : el('ul', { class: 'list' }, rows),
  );
  if (view && view.ctx === ctx) view.sections.set(idx, sec);
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
function pendingBox(S, r, idx) {
  const p = S.profile;
  const warnMissing = r.missingNights > 0;
  const warn = warnMissing || r.suspect;
  const lines = [
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
  ];
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
    'Apply this adjustment',
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
    S.calib.push({ label: periodLabel(p, idx), pred: r.pred, actual: r.actual, err: r.err });
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

function calibCard(S, idxs, today) {
  const p = S.profile;
  const finished = (i) => isFinal(p, i, today);
  if (calPeriod == null || !idxs.includes(calPeriod)) calPeriod = defaultCalibPeriod(idxs, finished);
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
  const undo = el(
    'button',
    { type: 'button', class: 'btn btn-secondary btn-small', id: 'cal-undo' },
    'Undo adjustments',
  );
  const show = (text) => {
    calPending = null;
    calMsg = { text };
    bus.rerender();
  };
  run.addEventListener('click', () => {
    const idx = Number(sel.value);
    calActual = actual.value;
    const r = idxs.length
      ? calibrate(p, S.nights, idx, numOf(actual.value), today)
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
    calPending = { idx, r };
    bus.rerender();
    focusId(r.missingNights > 0 || r.suspect ? 'cal-keep' : 'cal-apply');
  });
  undo.addEventListener('click', () => {
    p.rateOverride = null;
    S.calib = [];
    calPending = null;
    save();
    calMsg = { text: 'Back to the rates from your paystub.' };
    bus.rerender();
  });
  if (calPending && calPending.idx === calPeriod) pendingNode = pendingBox(S, calPending.r, calPending.idx);
  else calPending = null;
  const hist = S.calib
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
    field('Pay period', sel),
    field('Actual paycheck amount (take-home on the stub)', actual),
    el('div', { class: 'cluster' }, run, undo),
    pendingNode,
    msg,
    hist.length ? el('ul', { class: 'stack-sm', style: 'list-style:none;margin:0;padding:0' }, hist) : null,
  );
}

/** "Show older pay periods": adds the next PAGE periods in place (nothing else is rebuilt) and keeps focus. */
function olderButton(S, idxs, ctx, host) {
  const left = () => idxs.length - shown;
  const btn = el('button', { type: 'button', class: 'btn btn-secondary', id: 'periods-older' });
  const label = () => {
    btn.textContent = 'Show older pay periods (' + left() + ' more)';
  };
  label();
  btn.addEventListener('click', () => {
    const from = shown;
    shown = Math.min(idxs.length, shown + PAGE);
    const added = idxs.slice(from, shown).map((i) => group(S, i, ctx));
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
    p = S.profile,
    today = todayISO();
  // One pass over the nights, shared by every period below (a long history stays fast).
  const index = indexNights(p, S.nights);
  const ctx = { today, index, base: shiftsPerPeriod(p, S.nights, today, undefined, index) };
  view = { S, ctx, sections: new Map() };
  const idxs = [...index.keys()].sort((a, b) => b - a);
  // The period with the open editor always stays visible.
  if (editingId != null) {
    const at = idxs.indexOf(idxOfNight(S, editingId));
    if (at >= shown) shown = Math.ceil((at + 1) / PAGE) * PAGE;
  }
  let list;
  if (idxs.length) {
    list = el('div', { class: 'stack' });
    idxs.slice(0, shown).forEach((i) => list.append(group(S, i, ctx)));
    if (idxs.length > shown) list.append(olderButton(S, idxs, ctx, list));
  } else
    list = el(
      'div',
      { class: 'card' },
      el('p', { class: 'hint' }, 'No nights yet. Log your first shift on the Tonight tab.'),
    );
  root.append(el('div', { class: 'stack' }, exampleBanner(), list, calibCard(S, idxs, today)));
}
