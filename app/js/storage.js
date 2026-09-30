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
/**
 * settings: {theme:'auto'|'light'|'dark', lastTab, csvMapping, setupDone, guideSkipped?, noDeductions?, entitlement?}. budget: see budget.js
 * profile.entryMode: 'tips' (the number typed each night is cash + card tips; TipNet adds the hourly/per-shift pay) or
 * 'total' (tips plus that pay). Either way a stored night's `total` is everything made, so the math never reads entryMode.
 */
export const ENTRY_MODES = ['tips', 'total'];
export function seedState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    profileExample: true,
    nightsExample: true,
    profile: { ...exampleProfile(), entryMode: 'tips' },
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
      if (typeof n.tips === 'number' && Number.isFinite(n.tips) && n.tips >= 0)
        o.tips = Math.round(n.tips * 100) / 100;
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
  if (s.guideSkipped === true) out.guideSkipped = true; // "Skip guided setup": the full Setup page, not set up until the basics are in
  if (s.noDeductions === true) out.noDeductions = true; // "My paystub has no deductions", ticked on the full Setup page
  // "Late nights" rule: shifts logged before this hour count as the night before (0 = off). Kept only when it's a whole hour 0-12.
  if (Number.isInteger(s.dayCutoffHour) && s.dayCutoffHour >= 0 && s.dayCutoffHour <= 12)
    out.dayCutoffHour = s.dayCutoffHour;
  // The guided setup in progress (see keepGuided in ui/setup.js), so a reload comes back to the same step. Its profile is
  // cleaned like the real one, but blank dates stay blank: the person has not typed them yet.
  if (isObj(s.guidedDraft)) {
    const g = s.guidedDraft;
    const d = { step: [0, 1, 2].includes(g.step) ? g.step : 0 };
    if (g.noDeductions === true) d.noDeductions = true;
    if (isObj(g.profile)) d.profile = cleanProfile(g.profile, { startFallback: '', entryDefault: 'tips' });
    out.guidedDraft = d;
  }
  // Backups: when the last backup code or file was made (ms), and until when the "Last backup" reminder is dismissed.
  const ms = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1e14;
  if (ms(s.lastBackupAt)) out.lastBackupAt = s.lastBackupAt;
  if (ms(s.backupNudgeUntil)) out.backupNudgeUntil = s.backupNudgeUntil;
  if (s.iosNoteSeen === true) out.iosNoteSeen = true; // the iPhone "Safari may clear data" note was shown once
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

/** The profile fields, each coerced to a safe shape. startFallback: the start date used when it is missing or broken. */
function cleanProfile(p, { startFallback, entryDefault }) {
  const out = {};
  out.periodStart = validDate(p.periodStart) ? p.periodStart : startFallback;
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
  out.entryMode = ENTRY_MODES.includes(p.entryMode) ? p.entryMode : entryDefault;
  return out;
}

/**
 * Accepts anything (null, prototype v1 shapes both old and new, v2). Returns a fresh, valid v2 state.
 * Never throws for missing or garbage input; returns the seed state instead. Every field is coerced to a
 * safe shape (bad rows are dropped) so the math and screens can always render the result.
 */
