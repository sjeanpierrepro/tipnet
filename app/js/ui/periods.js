// Pay periods screen: nights grouped by pay period, edit/delete, and "Check my accuracy".
import { computeNight, periodTotals, periodIndex, shiftsPerPeriod, calibrate, todayISO, isFinal } from '../math.js';
import { el, clear, field, moneyInput, select, numOf, money, money0, pct, fmtDate, periodLabel, exampleBanner, toast, arm, save, bus, getState } from './common.js';
import { nightFields, draftFromNight, storedNight } from './tonight.js';

let editingId = null;
let calMsg = null; // {text, tone}
let calPeriod = null;

function nightSub(n, c, p) {
  const bits = [money(c.total) + ' made'];
  if (c.tipout) bits.push(money(c.tipout) + ' tip-out');
  else if (p.tipout.on && !n.barback) bits.push('no barback');
  if (c.onCheck != null) bits.push(money(c.onCheck) + ' on check');
  return bits.join(' · ');
}

function editor(S, n) {
  const p = S.profile;
  const d = draftFromNight(n, p);
  const preview = el('p', { class: 'hint', 'aria-live': 'polite' });
  const upd = () => {
    const c = computeNight(storedNight(d, p, n.id), p, shiftsPerPeriod(p, S.nights).n);
    preview.textContent = 'Estimated take-home for this night: ' + money(c.net) + '.';
  };
  const f = nightFields(p, d, { onInput: () => { f.setTotalError(''); upd(); } });
  const saveBtn = el('button', { type: 'submit', class: 'btn btn-small' }, 'Save changes');
  const cancel = el('button', { type: 'button', class: 'btn btn-secondary btn-small', onclick: () => { editingId = null; bus.rerender(); } }, 'Cancel');
  const form = el('form', { class: 'card stack', novalidate: true }, el('div', { class: 'card-title' }, 'Edit night'), f.root, preview, el('div', { class: 'cluster' }, saveBtn, cancel));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!(numOf(d.total) > 0)) { f.setTotalError('Enter what you made that night.'); f.totalInput.focus(); return; }
    const i = S.nights.findIndex((x) => x.id === n.id);
    if (i >= 0) S.nights[i] = storedNight(d, p, n.id);
    save(); editingId = null; bus.rerender(); toast('Night updated.');
  });
  upd();
  return form;
}

function nightRow(S, n, shifts) {
  const p = S.profile;
  if (editingId === n.id) return editor(S, n);
  const c = computeNight(n, p, shifts);
  const del = el('button', { type: 'button', class: 'btn btn-danger btn-small', 'aria-label': 'Delete night ' + fmtDate(n.date) });
  arm(del, {
    label: 'Delete', armedLabel: 'Delete?',
    onConfirm: () => {
      const i = S.nights.findIndex((x) => x.id === n.id);
      if (i < 0) return;
      const [gone] = S.nights.splice(i, 1);
      save(); bus.rerender();
      toast('Night deleted.', { undo: () => { S.nights.push(gone); save(); bus.rerender(); } });
    },
  });
  return el('li', { class: 'list-row wrap' },
    el('div', { class: 'main' }, el('div', null, fmtDate(n.date)), el('div', { class: 'hint' }, nightSub(n, c, p))),
    el('div', { class: 'amount' }, money0(c.net)),
    el('div', { class: 'row-actions' },
      el('button', { type: 'button', class: 'btn btn-secondary btn-small', 'aria-label': 'Edit night ' + fmtDate(n.date), onclick: () => { editingId = n.id; bus.rerender(); } }, 'Edit'),
      del));
}

function group(S, idx) {
  const p = S.profile, today = todayISO();
  const t = periodTotals(p, S.nights, idx, today);
  const shifts = shiftsPerPeriod(p, S.nights, today).n;
  const rows = t.ns.map((n) => nightRow(S, n, shifts));
  const editingRow = rows.length && t.ns.some((n) => n.id === editingId);
  return el('section', { class: 'stack-sm' },
    el('div', { class: 'spread' },
      el('span', { class: 'label' }, periodLabel(p, idx) + (t.exact ? ' · final' : '')),
      el('b', { class: 'num' }, money0(t.net) + ' take-home')),
    editingRow ? el('div', { class: 'stack-sm' }, rows.map((r) => (r.tagName === 'LI' ? el('ul', { class: 'list' }, r) : r)))
      : el('ul', { class: 'list' }, rows));
}

