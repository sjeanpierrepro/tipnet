// Tonight screen: one number in, estimated take-home out. Also exports the night form used by "edit night".
import {
  computeNight,
  periodTotals,
  periodIndex,
  shiftsPerPeriod,
  weeklyHours,
  payAmount,
  todayISO,
  num,
} from '../math.js';
import {
  businessDate,
  cutoffFromSettings,
  checkCash,
  negativeCheckReason,
  parseHoursInput,
  hasHoursText,
} from '../inputs.js';
import { lockFinished } from '../storage.js';
import {
  el,
  clear,
  field,
  moneyInput,
  clean,
  numOf,
  money,
  money0,
  minus,
  pct,
  fmtDate,
  periodLabel,
  exampleBanner,
  save,
  getState,
  uid,
  debounce,
} from './common.js';

let draft = null; // survives tab switches so half-typed entries are not lost
let draftIsExample = false; // draft was pre-filled with the example night

const exampleMode = (S) => !!(S.profileExample && S.nightsExample);
/** Nights that count as history for shift averages. Example nights never do, so the first real numbers match their preview. */
const historyOf = (S) => (S.nightsExample ? [] : S.nights);

/** Drop the in-progress entry (e.g. after Erase everything or Restore). */
export function resetDraft() {
  draft = null;
  draftIsExample = false;
}
/** The "Late nights" rule changed: re-date the in-progress entry, unless the user picked a date themselves. */
export function redateDraft(S) {
  if (draft && !draft.dateTouched) draft.date = businessDate(new Date(), cutoffFromSettings(S.settings));
}

export function blankDraft(S) {
  const d = {
    total: '',
    cash: '',
    pay: {},
    barback: true,
    date: businessDate(new Date(), cutoffFromSettings(S.settings)),
  };
  if (exampleMode(S)) {
    // the example night from the spec: $585, 8 hours, $210 cash. Blank otherwise: main hours fall back to "usual".
    d.total = '585';
    d.cash = '210';
    const main = S.profile.payTypes[0];
    if (main) d.pay[main.id] = '8';
  }
  return d;
}
export function draftFromNight(n, p) {
  const d = {
    total: String(n.total),
    cash: n.cash == null ? '' : String(n.cash),
    pay: {},
    barback: n.barback !== false,
    date: n.date,
  };
  p.payTypes.forEach((t, i) => {
    d.pay[t.id] = String(payAmount(n, t, i));
  });
  return d;
}
/** Draft (strings) -> night with cleaned values, for live math. */
export function liveNight(d, id, p) {
  const pay = {};
  Object.keys(d.pay).forEach((k) => {
    if (d.pay[k] === '') return;
    const t = p && p.payTypes.find((x) => x.id === k);
    // hours and shifts read "7:30" as 7.5; dollar amounts keep the plain number cleaning
    pay[k] =
      t && t.unit !== 'amt' ? String(Math.round(parseHoursInput(d.pay[k]) * 10000) / 10000) : clean(d.pay[k]);
  });
  // Cash that is negative or more than the total is not used (the screen says why); it never blocks the night.
  const cash = checkCash(d.total, d.cash).status === 'ok' ? clean(d.cash) : '';
  return {
    id,
    date: d.date || todayISO(),
    total: numOf(d.total) > 0 ? clean(d.total) : '',
    cash,
    pay,
    barback: d.barback,
  };
}
/** Draft -> night to store. Freezes each pay type's amount (main type falls back to its usual). */
export function storedNight(d, p, id) {
  const ln = liveNight(d, id, p);
  const pay = {};
  p.payTypes.forEach((t, i) => {
    pay[t.id] = payAmount(ln, t, i);
  });
  return {
    id,
    date: ln.date,
    total: numOf(d.total),
    cash: ln.cash === '' ? null : numOf(ln.cash),
    pay,
    barback: d.barback,
  };
}

/**
 * nightFields(p, d, {big, onInput}) builds the entry fields bound to draft d.
 * Returns {root, totalInput, setTotalError}.
 */
