// Setup screen. First-time users get a 3-step guided flow; returning users get the full editable page.
// Every change autosaves (debounced) and ends example mode for the profile.
import {
  num,
  summary,
  lengthFromDates,
  calendarMode,
  dayDiff,
  parseISO,
  addDays,
  periodRange,
  shiftsPerPeriod,
  exampleProfile,
  JOB_PRESETS,
  OTHER_PAY_PRESETS,
  payKind,
  DEDUCTION_PRESETS,
  findPayPreset,
  findDeductionPreset,
  applyPayPreset,
  applyDeductionPreset,
  fillFica,
} from '../math.js';
import {
  el,
  clear,
  field,
  moneyInput,
  select,
  numOf,
  money,
  pct,
  exampleBanner,
  toast,
  save,
  bus,
  getState,
  applyTheme,
  restoreRequest,
  arm,
  workplaceSwitcher,
} from './common.js';
import { cutoffFromSettings } from '../inputs.js';
import {
  isSetUp,
  isWorkplaceSetUp,
  activeWorkplace,
  findWorkplace,
  isFirstWorkplace,
  nightsOf,
  newWorkplaceId,
  MAX_WORKPLACES,
} from '../storage.js';
import { renderImporter } from './importer.js';
import { renderBackup, renderInstall } from './backup.js';
import { redateDraft, dropDraft } from './tonight.js';

let guidedStep = 0;
// The restaurant the guided flow is running for (null = none). It stays set once the flow starts, even after the first
// edit ends example mode, until Finish or Skip.
let guidedFor = null;
// While the first restaurant's profile is still the example paystub, the guided steps work on a blank copy (gProfile) so
// nothing of the example ever becomes the user's profile by accident. The real profile is replaced only when Finish passes.
let gProfile = null;
let noDeductions = false; // "My paystub has no deductions" ticked (on the blank copy)
let adding = null; // "+ Set up another restaurant" is open: {name, error}
export function reset() {
  guidedStep = 0;
  guidedFor = null;
  gProfile = null;
  noDeductions = false;
  adding = null;
  restoreRequest.open = false;
}
/**
 * The guided flow is kept in the saved state (settings.guidedDraft = {workplaceId, step, noDeductions, profile?}), so a
 * reload in the middle of setup comes back to the same restaurant and step with what was typed. profile is the blank copy
 * being filled in (only while the first restaurant is still the example). Cleared by Finish and Skip.
 */
function keepGuided(S) {
  if (!guidedFor) return;
  const g = { workplaceId: guidedFor, step: guidedStep };
  if (noDeductions) g.noDeductions = true;
  if (gProfile) g.profile = gProfile;
  S.settings.guidedDraft = g;
  save();
}
/** After a reload: pick the guided flow up where it was. */
function resumeGuided(S) {
  const g = S.settings && S.settings.guidedDraft;
  if (guidedFor || gProfile || !g || typeof g !== 'object') return;
  const w = findWorkplace(S, g.workplaceId);
  if (!w || isWorkplaceSetUp(S, w) || w.guideSkipped) return;
  guidedFor = w.id;
  guidedStep = [0, 1, 2].includes(g.step) ? g.step : 0;
  noDeductions = g.noDeductions === true;
  const gp = g.profile;
  if (
    S.profileExample &&
    isFirstWorkplace(S, w) &&
    gp &&
    typeof gp === 'object' &&
    Array.isArray(gp.payTypes) &&
    gp.payTypes.length &&
    Array.isArray(gp.deductions) &&
    gp.tipout &&
    typeof gp.tipout === 'object'
  )
    gProfile = gp;
}

function blankProfile() {
  const b = exampleProfile();
  b.periodStart = '';
  b.periodEnd = '';
  b.shifts = 0;
  b.gross = 0;
  b.deductions.forEach((d) => {
    d.amount = 0;
  });
  // Just the main job to start; "+ Add a job" adds the others.
  b.payTypes = b.payTypes.slice(0, 1);
  b.payTypes.forEach((t) => {
    t.rate = 0;
    t.usual = 0;
  });
  b.tipout.on = false;
  b.tipout.value = 0;
  b.entryMode = 'tips'; // new users type their tips; TipNet adds the hourly pay
  return b;
}
const eg = (n) => 'e.g. ' + Number(n).toLocaleString('en-US');

/** That restaurant's real nights: example nights are not history, so shift averages ignore them until the first real night. */
const historyOf = (S, w) => (S.nightsExample ? [] : nightsOf(S, w.id));
/** After a row is removed its button is gone: keep keyboard focus on the row that took its place, or on the Add button. */
function focusNear(host, at, addId) {
  const rows = host.querySelectorAll('button[aria-label^="Remove"]');
  const t = rows[Math.min(at, rows.length - 1)] || document.getElementById(addId);
  if (t) t.focus();
}

/** Grouped <select> for presets. A key not in the list shows as `fallback`. */
function presetSelect(presets, current, id, fallback = 'other') {
  const s = el('select', { id });
  const groups = [];
  presets.forEach((pr) => {
    let g = groups.find((x) => x.name === pr.g);
    if (!g) {
      g = { name: pr.g, items: [] };
      groups.push(g);
    }
    g.items.push(pr);
  });
  groups.forEach((g) =>
    s.append(
      el(
        'optgroup',
        { label: g.name },
        g.items.map((pr) => el('option', { value: pr.k }, pr.name)),
      ),
    ),
  );
  s.value = current;
  if (s.value !== current) s.value = fallback;
  return s;
}

/* ============ context shared by the cards on one render ============ */
let saveSeq = 0; // the newest edit's save decides the "All changes saved" line
/** w: the restaurant being set up. blank: the guided steps fill in gProfile (the first restaurant, still the example). */
function makeCtx(w, blank = false, guidedNow = blank) {
  const S = getState();
  if (blank && !gProfile) gProfile = blankProfile();
  const live = [];
  const saved = el('p', { class: 'hint', role: 'status', 'aria-live': 'polite' });
  const ctx = {
    S,
    w,
    p: blank ? gProfile : w.profile,
    blank,
    ph: blank || guidedNow ? exampleProfile() : null, // example numbers as placeholders while setting up
    live,
    saved,
    /** Required-field errors wait until the field was left (blur) or Next/Finish was pressed. */
    seen: new Set(),
    showAll: false,
    gate(f, msg) {
      f.setError(ctx.showAll || ctx.seen.has(f) ? msg : '');
    },
    /** Call after any profile edit. resetRate: the tax rate from paystub changed, so drop the calibration adjustment. */
    touch(resetRate) {
      if (blank) {
        live.forEach((f) => f());
        keepGuided(S); // guided on the example: only the draft is saved until Finish
        return;
      }
      S.profileExample = false;
      if (resetRate) w.profile.rateOverride = null;
      saved.textContent = 'Saving…';
      // "All changes saved" only after the write really worked (a full or blocked storage says so instead)
      const n = ++saveSeq;
      save().then((ok) => {
        if (n === saveSeq)
          saved.textContent = ok
            ? 'All changes saved on this device.'
            : 'Couldn’t save on this device. Your changes are kept while TipNet is open.';
      });
      live.forEach((f) => f());
    },
  };
  return ctx;
}

