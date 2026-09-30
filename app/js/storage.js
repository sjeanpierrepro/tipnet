// TipNet persistence: state shape, migration, backup codes, IndexedDB + localStorage.
// The pure helpers (seedState, migrate, encodeBackup, decodeBackup) work in Node with no browser APIs.
import { exampleProfile, exampleNights, num, parseISO, todayISO, lockFinishedNights } from './math.js';
import { emptyBudget, migrateBudget } from './budget.js';

export const SCHEMA_VERSION = 2;
export const LEGACY_KEY = 'tipnet.v1';
const LS_KEY = 'tipnet.v2';
const DB_NAME = 'tipnet';
const STORE = 'kv';
const STATE_KEY = 'state';

/* ---------- state shape ---------- */
/** settings: {theme:'auto'|'light'|'dark', lastTab, csvMapping, setupDone, entitlement?}. budget: see budget.js */
export function seedState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    profileExample: true,
    nightsExample: true,
    profile: exampleProfile(),
    nights: exampleNights(),
    calib: [],
    budget: emptyBudget(),
    settings: { theme: 'auto', lastTab: 'tonight', csvMapping: null },
  };
}
/** Empty state after "Erase everything": example profile numbers, no nights. */
export function erasedState() {
  const s = seedState();
  s.nights = [];
  s.nightsExample = false;
  return s;
}

