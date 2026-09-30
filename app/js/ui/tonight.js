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
  totalFromTips,
  tipsFromTotal,
  exampleProfile,
  exampleNights,
} from '../math.js';
import {
  businessDate,
  cutoffFromSettings,
  checkCash,
  negativeCheckReason,
  parseHoursInput,
  hasHoursText,
} from '../inputs.js';
import { lockFinished, isSetUp } from '../storage.js';
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
  setupFirstCard,
  save,
  getState,
  uid,
  debounce,
  bus,
} from './common.js';

let draft = null; // survives tab switches so half-typed entries are not lost
let showExample = false; // before setup: "See an example first" was tapped

/** Nights that count as history for shift averages. Example nights never do, so the first real numbers match their preview. */
const historyOf = (S) => (S.nightsExample ? [] : S.nights);

/** Tips-only entry: the nightly number is cash + card tips and TipNet adds the hourly/per-shift pay. */
export const tipsMode = (p) => !!p && p.entryMode === 'tips';
/** The typed amount as a number; null when blank or not a number. */
function typedAmount(v) {
  const c = clean(v);
  if (c === '' || c === '-' || c === '.') return null;
  const n = parseFloat(c);
  return Number.isFinite(n) ? n : null;
}

/** Drop the in-progress entry and the example view (e.g. after Erase everything or Restore). */
export function resetDraft() {
  draft = null;
  showExample = false;
}
/** The "Late nights" rule changed: re-date the in-progress entry, unless the user picked a date themselves. */
export function redateDraft(S) {
  if (draft && !draft.dateTouched) draft.date = businessDate(new Date(), cutoffFromSettings(S.settings));
}

