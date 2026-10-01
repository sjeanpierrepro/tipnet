// CSV import helpers. Everything is parsed locally; nothing is uploaded.
import { toCents, fromCents, formatISO } from './math.js';
import { parseHoursInput } from './inputs.js';

/** RFC 4180-ish parser. Returns an array of rows (arrays of strings). Handles BOM, quotes, "" escapes,
 *  commas and newlines inside quotes, CRLF/LF/CR. Blank lines are dropped. */
export function parseCSV(text) {
  let s = String(text == null ? '' : text);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const rows = [];
  let row = [],
    field = '',
    inQ = false,
    any = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += c;
    } else if (c === '"') {
      inQ = true;
      any = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
      any = true;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (any || row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      any = false;
    } else {
      field += c;
      any = true;
    }
  }
  if (any || field !== '' || row.length) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  return rows;
}

/** True when a spreadsheet value is written as negative: "-3", "$-3", "−3", "3-", "(3)" or "$(3)". */
export function looksNegative(v) {
  // Ignore currency symbols and spaces, then look for a minus sign at either end or accounting brackets.
  const bare = String(v == null ? '' : v).replace(/[\s$€£¥]/g, '');
  return /^[-−]/.test(bare) || /[-−]$/.test(bare) || /^\(.*\)$/.test(bare);
}

/** "$1,234.50" -> 1234.5, "(45.00)" and "$(45.00)" -> -45, "-$3" and "$-3" -> -3, "" or junk -> null. */
export function parseMoney(v) {
  if (v == null) return null;
  let s = String(v).trim();
  if (!s) return null;
  const neg = looksNegative(s);
  s = s.replace(/[^0-9.]/g, '');
  if (!s || s === '.' || (s.match(/\./g) || []).length > 1) return null;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/** "7.5" -> 7.5, "7,5" -> 7.5 (a lone comma before 1-2 digits is a decimal), "7:30" -> 7.5, "7h 30m" -> 7.5, junk -> 0.
 *  Never negative (a negative cell is caught by looksNegative). "1,250" or "1,250.5" is ambiguous (thousands? decimal?)
 *  and returns NaN so the caller can reject the row. The shared parser from inputs.js, in its strict mode. */
export function parseHours(v) {
  return Math.abs(parseHoursInput(v, { strict: true }));
}

const validYMD = (y, m, d) => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
/** Formats: YYYY-MM-DD, M/D/YYYY, M/D/YY (00-69 = 20xx), M/D (uses refYear). Returns "YYYY-MM-DD" or null. */
export function parseDate(v, refYear = new Date().getFullYear()) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  let y, m, d, x;
  if ((x = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(s))) {
    y = +x[1];
    m = +x[2];
    d = +x[3];
  } else if ((x = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s.*)?$/.exec(s))) {
    m = +x[1];
    d = +x[2];
    y = +x[3];
  } else if ((x = /^(\d{1,2})\/(\d{1,2})\/(\d{2})(?:\s.*)?$/.exec(s))) {
    m = +x[1];
    d = +x[2];
    y = +x[3] < 70 ? 2000 + +x[3] : 1900 + +x[3];
  } else if ((x = /^(\d{1,2})\/(\d{1,2})$/.exec(s))) {
    m = +x[1];
    d = +x[2];
    y = refYear;
  } else return null;
  if (!validYMD(y, m, d)) return null;
  return formatISO(Date.UTC(y, m - 1, d));
}

/**
 * Mapping presets. A mapping is {date, total, cash, card, hours, employee} where each value is a
 * lowercase header name to match (or null; "tips" is cash + card together, "total" is tips plus pay), resolved by guessMapping/resolveMapping.
 */
export const MAPPING_PRESETS = {
  generic: {
    label: 'Generic CSV',
    headers: {
      date: ['date', 'business date', 'day', 'shift date'],
      total: ['total', 'total made', 'earnings', 'total earned'],
      tips: ['tips', 'total tips', 'tips total', 'tip total', 'tips (cash + card)', 'total tip'],
      cash: ['cash', 'cash tips', 'cash tip'],
      card: ['card', 'card tips', 'credit tips', 'credit card tips', 'non-cash tips'],
      hours: ['hours', 'regular hours', 'hours worked', 'total hours'],
      employee: ['employee', 'name', 'employee name', 'server'],
    },
  },
  // Phase 2 seam: fill in once a real Toast labor/tips export is available. Header names below are
  // GUESSES, not verified against a real export.
  // toast: {
  //   label: 'Toast',
  //   headers: { date: ['business date'], cash: ['cash tips'], card: ['non-cash tips'],
  //              hours: ['regular hours'], employee: ['employee'] },
  // },
};

