// Tonight screen: one number in, estimated take-home out. Also exports the night form used by "edit night".
import { computeNight, periodTotals, periodIndex, shiftsPerPeriod, weeklyHours, payAmount, todayISO, num } from '../math.js';
import { el, clear, field, moneyInput, clean, numOf, money, money0, minus, pct, fmtDate, periodLabel, exampleBanner, save, getState, uid } from './common.js';

let draft = null; // survives tab switches so half-typed entries are not lost
let draftIsExample = false; // draft was pre-filled with the example night

const exampleMode = (S) => !!(S.profileExample && S.nightsExample);

/** Drop the in-progress entry (e.g. after Erase everything or Restore). */
export function resetDraft() { draft = null; draftIsExample = false; }

export function blankDraft(S) {
  const d = { total: '', cash: '', pay: {}, barback: true, date: todayISO() };
  if (exampleMode(S)) { // the example night from the spec: $585, 8 hours, $210 cash. Blank otherwise: main hours fall back to "usual".
    d.total = '585'; d.cash = '210';
    const main = S.profile.payTypes[0];
    if (main) d.pay[main.id] = '8';
  }
  return d;
}
export function draftFromNight(n, p) {
  const d = { total: String(n.total), cash: n.cash == null ? '' : String(n.cash), pay: {}, barback: n.barback !== false, date: n.date };
  p.payTypes.forEach((t, i) => { d.pay[t.id] = String(payAmount(n, t, i)); });
  return d;
}
/** Draft (strings) -> night with cleaned values, for live math. */
export function liveNight(d, id) {
  const pay = {};
  Object.keys(d.pay).forEach((k) => { if (d.pay[k] !== '') pay[k] = clean(d.pay[k]); });
  return { id, date: d.date || todayISO(), total: numOf(d.total) > 0 ? clean(d.total) : '', cash: clean(d.cash), pay, barback: d.barback };
}
/** Draft -> night to store. Freezes each pay type's amount (main type falls back to its usual). */
export function storedNight(d, p, id) {
  const ln = liveNight(d, id);
  const pay = {};
  p.payTypes.forEach((t, i) => { pay[t.id] = payAmount(ln, t, i); });
  return { id, date: ln.date, total: numOf(d.total), cash: d.cash === '' || clean(d.cash) === '' ? null : numOf(d.cash), pay, barback: d.barback };
}

/**
 * nightFields(p, d, {big, onInput}) builds the entry fields bound to draft d.
 * Returns {root, totalInput, setTotalError}.
 */
