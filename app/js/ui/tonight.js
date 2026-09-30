// Tonight screen: one number in, estimated take-home out. Also exports the night form used by "edit night".
import {
  computeNight,
  periodTotals,
  periodIndex,
  shiftsPerPeriod,
  weeklyHours,
  payAmount,
  basePay,
  todayISO,
  num,
  round2,
  totalFromTips,
  tipsFromTotal,
  nightTotal,
  hasTips,
  payKind,
  jobsOf,
  otherPayOf,
  findPayPreset,
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
  hoursReadable,
  dateProblem,
  maxNightDate,
  MIN_NIGHT_DATE,
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
/** The business date "tonight" belongs to (the Late nights rule). */
const tonightOf = (S) => businessDate(new Date(), cutoffFromSettings(S && S.settings));

/** A pay type's display name: its own name, else its preset's, else a plain fallback. */
export function payName(t, i = 1) {
  if (t && t.name) return t.name;
  const pr = t && findPayPreset(t.k);
  if (pr && pr.k !== 'other' && pr.k !== 'otherjob') return pr.name;
  return i === 0 ? 'Main job' : t && payKind(t, i) === 'job' ? 'Other job' : 'Other pay';
}
const same = (a, b) => String(a) === String(b);
const typeById = (p, id) => (p.payTypes || []).find((t) => same(t.id, id));
const fmtHrs = (h) => String(Math.round(h * 100) / 100);

/** Drop the in-progress entry and the example view (e.g. after Erase everything or Restore). */
export function resetDraft() {
  draft = null;
  showExample = false;
}
/** The "Late nights" rule changed: re-date the in-progress entry, unless the user picked a date themselves. */
export function redateDraft(S) {
  if (draft && !draft.dateTouched) draft.date = tonightOf(S);
}

/**
 * An empty entry. d.total holds the typed text: tips in tips mode, tips + pay in total mode.
 * d.rows: the jobs worked tonight, in order (pay type ids); their hours/shifts live in d.pay like every other amount.
 * The first row is the main job with EMPTY hours: hours are typed every night (shift lengths vary), never pre-filled
 * or remembered. A per-shift main job starts at 1 shift. Other pay stays hidden until "+ Add other pay" (d.showOther).
 */
export function blankDraft(S) {
  const main = jobsOf(S.profile)[0];
  return {
    total: '',
    cash: '',
    pay: main && main.unit === 'shift' ? { [main.id]: '1' } : {},
    rows: main ? [main.id] : [],
    showOther: false,
    barback: true,
    date: tonightOf(S),
  };
}
/** Keep a draft in step with Setup (a job removed or turned into other pay since): rows hold current jobs only, never twice. */
export function syncDraft(d, p) {
  const jobs = jobsOf(p);
  const isJobId = (id) => jobs.some((t) => same(t.id, id));
  d.rows = (d.rows || []).filter((id, k, a) => isJobId(id) && a.findIndex((x) => same(x, id)) === k);
  if (!d.rows.length && jobs[0]) {
    d.rows = [jobs[0].id];
    if (jobs[0].unit === 'shift' && !hasHoursText(d.pay[jobs[0].id])) d.pay[jobs[0].id] = '1';
  }
  // a job that is not in a row is not part of tonight
  jobs.forEach((t) => {
    if (!d.rows.some((id) => same(id, t.id))) delete d.pay[t.id];
  });
  return d;
}
/** A saved night as an editable draft, in the current entry mode (tips mode shows the tips inside its total). */
export function draftFromNight(n, p) {
  const d = {
    total: tipsMode(p) ? String(Math.max(0, tipsFromTotal(n, p))) : String(nightTotal(n, p)),
    cash: n.cash == null ? '' : String(n.cash),
    pay: {},
    rows: [],
    showOther: false,
    barback: n.barback !== false,
    date: n.date,
  };
  p.payTypes.forEach((t, i) => {
    const a = payAmount(n, t, i);
    if (payKind(t, i) === 'job') {
      if (a > 0) {
        d.rows.push(t.id);
        d.pay[t.id] = String(a);
      }
    } else if (a) {
      d.pay[t.id] = String(a);
      d.showOther = true;
    }
  });
  const main = p.payTypes[0];
  if (!d.rows.length && main) {
    d.rows = [main.id];
    d.pay[main.id] = String(payAmount(n, main, 0));
  }
  return d;
}
/** The typed amounts as a clean pay map (hours "7:30" = 7.5). Negative or unreadable hours are left out (saving refuses them). */
function draftPay(d, p) {
  const pay = {};
  Object.keys(d.pay).forEach((k) => {
    if (d.pay[k] === '' || d.pay[k] == null) return;
    const t = p && typeById(p, k);
    if (t && t.unit !== 'amt') {
      if (!hoursReadable(d.pay[k])) return;
      const h = parseHoursInput(d.pay[k]);
      if (h < 0) return;
      pay[k] = String(Math.round(h * 10000) / 10000);
    } else pay[k] = clean(d.pay[k]);
  });
  // The main job always has an explicit amount (0 when blank), so the math never falls back to an old "usual" amount.
  const main = p && p.payTypes && p.payTypes[0];
  if (main && pay[main.id] === undefined) pay[main.id] = '0';
  return pay;
}
/** Cash check for a draft: in total mode the cash is measured against the tips part (total minus tonight's pay). */
function cashCheck(d, p, snap) {
  if (tipsMode(p)) return checkCash(d.total, d.cash, { tips: true });
  const pay = basePay({ pay: draftPay(d, p), ...(snap ? { snap } : {}) }, p).pay;
  return checkCash(d.total, d.cash, { basePay: pay });
}
/**
 * Draft (strings) -> night with cleaned values, for live math. total is always everything made (tips + hourly/per-shift
 * pay): in tips mode the typed tips are converted here, so the preview and the saved night use the same number, and
 * the tips are kept as `tips` too. snap: work out the pay with this locked night's rates (editing or replacing it).
 */
export function liveNight(d, id, p, { snap } = {}) {
  const pay = draftPay(d, p);
  // Cash that is negative or more than the tips is not used (the screen says why); it never blocks the night.
  const cash = cashCheck(d, p, snap).status === 'ok' ? clean(d.cash) : '';
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
      night.tips = round2(t);
      const tot = totalFromTips(t, snap ? { ...night, snap } : night, p);
      if (tot > 0) night.total = String(tot);
    }
  } else if (numOf(d.total) > 0) night.total = clean(d.total);
  return night;
}
/** Draft -> night to store (no snapshot; the caller keeps one). Freezes each pay type's amount (0 when not worked). */
export function storedNight(d, p, id, { snap } = {}) {
  const ln = liveNight(d, id, p, { snap });
  const pay = {};
  p.payTypes.forEach((t, i) => {
    pay[t.id] = payAmount(ln, t, i);
  });
  const out = {
    id,
    date: ln.date,
    total: tipsMode(p) ? num(ln.total) : numOf(d.total),
    cash: ln.cash === '' ? null : numOf(ln.cash),
    pay,
    barback: d.barback,
  };
  if (tipsMode(p) && hasTips(ln)) out.tips = ln.tips;
  return out;
}