/** Guess column indexes from a header row. Returns {date,total,cash,card,hours,employee} with index or null. */
export function guessMapping(headerRow, preset = 'generic') {
  const spec = (MAPPING_PRESETS[preset] || MAPPING_PRESETS.generic).headers;
  const hs = headerRow.map((h) => String(h).trim().toLowerCase());
  const out = {};
  Object.keys(spec).forEach((field) => {
    let idx = -1;
    for (const name of spec[field]) {
      idx = hs.indexOf(name);
      if (idx >= 0) break;
    }
    out[field] = idx >= 0 ? idx : null;
  });
  // Any other header that mentions "tip" (and is not a cash or card column) is tips, never the total.
  if (out.tips == null && spec.tips)
    out.tips = hs.findIndex(
      (h, i) =>
        /\btips?\b/.test(h) &&
        !/cash|card|credit/.test(h) &&
        i !== out.cash &&
        i !== out.card &&
        i !== out.total,
    );
  if (out.tips === -1) out.tips = null;
  if (out.total != null && /tip/.test(hs[out.total]) && out.tips == null) {
    out.tips = out.total;
    out.total = null;
  }
  return out;
}
/** Turn a saved mapping of header NAMES back into indexes for a new file (or null if headers are gone). */
export function namesToMapping(headerRow, names) {
  const hs = headerRow.map((h) => String(h).trim().toLowerCase());
  const out = {};
  Object.keys(names || {}).forEach((f) => {
    const i = names[f] == null ? -1 : hs.indexOf(String(names[f]).toLowerCase());
    out[f] = i >= 0 ? i : null;
  });
  // A mapping saved before the Tips choice existed may have a tips column stored as "Total made".
  if (out.total != null && out.tips == null && /tip/.test(hs[out.total])) {
    out.tips = out.total;
    out.total = null;
  }
  return out;
}
/** Convert index mapping to header-name mapping for storing in settings.csvMapping. */
export function mappingToNames(headerRow, mapping) {
  const out = {};
  Object.keys(mapping || {}).forEach((f) => {
    out[f] =
      mapping[f] == null
        ? null
        : String(headerRow[mapping[f]] || '')
            .trim()
            .toLowerCase() || null;
  });
  return out;
}

/** Distinct employee values in the mapped column. */
export function listEmployees(rows, mapping) {
  if (mapping.employee == null) return [];
  return [...new Set(rows.map((r) => String(r[mapping.employee] || '').trim()).filter(Boolean))].sort();
}

/**
 * buildNights(rows, mapping, opts) -> {nights, skipped}
 *  rows: DATA rows (no header) as arrays. mapping: column indexes {date,total,tips,cash,card,hours,employee}.
 *  opts: {employee, refYear, rate (hourly $ for hours*rate), payId (id of the first HOURLY pay type; hours are stored there;
 *         null = no hourly pay type, so hours are ignored), barback (default true)}
 *  total = total column, else tips (or cash + card) + hours * rate. When the Tips column is mapped the night also stores
 *  `tips`. Several rows on the same date are summed.
 *  Night: {id, date, total, cash|null, [tips], pay:{[payId]:hours}, barback}. skipped: [{row, reason}] (row = 1-based data row;
 *  reason is 'date', 'amount', 'hours' (unreadable, ambiguous or over 24), or 'negative' for a negative money or hours value).
 */