/* ============ 1. pay period + gross ============ */
const ord = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
/** Dropdown label for the calendar "twice a month" option, using the real anchors from the start date. */
function semiLabel(startISO) {
  const A = Number.isFinite(parseISO(startISO)) ? +startISO.slice(8, 10) : 1;
  const B = A <= 15 ? A + 15 : A - 15;
  const [lo, hi] = A <= B ? [A, B] : [B, A];
  const to = (y) => (y === 1 ? 'end' : ord(y - 1));
  return 'Twice a month (' + ord(lo) + '–' + to(hi) + ' and ' + ord(hi) + '–' + to(lo) + ')';
}
function periodCard(ctx, { title = 'Pay period and gross pay' } = {}) {
  const { p, ph } = ctx;
  const exampleEnd =
    ctx.S.profileExample && !ctx.blank && isFirstWorkplace(ctx.S, ctx.w) ? p.periodEnd : null; // the example's end date, until the user changes it
  const start = el('input', { type: 'date', value: p.periodStart || '' });
  const end = el('input', { type: 'date', value: p.periodEnd || '' });
  const shifts = el('input', {
    type: 'text',
    inputmode: 'numeric',
    autocomplete: 'off',
    placeholder: ph ? eg(ph.shifts) : '—',
    value: p.shifts ? String(p.shifts) : '',
  });
  const freq = select(
    [
      [7, 'Every week'],
      [14, 'Every two weeks'],
      ['semimonthly', semiLabel(p.periodStart)],
      [15, 'Every 15 days'],
      ['monthly', 'Once a month (same day each month)'],
      [30, 'Every 30 days'],
    ],
    p.freq,
  );
  const refreshSemiLabel = () => {
    freq.querySelector('option[value="semimonthly"]').textContent = semiLabel(p.periodStart);
  };
  const gross = moneyInput({ value: p.gross ? String(p.gross) : '', placeholder: ph ? eg(ph.gross) : null });
  // payDelay (days after the period end) is what is stored; the field shows and edits it as a date.
  const periodEndOf = () => (p.periodStart ? periodRange(p, 0).end : '');
  const paydayValue = () =>
    p.payDelay === undefined || p.payDelay === null || !p.periodStart
      ? ''
      : addDays(periodEndOf(), p.payDelay);
  const delay = el('input', { type: 'date', value: paydayValue() });
  const fStart = field('Pay period started', start);
  const fEnd = field('Pay period ended', end, { optional: true });
  const fShifts = field('Shifts you worked', shifts, { optional: true });
  const fFreq = field('You get paid', freq);
  const fDelay = field('Payday for this pay period', delay, {
    optional: true,
    hint: 'The pay date printed on your paystub for these dates. Leave blank if you’re not sure.',
  });
  const freqNote = el('p', { class: 'hint', hidden: true });
  fFreq.append(freqNote);
  const fGross = field('Gross pay', gross, {
    hint: 'The top-line gross pay figure, before any deductions. Not “taxable wages.”',
  });

  const validate = () => {
    ctx.gate(fStart, Number.isFinite(parseISO(start.value)) ? '' : 'Pick the day your pay period started.');
    let e = '';
    if (end.value && start.value) {
      const len = dayDiff(start.value, end.value) + 1;
      if (!(len >= 1)) e = 'The end date has to be on or after the start date.';
      else if (len > 62) e = 'Pay periods are 62 days or shorter. Check the end date.';
    }
    fEnd.setError(e);
    let de = '';
    if (delay.value && p.periodStart) {
      const d = dayDiff(periodEndOf(), delay.value);
      if (!(d >= 0)) de = 'Payday can’t be before the pay period ends.';
      else if (d > 21) de = 'Payday is more than 21 days after the pay period ends. Check the date.';
    }
    fDelay.setError(de);
    fShifts.setError(numOf(shifts.value) < 0 ? 'Shifts can’t be negative.' : '');
    ctx.gate(fGross, numOf(gross.value) > 0 ? '' : 'Gross pay is needed to work out your tax rate.');
    // The end date sets the period length when present; say so if it doesn't match the schedule picked.
    const len = lengthFromDates(p) ? dayDiff(p.periodStart, p.periodEnd) + 1 : 0;
    const cal = calendarMode(p);
    freqNote.hidden = cal ? false : !len || len === num(p.freq);
    freqNote.textContent = cal
      ? cal === 'semimonthly'
        ? 'Twice a month follows the calendar, so the end date is set for you.'
        : 'Once a month follows the calendar, so the end date is set for you.'
      : len
        ? 'Your dates make the pay period ' + len + ' days long, so TipNet uses that.'
        : '';
  };
  ctx.live.push(validate);
  start.addEventListener('input', () => {
    if (Number.isFinite(parseISO(start.value))) p.periodStart = start.value;
    if (exampleEnd && p.periodEnd === exampleEnd) {
      p.periodEnd = '';
      end.value = '';
    }
    refreshSemiLabel();
    if (calendarMode(p) && p.periodEnd) {
      p.periodEnd = periodRange(p, 0).end;
      end.value = p.periodEnd;
    }
    delay.value = paydayValue();
    ctx.touch(false);
  });
  end.addEventListener('input', () => {
    p.periodEnd = Number.isFinite(parseISO(end.value)) ? end.value : '';
    delay.value = paydayValue();
    ctx.touch(false);
  });
  // Twice a month / once a month follow the calendar: when the user finishes editing, snap the end date to the derived one.
  end.addEventListener('change', () => {
    if (calendarMode(p) && end.value) {
      p.periodEnd = periodRange(p, 0).end;
      end.value = p.periodEnd;
      delay.value = paydayValue();
      ctx.touch(false);
    }
  });
  shifts.addEventListener('input', () => {
    p.shifts = Math.max(0, Math.round(numOf(shifts.value)));
    ctx.touch(false);
  });
  freq.addEventListener('change', () => {
    p.freq = /^[0-9]+$/.test(freq.value) ? Number(freq.value) : freq.value; // 7/14/15/30 fixed days, or 'semimonthly'/'monthly'
    // Keep the end date in step with the schedule so the choice takes effect.
    if (calendarMode(p)) {
      p.periodEnd = periodRange(p, 0).end;
      end.value = p.periodEnd;
    } // calendar halves/months win
    else if (p.periodStart && p.periodEnd) {
      p.periodEnd = addDays(p.periodStart, p.freq - 1);
      end.value = p.periodEnd;
    }
    delay.value = paydayValue();
    ctx.touch(false);
  });
  delay.addEventListener('input', () => {
    if (!delay.value) delete p.payDelay;
    else if (p.periodStart) {
      const d = dayDiff(periodEndOf(), delay.value);
      if (d >= 0 && d <= 21) p.payDelay = d; // out of range: shown as an error, not saved
    }
    ctx.touch(false);
  });
  gross.addEventListener('input', () => {
    p.gross = numOf(gross.value);
    ctx.touch(true);
  });
  [
    [start, fStart],
    [gross, fGross],
  ].forEach(([i, f]) =>
    i.addEventListener('blur', () => {
      ctx.seen.add(f);
      validate();
    }),
  );
  validate();
  const card = el(
    'section',
    { class: 'card stack' },
    el('h2', null, title),
    el(
      'p',
      { class: 'note' },
      'Use one recent paystub. Enter the numbers for that pay period, not year-to-date. Your numbers stay on this device.',
    ),
    el('div', { class: 'grid-2' }, fStart, fEnd),
    el('div', { class: 'grid-2' }, fShifts, fFreq),
    el(
      'p',
      { class: 'hint' },
      'Fill in the end date, the shift count, or both. The end date keeps each night on the right paycheck. The shift count splits your fixed deductions evenly per shift. Both together give the closest estimate. Picking how often you get paid moves the end date to match.',
    ),
    fDelay,
    fGross,
  );
  card.validate = () => {
    ctx.showAll = true;
    validate();
    return !!(
      Number.isFinite(parseISO(start.value)) &&
      numOf(gross.value) > 0 &&
      !fEnd.hasAttribute('data-invalid')
    );
  };
  card.firstInvalid = () =>
    [start, end, shifts, gross].find((i) => i.getAttribute('aria-invalid') === 'true');
  return card;
}

