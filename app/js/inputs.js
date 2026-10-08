// Small pure helpers for the entry screens (no DOM), so they can be tested on their own.

export const DEFAULT_CUTOFF_HOUR = 6;
const pad = (n) => String(n).padStart(2, '0');

/** Read the "count as the night before" hour from settings. Missing or junk -> 6 (a.m.). Allowed 0..12. */
export function cutoffFromSettings(settings) {
  const v = settings && settings.dayCutoffHour;
  return Number.isInteger(v) && v >= 0 && v <= 12 ? v : DEFAULT_CUTOFF_HOUR;
}

/**
 * The date a shift logged at `now` belongs to. Before cutoffHour (local time) it is still last night's shift,
 * so the date is yesterday. cutoffHour 0 turns this off. Uses calendar arithmetic, not 24-hour math,
 * so daylight-saving nights (23 or 25 hours long) still land on the right date.
 */
export function businessDate(now = new Date(), cutoffHour = DEFAULT_CUTOFF_HOUR) {
  let y = now.getFullYear(),
    m = now.getMonth(),
    d = now.getDate();
  if (cutoffHour > 0 && now.getHours() < cutoffHour) {
    const prev = new Date(Date.UTC(y, m, d - 1));
    y = prev.getUTCFullYear();
    m = prev.getUTCMonth();
    d = prev.getUTCDate();
  }
  return y + '-' + pad(m + 1) + '-' + pad(d);
}

/**
 * Check the optional cash amount against the tips it came out of. Cash in hand is cash tips, so it is never more than
 * the tips:
 *   tips mode (tips: true): the typed number is the tips (cash + card), so cash can't be more than it, even at $0.
 *   total mode: the typed number is tips + hourly pay, so cash can't be more than the total minus basePay
 *   (tonight's hourly and per-shift pay).
 * Returns {status: 'none'|'ok'|'negative'|'over'|'typo', message}. Only 'ok' cash is used for the check split and saved.
 */
export function checkCash(totalStr, cashStr, { tips = false, basePay = 0 } = {}) {
  const cash = readMoney(cashStr);
  if (cash === null) return { status: 'none', message: '' };
  if (Number.isNaN(cash)) return { status: 'typo', message: moneyTypo(cashStr) };
  if (cash < 0)
    return {
      status: 'negative',
      message: 'Cash can’t be a negative number. It won’t be saved until you fix it.',
    };
  const total = readMoney(totalStr) ?? NaN;
  if (tips) {
    if (Number.isFinite(total) && total >= 0 && cash > total + 0.005)
      return {
        status: 'over',
        message: 'Cash is more than the tips you entered. Check the number. The cash amount won’t be saved.',
      };
  } else if (Number.isFinite(total) && total > 0) {
    const pay = Number.isFinite(basePay) && basePay > 0 ? basePay : 0;
    if (cash > Math.max(0, total - pay) + 0.005)
      return {
        status: 'over',
        message: pay
          ? 'Cash is more than the tips in what you made tonight (the total minus $' +
            pay.toFixed(2) +
            ' of hourly pay). Check the number. The cash amount won’t be saved.'
          : 'Cash is more than what you made tonight. Check the number. The cash amount won’t be saved.',
      };
  }
  return { status: 'ok', message: '' };
}

/**
 * Why is "on your check" negative? c = computeNight result (cash already valid).
 * null (not negative) | 'taxes' (taxes on the money you kept exceed what is left after cash) | 'fixed' (only the fixed deductions push it below zero).
 */
export function negativeCheckReason(c) {
  if (c.onCheck == null || c.onCheck >= 0) return null;
  const beforeTax = c.kept + c.extra - c.cashInHand;
  return beforeTax - c.tax < 0 ? 'taxes' : 'fixed';
}

/**
 * Read an hours/shifts field. "7:30" = 7.5, "7h 30m" = 7.5, "7.5" = 7.5, "7,5" = 7.5 (a lone comma before 1-2 digits
 * is a decimal comma). A leading minus stays negative ("-5" = -5, "-7:30" = -7.5), so the screens can refuse it
 * instead of flipping it. Empty or junk -> 0. This is the one hours parser in the app.
 * "1,250" or "1,250.5" is ambiguous (thousands? decimal?): the comma is ignored (1250, which the screens refuse as more than
 * 24 hours).
 */
const HOURS_UNIT = 'h(?:ours?|rs?)?';
// "7h30", "7h 30", "7h 30m": the minutes after the unit may skip the "m".
const HM_RE = new RegExp(
  `^(\\d+(?:\\.\\d+)?|\\.\\d+)\\s*${HOURS_UNIT}\\s*(?:(\\d+)\\s*(?:m(?:in(?:ute)?s?)?)?)?$`,
  'i',
);
const CLOCK_RE = new RegExp(`^(\\d+):(\\d{1,2})(?::\\d{1,2})?(?:\\s*${HOURS_UNIT})?$`, 'i'); // "7:30", "7:30 hrs"
const FRACS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '1/2': 0.5, '1/4': 0.25, '3/4': 0.75 };
const FRAC_RE = new RegExp(`^(?:(\\d+)\\s*)?(½|¼|¾|1/2|1/4|3/4)(?:\\s*${HOURS_UNIT})?$`, 'i'); // "7½", "7 1/2", "7½h"
/**
 * A decimal comma before 1-2 digits becomes a point, with or without a unit after it ("7,5", "7,5h", "7,5 hrs").
 * withShifts: a trailing "shift"/"shifts" is dropped too ("1 shift"), for a Shifts box.
 */