/** An empty entry. d.total holds the typed text: tips in tips mode, tips + pay in total mode. */
export function blankDraft(S) {
  return {
    total: '',
    cash: '',
    pay: {},
    barback: true,
    date: businessDate(new Date(), cutoffFromSettings(S.settings)),
  };
}
/** A saved night as an editable draft, in the current entry mode (tips mode shows the tips inside its total). */
export function draftFromNight(n, p) {
  const d = {
    total: tipsMode(p) ? String(Math.max(0, tipsFromTotal(n, p))) : String(n.total),
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
/**
 * Draft (strings) -> night with cleaned values, for live math. total is always everything made (tips + hourly/per-shift
 * pay): in tips mode the typed tips are converted here, so the preview and the saved night use the same number.
 * snap: work out the added pay with this locked night's rates (editing or replacing a locked night).
 */
export function liveNight(d, id, p, { snap } = {}) {
  const pay = {};
  Object.keys(d.pay).forEach((k) => {
    if (d.pay[k] === '') return;
    const t = p && p.payTypes.find((x) => x.id === k);
    // hours and shifts read "7:30" as 7.5; dollar amounts keep the plain number cleaning
    pay[k] =
      t && t.unit !== 'amt' ? String(Math.round(parseHoursInput(d.pay[k]) * 10000) / 10000) : clean(d.pay[k]);
  });
  // Cash that is negative or more than the total is not used (the screen says why); it never blocks the night.
  const cash = checkCash(d.total, d.cash, { tips: tipsMode(p) }).status === 'ok' ? clean(d.cash) : '';
  const night = {
    id,
    date: d.date || todayISO(),
    total: '',
    cash,
    pay,
    barback: d.barback,
  };
  if (tipsMode(p)) {
    const t = typedAmount(d.total);
    if (t != null && t >= 0) {
      const tot = totalFromTips(t, snap ? { ...night, snap } : night, p);
      if (tot > 0) night.total = String(tot);
    }
  } else if (numOf(d.total) > 0) night.total = clean(d.total);
  return night;
}
/** Draft -> night to store (no snapshot; the caller keeps one). Freezes each pay type's amount (main type falls back to its usual). */
export function storedNight(d, p, id, { snap } = {}) {
  const ln = liveNight(d, id, p, { snap });
  const pay = {};
  p.payTypes.forEach((t, i) => {
    pay[t.id] = payAmount(ln, t, i);
  });
  return {
    id,
    date: ln.date,
    total: tipsMode(p) ? num(ln.total) : numOf(d.total),
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
  const tips = tipsMode(p);
  const main = p.payTypes[0];
  const hintText = tips
    ? (after ? 'Cash tips + card tips, after paying the barback.' : 'Cash tips + card tips.') +
      (main && main.unit === 'shift'
        ? ' TipNet adds your shift pay for the shifts below.'
        : ' TipNet adds your hourly pay for the hours below.')
    : after
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
      el('label', { for: totalInput.id }, tips ? 'Tips you made tonight' : 'What you made tonight'),
      el('div', { class: 'money' }, el('span', { 'aria-hidden': 'true' }, '$'), totalInput),
      el('p', { class: 'hint' }, hintText),
      errEl,
    );
  } else {
    totalNode = el(
      'div',
      { class: 'field' },
      el('label', { for: totalInput.id }, tips ? 'Tips you made' : 'What you made'),
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
  refreshCash = () => cashField.setError(checkCash(d.total, d.cash, { tips }).message);
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
/**
 * Plain message when the main amount can't be saved, else ''. when: 'tonight' | 'that night'.
 * Total mode needs a total above 0. Tips mode takes 0 tips (a slow night still has hourly pay), but not blank or negative.
 */
export function entryProblem(p, d, when = 'tonight') {
  if (!tipsMode(p)) return numOf(d.total) > 0 ? '' : 'Enter what you made ' + when + ' first.';
  const t = typedAmount(d.total);
  if (t == null) return 'Enter your tips first. Type 0 if you made none.';
  if (t < 0) return 'Tips can’t be a negative number.';
  if (!(num(liveNight(d, 'check', p).total) > 0)) return 'Enter your tips or your hours first.';
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
      el(
        'p',
        { class: 'note' },
        tipsMode(S.profile)
          ? 'Enter tonight’s tips above and your take-home appears here.'
          : 'Enter tonight’s total above and your take-home appears here.',
      ),
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

/**
 * Before setup, "See an example first": the example paystub and the example night ($585 made: $489 tips + 8 hours at
 * $12, $210 cash), worked out with the real math. Built fresh from math.js, never from the user's state. No Save here.
 */
function exampleView(S) {
  const today = todayISO();
  const p = { ...exampleProfile(today), entryMode: S.profile.entryMode };
  const nights = exampleNights(today);
  const ex = S.profile.entryMode === 'tips' ? 'tips' : 'total';
  const night = nights[2]; // $585, 8 hours, $210 cash
  const exS = { profile: p, nights, calib: [], profileExample: true, nightsExample: true };
  const c = computeNight(night, p, shiftsPerPeriod(p, []).n);
  const heading = el('h2', { tabindex: '-1', id: 'example-heading' }, 'These are example numbers, not yours');
  const setUp = el('button', { type: 'button', class: 'btn', id: 'example-setup' }, 'Set up with my paystub');
  setUp.addEventListener('click', () => bus.startSetup());
  const typed =
    ex === 'tips'
      ? [bullet('Tips typed (cash + card)', money(tipsFromTotal(night, p)))]
      : [bullet('What they made (tips + hourly pay)', money(night.total))];
  return el(
    'div',
    { class: 'stack' },
    el(
      'section',
      { class: 'banner banner-example', 'aria-labelledby': 'example-heading' },
      heading,
      el(
        'p',
        null,
        'A bartender paid $12 an hour worked 8 hours, made $489 in tips, and took $210 of it home in cash. Here is what TipNet estimates they keep. Your own paystub gives you your own numbers.',
      ),
      setUp,
    ),
    el(
      'section',
      { class: 'card stack' },
      el('h2', { class: 'card-title' }, 'Example night'),
      el(
        'dl',
        { class: 'breakdown' },
        typed,
        bullet('Hours at $12', '8'),
        bullet('Cash collected', money(night.cash)),
      ),
    ),
    el('h2', { class: 'sr-only' }, 'Example estimate'),
    resultCard(c, exS),
  );
}

export function render(root) {
  const S = getState(),
    p = S.profile;
  if (!isSetUp(S)) {
    // No estimate and no entry form before setup: example taxes would give a wrong take-home.
    if (showExample) root.append(exampleView(S));
    else
      root.append(
        setupFirstCard({
          title: 'Finish setup to see your take-home',
          text: 'TipNet works out your take-home from one recent paystub. It takes about 3 minutes, and your numbers stay on this device.',
          example: () => {
            showExample = true;
            bus.rerender();
            const h = document.getElementById('example-heading');
            if (h) h.focus();
          },
        }),
      );
    return;
  }
  showExample = false;
  if (!draft) draft = blankDraft(S);
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
    // Total mode only: a total below the hourly pay usually means only the tips were typed. Tips mode adds the pay itself.
    if (!tipsMode(p) && c.total && c.basePay > c.total + 0.005 && c.hours > 0)
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
    const missing = entryProblem(p, d);
    if (missing) {
      fields.setTotalError(missing);
      fields.totalInput.focus();
      return;
    }
    const bad = hoursProblem(p, d);
    if (bad) {
      hoursErr.textContent = bad;
      hoursErr.hidden = false;
      return;
    }
    const cashWas = checkCash(d.total, d.cash, { tips: tipsMode(p) }).status;
    const night = storedNight(d, p, Date.now());
    // Same inputs as the preview: shift history before this night, never the example nights.
    const net = computeNight(night, p, shiftsPerPeriod(p, historyOf(S)).n).net;
    const same = S.nightsExample ? null : S.nights.find((n) => n.date === night.date);
    if (!same) return finish(night, net, cashWas, () => S.nights.push(night));
    const choose = (verb) => () => finish(night, net, cashWas, verb);
    // A locked night keeps its own pay rates: in tips mode the pay added with these tips is worked out with them too,
    // so the base pay is counted once, at the rates that night is shown with.
    const onto = (target) =>
      tipsMode(p) && target.snap ? storedNight(d, p, night.id, { snap: target.snap }) : night;
    const add = el(
      'button',
      { type: 'button', class: 'btn', 'data-focus-key': 'dup-add' },
      'Add to that night',
    );
    add.addEventListener(
      'click',
      choose(() => {
        S.nights[S.nights.indexOf(same)] = mergeNights(same, onto(same));
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
          ...onto(same),
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
            (tipsMode(p) ? ' (tips ' + money(Math.max(0, tipsFromTotal(same, p))) + ')' : '') +
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