function calibCard(S, idxs) {
  const p = S.profile;
  if (calPeriod == null || !idxs.includes(calPeriod)) calPeriod = idxs.length ? idxs[0] : null;
  const sel = select(idxs.length ? idxs.map((i) => [i, periodLabel(p, i)]) : [['', 'No pay periods yet']], calPeriod == null ? '' : calPeriod, { id: 'cal-period' });
  sel.addEventListener('change', () => { calPeriod = Number(sel.value); });
  const actual = moneyInput({ placeholder: '0.00' });
  const msg = el('p', { class: 'note', 'aria-live': 'polite', hidden: !calMsg }, calMsg ? calMsg.text : '');
  const run = el('button', { type: 'button', class: 'btn btn-small' }, 'Compare and adjust');
  const undo = el('button', { type: 'button', class: 'btn btn-secondary btn-small' }, 'Undo adjustments');
  const show = (text) => { calMsg = { text }; msg.hidden = false; msg.textContent = text; };
  run.addEventListener('click', () => {
    const idx = Number(sel.value);
    const r = idxs.length ? calibrate(p, S.nights, idx, numOf(actual.value)) : { ok: false, reason: 'nonights' };
    if (!r.ok) {
      if (r.reason === 'missingCash') {
        const m = r.missingCash;
        return show(m + ' night' + (m > 1 ? 's' : '') + ' in this period ' + (m > 1 ? 'have' : 'has') + ' no cash amount, so the check can’t be predicted. Add cash to every night first.');
      }
      return show('Pick a pay period with nights in it and enter the check amount.');
    }
    p.rateOverride = r.rateOverride;
    S.calib.push({ label: periodLabel(p, idx), pred: r.pred, actual: r.actual, err: r.err });
    save();
    calMsg = { text: 'Predicted ' + money(r.pred) + ', actual ' + money(r.actual) + ': off by ' + Math.abs(r.err * 100).toFixed(1) + '%. Tax rate adjusted to ' + pct(r.rateOverride) + '.' };
    bus.rerender();
  });
  undo.addEventListener('click', () => {
    p.rateOverride = null; S.calib = []; save();
    calMsg = { text: 'Back to the rates from your paystub.' };
    bus.rerender();
  });
  const hist = S.calib.slice(-4).reverse().map((c) => el('li', { class: 'spread' },
    el('span', { class: 'hint' }, c.label + ': predicted ' + money(c.pred) + ', actual ' + money(c.actual)),
    el('span', { class: Math.abs(c.err) <= 0.05 ? 'pill pill-good' : 'pill pill-bad' }, (c.err > 0 ? '+' : '') + (c.err * 100).toFixed(1) + '%')));
  return el('section', { class: 'card stack' },
    el('h2', null, 'Check my accuracy'),
    el('p', { class: 'note' }, 'When a paycheck lands, enter its amount. TipNet compares it with what it predicted for that pay period and adjusts your rates so the next estimate is closer. Every night in the period needs a cash amount.'),
    field('Pay period', sel),
    field('Actual paycheck amount (take-home on the stub)', actual),
    el('div', { class: 'cluster' }, run, undo),
    msg,
    hist.length ? el('ul', { class: 'stack-sm', style: 'list-style:none;margin:0;padding:0' }, hist) : null);
}

export function render(root) {
  const S = getState(), p = S.profile;
  const idxs = [...new Set(S.nights.map((n) => periodIndex(p, n.date)))].sort((a, b) => b - a);
  const list = idxs.length ? idxs.map((i) => group(S, i))
    : [el('div', { class: 'card' }, el('p', { class: 'hint' }, 'No nights yet. Log your first shift on the Tonight tab.'))];
  root.append(el('div', { class: 'stack' }, exampleBanner(), list, calibCard(S, idxs)));
}