/* ============ 2. deductions ============ */
function dedCard(ctx) {
  const { p, S, ph, w } = ctx;
  const rowsHost = el('div', { class: 'stack' });
  const summaryBox = el('div', { class: 'note', 'aria-live': 'polite' });
  const ficaErr = el('p', { class: 'field-error', hidden: true, role: 'alert' });

  const lineText = (d) => {
    if (d.mode === 'pct')
      return p.gross > 0
        ? ((num(d.amount) / p.gross) * 100).toFixed(2) + '% of every dollar you make'
        : 'Enter gross pay to see the rate';
    return money(num(d.amount) / shiftsPerPeriod(p, historyOf(S, w)).n) + ' per shift';
  };
  const drawSummary = () => {
    const s = summary(p, historyOf(S, w));
    clear(summaryBox).append(
      'Out of every ',
      el('b', null, '$100'),
      ' you make, about ',
      el('b', null, money(s.taxPer100)),
      ' goes to taxes and other deductions that grow with your pay, and you keep ',
      el('b', null, money(s.keepPer100)),
      '. ',
      'Deductions that stay the same total ',
      el('b', null, money(s.fixed)),
      ' a check, or ',
      el('b', null, money(s.fixedPerShift)),
      ' per shift, based on ',
      s.shiftSourceText,
      s.shiftSource === 'entered' ? '' : ' (' + s.shifts.toFixed(1).replace(/\.0$/, '') + ' shifts)',
      '. ',
      'Pay periods run ',
      el(
        'b',
        null,
        s.calendar === 'semimonthly'
          ? semiLabel(p.periodStart).replace('Twice a month (', 'twice a month (the ')
          : s.calendar === 'monthly'
            ? 'once a month, on the calendar'
            : s.periodLength + ' days',
      ),
      s.fromDates ? ' from your dates' : '',
      '.',
      s.adjusted
        ? el(
            'span',
            { class: 'hint' },
            ' Your tax rate is adjusted from your real paychecks (' + pct(s.r) + ').',
          )
        : '',
    );
  };
  const lines = new Map();
  const drawLines = () =>
    p.deductions.forEach((d) => {
      const n = lines.get(d.id);
      if (n) n.textContent = lineText(d);
    });
  ctx.live.push(drawSummary, drawLines, () => {
    if (num(p.gross) > 0) ficaErr.hidden = true;
  }); // clear the "enter gross first" note once gross is entered

  const drawRows = () => {
    clear(rowsHost);
    lines.clear();
    if (!p.deductions.length)
      rowsHost.append(el('p', { class: 'hint' }, 'No deductions yet. Add one for each line on your stub.'));
    p.deductions.forEach((d) => {
      const preset = findDeductionPreset(d.k);
      const sel = presetSelect(DEDUCTION_PRESETS, d.k, 'dk-' + d.id);
      const amt = moneyInput({
        value: d.amount ? String(d.amount) : '',
        placeholder:
          ph && ph.deductions.find((x) => x.id === d.id)
            ? eg(ph.deductions.find((x) => x.id === d.id).amount)
            : '0.00',
      });
      const mode = select(
        [
          ['pct', 'Changes with my pay'],
          ['fixed', 'Same every check'],
        ],
        d.mode,
        { id: 'dm-' + d.id },
      );
      const line = el('p', { class: 'hint', style: 'grid-column:1/-1;margin:0' });
      lines.set(d.id, line);
      line.textContent = lineText(d);
      const kids = [
        el(
          'div',
          { class: 'field', style: 'grid-column:1/-1' },
          el('label', { for: sel.id }, 'Deduction'),
          sel,
        ),
      ];
      if (d.k === 'other' || !preset) {
        const nm = el('input', {
          type: 'text',
          value: d.name === 'Other' ? '' : d.name,
          placeholder: 'e.g. Tool fee',
          autocomplete: 'off',
          id: 'dn-' + d.id,
        });
        nm.addEventListener('input', () => {
          d.name = nm.value || 'Other';
          ctx.touch(false);
        });
        kids.push(el('div', { style: 'grid-column:1/-1' }, field('Name on stub', nm)));
      }
      amt.id = 'da-' + d.id;
      const fAmt = field('Amount this check ($)', amt);
      kids.push(el('div', { class: 'grid-2', style: 'grid-column:1/-1' }, fAmt, field('This amount', mode)));
      kids.push(line);
      if (preset && preset.notes)
        kids.push(el('p', { class: 'hint', style: 'grid-column:1/-1;margin:0' }, preset.notes));
      const rm = el(
        'button',
        { type: 'button', class: 'btn btn-secondary btn-small', 'aria-label': 'Remove ' + d.name },
        'Remove',
      );
      kids.push(el('div', { style: 'grid-column:1/-1' }, rm));
      sel.addEventListener('change', () => {
        const i = p.deductions.indexOf(d);
        p.deductions[i] = applyDeductionPreset(d, sel.value);
        ctx.touch(true);
        drawRows();
        const f = document.getElementById('dk-' + d.id);
        if (f) f.focus();
      });
      amt.addEventListener('input', () => {
        d.amount = numOf(amt.value);
        fAmt.setError(d.amount < 0 ? 'Amounts on a stub are positive numbers.' : '');
        ctx.touch(true);
      });
      mode.addEventListener('change', () => {
        d.mode = mode.value;
        ctx.touch(true);
      });
      rm.addEventListener('click', () => {
        const at = p.deductions.indexOf(d);
        p.deductions = p.deductions.filter((x) => x !== d);
        ctx.touch(true);
        drawRows();
        focusNear(rowsHost, at, 'dk-add');
        toast('Removed ' + d.name + '.', {
          undo: () => {
            if (p.deductions.includes(d)) return;
            p.deductions.splice(Math.min(at, p.deductions.length), 0, d);
            ctx.touch(true);
            drawRows();
            focusNear(rowsHost, at, 'dk-add');
          },
        });
      });
      rowsHost.append(el('div', { class: 'repeat-row', style: 'grid-template-columns:minmax(0,1fr)' }, kids));
    });
  };
  drawRows();
  drawSummary();

  const add = el(
    'button',
    { type: 'button', class: 'btn btn-secondary btn-small', id: 'dk-add' },
    '+ Add deduction',
  );
  add.addEventListener('click', () => {
    const used = p.deductions.map((d) => d.k);
    const pr =
      DEDUCTION_PRESETS.find((x) => !used.includes(x.k)) || DEDUCTION_PRESETS[DEDUCTION_PRESETS.length - 1];
    const id = 'd' + Date.now();
    p.deductions.push({ id, k: pr.k, name: pr.name, amount: 0, mode: pr.mode });
    ctx.touch(true);
    drawRows();
    const f = document.getElementById('dk-' + id);
    if (f) f.focus();
  });
  const fica = el(
    'button',
    { type: 'button', class: 'btn btn-secondary btn-small' },
    'Fill Social Security + Medicare from gross',
  );
  fica.addEventListener('click', () => {
    if (!(num(p.gross) > 0)) {
      ficaErr.hidden = false;
      ficaErr.textContent = 'Enter your gross pay first, then tap this again.';
      return;
    }
    ficaErr.hidden = true;
    p.deductions = fillFica(p);
    ctx.touch(true);
    drawRows();
    toast('Social Security and Medicare filled in.');
  });
  // Guided setup on the example: the user must type an amount, or say the stub has none.
  const noDed = el('input', { type: 'checkbox', id: 'no-ded' });
  noDed.checked = ctx.blank ? noDeductions : !!w.noDeductions;
  const dedErr = el('p', { class: 'field-error', hidden: true, role: 'alert' });
  noDed.addEventListener('change', () => {
    if (ctx.blank) {
      noDeductions = noDed.checked;
      keepGuided(S);
    } else {
      if (noDed.checked) w.noDeductions = true;
      else delete w.noDeductions;
      ctx.touch(false);
    }
    if (noDed.checked) dedErr.hidden = true;
  });
  // The full page offers it too while no deduction has an amount (the "Skip guided setup" path needs it to finish).
  const showNoDed = ctx.blank || !!w.noDeductions || !p.deductions.some((d) => num(d.amount) > 0);
  const card = el(
    'section',
    { class: 'card stack' },
    el('h2', null, 'Deductions'),
    el(
      'p',
      { class: 'note' },
      'Add a row for each line in the deductions part of your stub, using the dollar amount for that pay period. Pick whether it changes with your pay, like taxes, or stays the same every check, like health insurance.',
    ),
    rowsHost,
    el('div', { class: 'cluster' }, add, fica),
    ficaErr,
    showNoDed
      ? el(
          'label',
          { class: 'check', for: 'no-ded' },
          noDed,
          el('span', null, 'My paystub has no deductions'),
        )
      : null,
    ctx.blank ? dedErr : null,
    summaryBox,
  );
  card.validate = () => {
    if (!ctx.blank) return true;
    const ok = noDed.checked || p.deductions.some((d) => num(d.amount) > 0);
    dedErr.hidden = ok;
    dedErr.textContent = ok
      ? ''
      : 'Type the dollar amount for at least one line on your stub, or tick “My paystub has no deductions.”';
    return ok;
  };
  card.firstInvalid = () => (dedErr.hidden ? null : rowsHost.querySelector('input[id^="da-"]') || noDed);
  return card;
}