export function nightFields(p, d, { big = false, onInput: onInputRaw = () => {}, key = 'night' } = {}) {
  let refreshCash = () => {};
  const onInput = () => {
    refreshCash();
    onInputRaw();
  };
  const to = p.tipout || {};
  const after = to.on && to.basis === 'after';
  const hintText = after
    ? 'Cash + card tips + all hourly pay, after the barback tip-out.'
    : 'Cash + card tips + all hourly pay, before anything comes out.';
  const bind = (input, get, set) => {
    input.value = get();
    input.addEventListener('input', () => {
      set(input.value);
      onInput();
    });
    return input;
  };

  const totalInput = bind(
    moneyInput({
      id: uid('tot'),
      placeholder: '0',
      'aria-describedby': undefined,
      'data-focus-key': key + '-total',
    }),
    () => d.total,
    (v) => {
      d.total = v;
    },
  );
  let totalNode;
  const errEl = el('p', { class: 'field-error', hidden: true, role: 'alert' });
  const setTotalError = (m) => {
    errEl.hidden = !m;
    errEl.textContent = m || '';
    totalNode.toggleAttribute('data-invalid', !!m);
    totalInput.toggleAttribute('aria-invalid', !!m);
  };
  if (big) {
    totalNode = el(
      'div',
      { class: 'field' },
      el('label', { for: totalInput.id }, 'What you made tonight'),
      el('div', { class: 'money' }, el('span', { 'aria-hidden': 'true' }, '$'), totalInput),
      el('p', { class: 'hint' }, hintText),
      errEl,
    );
  } else {
    totalNode = el(
      'div',
      { class: 'field' },
      el('label', { for: totalInput.id }, 'What you made'),
      totalInput,
      el('p', { class: 'hint' }, hintText),
      errEl,
    );
  }

  const kids = [totalNode];
  if (to.on && to.basis === 'before') {
    const cb = el('input', { type: 'checkbox', id: uid('bb'), 'data-focus-key': key + '-barback' });
    cb.checked = !!d.barback;
    cb.addEventListener('change', () => {
      d.barback = cb.checked;
      onInput();
    });
    kids.push(
      el(
        'label',
        { class: 'check', for: cb.id },
        cb,
        el(
          'span',
          null,
          'Barback tip-out tonight',
          el('small', null, 'Uncheck if you worked without a barback.'),
        ),
      ),
    );
  } else d.barback = d.barback !== false ? d.barback : true;

  const payInputs = p.payTypes.map((t, i) => {
    const name = t.name || 'Pay type ' + (i + 1);
    const one = p.payTypes.length === 1;
    const label =
      t.unit === 'amt'
        ? [name + ' $ ', el('span', { class: 'hint' }, '(on top)')]
        : one
          ? t.unit === 'hr'
            ? 'Hours worked'
            : 'Shifts worked'
          : name + (t.unit === 'hr' ? ' hours' : ' shifts');
    const inp = bind(
      moneyInput({
        placeholder: String(i === 0 && t.unit !== 'amt' ? num(t.usual) : 0),
        'data-focus-key': key + '-pay-' + t.id,
      }),
      () => d.pay[t.id] || '',
      (v) => {
        d.pay[t.id] = v;
      },
    );
    return field(label, inp);
  });
  if (payInputs.length) kids.push(el('div', { class: 'grid-2' }, payInputs));

  const cash = bind(
    moneyInput({ placeholder: '—', 'data-focus-key': key + '-cash' }),
    () => d.cash,
    (v) => {
      d.cash = v;
    },
  );
  const collected = !!(to.on && to.basis === 'before' && to.from === 'cash');
  const cashField = field(
    collected ? 'Cash tips collected (before paying the barback)' : 'Cash you’re taking home',
    cash,
    {
      optional: true,
      hint: collected
        ? 'Count all the cash you made tonight, then TipNet takes the barback’s cash out.'
        : undefined,
    },
  );
  refreshCash = () => cashField.setError(checkCash(d.total, d.cash).message);
  refreshCash();
  kids.push(cashField);
  const date = el('input', { type: 'date', value: d.date, 'data-focus-key': key + '-date' });
  date.addEventListener('input', () => {
    d.date = date.value || todayISO();
    d.dateTouched = true;
    onInput();
  });
  kids.push(field('Date', date));
  return { root: el('div', { class: 'stack' }, kids), totalInput, setTotalError };
}