function normHours(s, withShifts = false) {
  if (withShifts) s = s.replace(/\s*shifts?$/i, '');
  const m = /^(\d*),(\d{1,2})(\s*h(?:ours?|rs?)?)?$/i.exec(s);
  return m ? m[1] + '.' + m[2] + (m[3] || '') : s;
}
/** A period after the unit ("8hrs.") or after a plain number ("7.5.") is dropped. */
function dropEndPeriod(s) {
  if (/^\d.*[a-z]\.$/i.test(s) || /^\d+(?:\.\d+)?\.$/.test(s)) return s.slice(0, -1);
  return s;
}
export function parseHoursInput(v) {
  let s = String(v == null ? '' : v).trim();
  const neg = /^[-−]/.test(s);
  if (neg) s = s.slice(1).trim();
  s = normHours(dropEndPeriod(s), true); // a Shifts box reads "1 shift"
  const sign = neg ? -1 : 1;
  let x;
  if ((x = CLOCK_RE.exec(s))) return sign * (+x[1] + +x[2] / 60);
  if ((x = HM_RE.exec(s))) return sign * (+x[1] + (x[2] ? +x[2] / 60 : 0));
  if ((x = FRAC_RE.exec(s))) return sign * (+(x[1] || 0) + FRACS[x[2]]);
  const n = parseFloat(s.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? sign * n : 0;
}

/** True when the text has something in it (so "0" counts, blank does not). */
export const hasHoursText = (v) => String(v == null ? '' : v).trim() !== '';
/** True when the text holds a number parseHoursInput can read (blank and junk like "abc" do not). */
export const hoursReadable = (v) => /\d/.test(String(v == null ? '' : v));

/**
 * Read a money box strictly. Blank -> null (nothing typed), a typo -> NaN, else the number as typed (full precision;
 * the screens round). Accepted after trimming: 123, 123., 123.45, .5, thousands groups (1,250 / 12,500.75), a lone
 * decimal comma (12,5 / 12,50), an optional "$" before ("$ 12.50") or after ("12.50$") the digits, a leading "+" and an
 * optional leading minus, which stays negative so each screen can keep its own "can't be negative" message. A percent
 * box ({ percent: true }) takes a trailing "%" instead of "$" ("15%", "1.25 %"). Anything else is a typo: "1.2.3",
 * "12abc", "1,2,3", "$", "12 50".
 */
export function readMoney(text, { percent = false } = {}) {
  let s = String(text == null ? '' : text).trim();
  if (s === '') return null;
  const neg = /^[-−]/.test(s);
  if (neg || s[0] === '+') s = s.slice(1);
  s = percent ? s.replace(/\s*%$/, '') : s.replace(/^\$\s*|\s*\$$/, '');
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d*)?$/.test(s)) s = s.replace(/,/g, '');
  else if (/^\d*,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
  const n = parseFloat(s);
  return neg && n !== 0 ? -n : n;
}
/** '' when the money text is blank or readable, else a short message to show next to the box. */
export function moneyTypo(text) {
  const n = readMoney(text);
  return n !== null && Number.isNaN(n)
    ? 'That isn’t an amount. Use numbers and one decimal point, like 12.50.'
    : '';
}
/** Same as moneyTypo for a percent box ("15", "1.25", "15%"), with percent wording. */
export function percentTypo(text) {
  const n = readMoney(text, { percent: true });
  return n !== null && Number.isNaN(n) ? 'That isn’t a percent. Use something like 15 or 1.25.' : '';
}
/** True when parseHoursInput reads this text as it was meant (blank counts: nothing typed is not a typo). */
function hoursShape(text, unit = 'hours') {
  let s = String(text == null ? '' : text).trim();
  if (s === '') return true;
  if (/^[-−]/.test(s)) s = s.slice(1).trim();
  s = normHours(dropEndPeriod(s), unit === 'shifts');
  return CLOCK_RE.test(s) || HM_RE.test(s) || FRAC_RE.test(s) || /^(?:\d+\.?\d*|\.\d+)$/.test(s);
}
/** '' when an hours/shifts box is blank or readable, else a short message. unit: 'hours' | 'shifts'. */
export function hoursTypo(text, unit = 'hours') {
  if (hoursShape(text, unit)) return '';
  return unit === 'shifts'
    ? 'That isn’t a number of shifts. Use something like 1 or 1.5.'
    : 'That isn’t a number of hours. Use something like 7.5 or 7:30.';
}

/* ---------- night date bounds ---------- */
/** Earliest night date accepted. */
export const MIN_NIGHT_DATE = '2000-01-01';
function addDaysISO(iso, n) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate());
}
/** Latest night date accepted: the day after today (a shift can run past midnight). */
export const maxNightDate = (today) => addDaysISO(today, 1);
/**
 * Plain message when a night's date is out of bounds (before 2000 or more than 1 day after today), else ''. It names the
 * latest date, not "tomorrow": before the late-night cutoff today is still yesterday's date, so "tomorrow" misleads.
 */
export function dateProblem(iso, today) {
  const s = String(iso || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || s < MIN_NIGHT_DATE || s > maxNightDate(today)) {
    const [y, m, d] = maxNightDate(today).split('-').map(Number);
    const last = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
    return 'Pick a date between Jan 1, 2000 and ' + last + '.';
  }
  return '';
}