/* ---------- checks shared by Tonight and the night editor ---------- */
/** Id of the first job row that is hourly with a rate and has no hours typed (0 is fine when typed), else null. */
export function missingHoursRow(p, d) {
  for (const id of d.rows || []) {
    const t = typeById(p, id);
    if (t && t.unit === 'hr' && num(t.rate) > 0 && !hasHoursText(d.pay[id])) return id;
  }
  return null;
}
/** Pay types with an amount box on screen right now: the job rows, then other pay once it is shown. */
function visibleTypes(p, d) {
  const rows = (d.rows || []).map((id) => typeById(p, id)).filter(Boolean);
  return d.showOther ? rows.concat(otherPayOf(p)) : rows;
}
/**
 * {msg, id}: a plain message about the hours/shifts typed (and the pay type it is about), or {msg: ''}.
 * Refused: unreadable text, negative numbers, more than 24 hours in one row, more than 24 hours in all.
 */
export function hoursProblem(p, d) {
  const types = visibleTypes(p, d);
  const many = types.length > 1;
  let total = 0;
  for (const t of types) {
    const v = d.pay[t.id];
    if (t.unit === 'amt' || !hasHoursText(v)) continue;
    const what = t.unit === 'hr' ? 'Hours' : 'Shifts';
    const forName = many ? ' for ' + payName(t, p.payTypes.indexOf(t)) : '';
    if (!hoursReadable(v)) return { msg: what + forName + ' should be a number, like 6 or 7:30.', id: t.id };
    const h = parseHoursInput(v);
    if (h < 0) return { msg: what + ' can’t be a negative number' + forName + '.', id: t.id };
    if (t.unit !== 'hr') continue;
    if (h > 24)
      return {
        msg:
          'That is more than 24 hours in one night. Check the hours' +
          forName +
          '. Use 7:30 or 7.5 for seven and a half hours.',
        id: t.id,
      };
    if (!(t.k === 'diff' || t.diff)) total += h; // differential hours are the same hours again
  }
  if (total > 24.0001)
    return {
      msg: 'Your hours add up to more than 24 in one night. Check the hours for each job.',
      id: (d.rows || [])[0],
    };
  return { msg: '' };
}
/**
 * Plain message when the typed amount can't be saved, else ''. when: 'tonight' | 'that night'.
 * Total mode needs a total above 0. Tips mode takes 0 tips (a slow night still has hourly pay), but not blank or negative.
 */