/* ============ 3. pay types ============ */
/**
 * "The number I type each night is:" tips only (TipNet adds the hourly/per-shift pay) or everything. It only changes how
 * Tonight and the night editor read the typed number; saved nights always store everything made, so they stay the same.
 */
function entryModeField(ctx) {
  const { p } = ctx;
  const cur = p.entryMode === 'total' ? 'total' : 'tips';
  const opt = (v, text) => {
    const r = el('input', { type: 'radio', name: 'entry-mode', value: v, id: 'em-' + v });
    r.checked = cur === v;
    r.addEventListener('change', () => {
      if (!r.checked) return;
      p.entryMode = v;
      ctx.touch(false);
    });
    return el('label', { class: 'check', for: r.id }, r, el('span', null, text));
  };
  return el(
    'fieldset',
    { class: 'field' },
    el('legend', null, 'The number I type each night is:'),
    el(
      'div',
      { class: 'stack-sm' },
      opt('tips', 'Just my tips (cash + card). TipNet adds my hourly pay.'),
      opt('total', 'Everything: tips plus my hourly pay'),
    ),
    el('p', { class: 'hint' }, 'Nights you already saved stay the same.'),
  );
}

/** Job presets whose row needs its own name (a general or "other" kind has no telling name of its own). */
const NAMED_JOB_KEYS = ['otherjob', 'other', 'hourly', 'shift'];

/**
 * "Your jobs and pay": one row per job (preset, name when needed, rate, per hour/per shift). The first job is the main
 * job (preselected on Tonight, can't be removed). Below, "Other pay" keeps the extra kinds: overtime, holiday,
 * differential, PTO (per hour) and flat amounts on top. Rows are sorted by payKind(), so nothing is stored to say which
 * is which, and old profiles show up where they belong.
 */