export function nightFields(p, d, { big = false, onInput = () => {} } = {}) {
  const to = p.tipout || {};
  const after = to.on && to.basis === 'after';
  const hintText = after
    ? 'Cash + card tips + all hourly pay, after the barback tip-out.'
    : 'Cash + card tips + all hourly pay, before anything comes out.';
  const bind = (input, get, set) => { input.value = get(); input.addEventListener('input', () => { set(input.value); onInput(); }); return input; };

  const totalInput = bind(moneyInput({ id: uid('tot'), placeholder: '0', 'aria-describedby': undefined }), () => d.total, (v) => { d.total = v; });
  let totalNode;
  const errEl = el('p', { class: 'field-error', hidden: true, role: 'alert' });
  const setTotalError = (m) => { errEl.hidden = !m; errEl.textContent = m || ''; totalNode.toggleAttribute('data-invalid', !!m); totalInput.toggleAttribute('aria-invalid', !!m); };
  if (big) {
    totalNode = el('div', { class: 'field' },
      el('label', { for: totalInput.id }, 'What you made tonight'),
      el('div', { class: 'money' }, el('span', { 'aria-hidden': 'true' }, '$'), totalInput),
      el('p', { class: 'hint' }, hintText), errEl);
  } else {
    totalNode = el('div', { class: 'field' }, el('label', { for: totalInput.id }, 'What you made'), totalInput, el('p', { class: 'hint' }, hintText), errEl);
  }

  const kids = [totalNode];
  if (to.on && to.basis === 'before') {
    const cb = el('input', { type: 'checkbox', id: uid('bb') });
    cb.checked = !!d.barback;
    cb.addEventListener('change', () => { d.barback = cb.checked; onInput(); });
    kids.push(el('label', { class: 'check', for: cb.id }, cb, el('span', null, 'Barback tip-out tonight', el('small', null, 'Uncheck if you worked without a barback.'))));
  } else d.barback = d.barback !== false ? d.barback : true;

  const payInputs = p.payTypes.map((t, i) => {
    const name = t.name || 'Pay type ' + (i + 1);
    const one = p.payTypes.length === 1;
    const label = t.unit === 'amt' ? [name + ' $ ', el('span', { class: 'hint' }, '(on top)')]
      : one ? (t.unit === 'hr' ? 'Hours worked' : 'Shifts worked') : name + (t.unit === 'hr' ? ' hours' : ' shifts');
    const inp = bind(moneyInput({ placeholder: String(i === 0 && t.unit !== 'amt' ? num(t.usual) : 0) }), () => d.pay[t.id] || '', (v) => { d.pay[t.id] = v; });
    return field(label, inp);
  });
  if (payInputs.length) kids.push(el('div', { class: 'grid-2' }, payInputs));

  const cash = bind(moneyInput({ placeholder: '—' }), () => d.cash, (v) => { d.cash = v; });
  kids.push(field('Cash in hand', cash, { optional: true }));
  const date = el('input', { type: 'date', value: d.date });
  date.addEventListener('input', () => { d.date = date.value || todayISO(); onInput(); });
  kids.push(field('Date', date));
  return { root: el('div', { class: 'stack' }, kids), totalInput, setTotalError };
}

function bullet(dt, dd, cls) { return el('div', cls ? { class: cls } : null, el('dt', null, dt), el('dd', { class: 'num' }, dd)); }

/** Result card body. c = computeNight result; ctx = {p, S}. */
export function resultCard(c, S, note) {
  if (!c.total) return el('div', { class: 'result' }, el('p', { class: 'note' }, 'Enter tonight’s total above and your take-home appears here.'));
  const cal = S.calib.length ? S.calib[S.calib.length - 1] : null;
  const acc = cal ? 'Your last paycheck estimate was off by ' + Math.abs(cal.err * 100).toFixed(1) + '%.'
    : 'Estimate. A single night is usually within 5–10%; a full paycheck is usually closer.';
  const rows = [
    bullet('Made tonight', money(c.total)),
    bullet('  of which base pay', money(c.basePay)),
    bullet('  of which tips', money(c.tips)),
  ];
  if (c.extra) rows.push(bullet('Extra pay (bonus etc.)', '+' + money(c.extra)));
  if (c.tipout) rows.push(bullet('Barback tip-out', minus(c.tipout)));
  rows.push(bullet('Taxes (' + pct(c.r) + ')', minus(c.tax)));
  if (c.fixedPerShift) rows.push(bullet('Share of fixed deductions', minus(c.fixedPerShift)));
  rows.push(bullet('Estimated take-home', money(c.net), 'total'));

  const kids = [
    el('div', null, el('div', { class: 'hero-label' }, 'Estimated take-home tonight'), el('div', { class: 'hero num' }, money(c.net))),
    el('dl', { class: 'breakdown' }, rows),
  ];
  if (c.cashInHand != null) {
    kids.push(el('div', { class: 'strip strip-2' },
      el('div', null, el('span', { class: 'label' }, 'Cash in hand'), el('b', null, money(c.cashInHand))),
      el('div', null, el('span', { class: 'label' }, 'On your check'), el('b', null, money(c.onCheck)))));
    if (c.onCheck < 0) {
      kids.push(el('p', { class: 'note' }, el('strong', null, 'Heads up: '),
        'the taxes on your cash are bigger than your card tips and base pay tonight, so this night shrinks your check.'));
    } else {
      kids.push(el('p', { class: 'hint' }, 'Taxes on cash tips usually come out of the paycheck, which is why a check can look small.'));
    }
  } else kids.push(el('p', { class: 'note' }, 'Add your cash amount to see what lands on your check.'));
  const tip = [acc + ' '];
  if (c.fedOnTips > 0) tip.push('About ', el('strong', null, money(c.fedOnTips)), ' of tonight’s tax is federal income tax on tips, some of which may come back at tax time (federal “No Tax on Tips” deduction, 2025–2028). Social Security and Medicare still apply.');
  kids.push(el('p', { class: 'note' }, tip));
  if (note) kids.push(note);
  return el('div', { class: 'result' }, kids);
}