export function entryProblem(p, d, when = 'tonight') {
  if (!tipsMode(p)) return numOf(d.total) > 0 ? '' : 'Enter what you made ' + when + ' first.';
  const t = typedAmount(d.total);
  if (t == null) return 'Enter your tips first. Type 0 if you made none.';
  if (t < 0) return 'Tips can’t be a negative number.';
  return '';
}
/**
 * Everything that blocks saving, in the order the person meets it: {where: 'total'|'hours'|'date', msg, id?} or null.
 * today: the business date for tonight (dates may be at most one day after it).
 */
export function entryCheck(p, d, { when = 'tonight', today = todayISO() } = {}) {
  const m = entryProblem(p, d, when);
  if (m) return { where: 'total', msg: m };
  const miss = missingHoursRow(p, d);
  if (miss != null) return { where: 'hours', msg: 'Enter the hours you worked ' + when + '.', id: miss };
  const bad = hoursProblem(p, d);
  if (bad.msg) return { where: 'hours', msg: bad.msg, id: bad.id };
  if (tipsMode(p) && !(num(liveNight(d, 'check', p).total) > 0))
    return { where: 'total', msg: 'Enter your tips or your hours first.' };
  const dp = dateProblem(d.date, today);
  if (dp) return { where: 'date', msg: dp };
  return null;
}
/**
 * Combine an existing night with a new one on the same date: pay adds up by pay type (so job hours merge by job), cash
 * and totals add up. In tips mode the tips add up too, so the merged night keeps following the current rates.
 */
export function mergeNights(a, b, p) {
  const pay = { ...a.pay };
  Object.keys(b.pay).forEach((k) => {
    pay[k] = Math.round(((pay[k] || 0) + b.pay[k]) * 10000) / 10000;
  });
  const cash =
    a.cash == null && b.cash == null ? null : Math.round(((a.cash || 0) + (b.cash || 0)) * 100) / 100;
  // A locked night's added part was worked out with its own rates already (see onto in render), so its total is used as is.
  const tb = a.snap ? num(b.total) : nightTotal(b, p);
  const out = { ...a, total: round2(nightTotal(a, p) + tb), cash, pay };
  delete out.tips;
  const ta = tipsFromTotal(a, p);
  if (hasTips(b) && ta >= 0) {
    out.tips = round2(ta + b.tips);
    if (!a.snap) out.total = totalFromTips(out.tips, out, p);
  }
  return out;
}
/** "Prep 2 h · Bartender 6 h" for a saved night: the jobs worked, with the current Setup's names. */
export function jobsText(n, p) {
  return p.payTypes
    .map((t, i) => {
      if (payKind(t, i) !== 'job') return null;
      const a = payAmount(n, t, i);
      if (!(a > 0)) return null;
      return (
        payName(t, i) +
        ' ' +
        (t.unit === 'shift' ? fmtHrs(a) + (a === 1 ? ' shift' : ' shifts') : fmtHrs(a) + ' h')
      );
    })
    .filter(Boolean)
    .join(' · ');
}

/**
 * nightFields(p, d, {big, onInput, key, rateOf}) builds the entry fields bound to draft d.
 *   rateOf(t): the rate shown for pay type t (default its Setup rate; the editor passes a locked night's own rates).
 * Returns {root, totalInput, setTotalError, setHoursError, setDateError, refresh, focusPay(id)}.
 */