function payCard(ctx) {
  const { p, ph } = ctx;
  const phOf = (t) => (ph ? ph.payTypes.find((x) => x.id === t.id) : null);
  const rateFields = [];
  const jobsHost = el('div', { class: 'stack' });
  const otherHost = el('div', { class: 'stack' });
  const mainRate = () => num(p.payTypes[0] && p.payTypes[0].rate);
  const refocus = (id) => {
    const f = document.getElementById(id);
    if (f) f.focus();
  };

  const removeButton = (t, i, host, addId, what) => {
    const rm = el(
      'button',
      {
        type: 'button',
        class: 'btn btn-secondary btn-small',
        'aria-label': 'Remove ' + (t.name || what),
      },
      'Remove',
    );
    rm.addEventListener('click', () => {
      const at = p.payTypes.indexOf(t);
      const near = Array.from(host.querySelectorAll('button[aria-label^="Remove"]')).indexOf(rm);
      p.payTypes = p.payTypes.filter((x) => x !== t);
      ctx.touch(false);
      draw();
      focusNear(host, Math.max(0, near - 1), addId);
      toast('Removed ' + (t.name || what) + '.', {
        undo: () => {
          if (p.payTypes.includes(t)) return;
          p.payTypes.splice(Math.min(at, p.payTypes.length), 0, t);
          ctx.touch(false);
          draw();
          focusNear(host, Math.max(0, near - 1), addId);
        },
      });
    });
    return el('div', { style: 'grid-column:1/-1' }, rm);
  };

  const rateField = (t, i, label) => {
    const rt = moneyInput({
      value: t.rate ? String(t.rate) : '',
      placeholder: phOf(t) && phOf(t).rate ? eg(phOf(t).rate) : '0.00',
      id: 'pr-' + t.id,
    });
    const fr = field(label, rt);
    rt.addEventListener('input', () => {
      const was = num(t.rate);
      t.rate = numOf(rt.value);
      if (i === 0) {
        fr.setError(t.rate <= 0 ? 'Enter the rate from your stub.' : '');
        // Overtime follows the main job (1.5x) while it still matches the old main rate or is empty.
        p.payTypes.forEach((o) => {
          if (o.k !== 'ot' || !(num(o.rate) === 0 || Math.abs(num(o.rate) - was * 1.5) < 0.006)) return;
          o.rate = +(t.rate * 1.5).toFixed(2);
          const box = document.getElementById('pr-' + o.id);
          if (box) box.value = o.rate ? String(o.rate) : '';
        });
      }
      ctx.touch(false);
    });
    if (i === 0 && !(t.rate > 0) && !ctx.ph) fr.setError('Enter the rate from your stub.');
    if (i === 0) rateFields.push({ fr, rt });
    return fr;
  };

  const nameField = (t, label, placeholder) => {
    const nm = el('input', {
      type: 'text',
      value: t.name || '',
      placeholder,
      autocomplete: 'off',
      id: 'pn-' + t.id,
    });
    nm.addEventListener('input', () => {
      t.name = nm.value;
      ctx.touch(false);
    });
    return el('div', { style: 'grid-column:1/-1' }, field(label, nm));
  };

  const jobRow = (t, i) => {
    const main = i === 0;
    const preset = findPayPreset(t.k);
    const sel = presetSelect(JOB_PRESETS, t.k, 'pk-' + t.id, 'otherjob');
    const kids = [el('div', { style: 'grid-column:1/-1' }, field(main ? 'Main job' : 'Job', sel))];
    const showName = NAMED_JOB_KEYS.includes(sel.value) || !preset || (!!t.name && t.name !== preset.name);
    if (showName) kids.push(nameField(t, 'Job name', 'e.g. Cook'));
    const unit = select(
      [
        ['hr', 'Per hour'],
        ['shift', 'Per shift'],
      ],
      t.unit === 'shift' ? 'shift' : 'hr',
      { id: 'pu-' + t.id },
    );
    kids.push(
      el(
        'div',
        { class: 'grid-2', style: 'grid-column:1/-1' },
        rateField(t, i, 'Rate ($)'),
        field('Paid', unit),
      ),
    );
    if (main)
      kids.push(
        el(
          'p',
          { class: 'hint', style: 'grid-column:1/-1;margin:0' },
          'Your main job is picked for you on Tonight. You can switch it there on nights you work something else.',
        ),
      );
    else kids.push(removeButton(t, i, jobsHost, 'pt-add', 'job'));
    sel.addEventListener('change', () => {
      p.payTypes[i] = applyPayPreset(t, sel.value, mainRate());
      ctx.touch(false);
      draw();
      refocus('pk-' + t.id);
    });
    unit.addEventListener('change', () => {
      t.unit = unit.value;
      ctx.touch(false);
      draw();
      refocus('pu-' + t.id);
    });
    return el('div', { class: 'repeat-row', style: 'grid-template-columns:minmax(0,1fr)' }, kids);
  };

  const otherRow = (t, i) => {
    const preset = findPayPreset(t.k);
    const sel = presetSelect(OTHER_PAY_PRESETS, t.k, 'pk-' + t.id, 'other');
    const kids = [el('div', { style: 'grid-column:1/-1' }, field('Other pay', sel))];
    if (sel.value === 'other' || !preset) kids.push(nameField(t, 'Name', 'What your stub calls it'));
    if (t.unit !== 'amt')
      kids.push(
        el(
          'div',
          { class: 'grid-2', style: 'grid-column:1/-1' },
          rateField(t, i, t.unit === 'shift' ? 'Rate per shift ($)' : 'Rate per hour ($)'),
        ),
      );
    else
      kids.push(
        el(
          'p',
          { class: 'hint', style: 'grid-column:1/-1;margin:0' },
          'You type the dollar amount on the night it applies (Tonight, “+ Add other pay”). It is added on top of what you made.',
        ),
      );
    if (preset && preset.notes)
      kids.push(el('p', { class: 'hint', style: 'grid-column:1/-1;margin:0' }, preset.notes));
    kids.push(removeButton(t, i, otherHost, 'op-add', 'other pay'));
    sel.addEventListener('change', () => {
      p.payTypes[i] = applyPayPreset(t, sel.value, mainRate());
      ctx.touch(false);
      draw();
      refocus('pk-' + t.id);
    });
    return el('div', { class: 'repeat-row', style: 'grid-template-columns:minmax(0,1fr)' }, kids);
  };

  const addJob = el(
    'button',
    { type: 'button', class: 'btn btn-secondary btn-small', id: 'pt-add' },
    '+ Add a job',
  );
  addJob.addEventListener('click', () => {
    const id = 'p' + Date.now();
    p.payTypes.push({ id, k: 'otherjob', name: '', rate: 0, unit: 'hr', usual: 0 });
    ctx.touch(false);
    draw();
    refocus('pk-' + id);
  });
  const addOther = el(
    'button',
    { type: 'button', class: 'btn btn-secondary btn-small', id: 'op-add' },
    '+ Add other pay',
  );
  addOther.addEventListener('click', () => {
    const id = 'p' + Date.now();
    p.payTypes.push(applyPayPreset({ id, rate: 0, usual: 0 }, 'ot', mainRate()));
    ctx.touch(false);
    draw();
    refocus('pk-' + id);
  });

  const draw = () => {
    clear(jobsHost);
    clear(otherHost);
    rateFields.length = 0;
    p.payTypes.forEach((t, i) => {
      if (payKind(t, i) === 'job') jobsHost.append(jobRow(t, i));
      else otherHost.append(otherRow(t, i));
    });
    if (!otherHost.firstChild)
      otherHost.append(el('p', { class: 'hint', id: 'op-none' }, 'No other pay yet.'));
  };
  draw();
  const card = el(
    'section',
    { class: 'card stack' },
    el('h2', null, 'Your jobs and pay'),
    el(
      'p',
      { class: 'note' },
      'Add every job you do where you work and what it pays. On Tonight you pick the job and type your hours; the rate fills in by itself.',
    ),
    entryModeField(ctx),
    el('h3', null, 'Jobs'),
    jobsHost,
    el('div', null, addJob),
    el('h3', null, 'Other pay'),
    el(
      'p',
      { class: 'hint' },
      'Extra pay on top of a job, like overtime, holiday pay or a bonus. On Tonight it stays out of the way until you tap “+ Add other pay”.',
    ),
    otherHost,
    el('div', null, addOther),
  );
  card.validate = () => {
    const main = p.payTypes[0];
    const ok = !!main && (main.unit === 'amt' || num(main.rate) > 0);
    rateFields.forEach(({ fr }) => fr.setError(ok ? '' : 'Enter the rate from your stub.'));
    return ok;
  };
  card.firstInvalid = () => {
    const f = rateFields[0];
    return f && f.rt.getAttribute('aria-invalid') === 'true' ? f.rt : null;
  };
  return card;
}

