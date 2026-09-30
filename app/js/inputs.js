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
 * Returns {status: 'none'|'ok'|'negative'|'over', message}. Only 'ok' cash is used for the check split and saved.
 */
export function checkCash(totalStr, cashStr, { tips = false, basePay = 0 } = {}) {
  const raw = String(cashStr == null ? '' : cashStr).replace(/[^0-9.-]/g, '');
  if (raw === '' || raw === '-' || raw === '.') return { status: 'none', message: '' };
  const cash = parseFloat(raw);
  if (!Number.isFinite(cash)) return { status: 'none', message: '' };
  if (cash < 0)
    return {
      status: 'negative',
      message: 'Cash can’t be a negative number. It won’t be saved until you fix it.',
    };
  const typed = String(totalStr == null ? '' : totalStr).replace(/[^0-9.-]/g, '');
  const total = typed === '' ? NaN : parseFloat(typed);
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
 * instead of flipping it. Empty or junk -> 0. This is the one hours parser in the app (the CSV import uses it too).
 * "1,250" or "1,250.5" is ambiguous (thousands? decimal?): with { strict: true } (CSV import) it returns NaN so the row
 * can be rejected; otherwise the comma is ignored (1250, which the screens refuse as more than 24 hours).
 */
export function parseHoursInput(v, { strict = false } = {}) {
  let s = String(v == null ? '' : v).trim();
  const neg = /^[-−]/.test(s);
  if (neg) s = s.slice(1).trim();
  const sign = neg ? -1 : 1;
  let x;
  if (/^\d*,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  else if (strict && (/^\d*,\d+(?:\.\d+)?$/.test(s) || /^\d+(?:,\d{3})+(?:\.\d+)?$/.test(s))) return NaN;
  if ((x = /^(\d+):(\d{1,2})(?::\d{1,2})?$/.exec(s))) return sign * (+x[1] + +x[2] / 60);
  if ((x = /^(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?$/i.exec(s)))
    return sign * (+x[1] + (x[2] ? +x[2] / 60 : 0));
  const n = parseFloat(s.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? sign * n : 0;
}

/** True when the text has something in it (so "0" counts, blank does not). */
export const hasHoursText = (v) => String(v == null ? '' : v).trim() !== '';
/** True when the text holds a number parseHoursInput can read (blank and junk like "abc" do not). */
export const hoursReadable = (v) => /\d/.test(String(v == null ? '' : v));

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
/** Plain message when a night's date is out of bounds (before 2000 or more than 1 day after today), else ''. */
export function dateProblem(iso, today) {
  const s = String(iso || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || s < MIN_NIGHT_DATE || s > maxNightDate(today))
    return 'Pick a date between Jan 1, 2000 and tomorrow.';
  return '';
}