function stripCard(S) {
  const p = S.profile, today = todayISO();
  const idx = periodIndex(p, today);
  const t = periodTotals(p, S.nights, idx, today);
  const strip = el('div', { class: 'strip' },
    el('div', null, el('span', { class: 'label' }, 'Take-home'), el('b', null, money0(t.net))),
    el('div', null, el('span', { class: 'label' }, 'Nights'), el('b', null, String(t.ns.length))),
    el('div', null, el('span', { class: 'label' }, 'Per hour'), el('b', null, t.hrs ? money0(t.net / t.hrs) : '—')));
  const cap = t.ns.length
    ? (t.allCash ? 'Expected on your next check from these nights: ' + money(t.chk) + '.' : 'Add cash amounts to every night to preview your check.')
    : 'No nights logged yet this period.';
  return el('div', { class: 'stack-sm' }, el('div', { class: 'label' }, 'This pay period · ' + periodLabel(p, idx)), strip, el('p', { class: 'hint' }, cap));
}

export function render(root) {
  const S = getState(), p = S.profile;
  // Example mode ended (Finish setup, Clear example nights, first save): drop the example pre-fill.
  if (draft && draftIsExample && !exampleMode(S)) draft = null;
  if (!draft) { draft = blankDraft(S); draftIsExample = exampleMode(S); }
  const d = draft;
  const banner = exampleBanner();
  const resultHost = el('div', { 'aria-live': 'polite' });
  const savedMsg = el('p', { class: 'hint', role: 'status' });

  const update = () => {
    const shifts = shiftsPerPeriod(p, S.nights).n;
    const night = liveNight(d, 'draft');
    const c = computeNight(night, p, shifts);
    let ot = null;
    const others = S.nights.filter((n) => n.id !== 'draft');
    const wk = weeklyHours(p, others.concat([night]), night.date);
    if (wk.over && c.hours > 0) {
      ot = el('p', { class: 'note' }, 'You have logged about ' + (Math.round(wk.hours * 10) / 10) + ' hours this week (Monday to Sunday). If some were overtime, add Overtime as its own pay type in Setup and log those hours there. TipNet does not work out overtime pay for you.');
    }
    clear(resultHost).append(resultCard(c, S, ot));
  };
  const fields = nightFields(p, d, { big: true, onInput: () => { savedMsg.textContent = ''; fields.setTotalError(''); update(); } });

  const form = el('form', { class: 'card stack', novalidate: true },
    fields.root,
    el('button', { class: 'btn btn-block', type: 'submit' }, 'Save night'),
    savedMsg);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!(numOf(d.total) > 0)) { fields.setTotalError('Enter what you made tonight first.'); fields.totalInput.focus(); return; }
    if (S.nightsExample) { S.nights = []; S.calib = []; S.nightsExample = false; }
    const night = storedNight(d, p, Date.now());
    S.nights.push(night);
    save();
    const net = computeNight(night, p, shiftsPerPeriod(p, S.nights).n).net;
    draft = blankDraft(S); draftIsExample = exampleMode(S);
    render(clear(root));
    const m = root.querySelector('[role=status].hint');
    if (m) m.textContent = 'Saved. ' + money(net) + ' take-home for ' + fmtDate(night.date) + '.';
  });

  root.append(el('div', { class: 'stack' }, banner, stripCard(S), form, resultHost));
  update();
}