/* ============ 4. tip-out ============ */
function tipoutCard(ctx) {
  const { p, ph } = ctx;
  const to = p.tipout;
  const on = el('input', { type: 'checkbox', id: 'to-on' });
  on.checked = !!to.on;
  const mode = select(
    [
      ['pct', 'A % of my tips'],
      ['flat', 'A flat $ per shift'],
    ],
    to.mode,
  );
  const value = moneyInput({
    value: to.value ? String(to.value) : '',
    placeholder: ph ? eg(ph.tipout.value) : null,
  });
  const basis = select(
    [
      ['before', 'Before tip-out'],
      ['after', 'After tip-out'],
    ],
    to.basis,
  );
  const from = select(
    [
      ['cash', 'My cash'],
      ['check', 'Payroll'],
    ],
    to.from,
  );
  const fValue = field('Amount', value);
  const fields = el(
    'div',
    { class: 'stack' },
    el('div', { class: 'grid-2' }, field('Tip-out is', mode), fValue),
    el(
      'div',
      { class: 'grid-2' },
      field('The number I enter is', basis),
      field('Barback gets paid from', from),
    ),
    el('p', { class: 'hint' }, 'The tip-out percentage applies to your tips only, never to your hourly pay.'),
  );
  const sync = () => {
    fields.hidden = !to.on;
    fValue.querySelector('label').textContent = to.mode === 'pct' ? 'Percent of tips' : 'Dollars per shift';
    from.disabled = to.basis === 'after';
    ctx.gate(fValue, to.on && !(num(to.value) > 0) ? 'Enter the tip-out amount, or turn tip-outs off.' : '');
  };
  ctx.live.push(sync);
  on.addEventListener('change', () => {
    to.on = on.checked;
    ctx.touch(false);
  });
  mode.addEventListener('change', () => {
    to.mode = mode.value;
    ctx.touch(false);
  });
  value.addEventListener('input', () => {
    to.value = numOf(value.value);
    ctx.touch(false);
  });
  basis.addEventListener('change', () => {
    to.basis = basis.value;
    ctx.touch(false);
  });
  from.addEventListener('change', () => {
    to.from = from.value;
    ctx.touch(false);
  });
  value.addEventListener('blur', () => {
    ctx.seen.add(fValue);
    sync();
  });
  sync();
  const card = el(
    'section',
    { class: 'card stack' },
    el('h2', null, 'Barback tip-out'),
    el(
      'label',
      { class: 'check', for: 'to-on' },
      on,
      el(
        'span',
        null,
        'My bar has barback tip-outs',
        el('small', null, 'Leave unchecked if you don’t tip out a barback.'),
      ),
    ),
    fields,
  );
  card.validate = () => {
    ctx.showAll = true;
    sync();
    return !to.on || num(to.value) > 0;
  };
  card.firstInvalid = () => (to.on && !(num(to.value) > 0) ? value : null);
  return card;
}

/* ============ business day cutoff ============ */
function cutoffCard(ctx) {
  const S = ctx.S;
  const opts = [[0, '12 a.m. (off)']];
  for (let h = 1; h <= 8; h++) opts.push([h, h + ' a.m.']);
  const sel = select(opts, cutoffFromSettings(S.settings), {
    id: 'day-cutoff',
    'data-focus-key': 'day-cutoff',
  });
  sel.addEventListener('change', () => {
    S.settings.dayCutoffHour = Number(sel.value);
    redateDraft(S);
    save();
    toast('Saved.');
  });
  return el(
    'section',
    { class: 'card stack' },
    el('h2', null, 'Late nights'),
    field('Shifts logged before this time count as the night before', sel, {
      hint: 'If you enter your night at 2 a.m., TipNet dates it the day your shift started. You can always change the date.',
    }),
  );
}

/* ============ theme ============ */
function themeCard(ctx) {
  const S = ctx.S;
  const cur = S.settings.theme || 'auto';
  const btns = [
    ['auto', 'System'],
    ['light', 'Light'],
    ['dark', 'Dark'],
  ].map(([v, label]) => {
    const b = el(
      'button',
      { type: 'button', class: 'btn btn-secondary btn-small', 'aria-pressed': String(cur === v) },
      label,
    );
    b.addEventListener('click', () => {
      S.settings.theme = v;
      applyTheme(v);
      save();
      btns.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    });
    return b;
  });
  return el(
    'section',
    { class: 'card stack' },
    el('h2', null, 'Appearance'),
    el('div', { class: 'cluster', role: 'group', 'aria-label': 'Theme' }, btns),
  );
}

const finePrint = () =>
  el(
    'p',
    { class: 'note' },
    'Social Security and Medicare apply to every tip dollar. Under the federal “No Tax on Tips” deduction (tax years 2025–2028, up to $25,000 of qualified tips), some federal income tax taken from your tips may come back at tax time, depending on your situation. Some states have no state income tax; if yours does, add State income tax as a deduction. Taxes on cash tips usually come out of the paycheck. Auto-gratuities are wages, not tips.',
  );