export function buildNights(rows, mapping, opts = {}) {
  const { employee, refYear, rate = 0, payId = 'p1', barback = true } = opts;
  const useHours = payId != null;
  const byDate = new Map();
  const skipped = [];
  rows.forEach((r, i) => {
    const rowNo = i + 1;
    if (mapping.employee != null && employee && String(r[mapping.employee] || '').trim() !== employee) return;
    const date = parseDate(r[mapping.date], refYear);
    if (!date) {
      skipped.push({ row: rowNo, reason: 'date' });
      return;
    }
    const cash = mapping.cash != null ? parseMoney(r[mapping.cash]) : null;
    const card = mapping.card != null ? parseMoney(r[mapping.card]) : null;
    const tips = mapping.tips != null ? parseMoney(r[mapping.tips]) : null;
    const hours = mapping.hours != null && useHours ? parseHours(r[mapping.hours]) : 0;
    let total = mapping.total != null ? parseMoney(r[mapping.total]) : null;
    const hadTotal = total != null;
    // A negative amount or hours (refund, void, typo) is not a night we can trust: skip the row and say why.
    const negHours = mapping.hours != null && useHours && looksNegative(r[mapping.hours]);
    if (
      (cash != null && cash < 0) ||
      (card != null && card < 0) ||
      (tips != null && tips < 0) ||
      (total != null && total < 0) ||
      negHours
    ) {
      skipped.push({ row: rowNo, reason: 'negative' });
      return;
    }
    if (Number.isNaN(hours) || hours > 24) {
      skipped.push({ row: rowNo, reason: 'hours' });
      return;
    }
    if (total == null) {
      const tipsAmt = tips != null ? tips : cash != null || card != null ? (cash || 0) + (card || 0) : null;
      if (tipsAmt == null && !(hours && rate)) {
        skipped.push({ row: rowNo, reason: 'amount' });
        return;
      }
      total = fromCents(toCents(tipsAmt || 0) + toCents(hours * rate));
    }
    const cur = byDate.get(date) || { date, totalC: 0, cashC: null, tipsC: null, hours: 0, noTips: false };
    cur.totalC += toCents(total);
    if (cash != null) cur.cashC = (cur.cashC || 0) + toCents(cash);
    // A Total column wins: that row's total is stored as is, and no tips are stored beside it (tips + current pay could differ).
    if (hadTotal) cur.noTips = true;
    else if (tips != null) cur.tipsC = (cur.tipsC || 0) + toCents(tips);
    cur.hours += hours;
    byDate.set(date, cur);
  });
  const base = Date.now();
  const nights = [...byDate.values()]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((c, i) => {
      const n = {
        id: base + i,
        date: c.date,
        total: fromCents(c.totalC),
        cash: c.cashC == null ? null : fromCents(c.cashC),
        pay: c.hours ? { [payId]: c.hours } : {},
        barback,
      };
      if (c.tipsC != null && !c.noTips) n.tips = fromCents(c.tipsC);
      return n;
    });
  return { nights, skipped };
}

/** Split incoming nights into new ones and ones whose date already exists.
 *  duplicates: [{incoming, existing (the first night on that date), existingAll (every night on that date)}]. */
export function dedupeNights(incoming, existing) {
  const byDate = new Map();
  existing.forEach((n) => byDate.set(n.date, (byDate.get(n.date) || []).concat(n)));
  const fresh = [],
    duplicates = [];
  incoming.forEach((n) =>
    byDate.has(n.date)
      ? duplicates.push({ incoming: n, existing: byDate.get(n.date)[0], existingAll: byDate.get(n.date) })
      : fresh.push(n),
  );
  return { fresh, duplicates };
}
/**
 * Merge incoming nights into existing. overwrite=true replaces EVERY existing night on a duplicate date with the imported
 * night. With exactly one existing night it keeps that night's id, barback choice, other pay types, and cash when the
 * import has none; with several it uses the imported night as is (first night's id and barback choice). false keeps them all
 * and skips those dates. Returns new array + counts (replaced = dates replaced, removed = existing nights removed).
 */
export function mergeNights(existing, incoming, { overwrite = false } = {}) {
  const { fresh, duplicates } = dedupeNights(incoming, existing);
  let out = existing.slice();
  let removed = 0;
  if (overwrite) {
    const dupDates = new Set(duplicates.map((d) => d.incoming.date));
    out = out.filter((n) => !dupDates.has(n.date));
    removed = existing.length - out.length;
    out.push(
      ...duplicates.map(({ incoming: inc, existing: ex, existingAll: all }) => {
        if (all.length !== 1) return { ...inc, id: ex.id, barback: ex.barback };
        const merged = {
          ...ex,
          ...inc,
          id: ex.id,
          cash: inc.cash ?? ex.cash ?? null,
          pay: { ...ex.pay, ...inc.pay },
          barback: ex.barback,
        };
        if (inc.tips === undefined) delete merged.tips; // the old tips no longer match the new total
        return merged;
      }),
    );
  }
  out.push(...fresh);
  return {
    nights: out,
    added: fresh.length,
    replaced: overwrite ? duplicates.length : 0,
    removed,
    skipped: overwrite ? 0 : duplicates.length,
  };
}