export function nightFields(
  p,
  d,
  { big = false, onInput: onInputRaw = () => {}, key = 'night', rateOf = (t) => num(t.rate) } = {},
) {
  syncDraft(d, p);
  let refresh = () => {};
  const onInput = () => {
    refresh();
    onInputRaw();
  };
  const to = p.tipout || {};
  const after = to.on && to.basis === 'after';
  const tips = tipsMode(p);
  const hintText = tips
    ? (after ? 'Cash tips + card tips, after paying the barback.' : 'Cash tips + card tips.') +
      ' TipNet adds the pay for the jobs below.'
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

  /* ----- jobs worked tonight ----- */
  const jobs = jobsOf(p);
  const jobsHost = el('div', { class: 'stack-sm' });
  const rateLines = []; // [{t, input, line}] for the rows on screen, refreshed as hours are typed
  const rateText = (t, v) => {
    const r = rateOf(t);
    if (!(r > 0)) return 'No rate in Setup for this job, so it adds no pay.';
    const unit = t.unit === 'shift' ? '/shift' : '/h';
    const h = hoursReadable(v) ? parseHoursInput(v) : null;
    return money(r) + unit + (h != null && h >= 0 ? ' → ' + money(round2(h * r)) : '');
  };
  let rootEl = null;
  const focusKey = (k) => {
    const n = (rootEl || document).querySelector('[data-focus-key="' + k + '"]');
    if (n) n.focus();
  };
  const drawJobs = () => {
    clear(jobsHost);
    rateLines.length = 0;
    d.rows.forEach((id, r) => {
      const t = typeById(p, id);
      if (!t) return;
      const sel = el('select', { id: uid('job'), 'data-focus-key': key + '-job-' + r });
      jobs.forEach((j) => {
        const taken = d.rows.some((x, k) => k !== r && same(x, j.id));
        const o = el('option', { value: String(j.id) }, payName(j, p.payTypes.indexOf(j)));
        if (taken) o.disabled = true;
        sel.append(o);
      });
      sel.value = String(t.id);
      sel.addEventListener('change', () => {
        const nt = typeById(p, sel.value);
        if (!nt || d.rows.some((x, k) => k !== r && same(x, nt.id))) {
          sel.value = String(t.id);
          return;
        }
        const was = d.pay[t.id] == null ? '' : d.pay[t.id];
        delete d.pay[t.id];
        d.rows[r] = nt.id;
        // Hours typed stay with the row when the unit is the same; a per-shift job starts at 1 shift.
        if (nt.unit === t.unit) d.pay[nt.id] = was;
        else d.pay[nt.id] = nt.unit === 'shift' ? '1' : '';
        drawJobs();
        onInput();
        focusKey(key + '-job-' + r);
      });
      const inp = bind(
        moneyInput({ placeholder: '0', 'data-focus-key': key + '-pay-' + t.id, id: uid('hrs') }),
        () => (d.pay[t.id] == null ? '' : d.pay[t.id]),
        (v) => {
          d.pay[t.id] = v;
        },
      );
      const line = el('p', { class: 'hint job-rate' }, rateText(t, d.pay[t.id]));
      rateLines.push({ t, input: inp, line });
      const cells = [
        field(r === 0 ? 'Job' : 'Job ' + (r + 1), sel),
        field(t.unit === 'shift' ? 'Shifts' : 'Hours', inp),
      ];
      let rm = null;
      if (r > 0) {
        rm = el(
          'button',
          {
            type: 'button',
            class: 'btn btn-secondary btn-small',
            'aria-label': 'Remove ' + payName(t, p.payTypes.indexOf(t)),
            'data-focus-key': key + '-rm-' + r,
          },
          'Remove',
        );
        rm.addEventListener('click', () => {
          d.rows.splice(r, 1);
          delete d.pay[t.id];
          drawJobs();
          onInput();
          focusKey(key + '-add-job');
          if (!document.activeElement || document.activeElement === document.body)
            focusKey(key + '-job-' + (r - 1));
        });
      }
      jobsHost.append(
        el(
          'div',
          { class: 'job-row', role: 'group', 'aria-label': 'Job ' + (r + 1) },
          el('div', { class: 'grid-2' }, cells),
          el('div', { class: 'spread' }, line, rm),
        ),
      );
    });
    if (jobs.length > d.rows.length) {
      const add = el(
        'button',
        { type: 'button', class: 'btn btn-secondary btn-small', 'data-focus-key': key + '-add-job' },
        '+ Add another job',
      );
      add.addEventListener('click', () => {
        const next = jobs.find((j) => !d.rows.some((x) => same(x, j.id)));
        if (!next) return;
        d.rows.push(next.id);
        d.pay[next.id] = next.unit === 'shift' ? '1' : '';
        drawJobs();
        onInput();
        focusKey(key + '-pay-' + next.id);
      });
      jobsHost.append(el('div', null, add));
    }
  };
  drawJobs();
  kids.push(
    el(
      'fieldset',
      { class: 'field jobs' },
      el('legend', null, big ? 'What did you work tonight?' : 'What did you work?'),
      jobsHost,
    ),
  );

  /* ----- other pay (overtime, holiday, bonus...), hidden until asked for ----- */
  const others = otherPayOf(p);
  const otherHost = el('div');
  const drawOther = () => {
    clear(otherHost);
    if (!others.length) return;
    if (!d.showOther) {
      const btn = el(
        'button',
        { type: 'button', class: 'btn-link', 'data-focus-key': key + '-add-other' },
        '+ Add other pay',
      );
      btn.addEventListener('click', () => {
        d.showOther = true;
        drawOther();
        onInput();
        focusKey(key + '-pay-' + others[0].id);
      });
      otherHost.append(
        el(
          'div',
          null,
          btn,
          el(
            'p',
            { class: 'hint' },
            'Overtime, holiday hours, a bonus and the like, only when you have them.',
          ),
        ),
      );
      return;
    }
    const inputs = others.map((t) => {
      const name = payName(t, p.payTypes.indexOf(t));
      const label =
        t.unit === 'amt'
          ? [name + ' $ ', el('span', { class: 'hint' }, '(on top)')]
          : name + (t.unit === 'hr' ? ' hours' : ' shifts');
      const inp = bind(
        moneyInput({ placeholder: '0', 'data-focus-key': key + '-pay-' + t.id }),
        () => (d.pay[t.id] == null ? '' : d.pay[t.id]),
        (v) => {
          d.pay[t.id] = v;
        },
      );
      const r = rateOf(t);
      return field(label, inp, {
        optional: true,
        hint: t.unit !== 'amt' && r ? money(r) + (t.unit === 'hr' ? '/h' : '/shift') : undefined,
      });
    });
    otherHost.append(
      el(
        'fieldset',
        { class: 'field' },
        el('legend', null, 'Other pay tonight'),
        el('div', { class: 'grid-2' }, inputs),
      ),
    );
  };
  drawOther();
  kids.push(otherHost);
  const hoursErr = el('p', { class: 'field-error', hidden: true, role: 'alert' });
  const setHoursError = (m) => {
    hoursErr.hidden = !m;
    hoursErr.textContent = m || '';
  };
  kids.push(hoursErr);

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
  kids.push(cashField);
  const today = tonightOf(getState());
  const date = el('input', {
    type: 'date',
    value: d.date,
    min: MIN_NIGHT_DATE,
    max: maxNightDate(today),
    'data-focus-key': key + '-date',
  });
  date.addEventListener('input', () => {
    d.date = date.value || todayISO();
    d.dateTouched = true;
    onInput();
  });
  const dateField = field('Date', date);
  kids.push(dateField);
  refresh = () => {
    cashField.setError(cashCheck(d, p).message);
    rateLines.forEach(({ t, line }) => {
      line.textContent = rateText(t, d.pay[t.id]);
    });
    setHoursError(hoursProblem(p, d).msg);
    dateField.setError(dateProblem(d.date, today));
  };
  refresh();
  rootEl = el('div', { class: 'stack' }, kids);
  return {
    root: rootEl,
    totalInput,
    setTotalError,
    setHoursError,
    setDateError: (m) => dateField.setError(m),
    refresh,
    focusPay: (id) => focusKey(key + '-pay-' + id),
    focusDate: () => date.focus(),
  };
}