/* ============ restaurants ============ */
/** Open Setup on another restaurant (Tonight follows: they share the picked restaurant). */
function pickWorkplace(S, id) {
  S.settings.activeWorkplaceId = id;
  adding = null;
  save();
  bus.rerender();
}
const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
/** A new restaurant with a blank paystub; its guided setup starts right away (setupDone false until Finish or Skip). */
function startNewWorkplace(S, name) {
  const w = { id: newWorkplaceId(S), name, profile: blankProfile(), calib: [], setupDone: false };
  S.workplaces.push(w);
  S.settings.activeWorkplaceId = w.id;
  adding = null;
  guidedFor = w.id;
  guidedStep = 0;
  gProfile = null;
  noDeductions = false;
  keepGuided(S);
  bus.rerender();
  const h = document.querySelector('#app h1');
  if (h) {
    h.setAttribute('tabindex', '-1');
    h.focus();
  }
}
/** "+ Set up another restaurant", then its name. */
function addWorkplaceCard(S) {
  if (S.workplaces.length >= MAX_WORKPLACES) return null;
  if (!adding) {
    const open = el(
      'button',
      { type: 'button', class: 'btn btn-secondary btn-small', id: 'wp-add' },
      '+ Set up another restaurant',
    );
    open.addEventListener('click', () => {
      adding = { name: '', error: '' };
      bus.rerender();
      const i = document.getElementById('wp-new-name');
      if (i) i.focus();
    });
    return el('div', null, open);
  }
  const name = el('input', {
    type: 'text',
    id: 'wp-new-name',
    value: adding.name,
    maxlength: '40',
    autocomplete: 'off',
    placeholder: 'e.g. Second Spot',
  });
  const f = field('Name of the restaurant', name, {
    hint: 'Its paystub, pay schedule, jobs and tip-out are set up on their own. Your budget counts both paychecks.',
  });
  if (adding.error) f.setError(adding.error);
  name.addEventListener('input', () => {
    adding.name = name.value;
    if (adding.error) {
      adding.error = '';
      f.setError('');
    }
  });
  const go = el('button', { type: 'submit', class: 'btn btn-small', id: 'wp-new-start' }, 'Start setup');
  const cancel = el(
    'button',
    { type: 'button', class: 'btn btn-secondary btn-small', id: 'wp-new-cancel' },
    'Cancel',
  );
  cancel.addEventListener('click', () => {
    adding = null;
    bus.rerender();
    const b = document.getElementById('wp-add');
    if (b) b.focus();
  });
  const form = el(
    'form',
    { class: 'card stack', novalidate: true, 'aria-labelledby': 'wp-new-heading' },
    el('h2', { id: 'wp-new-heading' }, 'Set up another restaurant'),
    f,
    el('div', { class: 'cluster' }, go, cancel),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const n = name.value.trim().slice(0, 40);
    let err = '';
    if (!n) err = 'Give the restaurant a name, so you can tell your paychecks apart.';
    else if (S.workplaces.some((x) => sameName(x.name, n)))
      err = 'You already have a restaurant called ' + n + '.';
    if (err) {
      adding.error = err;
      f.setError(err);
      name.focus();
      return;
    }
    startNewWorkplace(S, n);
  });
  return form;
}
/** Remove a restaurant and its nights (two taps, then Undo brings both back). The last restaurant can't be removed. */
function removeWorkplace(S, w) {
  const at = S.workplaces.indexOf(w);
  if (at < 0 || S.workplaces.length < 2) return;
  const gone = S.nights.filter((n) => n.workplaceId === w.id);
  const goals = ((S.budget && S.budget.goals) || []).filter((g) => g.fundedBy === w.id);
  const was = {
    active: S.settings.activeWorkplaceId,
    filter: S.settings.periodsFilter,
    draft: S.settings.guidedDraft,
  };
  S.workplaces.splice(at, 1);
  S.nights = S.nights.filter((n) => n.workplaceId !== w.id);
  goals.forEach((g) => delete g.fundedBy); // those goals are saved from the default paycheck now
  if (S.settings.activeWorkplaceId === w.id) S.settings.activeWorkplaceId = S.workplaces[0].id;
  if (S.settings.periodsFilter === w.id) delete S.settings.periodsFilter;
  if (S.settings.guidedDraft && S.settings.guidedDraft.workplaceId === w.id) delete S.settings.guidedDraft;
  if (guidedFor === w.id) {
    guidedFor = null;
    guidedStep = 0;
  }
  dropDraft(w.id);
  save();
  bus.rerender();
  const h = document.querySelector('#app h1');
  if (h) {
    h.setAttribute('tabindex', '-1');
    h.focus();
  }
  toast(
    'Removed ' +
      w.name +
      (gone.length ? ' and its ' + gone.length + ' night' + (gone.length === 1 ? '' : 's') : '') +
      '.',
    {
      undo: () => {
        if (S.workplaces.includes(w)) return;
        S.workplaces.splice(Math.min(at, S.workplaces.length), 0, w);
        S.nights = S.nights.concat(gone);
        goals.forEach((g) => {
          g.fundedBy = w.id;
        });
        S.settings.activeWorkplaceId = was.active;
        if (was.filter) S.settings.periodsFilter = was.filter;
        if (was.draft) S.settings.guidedDraft = was.draft;
        save();
        bus.rerender();
      },
    },
  );
}
/** The restaurant's name (rename in place, autosaved) and Remove. */
function workplaceCard(ctx) {
  const { S, w } = ctx;
  const name = el('input', {
    type: 'text',
    id: 'wp-name',
    value: w.name,
    maxlength: '40',
    autocomplete: 'off',
  });
  const f = field('Restaurant name', name, {
    hint:
      S.workplaces.length > 1
        ? 'Shown on Tonight, Pay periods and Budget.'
        : 'Shown if you add another restaurant.',
  });
  name.addEventListener('input', () => {
    const n = name.value.trim().slice(0, 40);
    if (!n) return f.setError('Give the restaurant a name.');
    if (S.workplaces.some((x) => x !== w && sameName(x.name, n)))
      return f.setError('You already have a restaurant called ' + n + '.');
    f.setError('');
    w.name = n;
    ctx.touch(false);
  });
  name.addEventListener('blur', () => {
    if (name.value.trim() !== w.name) {
      name.value = w.name; // a blank or repeated name goes back to the saved one
      f.setError('');
    }
  });
  let rm = null;
  if (S.workplaces.length > 1) {
    const n = nightsOf(S, w.id).length;
    rm = el('button', { type: 'button', class: 'btn btn-danger btn-small', id: 'wp-remove' });
    arm(rm, {
      label: 'Remove ' + w.name,
      armedLabel: n
        ? 'Tap again: this also removes its ' + n + ' night' + (n === 1 ? '' : 's')
        : 'Tap again to remove ' + w.name,
      onConfirm: () => removeWorkplace(S, w),
    });
  }
  return el(
    'section',
    { class: 'card stack', 'aria-labelledby': 'wp-card-heading' },
    el('h2', { id: 'wp-card-heading' }, 'Restaurant'),
    f,
    rm ? el('div', null, rm) : null,
  );
}

/* ============ guided flow ============ */
function guided(root, ctx) {
  const S = ctx.S,
    w = ctx.w;
  const first = isFirstWorkplace(S, w);
  const many = S.workplaces.length > 1;
  const names = ['Pay period and gross', 'Deductions', 'Pay and tip-out'];
  const steps = el(
    'ol',
    { class: 'steps', 'aria-label': 'Setup progress' },
    names.map((n, i) =>
      el(
        'li',
        { class: i < guidedStep ? 'done' : '', 'aria-current': i === guidedStep ? 'step' : null },
        i + 1 + '. ' + n,
      ),
    ),
  );
  let body;
  if (guidedStep === 0) body = [periodCard(ctx)];
  else if (guidedStep === 1) body = [dedCard(ctx)];
  else body = [payCard(ctx), tipoutCard(ctx)];
  const back =
    guidedStep > 0
      ? el(
          'button',
          {
            type: 'button',
            class: 'btn btn-secondary',
            onclick: () => {
              guidedStep--;
              keepGuided(S);
              bus.rerender();
              window.scrollTo(0, 0);
            },
          },
          'Back',
        )
      : null;
  const next = el('button', { type: 'button', class: 'btn' }, guidedStep === 2 ? 'Finish setup' : 'Next');
  next.addEventListener('click', () => {
    const bad = body.filter((c) => !c.validate());
    if (bad.length) {
      const i = bad.map((c) => c.firstInvalid()).find(Boolean);
      if (i) i.focus();
      return;
    }
    if (guidedStep < 2) {
      guidedStep++;
      keepGuided(S);
      bus.rerender();
      window.scrollTo(0, 0);
      return;
    }
    const tidy = (p) => {
      p.deductions = p.deductions.filter((d) => num(d.amount) > 0);
      p.payTypes = p.payTypes.filter((t, i) => i === 0 || t.unit === 'amt' || num(t.rate) > 0);
      p.rateOverride = null;
    };
    if (gProfile) {
      // the user's own numbers replace the example only now
      tidy(gProfile);
      w.profile = gProfile;
      gProfile = null;
    } else if (!first) tidy(w.profile); // a restaurant added later: drop the blank rows it started with
    const hadExamples = S.nightsExample;
    if (hadExamples) {
      S.nights = [];
      S.workplaces[0].calib = [];
      S.nightsExample = false;
    }
    if (noDeductions) w.noDeductions = true;
    noDeductions = false;
    w.setupDone = true;
    delete w.guideSkipped;
    delete S.settings.guidedDraft;
    S.settings.activeWorkplaceId = w.id;
    S.profileExample = false;
    guidedFor = null;
    save();
    guidedStep = 0;
    bus.rerender();
    bus.go('tonight');
    toast(
      (many ? w.name + ' is set up.' : 'Setup saved.') + ' Enter a night to see your estimated take-home.',
    );
    if (hadExamples) toast('Example nights cleared.');
  });
  const skip = el(
    'button',
    {
      type: 'button',
      class: 'btn-link',
      onclick: () => {
        // Not "set up": Tonight keeps its "Finish setup" card until gross pay, a deduction (or "no deductions") and the
        // main rate are in. The example paystub is swapped for a blank one, so no night is ever saved against example taxes.
        if (S.profileExample && first) {
          w.profile = gProfile || blankProfile();
          S.profileExample = false;
        }
        if (S.nightsExample) {
          S.nights = [];
          S.workplaces[0].calib = [];
          S.nightsExample = false;
        }
        if (noDeductions) w.noDeductions = true;
        w.guideSkipped = true;
        delete w.setupDone;
        delete S.settings.guidedDraft;
        guidedFor = null;
        gProfile = null;
        noDeductions = false;
        guidedStep = 0;
        save();
        bus.rerender();
        const h = document.querySelector('#app h1');
        if (h) {
          h.setAttribute('tabindex', '-1');
          h.focus();
        }
      },
    },
    'Skip guided setup and show everything',
  );
  if (restoreRequest.open) {
    const host = el('div');
    renderBackup(host, { restoreOnly: true });
    root.append(
      el(
        'div',
        { class: 'stack' },
        el('h1', null, 'Set up TipNet'),
        host,
        el(
          'div',
          null,
          el(
            'button',
            {
              type: 'button',
              class: 'btn-link',
              onclick: () => {
                restoreRequest.open = false;
                bus.rerender();
              },
            },
            'Back to setup',
          ),
        ),
      ),
    );
    const ta = root.querySelector('#bk-code');
    if (ta) ta.focus();
    return;
  }
  // Restoring a backup replaces everything, so it is offered only on the very first setup.
  const restoreLink =
    guidedStep === 0 && first && !many
      ? el(
          'div',
          null,
          el(
            'button',
            {
              type: 'button',
              class: 'btn-link',
              id: 'restore-link',
              onclick: () => {
                restoreRequest.open = true;
                bus.rerender();
              },
            },
            'Moving from another phone? Restore a backup code',
          ),
        )
      : null;
  // A restaurant added later can be dropped before it is finished (Undo brings it back).
  let cancel = null;
  if (!first && many) {
    cancel = el(
      'button',
      { type: 'button', class: 'btn-link', id: 'wp-cancel-setup' },
      'Cancel and remove ' + w.name,
    );
    cancel.addEventListener('click', () => removeWorkplace(S, w));
  }
  const switcher = workplaceSwitcher(S, w.id, (id) => pickWorkplace(S, id), {
    key: 'setup-wp',
    label: 'Restaurant to set up',
  });
  root.append(
    el(
      'div',
      { class: 'stack' },
      switcher,
      el('h1', { tabindex: '-1' }, first && !many ? 'Set up TipNet' : 'Set up ' + w.name),
      el(
        'p',
        { class: 'note', id: 'setup-welcome' },
        first && !many
          ? 'Set up with one recent paystub (about 3 minutes) so TipNet can estimate your real take-home.'
          : 'Use one recent paystub from ' +
              w.name +
              ' (about 3 minutes). Its pay schedule, jobs and tip-out are kept apart from your other restaurant' +
              (S.workplaces.length > 2 ? 's' : '') +
              '.',
      ),
      restoreLink,
      el('p', { class: 'hint' }, 'Three short steps. You can change any of it later.'),
      steps,
      body,
      ctx.saved,
      el('div', { class: 'cluster' }, back, next),
      skip,
      cancel ? el('div', null, cancel) : null,
      finePrint(),
    ),
  );
}