/* ---------- migration (prototype logic kept) ---------- */
const clone = (o) => JSON.parse(JSON.stringify(o));

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v, d = '') => (typeof v === 'string' ? v.slice(0, 200) : d);
const numOr0 = (v) => (typeof v === 'number' || typeof v === 'string' ? num(v) : 0);
const validDate = (v) => typeof v === 'string' && Number.isFinite(parseISO(v));
/** Ids must be unique and non-empty. Bad or repeated ids get a fresh one. */
function uniqueId(v, seen, prefix, i) {
  let id = (typeof v === 'string' && v) || (typeof v === 'number' && Number.isFinite(v) ? v : '');
  while (id === '' || seen.has(id)) id = prefix + i++ + '_' + seen.size;
  seen.add(id);
  return id;
}
function cleanPayTypes(list) {
  const seen = new Set();
  const out = (Array.isArray(list) ? list : [])
    .filter(isObj)
    .slice(0, 30)
    .map((t, i) => {
      const unit = ['hr', 'shift', 'amt'].includes(t.unit) ? t.unit : 'hr';
      const o = {
        id: uniqueId(t.id, seen, 'p', i + 1),
        name: text(t.name),
        rate: numOr0(t.rate),
        unit: i === 0 && unit === 'amt' ? 'hr' : unit,
        usual: numOr0(t.usual),
      };
      o.k = typeof t.k === 'string' && t.k ? t.k.slice(0, 40) : i === 0 ? 'hourly' : 'other';
      if (t.supp) o.supp = 1;
      if (t.diff) o.diff = true;
      return o;
    });
  if (!out.length) out.push({ id: 'p1', name: 'Main rate', rate: 0, unit: 'hr', usual: 7, k: 'hourly' });
  return out;
}
function cleanDeductions(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .filter(isObj)
    .slice(0, 50)
    .map((d, i) => ({
      id: uniqueId(d.id, seen, 'd', i + 1),
      k: typeof d.k === 'string' && d.k ? d.k.slice(0, 40) : 'other',
      name: text(d.name),
      amount: numOr0(d.amount),
      mode: d.mode === 'fixed' ? 'fixed' : 'pct',
    }));
}
const finiteIn = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
/** A night's locked Setup numbers (see snapshotFor in math.js). Anything malformed is dropped (the night is then unlocked). */
function cleanSnap(s) {
  if (
    !isObj(s) ||
    !finiteIn(s.r, 0, 1) ||
    !finiteIn(s.rf, 0, 1) ||
    !finiteIn(s.fixed, 0, 1e7) ||
    !finiteIn(s.n, 0.01, 1000) ||
    !Array.isArray(s.pay)
  )
    return null;
  const pay = s.pay
    .filter((t) => isObj(t) && (typeof t.id === 'string' || typeof t.id === 'number'))
    .slice(0, 30)
    .map((t, i) => {
      const o = {
        id: t.id,
        rate: numOr0(t.rate),
        unit: ['hr', 'shift', 'amt'].includes(t.unit) ? t.unit : 'hr',
      };
      if (i === 0) o.usual = numOr0(t.usual);
      if (t.supp) o.supp = 1;
      if (t.diff) o.diff = 1;
      return o;
    });
  const to = isObj(s.tipout) ? s.tipout : {};
  return {
    v: 1,
    r: s.r,
    rf: s.rf,
    fixed: s.fixed,
    n: s.n,
    pay,
    tipout: {
      on: !!to.on,
      mode: to.mode === 'flat' ? 'flat' : 'pct',
      value: numOr0(to.value),
      basis: text(to.basis, 'before') || 'before',
      from: text(to.from, 'cash') || 'cash',
    },
  };
}
/** A comparison entry. Old ones (label, pred, actual, err only) stay valid; new ones also carry the pay period and the rate before/after. */
function cleanCalib(c) {
  const o = { label: text(c.label), pred: numOr0(c.pred), actual: numOr0(c.actual), err: numOr0(c.err) };
  if (Number.isInteger(c.idx) && validDate(c.start) && validDate(c.end)) {
    o.idx = c.idx;
    o.start = c.start;
    o.end = c.end;
    const rate = (v) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : null);
    o.rateBefore = rate(c.rateBefore);
    o.rateAfter = rate(c.rateAfter);
  }
  return o;
}
function cleanNights(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .filter((n) => isObj(n) && validDate(n.date))
    .map((n, i) => {
      const pay = {};
      if (isObj(n.pay)) {
        Object.keys(n.pay).forEach((k) => {
          const v = n.pay[k];
          if (
            (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) &&
            Number.isFinite(parseFloat(v))
          )
            pay[k] = num(v);
        });
      }
      const hasCash =
        (typeof n.cash === 'number' || typeof n.cash === 'string') &&
        n.cash !== '' &&
        Number.isFinite(parseFloat(n.cash));
      const o = {
        id: uniqueId(n.id, seen, 'n', i + 1),
        date: n.date,
        total: numOr0(n.total),
        cash: hasCash ? num(n.cash) : null,
        pay,
        barback: n.barback === undefined ? true : !!n.barback,
      };
      if (typeof n.note === 'string' && n.note) o.note = n.note.slice(0, 500);
      const snap = cleanSnap(n.snap);
      if (snap) o.snap = snap;
      return o;
    });
}
function cleanSettings(x) {
  const s = isObj(x) ? x : {};
  const out = {
    theme: ['auto', 'light', 'dark'].includes(s.theme) ? s.theme : 'auto',
    lastTab: ['tonight', 'periods', 'budget', 'setup'].includes(s.lastTab) ? s.lastTab : 'tonight',
    csvMapping: null,
  };
  if (isObj(s.csvMapping)) {
    const m = {};
    Object.keys(s.csvMapping).forEach((k) => {
      const v = s.csvMapping[k];
      if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) m[k] = v;
    });
    out.csvMapping = m;
  }
  if (s.setupDone !== undefined) out.setupDone = !!s.setupDone;
  // "Late nights" rule: shifts logged before this hour count as the night before (0 = off). Kept only when it's a whole hour 0-12.
  if (Number.isInteger(s.dayCutoffHour) && s.dayCutoffHour >= 0 && s.dayCutoffHour <= 12)
    out.dayCutoffHour = s.dayCutoffHour;
  // The license entitlement is device-only. decodeBackup strips it before migrate; here we only keep its known plain fields.
  if (isObj(s.entitlement)) {
    const e = {};
    ['plan', 'key', 'instanceId', 'status', 'validatedAt', 'expiresAt'].forEach((k) => {
      const v = s.entitlement[k];
      if (v === null || typeof v === 'string' || typeof v === 'number') e[k] = v;
    });
    out.entitlement = e;
  }
  return out;
}

/**
 * Accepts anything (null, prototype v1 shapes both old and new, v2). Returns a fresh, valid v2 state.
 * Never throws for missing or garbage input; returns the seed state instead. Every field is coerced to a
 * safe shape (bad rows are dropped) so the math and screens can always render the result.
 */