/** Show an entryCheck problem on the fields and move focus to it. */
export function showEntryProblem(f, prob) {
  if (prob.where === 'total') {
    f.setTotalError(prob.msg);
    f.totalInput.focus();
  } else if (prob.where === 'hours') {
    f.setHoursError(prob.msg);
    if (prob.id != null) f.focusPay(prob.id);
  } else {
    f.setDateError(prob.msg);
    f.focusDate();
  }
}

function bullet(dt, dd, cls) {
  return el('div', cls ? { class: cls } : null, el('dt', null, dt), el('dd', { class: 'num' }, dd));
}

/**
 * Result card body. c = computeNight result.
 * hoursMissing: a job row still needs its hours. Tips mode then shows no numbers (they would leave the pay out);
 * total mode labels the base pay instead.
 */
export function resultCard(c, S, note, hoursMissing = false) {
  if (!c.total || (hoursMissing && tipsMode(S.profile)))
    return el(
      'div',
      { class: 'result' },
      el(
        'p',
        { class: 'note' },
        c.total
          ? 'Add tonight’s hours to see your take-home.'
          : tipsMode(S.profile)
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
    bullet('  of which base pay' + (hoursMissing ? ' (hours not entered yet)' : ''), money(c.basePay)),
    bullet('  of which tips', money(c.tips)),
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
  // Not "your next check": with a payday delay the next check can belong to the previous pay period.
  const cap = t.ns.length
    ? t.allCash
      ? 'Estimated check for this pay period: ' + money(t.chk) + '.'
      : 'Add cash amounts to every night to preview this pay period’s check.'
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
        bullet('Bartender hours at $12', '8'),
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
    if (showExample) root.append(el('div', { class: 'stack' }, el('h1', null, 'Tonight'), exampleView(S)));
    else
      root.append(
        el(
          'div',
          { class: 'stack' },
          el('h1', null, 'Tonight'),
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
        ),
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
  const dupHost = el('div');

  const update = () => {
    const hist = historyOf(S);
    const shifts = shiftsPerPeriod(p, hist).n;
    const night = liveNight(d, 'draft', p);
    const c = computeNight(night, p, shifts);
    const hoursMissing = missingHoursRow(p, d) != null;
    let ot = null;
    const others = hist.filter((n) => n.id !== 'draft');
    const wk = weeklyHours(p, others.concat([night]), night.date);
    if (wk.over && c.hours > 0) {
      ot = el(
        'p',
        { class: 'note' },
        'You have logged about ' +
          Math.round(wk.hours * 10) / 10 +
          ' hours this week (Monday to Sunday). If some were overtime, add Overtime under Other pay in Setup and log those hours with “+ Add other pay”. TipNet does not work out overtime pay for you.',
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
    clear(resultHost).append(
      resultCard(c, S, low && ot ? el('div', { class: 'stack-sm' }, low, ot) : low || ot, hoursMissing),
    );
    lastSummary = c.total && !(tipsMode(p) && hoursMissing) ? 'Estimated take-home ' + money(c.net) : '';
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
    const prob = entryCheck(p, d, { today: tonightOf(S) });
    if (prob) return showEntryProblem(fields, prob);
    const cashWas = cashCheck(d, p).status;
    const night = storedNight(d, p, Date.now());
    // Same inputs as the preview: shift history before this night, never the example nights.
    const net = computeNight(night, p, shiftsPerPeriod(p, historyOf(S)).n).net;
    const dup = S.nightsExample ? null : S.nights.find((n) => n.date === night.date);
    if (!dup) return finish(night, net, cashWas, () => S.nights.push(night));
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
        S.nights[S.nights.indexOf(dup)] = mergeNights(dup, onto(dup), p);
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
        S.nights[S.nights.indexOf(dup)] = {
          ...onto(dup),
          id: dup.id,
          ...(dup.snap ? { snap: dup.snap } : {}),
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
    const worked = jobsText(dup, p);
    clear(dupHost).append(
      el(
        'div',
        { class: 'note stack-sm', role: 'group', 'aria-label': 'Night already saved for this date' },
        el(
          'p',
          null,
          'You already saved ' +
            money(nightTotal(dup, p)) +
            (tipsMode(p) ? ' (tips ' + money(Math.max(0, tipsFromTotal(dup, p))) + ')' : '') +
            (worked ? ', ' + worked + ',' : '') +
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
      el('h1', null, 'Tonight'),
      banner,
      stripCard(S),
      form,
      liveSummary,
      el('h2', { class: 'sr-only' }, 'Your estimate for tonight'),
      resultHost,
    ),
  );
  update();
}