/** What Tonight still needs before it can estimate at this restaurant, in the order of the page ([] once set up). */
export function stillNeeded(S, w) {
  if (isWorkplaceSetUp(S, w)) return [];
  const p = w.profile;
  const out = [];
  if (!Number.isFinite(parseISO(p.periodStart))) out.push('your pay period start date');
  if (!(num(p.gross) > 0)) out.push('your gross pay');
  if (!(p.deductions || []).some((d) => num(d.amount) > 0) && !w.noDeductions)
    out.push('at least one deduction (or tick “My paystub has no deductions”)');
  if (!(num(((p.payTypes || [])[0] || {}).rate) > 0)) out.push('your main rate');
  return out;
}
const listText = (a) => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
/** Full page while not set up (after "Skip guided setup"): what Tonight still needs. Updates as the fields change. */
function notReadyNote(ctx) {
  const { S, w } = ctx;
  const text = el('p', { id: 'not-ready-text' });
  const box = el('div', { class: 'banner', role: 'status' }, text);
  const sync = () => {
    const need = stillNeeded(S, w);
    box.hidden = !need.length;
    const t = need.length
      ? 'Still needed: ' + listText(need) + '. Tonight shows your take-home once they are in.'
      : '';
    if (text.textContent !== t) text.textContent = t;
  };
  ctx.live.push(sync);
  sync();
  return box;
}

/* ============ full setup ============ */
export function render(root) {
  const S0 = getState();
  resumeGuided(S0);
  const w = activeWorkplace(S0);
  const first = isFirstWorkplace(S0, w);
  if (gProfile && !(S0.profileExample && first)) gProfile = null;
  // The guided flow is for a restaurant that is not set up yet, unless they chose "Skip guided setup": the first one on a
  // first launch (still the example), or one being set up right now (a restaurant added later starts in it).
  const inGuided =
    !isWorkplaceSetUp(S0, w) &&
    !w.guideSkipped &&
    ((first && S0.profileExample) || guidedFor === w.id || (!first && w.setupDone === false));
  const ctx = makeCtx(w, inGuided && ((first && S0.profileExample) || !!gProfile), inGuided);
  if (inGuided) {
    if (guidedFor !== w.id) {
      // another restaurant's guided flow was running: this one starts at its first step
      guidedFor = w.id;
      if (!(first && S0.profileExample)) gProfile = null;
      const g = S0.settings.guidedDraft;
      guidedStep = g && g.workplaceId === w.id && [0, 1, 2].includes(g.step) ? g.step : 0;
      noDeductions = false;
    }
    guided(root, ctx);
    return;
  }
  gProfile = null;
  const many = S0.workplaces.length > 1;
  const importHost = el('div'),
    installHost = el('div'),
    backupHost = el('div');
  // Imported nights would count as "set up" and be worked out with whatever paystub is here, so the importer waits for the basics.
  if (isSetUp(S0)) renderImporter(importHost);
  else
    importHost.append(
      el(
        'section',
        { class: 'card stack' },
        el('h2', null, 'Import nights from a file'),
        el(
          'p',
          { class: 'hint' },
          'You can import nights from a spreadsheet once your paystub numbers are in.',
        ),
      ),
    );
  renderInstall(installHost);
  renderBackup(backupHost);
  root.append(
    el(
      'div',
      { class: 'stack' },
      workplaceSwitcher(S0, w.id, (id) => pickWorkplace(S0, id), {
        key: 'setup-wp',
        label: 'Restaurant to set up',
      }),
      exampleBanner(),
      el('h1', null, many ? 'Setup: ' + w.name : 'Setup'),
      many
        ? el(
            'p',
            { class: 'hint' },
            'The paystub, jobs and tip-out below are for ' +
              w.name +
              '. Late nights, appearance and backups are shared by all your restaurants.',
          )
        : null,
      notReadyNote(ctx),
      ctx.saved,
      addWorkplaceCard(S0),
      workplaceCard(ctx),
      periodCard(ctx, { title: 'From your paystub' }),
      dedCard(ctx),
      payCard(ctx),
      tipoutCard(ctx),
      cutoffCard(ctx),
      themeCard(ctx),
      importHost,
      installHost,
      backupHost,
      finePrint(),
    ),
  );
  if (restoreRequest.open) {
    // came from the "Moving from another phone?" link: take them to the restore box
    restoreRequest.open = false;
    const ta = root.querySelector('#bk-code');
    if (ta) {
      try {
        ta.scrollIntoView({ block: 'center' });
      } catch (e) {
        /* ignore */
      }
      ta.focus();
    }
  }
}