/** Plain message when an hourly field is over 24 hours, else ''. Shift counts are not limited. */
export function hoursProblem(p, d) {
  for (let i = 0; i < p.payTypes.length; i++) {
    const t = p.payTypes[i];
    if (t.unit !== 'hr' || !hasHoursText(d.pay[t.id])) continue;
    if (parseHoursInput(d.pay[t.id]) > 24)
      return (
        'That is more than 24 hours in one night. Check the hours' +
        (p.payTypes.length > 1 ? ' for ' + (t.name || 'Pay type ' + (i + 1)) : '') +
        '. Use 7:30 or 7.5 for seven and a half hours.'
      );
  }
  return '';
}
/** Combine an existing night with a new one on the same date (totals, cash and pay add up). */
export function mergeNights(a, b) {
  const pay = { ...a.pay };
  Object.keys(b.pay).forEach((k) => {
    pay[k] = Math.round(((pay[k] || 0) + b.pay[k]) * 10000) / 10000;
  });
  const cash =
    a.cash == null && b.cash == null ? null : Math.round(((a.cash || 0) + (b.cash || 0)) * 100) / 100;
  return { ...a, total: Math.round((a.total + b.total) * 100) / 100, cash, pay };
}

function bullet(dt, dd, cls) {
  return el('div', cls ? { class: cls } : null, el('dt', null, dt), el('dd', { class: 'num' }, dd));
}

/** Result card body. c = computeNight result; ctx = {p, S}. */
export function resultCard(c, S, note) {
  if (!c.total)
    return el(
      'div',
      { class: 'result' },
      el('p', { class: 'note' }, 'Enter tonight’s total above and your take-home appears here.'),
    );
  const cal = S.calib.length ? S.calib[S.calib.length - 1] : null;
  const acc = cal
    ? 'Your last paycheck estimate was off by ' + Math.abs(cal.err * 100).toFixed(1) + '%.'
    : 'This is an estimate. Your real paycheck can differ; check it with “Check my accuracy” after payday.';
  const rows = [
    bullet('Made tonight', money(c.total)),
    bullet('  of which base pay', money(c.basePay)),
    bullet('  of which tips', money(c.tips)),
  ];
  if (c.extra) rows.push(bullet('Extra pay (bonus etc.)', '+' + money(c.extra)));
  if (c.tipout) rows.push(bullet('Barback tip-out', minus(c.tipout)));
  rows.push(bullet('Taxes and % deductions (' + pct(c.r) + ')', minus(c.tax)));
  if (c.fixedPerShift) rows.push(bullet('Share of fixed deductions', minus(c.fixedPerShift)));
  rows.push(bullet('Estimated take-home', money(c.net), 'total'));

  const kids = [
    el(
      'div',
      null,
      el('div', { class: 'hero-label' }, 'Estimated take-home tonight'),
      el('div', { class: 'hero num' }, money(c.net)),
    ),
    el('dl', { class: 'breakdown' }, rows),
  ];
  if (c.cashInHand != null) {
    kids.push(
      el(
        'div',
        { class: 'strip strip-2' },
        el('div', null, el('span', { class: 'label' }, 'Cash you keep'), el('b', null, money(c.cashInHand))),
        el('div', null, el('span', { class: 'label' }, 'On your check'), el('b', null, money(c.onCheck))),
      ),
    );
    const why = negativeCheckReason(c);
    if (why === 'taxes') {
      kids.push(
        el(
          'p',
          { class: 'note' },
          el('strong', null, 'Heads up: '),
          'the taxes on your cash are bigger than your card tips and base pay tonight, so this night shrinks your check.',
        ),
      );
    } else if (why === 'fixed') {
      kids.push(
        el(
          'p',
          { class: 'note' },
          el('strong', null, 'Heads up: '),
          'after your cash, what is left on the check does not cover this night’s share of your fixed deductions, so this night shrinks your check.',
        ),
      );
    } else {
      kids.push(
        el(
          'p',
          { class: 'hint' },
          'Taxes on cash tips usually come out of the paycheck, which is why a check can look small.',
        ),
      );
    }
  } else kids.push(el('p', { class: 'note' }, 'Add your cash amount to see what lands on your check.'));
  const tip = [acc + ' '];
  if (c.fedOnTips > 0)
    tip.push(
      'About ',
      el('strong', null, money(c.fedOnTips)),
      ' of tonight’s tax is federal income tax on tips, some of which may come back at tax time (federal “No Tax on Tips” deduction, 2025–2028). Social Security and Medicare still apply.',
    );
  kids.push(el('p', { class: 'note' }, tip));
  if (note) kids.push(note);
  return el('div', { class: 'result' }, kids);
}