export function migrate(input, { today = todayISO() } = {}) {
  try {
    return migrateUnsafe(input, today);
  } catch (e) {
    return seedState();
  }
}
function migrateUnsafe(input, today) {
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
  // Existing users keep the meaning of their nightly number: anyone with real nights or their own profile typed totals.
  const realNights = !S.nightsExample && rawNights.length > 0;
  // A missing or broken start date: the example gets today (its dates are made up anyway). A real profile keeps it
  // blank, so Setup asks for it instead of inventing a pay schedule; TipNet does not count as set up until it is in.
  const out = cleanProfile(p, {
    startFallback: S.profileExample ? today : '',
    entryDefault: realNights || !S.profileExample ? 'total' : 'tips',
  });
  const cleaned = cleanNights(rawNights);
  const nights = validDate(out.periodStart) ? lockFinishedNights(out, cleaned, today).nights : cleaned;
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

/* ---------- set up or not ---------- */
/** Real nights: saved by the user (or imported / restored), not the example ones. */
export const hasRealNights = (S) => !!S && !S.nightsExample && Array.isArray(S.nights) && S.nights.length > 0;
/** The paystub basics an estimate needs: a pay period start date, gross pay, a main rate, and a deduction (or "no deductions" ticked). */
export function hasBasics(p, settings) {
  if (!p || !validDate(p.periodStart)) return false;
  const main = (p.payTypes || [])[0];
  return (
    num(p.gross) > 0 &&
    !!main &&
    num(main.rate) > 0 &&
    ((p.deductions || []).some((d) => num(d.amount) > 0) || !!(settings && settings.noDeductions))
  );
}
/**
 * Set up = TipNet can estimate this person's real take-home: they have real nights (saved, imported or restored),
 * or finished the guided setup, or (after "Skip guided setup", or a restored code without that flag) entered the
 * paystub basics themselves. The example paystub never counts, so no night is ever saved against example taxes.
 */
export function isSetUp(S) {
  if (!S || !S.profile) return false;
  if (!validDate(S.profile.periodStart)) return false; // without it there are no pay periods to estimate
  if (hasRealNights(S)) return true;
  if (S.profileExample) return false;
  if (S.settings && S.settings.setupDone) return true;
  return hasBasics(S.profile, S.settings);
}

/* ---------- backups: a code (base64 of the JSON state, UTF-8 safe) or a .json file with the same data ---------- */
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
/**
 * What a backup holds: the whole state except device-only settings. The license key stays on this device (a backup
 * code is pasted into notes and chats), and a half-finished guided setup is not worth carrying to another phone.
 */
export function backupData(state) {
  const copy = { ...state, settings: { ...((state && state.settings) || {}) } };
  delete copy.settings.entitlement;
  delete copy.settings.guidedDraft;
  delete copy._savedAt;
  delete copy._writer;
  return copy;
}
export function encodeBackup(state) {
  return toB64(JSON.stringify(backupData(state)));
}
/** The text of a backup file (tipnet-backup-YYYY-MM-DD.json): the same data as a backup code, as plain JSON. */
export function backupFileText(state) {
  return JSON.stringify(backupData(state));
}
/** Checks a parsed backup and migrates it. Throws unless it looks like TipNet data. Never keeps device-only data. */
function fromBackupObject(d) {
  if (!d || typeof d !== 'object' || !d.profile || !Array.isArray(d.nights)) throw new Error('shape');
  // A backup is text anyone can write by hand, so it never carries device-only data.
  // The license (entitlement) belongs to this device and is only ever set by activating a key.
  if (d.settings && typeof d.settings === 'object') {
    delete d.settings.entitlement;
    delete d.settings.guidedDraft;
  }
  const out = migrate(d);
  delete out.settings.entitlement;
  delete out.settings.guidedDraft;
  return out;
}
/** Returns a migrated v2 state. Throws Error('bad-backup') if the code is not a TipNet backup. Accepts prototype codes. */
export function decodeBackup(code) {
  try {
    const clean = String(code).replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    return fromBackupObject(JSON.parse(fromB64(clean)));
  } catch (e) {
    throw new Error('bad-backup', { cause: e });
  }
}
/** Reads a backup file's text (JSON; a backup code saved as a file works too). Throws Error('bad-backup'). */
export function decodeBackupFile(textIn) {
  const t = String(textIn == null ? '' : textIn)
    .replace(/^\uFEFF/, '')
    .trim();
  if (t.startsWith('{')) {
    try {
      return fromBackupObject(JSON.parse(t));
    } catch (e) {
      throw new Error('bad-backup', { cause: e });
    }
  }
  return decodeBackup(t);
}

/* ---------- IndexedDB wrapper (browser only; every access guarded) ---------- */
/*
 * Two copies of TipNet can be open at once (two tabs, or the installed app and a browser tab) and share this storage.
 * Each save is stamped with _savedAt and this copy's writer id. Before writing, a copy checks whether the stored data is
 * newer than what it last loaded or saved; if so it merges (see mergeStates) instead of overwriting, and the screen is
 * redrawn with the result. Other copies hear about a save through BroadcastChannel('tipnet') and the 'storage' event.
 */
let cache = null;
/** Stops waiting for IndexedDB after this long (it can hang when another tab holds an old version open). */
let idbWaitMs = 2000;
let db = null;
let opening = null;
const writerId = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
let base = null; // the state as this copy last loaded or saved it: what "changed here" is measured against
let lastKnown = 0; // _savedAt of that copy
let onExternal = null;
let onSaveResult = null;
let channel = null;

/** Resolves with p's value, or with fallback when p takes longer than ms (or fails). */
function within(p, ms, fallback) {
  return new Promise((resolve) => {
    let done = false;
    let t = null;
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve(v);
    };
    t = setTimeout(() => finish(fallback), ms);
    Promise.resolve(p).then(finish, () => finish(fallback));
  });
}
/** The open database, or null when there is none or it did not answer in time. A slow open keeps going in the background. */
function openDB() {
  if (db) return Promise.resolve(db);
  if (!opening) {
    opening = new Promise((resolve) => {
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
        req.onsuccess = () => {
          db = req.result;
          try {
            db.onversionchange = () => {
              db.close();
              db = null;
              opening = null;
            };
          } catch (e) {
            /* ignore */
          }
          resolve(db);
        };
        req.onerror = () => {
          opening = null; // try again next time
          resolve(null);
        };
        req.onblocked = () => resolve(null); // carry on without it; onsuccess may still arrive later
      } catch (e) {
        resolve(null);
      }
    });
  }
  return within(opening, idbWaitMs, null);
}
function idbGet(d) {
  return within(
    new Promise((resolve) => {
      try {
        const r = d.transaction(STORE, 'readonly').objectStore(STORE).get(STATE_KEY);
        r.onsuccess = () => resolve(r.result === undefined ? null : r.result);
        r.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    }),
    idbWaitMs,
    null,
  );
}
function idbPut(d, value) {
  return within(
    new Promise((resolve) => {
      try {
        const tx = d.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, STATE_KEY);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    }),
    idbWaitMs,
    false,
  );
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

/* ---------- merging two copies ---------- */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** One level deep: each key takes this copy's value if only this copy changed it, otherwise the other copy's. */
function mergeObj(b, mine, theirs) {
  const out = clone(theirs);
  Object.keys(mine).forEach((k) => {
    if (!same(mine[k], b[k]) && same(theirs[k], b[k])) out[k] = clone(mine[k]);
  });
  Object.keys(b).forEach((k) => {
    if (!(k in mine) && same(theirs[k], b[k])) delete out[k]; // removed here, untouched there
  });
  return out;
}
/** Nights by id: added here are added; edited or deleted here apply unless the other copy changed that night too. */
function mergeNightLists(b, mine, theirs) {
  const B = new Map(b.map((n) => [n.id, n]));
  const T = new Map(theirs.map((n) => [n.id, n]));
  const M = new Set(mine.map((n) => n.id));
  let out = theirs.map((n) => clone(n));
  let fresh = 0;
  mine.forEach((n) => {
    const was = B.get(n.id);
    const there = T.get(n.id);
    if (!was) {
      if (!there) out.push(clone(n));
      else if (!same(there, n)) {
        // the same new id on both sides (unlikely): keep both nights
        let id;
        do id = 'n' + Date.now().toString(36) + '_' + fresh++;
        while (T.has(id) || M.has(id));
        out.push({ ...clone(n), id });
      }
    } else if (!same(was, n) && there && same(there, was))
      out = out.map((x) => (x.id === n.id ? clone(n) : x));
  });
  B.forEach((was, id) => {
    if (!M.has(id) && T.has(id) && same(T.get(id), was)) out = out.filter((x) => x.id !== id);
  });
  return out;
}
/**
 * Pure. Three-way merge of two saved states: b is what this copy started from, mine is this copy now, theirs is what
 * another copy saved since. Nights merge one by one and settings and budget key by key; for anything else a change
 * made here wins only if the other copy left it alone. Nothing the other copy saved is dropped.
 */
export function mergeStates(b, mine, theirs) {
  const B = isObj(b) ? b : {};
  const out = clone(theirs);
  Object.keys(mine).forEach((k) => {
    if (k === 'nights' || k === '_savedAt' || k === '_writer' || same(mine[k], B[k])) return;
    if (same(theirs[k], B[k])) out[k] = clone(mine[k]);
    else if ((k === 'settings' || k === 'budget') && isObj(mine[k]) && isObj(theirs[k]) && isObj(B[k]))
      out[k] = mergeObj(B[k], mine[k], theirs[k]);
  });
  out.nights = mergeNightLists(
    Array.isArray(B.nights) ? B.nights : [],
    Array.isArray(mine.nights) ? mine.nights : [],
    Array.isArray(theirs.nights) ? theirs.nights : [],
  );
  delete out._savedAt;
  delete out._writer;
  return out;
}
const withoutTab = (S) => ({ ...S, settings: { ...S.settings, lastTab: null } });
/**
 * Take in a copy saved by another window, if it is newer than what this copy last loaded or saved. Synchronous.
 * Returns {changed, conflict (this copy had changes of its own, now merged), visible (the screen should redraw)}.
 */
function absorb(copy) {
  const none = { changed: false, conflict: false, visible: false };
  if (!cache || !copy || savedAtOf(copy) <= lastKnown || copy._writer === writerId) return none;
  const theirs = migrate(copy);
  const mine = cache;
  const hadChanges = !base || !same(mine, base);
  const next = hadChanges ? migrate(mergeStates(base, mine, theirs)) : theirs;
  const visible = !same(withoutTab(next), withoutTab(mine));
  cache = next;
  base = clone(theirs);
  lastKnown = savedAtOf(copy);
  lockedOn = null;
  return { changed: true, conflict: hadChanges && !same(next, theirs), visible };
}
function notify(r) {
  if (r.visible && onExternal) {
    try {
      onExternal({ conflict: r.conflict });
    } catch (e) {
      /* the screen redraw failed; the data is still right */
    }
  }
}
function ensureChannel() {
  if (channel || typeof BroadcastChannel === 'undefined') return;
  try {
    channel = new BroadcastChannel('tipnet');
    if (channel.unref) channel.unref(); // Node (tests): do not keep the process alive
    channel.onmessage = (e) => {
      const d = e && e.data;
      if (d && d.type === 'saved' && d.writer !== writerId && d.savedAt > lastKnown) syncFromStorage();
    };
  } catch (e) {
    channel = null;
  }
}
/** fn({conflict}) runs after another window's save changed what this copy shows (app.js redraws and says so). */
export function setExternalHandler(fn) {
  onExternal = fn;
}
/** fn(ok) runs after every save attempt (app.js shows or hides the "Couldn't save" banner). */
export function setSaveHandler(fn) {
  onSaveResult = fn;
}
/**
 * Another window saved (BroadcastChannel message or 'storage' event): read the newest stored copy and take it in.
 * This copy's unsaved changes are merged and written back. Resolves true when something changed.
 */
export async function syncFromStorage() {
  if (!cache) return false;
  let idbCopy = null;
  try {
    const d = await openDB();
    if (d) idbCopy = await idbGet(d);
  } catch (e) {
    idbCopy = null;
  }
  const r = absorb(pickNewest(idbCopy, lsGet(LS_KEY)));
  if (!r.changed) return false;
  if (r.conflict) await flush();
  notify(r);
  return true;
}

/**
 * load(): reads IndexedDB (then localStorage v2, then legacy 'tipnet.v1'), migrates, fills the
 * in-memory cache and returns it. Never throws; falls back to the example state. If IndexedDB does not answer within
 * about 2 seconds, TipNet starts from the localStorage copy and takes in the IndexedDB copy later if that one is newer.
 */
export async function load() {
  ensureChannel();
  let idbRaw = null;
  try {
    const d = await openDB();
    if (d) idbRaw = await idbGet(d);
  } catch (e) {
    idbRaw = null;
  }
  let raw = pickNewest(idbRaw, lsGet(LS_KEY));
  if (!raw) raw = lsGet(LEGACY_KEY);
  cache = migrate(raw);
  base = clone(cache);
  lastKnown = savedAtOf(raw);
  lockedOn = null;
  if (!db && opening) {
    // IndexedDB was slow: take in its copy once it opens (if newer), without holding up the first screen
    opening.then((d) => {
      if (d) syncFromStorage();
    });
  }
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
  if (!validDate(S.profile.periodStart)) return 0; // no pay schedule yet: nothing has finished
  const r = lockFinishedNights(S.profile, S.nights, today);
  if (!r.stamped) return 0;
  S.nights = r.nights;
  scheduleSave();
  return r.stamped;
}
/** Replace the whole state (e.g. after restore or erase) and schedule a save. today: for tests (default: the real date). */
export function setState(next, { today } = {}) {
  cache = migrate(next, today ? { today } : undefined);
  lockedOn = null;
  scheduleSave();
  return cache;
}

let timer = null;
let pending = null; // {promise, resolve} shared by every scheduleSave until the next flush
/** Save soon (changes close together are written once). Resolves with the result of that write (true = saved). */
export function scheduleSave(delay = 400) {
  if (!pending) {
    let resolve;
    const promise = new Promise((r) => {
      resolve = r;
    });
    pending = { promise, resolve };
  }
  const p = pending.promise;
  try {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, delay);
  } catch (e) {
    /* ignore */
  }
  return p;
}
const stamped = (json, at) => ({ ...JSON.parse(json), _savedAt: at, _writer: writerId });
/**
 * Write now. Resolves true if something durable was written. The quick localStorage copy is written first and
 * synchronously (so it lands even while the page is closing), then IndexedDB. If another window saved since this copy
 * last loaded or saved, that data is merged in first instead of being overwritten.
 */
export async function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const waiters = pending;
  pending = null;
  let ok = false;
  if (cache) {
    try {
      // 1. localStorage: take in a newer copy from another window, then write. Nothing before this is asynchronous.
      // The screen is redrawn right away, so nothing typed from here on lands in the replaced state.
      notify(absorb(lsGet(LS_KEY)));
      let at = Math.max(Date.now(), lastKnown + 1);
      let json = JSON.stringify(cache);
      const lsOk = lsSet(LS_KEY, stamped(json, at));
      if (lsOk) {
        base = JSON.parse(json);
        lastKnown = at;
      }
      // 2. IndexedDB (may be slow or missing).
      let idbOk = false;
      const d = await openDB();
      if (d) {
        const r = absorb(await idbGet(d)); // newer only when localStorage could not be written (full)
        if (r.changed) {
          notify(r);
          at = Math.max(Date.now(), lastKnown + 1);
          json = JSON.stringify(cache);
          lsSet(LS_KEY, stamped(json, at));
        }
        idbOk = await idbPut(d, stamped(json, at));
        if (idbOk) {
          base = JSON.parse(json);
          lastKnown = at;
        }
      }
      ok = lsOk || idbOk;
      if (ok && channel) {
        try {
          channel.postMessage({ type: 'saved', writer: writerId, savedAt: at });
        } catch (e) {
          /* ignore */
        }
      }
    } catch (e) {
      ok = false;
    }
  }
  if (waiters) waiters.resolve(ok);
  if (onSaveResult) {
    try {
      onSaveResult(ok);
    } catch (e) {
      /* ignore */
    }
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
  base = null;
  lastKnown = 0;
}
/** Test helper: how long to wait for IndexedDB before carrying on without it (ms). */
export function _setIdbWait(ms) {
  idbWaitMs = ms;
}
