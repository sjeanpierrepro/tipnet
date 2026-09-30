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
  let y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  if (cutoffHour > 0 && now.getHours() < cutoffHour) {
    const prev = new Date(Date.UTC(y, m, d - 1));
    y = prev.getUTCFullYear(); m = prev.getUTCMonth(); d = prev.getUTCDate();
  }
  return y + '-' + pad(m + 1) + '-' + pad(d);
}

/**
 * Check the optional cash amount against tonight's total.
 * Returns {status: 'none'|'ok'|'negative'|'over', message}. Only 'ok' cash is used for the check split and saved.
 */
export function checkCash(totalStr, cashStr) {
  const raw = String(cashStr == null ? '' : cashStr).replace(/[^0-9.\-]/g, '');
  if (raw === '' || raw === '-' || raw === '.') return { status: 'none', message: '' };
  const cash = parseFloat(raw);
  if (!Number.isFinite(cash)) return { status: 'none', message: '' };
  if (cash < 0) return { status: 'negative', message: 'Cash can’t be a negative number. It won’t be saved until you fix it.' };
  const total = parseFloat(String(totalStr == null ? '' : totalStr).replace(/[^0-9.\-]/g, ''));
  if (Number.isFinite(total) && total > 0 && cash > total + 0.005) {
    return { status: 'over', message: 'Cash is more than what you made tonight. Check the number. The cash amount won’t be saved.' };
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
