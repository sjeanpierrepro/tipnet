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
  stubWarnings,
  weekdayMon0,
  todayISO,
} from '../math.js';
import { budgetVisible, isUnlocked } from '../billing.js';
import { subscriptionLine } from './budget.js';
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
  exampleShown,
  debounce,
  fmtShort,
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
  lockFinished,
  flush,
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
/**
 * The full Setup page shows each restaurant as one row. The open one is edited as a draft (a copy), applied by Save:
 * open = {wid, base, draft}, where base and draft are {name, noDeductions, profile} (base: as it was when opened).
 */
let open = null;
let asking = null; // "Save changes to <name>?" is showing: {next} runs after Save or Discard
let lastSaved = null; // {wid, text}: the line under a row that was just saved
const foldOpen = new Set(); // shared sections (Late nights, Appearance...) that are open
const userClosed = new Set(); // restaurants the person closed themselves (a not-set-up one otherwise opens by itself)
export function reset() {
  open = null;
  asking = null;
  lastSaved = null;
  foldOpen.clear();
  userClosed.clear();
  pendingEdits.forEach((f) => f.cancel());
  pendingEdits.clear();
  guidedStep = 0;
  guidedFor = null;
  gProfile = null;
  noDeductions = false;
  adding = null;
  restoreRequest.open = false;
  rateCleared.clear();
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

/* ============ numbers that change the paystub rate ============ */
/**
 * Gross pay and deduction amounts apply after a short pause in typing, when the field is left, or on any click (app.js
 * calls flushEdits), never on every keystroke: typing "2100" must not pass through a $2 gross (a huge rate, a cleared
 * accuracy adjustment, a save). Until then the saved line says "Saving…", so "All changes saved" stays true.
 */
const pendingEdits = new Set();
const EDIT_PAUSE_MS = 600;
/** Apply every typed number that is still waiting (before a click or when the page is hidden). */
export function flushEdits() {
  [...pendingEdits].forEach((f) => f.flush());
}
function onPause(ctx, input, apply) {
  const run = debounce(() => {
    if (!pendingEdits.delete(run)) return;
    lockFinished(); // a pay period that ended meanwhile locks before the new number reaches it
    apply();
  }, EDIT_PAUSE_MS);
  input.addEventListener('input', () => {
    pendingEdits.add(run);
    if (ctx.draft)
      ctx.changed(); // the full page: a draft until Save
    else ctx.saved.textContent = 'Saving…';
    run();
  });
  const now = () => {
    if (pendingEdits.has(run)) run.flush();
  };
  input.addEventListener('change', now);
  input.addEventListener('blur', now);
}

/* ============ context shared by the cards on one render ============ */
let saveSeq = 0; // the newest edit's save decides the "All changes saved" line
/** What the paystub rate is worked out from: gross pay and the percentage deductions' total (in cents). */
const rateSig = (p) =>
  JSON.stringify([
    Math.round(num(p.gross) * 100),
    Math.round(
      (p.deductions || []).filter((d) => d.mode === 'pct').reduce((s, d) => s + num(d.amount), 0) * 100,
    ),
  ]);
/** Restaurant id -> {sig, value}: its accuracy adjustment was cleared by a paystub change this session. */
const rateCleared = new Map();
export const RATE_NOTE =
  'Your paystub rates changed, so TipNet’s accuracy adjustment was cleared. Check a paycheck again after payday.';
const RATE_NOTE_DRAFT =
  'Your paystub rates changed, so saving clears TipNet’s accuracy adjustment. Putting the rates back keeps it.';
/** w: the restaurant being set up. blank: the guided steps fill in gProfile (the first restaurant, still the example). */
/** draft: the full page's open restaurant ({name, noDeductions, profile}); edits go there and Save applies them. */
function makeCtx(w, blank = false, guidedNow = blank, draft = null) {
  const S = getState();
  if (blank && !gProfile) gProfile = blankProfile();
  const live = [];
  const saved = el('p', { class: 'hint', role: 'status', 'aria-live': 'polite' });
  const rateNote = el('p', { class: 'hint', role: 'status', 'aria-live': 'polite' });
  const showRateNote = () => {
    // A draft says beforehand what Save will do to the accuracy adjustment.
    const on = draft
      ? w.profile.rateOverride != null && rateSig(draft.profile) !== rateSig(w.profile)
      : !blank && !!w && rateCleared.has(w.id);
    const text = on ? (draft ? RATE_NOTE_DRAFT : RATE_NOTE) : '';
    if (rateNote.textContent !== text) rateNote.textContent = text;
    rateNote.hidden = !on;
  };
  const ctx = {
    S,
    w,
    p: blank ? gProfile : draft ? draft.profile : w.profile,
    draft,
    /** A draft changed (set by the editor: refreshes Save and its reasons). */
    changed() {},
    blank,
    guided: guidedNow,
    ph: blank || guidedNow ? exampleProfile() : null, // example numbers as placeholders while setting up
    live,
    saved,
    /** Required-field errors wait until the field was left (blur) or Next/Finish was pressed. */
    seen: new Set(),
    showAll: false,
    gate(f, msg) {
      f.setError(ctx.showAll || ctx.seen.has(f) ? msg : '');
    },
    rateNote,
    /**
     * Call after any profile edit. The accuracy adjustment (rateOverride) is cleared only when the paystub rates really
     * changed: gross pay, or a percentage deduction's amount or mode (a fixed amount or a name never does). Putting the
     * rates back (Undo) brings the adjustment back. The argument is kept for older calls and is not used.
     */
    touch() {
      if (draft) {
        // nothing is saved until Save
        showRateNote();
        live.forEach((f) => f());
        ctx.changed();
        return;
      }
      if (blank) {
        live.forEach((f) => f());
        keepGuided(S); // guided on the example: only the draft is saved until Finish
        return;
      }
      S.profileExample = false;
      const pw = w.profile;
      const sig = rateSig(pw);
      const was = rateCleared.get(w.id);
      if (was && was.sig === sig && pw.rateOverride == null) {
        pw.rateOverride = was.value; // back to the rates it was learned with
        rateCleared.delete(w.id);
      } else if (pw.rateOverride != null && ctx.sig != null && sig !== ctx.sig) {
        rateCleared.set(w.id, { sig: ctx.sig, value: pw.rateOverride });
        pw.rateOverride = null;
      }
      ctx.sig = sig;
      showRateNote();
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
  ctx.sig = blank || !w ? null : rateSig(w.profile);
  showRateNote();
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
  // A calm check, never a block: a gross this small is usually a typo (or a short first check).
  const grossNote = el('p', { class: 'note', role: 'status', id: 'gross-check', hidden: true });
  fGross.append(grossNote);
  const showGrossNote = () => {
    const low = stubWarnings(p).lowGross;
    const text = low
      ? 'That’s a small gross pay for one paycheck. If it’s right, carry on; if not, type the full gross amount for this pay period.'
      : '';
    if (grossNote.textContent !== text) grossNote.textContent = text;
    grossNote.hidden = !low;
  };
  showGrossNote();
  ctx.live.push(showGrossNote);

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
  onPause(ctx, gross, () => {
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
    if (d.mode === 'pct') {
      if (!(p.gross > 0)) return 'Enter gross pay to see the rate';
      const share = num(d.amount) / p.gross;
      return share > 1
        ? 'More than your gross pay: check this amount'
        : (share * 100).toFixed(2) + '% of every dollar you make';
    }
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
    // Calm checks on the stub numbers (never a block). TipNet never uses a rate above 100%.
    const wn = stubWarnings(p);
    if (wn.capped)
      summaryBox.append(
        el(
          'p',
          { class: 'hint', id: 'rate-check' },
          'Your “changes with my pay” deductions add up to more than your gross pay, so TipNet uses 100% for now. Check the gross pay and each amount against your paystub.',
        ),
      );
    else if (wn.highRate)
      summaryBox.append(
        el(
          'p',
          { class: 'hint', id: 'rate-check' },
          'Your “changes with my pay” deductions are ' +
            Math.round(wn.share * 100) +
            '% of your gross pay, which is unusually high. Check that they come from this paystub, not year-to-date.',
        ),
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
      onPause(ctx, amt, () => {
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
  const owner = ctx.draft || w; // where "no deductions" is kept: the draft on the full page
  noDed.checked = ctx.blank ? noDeductions : !!owner.noDeductions;
  const dedErr = el('p', { class: 'field-error', hidden: true, role: 'alert' });
  noDed.addEventListener('change', () => {
    if (ctx.blank) {
      noDeductions = noDed.checked;
      keepGuided(S);
    } else if (ctx.draft) {
      ctx.draft.noDeductions = noDed.checked;
      ctx.touch(false);
    } else {
      if (noDed.checked) w.noDeductions = true;
      else delete w.noDeductions;
      ctx.touch(false);
    }
    if (noDed.checked) dedErr.hidden = true;
  });
  // The full page offers it too while no deduction has an amount (the "Skip guided setup" path needs it to finish).
  const showNoDed = ctx.blank || !!owner.noDeductions || !p.deductions.some((d) => num(d.amount) > 0);
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
    ctx.guided ? dedErr : null,
    summaryBox,
  );
  card.validate = () => {
    if (!ctx.guided) return true;
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
  const offCb = el('input', {
    type: 'checkbox',
    id: 'cash-off-payroll',
    'data-focus-key': 'setup-cash-off-payroll',
  });
  offCb.checked = !!p.cashOffPayroll;
  offCb.addEventListener('change', () => {
    p.cashOffPayroll = offCb.checked;
    ctx.touch(false);
  });
  const offRow = el(
    'div',
    { class: 'stack-sm' },
    el('h3', null, 'Cash tips'),
    el(
      'label',
      { class: 'check', for: 'cash-off-payroll' },
      offCb,
      el(
        'span',
        null,
        'Cash tips here usually aren’t run through payroll',
        el(
          'small',
          null,
          'Tonight starts with “Cash tips weren’t run through payroll” ticked once you enter cash. You can change it any night.',
        ),
      ),
    ),
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
    offRow,
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
  // The hint describes what the current setting actually does (it used to describe the 2 a.m. rule even when off).
  const hintFor = (h) =>
    h === 0
      ? 'Off: a night is dated the day you enter it, even after midnight. You can always change the date.'
      : 'If you enter your night before ' +
        h +
        ' a.m., TipNet dates it the day your shift started. You can always change the date.';
  const f = field('Shifts logged before this time count as the night before', sel, {
    hint: hintFor(cutoffFromSettings(S.settings)),
  });
  sel.addEventListener('change', () => {
    S.settings.dayCutoffHour = Number(sel.value);
    const hint = f.querySelector('.hint');
    if (hint) hint.textContent = hintFor(S.settings.dayCutoffHour);
    redateDraft(S);
    save();
    toast('Saved.');
  });
  return el('section', { class: 'card stack' }, el('h2', null, 'Late nights'), f);
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
/** What is wrong with a name for restaurant w ('' when it is fine). */
function nameProblem(S, w, n) {
  if (!n) return 'Give the restaurant a name.';
  if (S.workplaces.some((x) => x !== w && sameName(x.name, n)))
    return 'You already have a restaurant called ' + n + '.';
  return '';
}
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
    const addBtn = el(
      'button',
      { type: 'button', class: 'btn btn-secondary btn-small', id: 'wp-add' },
      '+ Set up another restaurant',
    );
    const start = () => {
      adding = { name: '', error: '' };
      bus.rerender();
      const i = document.getElementById('wp-new-name');
      if (i) i.focus();
    };
    addBtn.addEventListener('click', () => {
      if (!confirmLeave(start)) start(); // an open restaurant with unsaved changes asks first
    });
    return el('div', null, addBtn);
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
  if (open && open.wid === w.id) {
    open = null; // its unsaved changes go with it
    asking = null;
  }
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
/** A rename shows right away everywhere on this screen (switcher buttons, heading, notes, Remove), without a redraw. */
function showName(w) {
  document.querySelectorAll('[data-workplace]').forEach((b) => {
    if (b.getAttribute('data-workplace') !== w.id) return; // compared, not put in a selector: ids may hold any character
    b.textContent = w.name;
    b.title = w.name;
  });
  const h = document.getElementById('setup-h1');
  if (h) h.textContent = 'Setup: ' + w.name;
  const hint = document.getElementById('setup-wp-hint');
  if (hint)
    hint.textContent =
      'The paystub, jobs and tip-out below are for ' +
      w.name +
      '. Late nights, appearance and backups are shared by all your restaurants.';
  const rm = document.getElementById('wp-remove');
  if (rm && !rm.hasAttribute('data-armed')) rm.textContent = 'Remove ' + w.name;
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
  if (ctx.draft) name.value = ctx.draft.name;
  name.addEventListener('input', () => {
    const n = name.value.trim().slice(0, 40);
    if (ctx.draft) {
      // the draft keeps what is typed; Save says what is wrong with it
      ctx.draft.name = n;
      f.setError(nameProblem(S, w, n));
      ctx.touch(false);
      return;
    }
    if (!n) return f.setError('Give the restaurant a name.');
    if (S.workplaces.some((x) => x !== w && sameName(x.name, n)))
      return f.setError('You already have a restaurant called ' + n + '.');
    f.setError('');
    w.name = n;
    showName(w);
    ctx.touch(false);
  });
  name.addEventListener('blur', () => {
    if (!ctx.draft && name.value.trim() !== w.name) {
      name.value = w.name; // a blank or repeated name goes back to the saved one
      f.setError('');
    }
  });
  let rm = null;
  if (S.workplaces.length > 1) {
    const n = nightsOf(S, w.id).length;
    rm = el('button', { type: 'button', class: 'btn btn-danger btn-small', id: 'wp-remove' });
    arm(rm, {
      label: () => 'Remove ' + w.name,
      armedLabel: () =>
        n
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
    if (hadExamples && exampleShown.seen) toast('Example nights cleared.');
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
      ctx.rateNote,
      el('div', { class: 'cluster' }, back, next),
      skip,
      cancel ? el('div', null, cancel) : null,
      finePrint(),
    ),
  );
}

/** What Tonight still needs before it can estimate at this restaurant, in the order of the page ([] once set up). */
/** draft: a full-page draft ({profile, noDeductions}) to check instead of what is saved. */
export function stillNeeded(S, w, draft = null) {
  if (isWorkplaceSetUp(S, w)) return [];
  const p = draft ? draft.profile : w.profile;
  const out = [];
  if (!Number.isFinite(parseISO(p.periodStart))) out.push('your pay period start date');
  if (!(num(p.gross) > 0)) out.push('your gross pay');
  if (!(p.deductions || []).some((d) => num(d.amount) > 0) && !(draft ? draft.noDeductions : w.noDeductions))
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
    const need = stillNeeded(S, w, ctx.draft);
    box.hidden = !need.length;
    const t = need.length
      ? 'Still needed: ' + listText(need) + '. Tonight shows your take-home once they are in and saved.'
      : '';
    if (text.textContent !== t) text.textContent = t;
  };
  ctx.live.push(sync);
  sync();
  return box;
}

/* ============ full setup ============ */
let guidedShown = false; // the guided steps are on screen (the "TipNet Budget" card stays away from them)
export const guidedOnScreen = () => guidedShown;
export function render(root) {
  guidedShown = false;
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
    guidedShown = true;
    guided(root, ctx);
    return;
  }
  gProfile = null;
  fullPage(root, S0, w);
}

/* ============ full page: one row per restaurant (edited as a draft, applied by Save) ============ */
const copyOf = (x) => JSON.parse(JSON.stringify(x));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const snapOf = (w) => ({ name: w.name, noDeductions: !!w.noDeductions, profile: copyOf(w.profile) });
const focusId = (id) => {
  const n = document.getElementById(id);
  if (!n) return;
  try {
    n.scrollIntoView({ block: 'nearest' });
  } catch (e) {
    /* not available */
  }
  n.focus();
};

/** The open restaurant has changes that Save has not applied yet. */
export function hasUnsaved() {
  return !!open && (pendingEdits.size > 0 || !same(open.draft, open.base));
}

/**
 * Leaving the open restaurant (another tab, another restaurant, closing it). With unsaved changes this asks
 * "Save changes to <name>?" (Save / Discard / Keep editing) in the Save bar and returns true; next runs after Save or
 * Discard. With nothing unsaved the restaurant just closes and it returns false (the caller carries on).
 */
export function confirmLeave(next) {
  flushEdits();
  if (!hasUnsaved()) {
    open = null;
    asking = null;
    return false;
  }
  asking = { next };
  bus.rerender();
  focusId('draft-ask-save');
  return true;
}

/** Plain reasons Save can't apply the draft yet ([] when it can). */
function draftProblems(S, w, d) {
  const out = [];
  const p = d.profile;
  const np = nameProblem(S, w, d.name);
  if (np) out.push(np);
  if (!Number.isFinite(parseISO(p.periodStart))) out.push('Pick the day your pay period started.');
  else if (p.periodEnd && Number.isFinite(parseISO(p.periodEnd)) && !calendarMode(p)) {
    const len = dayDiff(p.periodStart, p.periodEnd) + 1;
    if (!(len >= 1)) out.push('The end date has to be on or after the start date.');
    else if (len > 62) out.push('Pay periods are 62 days or shorter. Check the end date.');
  }
  if (!(num(p.gross) > 0)) out.push('Enter your gross pay.');
  if ((p.deductions || []).some((x) => num(x.amount) < 0))
    out.push('Deduction amounts are positive numbers.');
  else if (!d.noDeductions && !(p.deductions || []).some((x) => num(x.amount) > 0))
    out.push('Type at least one deduction amount, or tick “My paystub has no deductions.”');
  const main = (p.payTypes || [])[0];
  if (!main || (main.unit !== 'amt' && !(num(main.rate) > 0))) out.push('Enter your main job’s rate.');
  if (p.tipout && p.tipout.on && !(num(p.tipout.value) > 0))
    out.push('Enter the tip-out amount, or turn tip-outs off.');
  return out;
}

/**
 * Apply the open draft to its restaurant, all at once. Only what the draft changed is written (a change another window
 * made to another field meanwhile is kept). The accuracy adjustment is cleared only when gross pay or the % deductions
 * changed, and comes back if a later Save puts them back. Returns false (nothing applied) when the draft isn't valid.
 */
function saveOpen() {
  flushEdits();
  const S = getState();
  const w = open && findWorkplace(S, open.wid);
  if (!w) {
    open = null;
    asking = null;
    return false;
  }
  if (draftProblems(S, w, open.draft).length) return false;
  lockFinished(); // a pay period that ended meanwhile locks before the new numbers reach it
  const { base, draft } = open;
  const live = w.profile;
  const sigBefore = rateSig(live);
  new Set([...Object.keys(base.profile), ...Object.keys(draft.profile)]).forEach((k) => {
    if (k === 'rateOverride' || same(draft.profile[k], base.profile[k])) return;
    if (draft.profile[k] === undefined) delete live[k];
    else live[k] = copyOf(draft.profile[k]);
  });
  if (draft.name !== base.name) w.name = draft.name;
  if (draft.noDeductions !== base.noDeductions) {
    if (draft.noDeductions) w.noDeductions = true;
    else delete w.noDeductions;
  }
  const sig = rateSig(live);
  const was = rateCleared.get(w.id);
  let note = '';
  if (was && was.sig === sig && live.rateOverride == null) {
    live.rateOverride = was.value; // back to the rates it was learned with
    rateCleared.delete(w.id);
  } else if (live.rateOverride != null && sig !== sigBefore) {
    rateCleared.set(w.id, { sig: sigBefore, value: live.rateOverride });
    live.rateOverride = null;
    note = ' ' + RATE_NOTE;
  }
  S.profileExample = false;
  open = null;
  asking = null;
  const mine = { wid: w.id, text: 'Saving…' + note };
  lastSaved = mine;
  const n = ++saveSeq;
  // Written right away (an explicit Save); "Saved." only once the write really worked.
  save();
  flush().then((ok) => {
    if (n !== saveSeq || lastSaved !== mine) return;
    mine.text = ok
      ? 'Saved.' + note
      : 'Couldn’t save on this device. Your changes are kept while TipNet is open.';
    const line = document.getElementById('wp-saved-' + w.id);
    if (line) line.textContent = mine.text;
  });
  return true;
}
/** The person closed the row (Cancel, Discard or its heading). */
function closeRow(wid) {
  userClosed.add(wid);
  open = null;
  asking = null;
  bus.rerender();
  focusId('wp-row-' + wid);
}

/** Open a restaurant's row (asking first if another one has unsaved changes). */
function openRow(S, wid) {
  if (open && open.wid === wid) return;
  const go = () => {
    const w = findWorkplace(S, wid);
    if (!w) return;
    lastSaved = null;
    const g = S.settings.guidedDraft;
    if (
      !isWorkplaceSetUp(S, w) &&
      !w.guideSkipped &&
      (w.setupDone === false || (g && g.workplaceId === wid))
    ) {
      // still in its guided setup: carry on there
      open = null;
      pickWorkplace(S, wid);
      const h = document.querySelector('#app h1');
      if (h) h.focus();
      return;
    }
    open = { wid, base: snapOf(w), draft: snapOf(w) };
    userClosed.delete(wid);
    // Tonight and Setup share the picked restaurant
    if (S.settings.activeWorkplaceId !== wid) {
      S.settings.activeWorkplaceId = wid;
      save();
    }
    bus.rerender();
    focusId('wp-row-' + wid);
  };
  if (!confirmLeave(go)) go();
}

const FREQ_SHORT = {
  7: 'every week',
  14: 'every two weeks',
  semimonthly: 'twice a month',
  15: 'every 15 days',
  monthly: 'once a month',
  30: 'every 30 days',
};
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const rateShort = (r) => (Math.round(r * 100) % 100 === 0 ? '$' + Math.round(r) : money(r));
/** One line under the restaurant's name, e.g. "Bartender $12/h · every two weeks · payday Fri". */
function rowSummary(S, w) {
  if (!isWorkplaceSetUp(S, w)) {
    const g = S.settings.guidedDraft;
    if (!w.guideSkipped && (w.setupDone === false || (g && g.workplaceId === w.id)))
      return 'Setup isn’t finished. Open it to carry on.';
    const need = stillNeeded(S, w);
    return need.length ? 'Not set up yet. Still needed: ' + listText(need) + '.' : 'Not set up yet.';
  }
  const p = w.profile;
  const parts = [];
  const main = (p.payTypes || [])[0];
  if (main) {
    const pr = findPayPreset(main.k);
    const nm = main.name || (pr && pr.name) || 'Main job';
    parts.push(
      num(main.rate) > 0
        ? nm + ' ' + rateShort(num(main.rate)) + (main.unit === 'shift' ? '/shift' : '/h')
        : nm,
    );
  }
  parts.push(FREQ_SHORT[p.freq] || 'every ' + num(p.freq) + ' days');
  // the payday's weekday, when it is the same every pay period
  if (p.payDelay != null && Number.isFinite(parseISO(p.periodStart))) {
    const d0 = addDays(periodRange(p, 0).end, p.payDelay);
    const d1 = addDays(periodRange(p, 1).end, p.payDelay);
    if (weekdayMon0(d0) === weekdayMon0(d1)) parts.push('payday ' + DAY_SHORT[weekdayMon0(d0)]);
  }
  return parts.join(' · ');
}

/** Cards made for the guided steps (h2, with h3 inside) sit one level down inside a row (h3, h4). */
function demote(root) {
  ['h3', 'h2'].forEach((tag) =>
    root.querySelectorAll(tag).forEach((h) => {
      const n = document.createElement(tag === 'h2' ? 'h3' : 'h4');
      Array.from(h.attributes).forEach((a) => n.setAttribute(a.name, a.value));
      while (h.firstChild) n.append(h.firstChild);
      h.replaceWith(n);
    }),
  );
}
/** A row's heading: a button with the name, a one-line summary and a chevron; it opens and closes the row. */
function rowHead(id, title, summaryText, isOpen, controls) {
  const sum = el('span', { class: 'fold-sum' }, summaryText);
  const b = el(
    'button',
    {
      type: 'button',
      class: 'fold-head',
      id,
      'aria-expanded': String(isOpen),
      'aria-controls': controls,
    },
    el('span', { class: 'fold-text' }, el('span', { class: 'fold-title' }, title), sum),
    el('span', { class: 'chev', 'aria-hidden': 'true' }),
  );
  b.sum = sum;
  return b;
}

/** Save / Cancel for the open restaurant, or the "Save changes to <name>?" question. Kept at the bottom of the screen. */
function saveBar(S, w, ctx) {
  const reasons = el('p', { class: 'hint', id: 'draft-reasons' });
  const stateLine = el('p', { class: 'hint', id: 'draft-state', role: 'status' });
  const bar = el('div', { class: 'save-bar stack-sm', id: 'draft-bar' });
  const doSave = (then) => {
    const next = asking && asking.next;
    if (!saveOpen()) return sync();
    if (then && next) next();
    else {
      bus.rerender();
      focusId('wp-row-' + w.id);
    }
  };
  let saveB;
  if (asking) {
    const name = open.draft.name || w.name;
    saveB = el(
      'button',
      { type: 'button', class: 'btn', id: 'draft-ask-save', 'aria-describedby': 'draft-reasons' },
      'Save',
    );
    saveB.addEventListener('click', () => doSave(true));
    const discard = el(
      'button',
      { type: 'button', class: 'btn btn-secondary', id: 'draft-ask-discard' },
      'Discard',
    );
    discard.addEventListener('click', () => {
      const next = asking.next;
      open = null;
      asking = null;
      if (next) next();
      else closeRow(w.id);
    });
    const keep = el(
      'button',
      { type: 'button', class: 'btn btn-secondary', id: 'draft-ask-keep' },
      'Keep editing',
    );
    keep.addEventListener('click', () => {
      asking = null;
      bus.rerender();
      focusId('draft-save');
    });
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-labelledby', 'draft-ask-q');
    bar.append(
      el('p', { id: 'draft-ask-q' }, el('strong', null, 'Save changes to ' + name + '?')),
      el('div', { class: 'cluster' }, saveB, discard, keep),
      reasons,
    );
  } else {
    saveB = el(
      'button',
      { type: 'button', class: 'btn', id: 'draft-save', 'aria-describedby': 'draft-reasons' },
      'Save',
    );
    saveB.addEventListener('click', () => doSave(false));
    const cancel = el('button', { type: 'button', class: 'btn btn-secondary', id: 'draft-cancel' }, 'Cancel');
    cancel.addEventListener('click', () => closeRow(w.id));
    bar.append(stateLine, el('div', { class: 'cluster' }, saveB, cancel), reasons);
  }
  const sync = () => {
    if (!open) return;
    // A number still waiting for its typing pause is applied by the click on Save, so Save stays usable meanwhile.
    const probs = pendingEdits.size ? [] : draftProblems(S, w, open.draft);
    saveB.disabled = probs.length > 0;
    const t = probs.length ? 'To save: ' + probs.join(' ') : '';
    if (reasons.textContent !== t) reasons.textContent = t;
    reasons.hidden = !probs.length;
    const st = hasUnsaved() ? 'You have changes that aren’t saved yet.' : 'No changes yet.';
    if (stateLine.textContent !== st) stateLine.textContent = st;
  };
  ctx.changed = sync;
  sync();
  return bar;
}

/** One restaurant: a row, and when open, its editable cards and the Save bar. */
function restaurantRow(S, w) {
  const isOpen = !!open && open.wid === w.id;
  const head = rowHead('wp-row-' + w.id, w.name, rowSummary(S, w), isOpen, isOpen ? 'wp-body-' + w.id : null);
  head.addEventListener('click', () => {
    if (!isOpen) openRow(S, w.id);
    else if (!confirmLeave(() => closeRow(w.id))) closeRow(w.id);
  });
  let body = null;
  if (isOpen) {
    const ctx = makeCtx(w, false, false, open.draft);
    body = el(
      'div',
      { class: 'stack fold-body', id: 'wp-body-' + w.id },
      el('p', { class: 'hint' }, 'Change anything below, then tap Save. Nothing changes until you save.'),
      isWorkplaceSetUp(S, w) ? null : notReadyNote(ctx),
      ctx.rateNote,
      workplaceCard(ctx),
      periodCard(ctx, { title: 'Pay period and gross pay' }),
      dedCard(ctx),
      payCard(ctx),
      tipoutCard(ctx),
      saveBar(S, w, ctx),
    );
    demote(body);
  }
  const done =
    !isOpen && lastSaved && lastSaved.wid === w.id
      ? el('p', { class: 'hint fold-saved', role: 'status', id: 'wp-saved-' + w.id }, lastSaved.text)
      : null;
  return el(
    'section',
    { class: 'card fold' + (isOpen ? ' fold-open' : ''), 'data-row': w.id },
    el('h2', { class: 'fold-h' }, head),
    done,
    body,
  );
}

/** The shared sections (Late nights, Appearance, Backups...): one row each that opens in place. They apply right away. */
function foldRow(key, title, summaryFn, content) {
  const isOpen = foldOpen.has(key);
  const head = rowHead('fold-' + key, title, summaryFn(), isOpen, 'fold-body-' + key);
  const body = el('div', { class: 'stack fold-body', id: 'fold-body-' + key, hidden: !isOpen }, content);
  const sec = el(
    'section',
    { class: 'card fold' + (isOpen ? ' fold-open' : '') },
    el('h2', { class: 'fold-h' }, head),
    body,
  );
  head.addEventListener('click', () => {
    const now = !foldOpen.has(key);
    if (now) foldOpen.add(key);
    else foldOpen.delete(key);
    head.setAttribute('aria-expanded', String(now));
    body.hidden = !now;
    sec.classList.toggle('fold-open', now);
  });
  // the summary follows what was just changed inside
  const refresh = () => {
    const t = summaryFn();
    if (head.sum.textContent !== t) head.sum.textContent = t;
  };
  body.addEventListener('change', refresh);
  body.addEventListener('click', refresh);
  return sec;
}
/** A card's contents without its own heading (the row's heading replaces it). */
function inner(section) {
  if (!section) return [];
  const h = Array.from(section.children).find((c) => c.tagName === 'H2');
  if (h) h.remove();
  return Array.from(section.childNodes);
}

function fullPage(root, S, active) {
  if (open && !findWorkplace(S, open.wid)) {
    open = null; // removed (here or in another window)
    asking = null;
  }
  // "Skip guided setup" and the basics are still missing: that restaurant's editor opens by itself (unless closed).
  if (!open && !isWorkplaceSetUp(S, active) && !userClosed.has(active.id)) {
    open = { wid: active.id, base: snapOf(active), draft: snapOf(active) };
  }
  // Nothing typed yet: show what is saved now (another window may have changed it).
  if (open && !hasUnsaved()) {
    const w = findWorkplace(S, open.wid);
    open.base = snapOf(w);
    open.draft = snapOf(w);
  }
  if (restoreRequest.open) foldOpen.add('backup');
  const many = S.workplaces.length > 1;
  const importHost = el('div'),
    installHost = el('div'),
    backupHost = el('div');
  // Imported nights would count as "set up" and be worked out with whatever paystub is here, so the importer waits for the basics.
  if (isSetUp(S)) renderImporter(importHost);
  else
    importHost.append(
      el(
        'section',
        null,
        el('h2', null, 'Import'),
        el(
          'p',
          { class: 'hint' },
          'You can import nights from a spreadsheet once your paystub numbers are in.',
        ),
      ),
    );
  renderInstall(installHost);
  renderBackup(backupHost);
  const ctx = { S }; // the shared cards only use the state
  const sub = budgetVisible(S.settings.entitlement) ? subscriptionLine() : null; // hidden while payments are off
  const lastBackup = () => {
    const at = getState().settings.lastBackupAt;
    return 'Last backup: ' + (at ? fmtShort(todayISO(new Date(at))) : 'never');
  };
  const cutoffText = () => {
    const h = cutoffFromSettings(getState().settings);
    return h
      ? 'Before ' + h + ' a.m. counts as the night before'
      : 'Off: nights are dated the day you enter them';
  };
  const themeText = () =>
    ({ auto: 'Same as your phone', light: 'Light', dark: 'Dark' })[getState().settings.theme || 'auto'] ||
    'Same as your phone';
  root.append(
    el(
      'div',
      { class: 'stack' },
      exampleBanner(),
      el('h1', { id: 'setup-h1' }, 'Setup'),
      el(
        'p',
        { class: 'hint', id: 'setup-wp-hint' },
        (many ? 'Open a restaurant' : 'Open your restaurant') +
          ' to change its paystub, pay schedule, jobs or tip-out, then tap Save.',
      ),
      S.workplaces.map((w) => restaurantRow(S, w)),
      addWorkplaceCard(S),
      el(
        'p',
        { class: 'label fold-group' },
        many
          ? 'For all your restaurants. Changes apply right away.'
          : 'More settings. Changes apply right away.',
      ),
      foldRow('cutoff', 'Late nights', cutoffText, inner(cutoffCard(ctx))),
      foldRow('theme', 'Appearance', themeText, inner(themeCard(ctx))),
      foldRow(
        'import',
        'Import nights',
        () => 'From a spreadsheet (.csv) file',
        inner(importHost.firstElementChild),
      ),
      foldRow('install', 'Install TipNet', () => 'Open it like an app', inner(installHost.firstElementChild)),
      foldRow('backup', 'Backups', lastBackup, inner(backupHost.firstElementChild)),
      sub
        ? foldRow(
            'subscription',
            'Budget subscription',
            () => (isUnlocked(getState().settings.entitlement) ? 'Active' : 'Not active'),
            sub,
          )
        : null,
      foldRow('privacy', 'Privacy and terms', () => 'Your numbers stay on this device', [
        el(
          'p',
          { class: 'note' },
          'TipNet keeps your numbers in this browser only. ',
          el('a', { href: 'privacy.html' }, 'Privacy'),
          ' · ',
          el('a', { href: 'terms.html' }, 'Terms'),
        ),
        finePrint(),
      ]),
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