function stripCard(S) {
  const p = S.profile,
    today = todayISO();
  const idx = periodIndex(p, today);
  const nights = S.nightsExample && !S.profileExample ? [] : S.nights;
  const t = periodTotals(p, nights, idx, today);
  const strip = el(
    'div',
    { class: 'strip' },
    el('div', null, el('span', { class: 'label' }, 'Take-home'), el('b', null, money0(t.net))),
    el('div', null, el('span', { class: 'label' }, 'Nights'), el('b', null, String(t.ns.length))),
    el(
      'div',
      null,
      el('span', { class: 'label' }, 'Per hour'),
      el('b', null, t.hrs ? money0(t.net / t.hrs) : '—'),
    ),
  );
  const cap = t.ns.length
    ? t.allCash
      ? 'Expected on your next check from these nights: ' + money(t.chk) + '.'
      : 'Add cash amounts to every night to preview your check.'
    : 'No nights logged yet this period.';
  return el(
    'div',
    { class: 'stack-sm' },
    el('div', { class: 'label' }, 'This pay period · ' + periodLabel(p, idx)),
    strip,
    el('p', { class: 'hint' }, cap),
  );
}

export function render(root) {
  const S = getState(),
    p = S.profile;
  // Example mode ended (Finish setup, Clear example nights, first save): drop the example pre-fill.
  if (draft && draftIsExample && !exampleMode(S)) draft = null;
  if (!draft) {
    draft = blankDraft(S);
    draftIsExample = exampleMode(S);
  }
  const d = draft;
  const banner = exampleBanner();
  const resultHost = el('div'); // the full card is not a live region: it changes on every keystroke
  const liveSummary = el('p', {
    class: 'sr-only',
    role: 'status',
    'aria-live': 'polite',
    'aria-atomic': 'true',
  });
  let lastSummary = '',
    started = false;
  const announce = debounce(() => {
    liveSummary.textContent = lastSummary;
  }, 800);
  const savedMsg = el('p', { class: 'hint', role: 'status' });
  const hoursErr = el('p', { class: 'field-error', hidden: true, role: 'alert' });
  const dupHost = el('div');

  const update = () => {
    const hist = historyOf(S);
    const shifts = shiftsPerPeriod(p, hist).n;
    const night = liveNight(d, 'draft', p);
    const c = computeNight(night, p, shifts);
    let ot = null;
    const others = hist.filter((n) => n.id !== 'draft');
    const wk = weeklyHours(p, others.concat([night]), night.date);
    if (wk.over && c.hours > 0) {
      ot = el(
        'p',
        { class: 'note' },
        'You have logged about ' +
          Math.round(wk.hours * 10) / 10 +
          ' hours this week (Monday to Sunday). If some were overtime, add Overtime as its own pay type in Setup and log those hours there. TipNet does not work out overtime pay for you.',
      );
    }
    let low = null;
    if (c.total && c.basePay > c.total + 0.005 && c.hours > 0)
      low = el(
        'p',
        { class: 'note', role: 'status' },
        'Your hourly pay for ' +
          Math.round(c.hours * 100) / 100 +
          ' hours is ' +
          money(c.basePay) +
          ', more than the ' +
          money(c.total) +
          ' you entered. Did you include your hourly pay?',
      );
    hoursErr.textContent = hoursProblem(p, d);
    hoursErr.hidden = !hoursErr.textContent;
    clear(resultHost).append(
      resultCard(c, S, low && ot ? el('div', { class: 'stack-sm' }, low, ot) : low || ot),
    );
    lastSummary = c.total ? 'Estimated take-home ' + money(c.net) : '';
    if (!started) {
      started = true;
      liveSummary.textContent = lastSummary;
      return;
    } // first fill is silent
    announce(); // only a short summary is announced, after typing pauses
  };
  const fields = nightFields(p, d, {
    big: true,
    onInput: () => {
      savedMsg.textContent = '';
      clear(dupHost);
      fields.setTotalError('');
      update();
    },
  });

  const form = el(
    'form',
    { class: 'card stack', novalidate: true },
    fields.root,
    hoursErr,
    dupHost,
    el('button', { class: 'btn btn-block', type: 'submit' }, 'Save night'),
    savedMsg,
  );
  const finish = (night, net, cashWas, verb) => {
    if (S.nightsExample) {
      S.nights = [];
      S.calib = [];
      S.nightsExample = false;
    }
    verb();
    lockFinished({ force: true });
    save();
    draft = blankDraft(S);
    draftIsExample = exampleMode(S);
    render(clear(root));
    const tot = root.querySelector('[data-focus-key="night-total"]');
    if (tot) tot.focus();
    const m = root.querySelector('[role=status].hint');
    if (m)
      m.textContent =
        'Saved. ' +
        money(net) +
        ' take-home for ' +
        fmtDate(night.date) +
        '.' +
        (cashWas === 'negative' || cashWas === 'over' ? ' The cash amount was not saved.' : '');
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!(numOf(d.total) > 0)) {
      fields.setTotalError('Enter what you made tonight first.');
      fields.totalInput.focus();
      return;
    }
    const bad = hoursProblem(p, d);
    if (bad) {
      hoursErr.textContent = bad;
      hoursErr.hidden = false;
      return;
    }
    const cashWas = checkCash(d.total, d.cash).status;
    const night = storedNight(d, p, Date.now());
    // Same inputs as the preview: shift history before this night, never the example nights.
    const net = computeNight(night, p, shiftsPerPeriod(p, historyOf(S)).n).net;
    const same = S.nightsExample ? null : S.nights.find((n) => n.date === night.date);
    if (!same) return finish(night, net, cashWas, () => S.nights.push(night));
    const choose = (verb) => () => finish(night, net, cashWas, verb);
    const add = el(
      'button',
      { type: 'button', class: 'btn', 'data-focus-key': 'dup-add' },
      'Add to that night',
    );
    add.addEventListener(
      'click',
      choose(() => {
        S.nights[S.nights.indexOf(same)] = mergeNights(same, night);
      }),
    );
    const rep = el(
      'button',
      { type: 'button', class: 'btn btn-secondary', 'data-focus-key': 'dup-replace' },
      'Replace it',
    );
    rep.addEventListener(
      'click',
      choose(() => {
        S.nights[S.nights.indexOf(same)] = {
          ...night,
          id: same.id,
          ...(same.snap ? { snap: same.snap } : {}),
        };
      }),
    );
    const sep = el(
      'button',
      { type: 'button', class: 'btn btn-secondary', 'data-focus-key': 'dup-separate' },
      'Save as a separate night',
    );
    sep.addEventListener(
      'click',
      choose(() => S.nights.push(night)),
    );
    clear(dupHost).append(
      el(
        'div',
        { class: 'note stack-sm', role: 'group', 'aria-label': 'Night already saved for this date' },
        el(
          'p',
          null,
          'You already saved ' +
            money(same.total) +
            ' for ' +
            fmtDate(night.date) +
            '. What should TipNet do with this one?',
        ),
        add,
        rep,
        sep,
      ),
    );
    add.focus();
  });

  root.append(
    el(
      'div',
      { class: 'stack' },
      banner,
      el('h2', { class: 'sr-only' }, 'Tonight'),
      stripCard(S),
      form,
      liveSummary,
      el('h2', { class: 'sr-only' }, 'Your estimate for tonight'),
      resultHost,
    ),
  );
  update();
}