export function migrate(input) {
  try {
    return migrateUnsafe(input);
  } catch (e) {
    return seedState();
  }
}
function migrateUnsafe(input) {
  let S;
  try {
    S = isObj(input) ? clone(input) : null;
  } catch (e) {
    S = null;
  }
  if (!S || !isObj(S.profile)) return seedState();
  const p = S.profile;
  const rawNights = Array.isArray(S.nights) ? S.nights.filter(isObj) : [];
  // Oldest prototype: single hourly rate and hours instead of payTypes.
  if (!Array.isArray(p.payTypes)) {
    p.payTypes = [{ id: 'p1', name: 'Main rate', rate: num(p.hourly), unit: 'hr', usual: num(p.hours) || 7 }];
    rawNights.forEach((n) => {
      if (!isObj(n.pay)) n.pay = { p1: num(n.hours) };
    });
  }
  // Older prototype: fixed set of deduction fields instead of a deductions list.
  if (!Array.isArray(p.deductions)) {
    const d = [];
    let n = 1;
    [
      ['fed', 'Federal income tax', p.fed, 'pct'],
      ['state', 'State / local tax', p.other, 'pct'],
      ['ss', 'Social Security', p.ss, 'pct'],
      ['med', 'Medicare', p.med, 'pct'],
      ['other', 'Benefits and fixed deductions', p.fixed, 'fixed'],
    ].forEach(([k, name, a, mode]) => {
      if (num(a)) d.push({ id: 'd' + n++, k, name, amount: num(a), mode });
    });
    p.deductions = d;
  }
  const out = {};
  // A missing or broken start date would leave every pay period undefined; fall back to today.
  out.periodStart = validDate(p.periodStart) ? p.periodStart : todayISO();
  out.periodEnd = validDate(p.periodEnd) ? p.periodEnd : '';
  out.gross = Math.max(0, numOr0(p.gross));
  out.shifts = Math.max(0, Math.round(numOr0(p.shifts)));
  const ro = p.rateOverride;
  out.rateOverride = typeof ro === 'number' && Number.isFinite(ro) && ro >= 0 && ro <= 1 ? ro : null;
  // freq: fixed day counts 7/14/15/30 or the calendar modes 'semimonthly'/'monthly'; anything else falls back to 14.
  let freq = p.freq;
  if (typeof freq === 'string' && /^[0-9]+$/.test(freq)) freq = Number(freq);
  out.freq = [7, 14, 15, 30, 'semimonthly', 'monthly'].includes(freq) ? freq : 14;
  // payDelay: whole days after the period end that the check arrives (0-21). Absent/blank stays absent (treated as 1).
  const pd = p.payDelay;
  if (!(
    pd === undefined ||
    pd === null ||
    pd === '' ||
    typeof pd === 'boolean' ||
    !Number.isFinite(Number(pd))
  ))
    out.payDelay = Math.min(21, Math.max(0, Math.round(Number(pd))));
  out.deductions = cleanDeductions(p.deductions);
  out.payTypes = cleanPayTypes(p.payTypes);
  const to = isObj(p.tipout) ? p.tipout : {};
  out.tipout = {
    on: !!to.on,
    mode: to.mode === 'flat' ? 'flat' : 'pct',
    value: numOr0(to.value),
    basis: text(to.basis, 'before') || 'before',
    from: text(to.from, 'cash') || 'cash',
  };
  const nights = lockFinishedNights(out, cleanNights(rawNights)).nights;
  return {
    schemaVersion: SCHEMA_VERSION,
    profileExample: !!S.profileExample,
    nightsExample: !!S.nightsExample,
    profile: out,
    nights,
    calib: (Array.isArray(S.calib) ? S.calib : []).filter(isObj).slice(-50).map(cleanCalib),
    budget: migrateBudget(S.budget, out), // old states and old backup codes have none: they get an empty budget; the profile converts old "Paid" ticks
    settings: cleanSettings(S.settings),
  };
}

/* ---------- backup codes: base64 of the JSON state, UTF-8 safe ---------- */
function toB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fromB64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
export function encodeBackup(state) {
  // The license key stays on this device: a backup code is pasted into notes and chats.
  const copy = { ...state, settings: { ...(state.settings || {}) } };
  delete copy.settings.entitlement;
  return toB64(JSON.stringify(copy));
}
/** Returns a migrated v2 state. Throws Error('bad-backup') if the code is not a TipNet backup. Accepts prototype codes. */
export function decodeBackup(code) {
  try {
    const clean = String(code).replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    const d = JSON.parse(fromB64(clean));
    if (!d || typeof d !== 'object' || !d.profile || !Array.isArray(d.nights)) throw new Error('shape');
    // A backup code is text anyone can write by hand, so it never carries device-only data.
    // The license (entitlement) belongs to this device and is only ever set by activating a key.
    if (d.settings && typeof d.settings === 'object') delete d.settings.entitlement;
    const out = migrate(d);
    delete out.settings.entitlement;
    return out;
  } catch (e) {
    throw new Error('bad-backup', { cause: e });
  }
}

