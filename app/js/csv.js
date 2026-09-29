// CSV import helpers. Everything is parsed locally; nothing is uploaded.
import { num, toCents, fromCents, formatISO } from './math.js';

/** RFC 4180-ish parser. Returns an array of rows (arrays of strings). Handles BOM, quotes, "" escapes,
 *  commas and newlines inside quotes, CRLF/LF/CR. Blank lines are dropped. */
export function parseCSV(text) {
  let s = String(text == null ? '' : text);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const rows = [];
  let row = [], field = '', inQ = false, any = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else if (c === '"') { inQ = true; any = true; }
    else if (c === ',') { row.push(field); field = ''; any = true; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (any || row.length > 1 || row[0] !== '') rows.push(row);
      row = []; any = false;
    } else { field += c; any = true; }
  }
  if (any || field !== '' || row.length) { row.push(field); if (row.length > 1 || row[0] !== '') rows.push(row); }
  return rows;
}

/** "$1,234.50" -> 1234.5, "(45.00)" -> -45, "-$3" -> -3, "" or junk -> null. */
export function parseMoney(v) {
  if (v == null) return null;
  let s = String(v).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/^-/.test(s) || /-$/.test(s)) neg = true;
  s = s.replace(/[^0-9.]/g, '');
  if (!s || s === '.' || (s.match(/\./g) || []).length > 1) return null;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
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
  if ((x = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(s))) { y = +x[1]; m = +x[2]; d = +x[3]; }
  else if ((x = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s.*)?$/.exec(s))) { m = +x[1]; d = +x[2]; y = +x[3]; }
  else if ((x = /^(\d{1,2})\/(\d{1,2})\/(\d{2})(?:\s.*)?$/.exec(s))) { m = +x[1]; d = +x[2]; y = +x[3] < 70 ? 2000 + +x[3] : 1900 + +x[3]; }
  else if ((x = /^(\d{1,2})\/(\d{1,2})$/.exec(s))) { m = +x[1]; d = +x[2]; y = refYear; }
  else return null;
  if (!validYMD(y, m, d)) return null;
  return formatISO(Date.UTC(y, m - 1, d));
}

/**
 * Mapping presets. A mapping is {date, total, cash, card, hours, employee} where each value is a
 * lowercase header name to match (or null), resolved by guessMapping/resolveMapping.
 */
export const MAPPING_PRESETS = {
  generic: {
    label: 'Generic CSV',
    headers: {
      date: ['date', 'business date', 'day', 'shift date'],
      total: ['total', 'total made', 'total tips', 'earnings', 'total earned'],
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
    for (const name of spec[field]) { idx = hs.indexOf(name); if (idx >= 0) break; }
    out[field] = idx >= 0 ? idx : null;
  });
  return out;
}
/** Turn a saved mapping of header NAMES back into indexes for a new file (or null if headers are gone). */
export function namesToMapping(headerRow, names) {
  const hs = headerRow.map((h) => String(h).trim().toLowerCase());
  const out = {};
  Object.keys(names || {}).forEach((f) => { const i = names[f] == null ? -1 : hs.indexOf(String(names[f]).toLowerCase()); out[f] = i >= 0 ? i : null; });
  return out;
}
/** Convert index mapping to header-name mapping for storing in settings.csvMapping. */
export function mappingToNames(headerRow, mapping) {
  const out = {};
  Object.keys(mapping || {}).forEach((f) => { out[f] = mapping[f] == null ? null : String(headerRow[mapping[f]] || '').trim().toLowerCase() || null; });
  return out;
}

/** Distinct employee values in the mapped column. */
export function listEmployees(rows, mapping) {
  if (mapping.employee == null) return [];
  return [...new Set(rows.map((r) => String(r[mapping.employee] || '').trim()).filter(Boolean))].sort();
}

/**
 * buildNights(rows, mapping, opts) -> {nights, skipped}
 *  rows: DATA rows (no header) as arrays. mapping: column indexes {date,total,cash,card,hours,employee}.
 *  opts: {employee, refYear, rate (hourly $ for hours*rate), payId (id of main pay type; hours are stored there),
 *         barback (default true)}
 *  total = total column, else cash + card + hours * rate. Several rows on the same date are summed.
 *  Night: {id, date, total, cash|null, pay:{[payId]:hours}, barback}. skipped: [{row, reason}] (row = 1-based data row).
 */
export function buildNights(rows, mapping, opts = {}) {
  const { employee, refYear, rate = 0, payId = 'p1', barback = true } = opts;
  const byDate = new Map();
  const skipped = [];
  rows.forEach((r, i) => {
    const rowNo = i + 1;
    if (mapping.employee != null && employee && String(r[mapping.employee] || '').trim() !== employee) return;
    const date = parseDate(r[mapping.date], refYear);
    if (!date) { skipped.push({ row: rowNo, reason: 'date' }); return; }
    const cash = mapping.cash != null ? parseMoney(r[mapping.cash]) : null;
    const card = mapping.card != null ? parseMoney(r[mapping.card]) : null;
    const hours = mapping.hours != null ? num(String(r[mapping.hours]).replace(/[^0-9.\-]/g, '')) : 0;
    let total = mapping.total != null ? parseMoney(r[mapping.total]) : null;
    if (total == null) {
      if (cash == null && card == null && !(hours && rate)) { skipped.push({ row: rowNo, reason: 'amount' }); return; }
      total = fromCents(toCents(cash || 0) + toCents(card || 0) + toCents(hours * rate));
    }
    const cur = byDate.get(date) || { date, totalC: 0, cashC: null, hours: 0 };
    cur.totalC += toCents(total);
    if (cash != null) cur.cashC = (cur.cashC || 0) + toCents(cash);
    cur.hours += hours;
    byDate.set(date, cur);
  });
  const base = Date.now();
  const nights = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).map((c, i) => ({
    id: base + i,
    date: c.date,
    total: fromCents(c.totalC),
    cash: c.cashC == null ? null : fromCents(c.cashC),
    pay: c.hours ? { [payId]: c.hours } : {},
    barback,
  }));
  return { nights, skipped };
}

/** Split incoming nights into new ones and ones whose date already exists. */
export function dedupeNights(incoming, existing) {
  const byDate = new Map(existing.map((n) => [n.date, n]));
  const fresh = [], duplicates = [];
  incoming.forEach((n) => (byDate.has(n.date) ? duplicates.push({ incoming: n, existing: byDate.get(n.date) }) : fresh.push(n)));
  return { fresh, duplicates };
}
/** Merge incoming nights into existing. overwrite=true replaces same-date nights; false skips them. Returns new array + counts. */
export function mergeNights(existing, incoming, { overwrite = false } = {}) {
  const { fresh, duplicates } = dedupeNights(incoming, existing);
  let out = existing.slice();
  if (overwrite) {
    const dupDates = new Set(duplicates.map((d) => d.incoming.date));
    out = out.filter((n) => !dupDates.has(n.date));
    out.push(...duplicates.map((d) => ({ ...d.incoming, id: d.existing.id })));
  }
  out.push(...fresh);
  return { nights: out, added: fresh.length, replaced: overwrite ? duplicates.length : 0, skipped: overwrite ? 0 : duplicates.length };
}