/* ---------- IndexedDB wrapper (browser only; every access guarded) ---------- */
let cache = null;
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        try {
          req.result.createObjectStore(STORE);
        } catch (e) {
          /* ignore */
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
  return dbPromise;
}
function idbGet(db) {
  return new Promise((resolve) => {
    try {
      const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(STATE_KEY);
      r.onsuccess = () => resolve(r.result === undefined ? null : r.result);
      r.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}
function idbPut(db, value) {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, STATE_KEY);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch (e) {
      resolve(false);
    }
  });
}
function lsGet(key) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : null;
  } catch (e) {
    return null;
  }
}
function lsSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

/** Time a saved copy was written (ms), or 0 if unknown. */
const savedAtOf = (r) => (r && typeof r === 'object' && Number.isFinite(r._savedAt) ? r._savedAt : 0);
/**
 * Pure. Given the IndexedDB copy and the localStorage copy (either may be null), returns the newer one.
 * A copy without a timestamp counts as oldest; on a tie IndexedDB wins.
 */
export function pickNewest(idbCopy, lsCopy) {
  if (!idbCopy) return lsCopy || null;
  if (!lsCopy) return idbCopy;
  return savedAtOf(lsCopy) > savedAtOf(idbCopy) ? lsCopy : idbCopy;
}

/**
 * load(): reads IndexedDB (then localStorage v2, then legacy 'tipnet.v1'), migrates, fills the
 * in-memory cache and returns it. Never throws; falls back to the example state.
 */
export async function load() {
  let idbRaw = null;
  try {
    const db = await openDB();
    if (db) idbRaw = await idbGet(db);
  } catch (e) {
    idbRaw = null;
  }
  let raw = pickNewest(idbRaw, lsGet(LS_KEY));
  if (!raw) raw = lsGet(LEGACY_KEY);
  cache = migrate(raw);
  lockedOn = null;
  return cache;
}
/** Synchronous access to the cached state. Call load() first (returns the seed if not yet loaded). */
export function getState() {
  if (!cache) cache = seedState();
  return cache;
}
let lockedOn = null;
/**
 * Lock the nights of every pay period that has ended (see lockFinishedNights) in the cached state, and save if any got
 * stamped. Call it before anything applies a changed Setup, so an edit can never rewrite a finished period.
 * Unless force is set, it only looks once per calendar day (boundaries only pass at midnight).
 */
export function lockFinished({ force = false, today = todayISO() } = {}) {
  if (!force && lockedOn === today) return 0;
  lockedOn = today;
  const S = getState();
  const r = lockFinishedNights(S.profile, S.nights, today);
  if (!r.stamped) return 0;
  S.nights = r.nights;
  scheduleSave();
  return r.stamped;
}
/** Replace the whole state (e.g. after restore or erase) and schedule a save. */
export function setState(next) {
  cache = migrate(next);
  lockedOn = null;
  scheduleSave();
  return cache;
}

let timer = null;
export function scheduleSave(delay = 400) {
  try {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, delay);
  } catch (e) {
    /* ignore */
  }
}
/** Write now. Resolves true if something durable was written. */
export async function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!cache) return false;
  let ok = false;
  try {
    const snapshot = { ...clone(cache), _savedAt: Date.now() }; // same stamp in both stores, so load can pick the newer
    const db = await openDB();
    if (db) ok = await idbPut(db, snapshot);
    if (!ok) ok = lsSet(LS_KEY, snapshot);
    else lsSet(LS_KEY, snapshot); // belt and braces: keeps a fallback copy
  } catch (e) {
    ok = false;
  }
  return ok;
}
/** Ask the browser not to evict our data. Safe to call repeatedly. */
export async function requestPersist() {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
      if (navigator.storage.persisted && (await navigator.storage.persisted())) return true;
      return await navigator.storage.persist();
    }
  } catch (e) {
    /* ignore */
  }
  return false;
}
/** Test/dev helper: drop the cache without touching disk. */
export function _resetCache() {
  cache = null;
}
