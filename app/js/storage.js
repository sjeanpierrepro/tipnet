// TipNet persistence: state shape, migration, backup codes, IndexedDB + localStorage.
// The pure helpers (seedState, migrate, encodeBackup, decodeBackup) work in Node with no browser APIs.
import { exampleProfile, exampleNights, num } from './math.js';
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

/**
 * Accepts anything (null, prototype v1 shapes both old and new, v2). Returns a fresh, valid v2 state.
 * Never throws for missing or garbage input; returns the seed state instead.
 */
export function migrate(input) {
  let S;
  try { S = input && typeof input === 'object' ? clone(input) : null; } catch (e) { S = null; }
  if (!S || !S.profile || typeof S.profile !== 'object') return seedState();
  if (!Array.isArray(S.nights)) S.nights = [];
  if (!Array.isArray(S.calib)) S.calib = [];
  const p = S.profile;
  // Oldest prototype: single hourly rate and hours instead of payTypes.
  if (!p.payTypes) {
    p.payTypes = [{ id: 'p1', name: 'Main rate', rate: num(p.hourly), unit: 'hr', usual: num(p.hours) || 7 }];
    S.nights.forEach((n) => { if (!n.pay) n.pay = { p1: num(n.hours) }; });
  }
  if (p.periodEnd === undefined) p.periodEnd = '';
  // Older prototype: fixed set of deduction fields instead of a deductions list.
  if (!p.deductions) {
    const d = [];
    let n = 1;
    [['fed', 'Federal income tax', p.fed, 'pct'], ['state', 'State / local tax', p.other, 'pct'],
      ['ss', 'Social Security', p.ss, 'pct'], ['med', 'Medicare', p.med, 'pct'],
      ['other', 'Benefits and fixed deductions', p.fixed, 'fixed']]
      .forEach(([k, name, a, mode]) => { if (num(a)) d.push({ id: 'd' + (n++), k, name, amount: num(a), mode }); });
    p.deductions = d;
    ['fed', 'other', 'ss', 'med', 'fixed', 'hourly', 'hours'].forEach((k) => delete p[k]);
  }
  p.payTypes.forEach((t, i) => { if (!t.k) t.k = i === 0 ? 'hourly' : 'other'; });
  S.nights.forEach((n) => { if (!n.pay) n.pay = {}; if (n.barback === undefined) n.barback = true; });
  if (p.rateOverride === undefined) p.rateOverride = null;
  if (!p.tipout) p.tipout = { on: false, mode: 'pct', value: 0, basis: 'before', from: 'cash' };
  // freq: fixed day counts 7/14/15/30 or the calendar modes 'semimonthly'/'monthly'; anything else falls back to 14.
  if (typeof p.freq === 'string' && /^[0-9]+$/.test(p.freq)) p.freq = Number(p.freq);
  if (![7, 14, 15, 30, 'semimonthly', 'monthly'].includes(p.freq)) p.freq = 14;
  if (p.shifts === undefined) p.shifts = 0;
  // payDelay: whole days after the period end that the check arrives (0-21). Absent/blank stays absent (treated as 1).
  if (p.payDelay === undefined || p.payDelay === null || p.payDelay === '' || !Number.isFinite(Number(p.payDelay))) delete p.payDelay;
  else p.payDelay = Math.min(21, Math.max(0, Math.round(Number(p.payDelay))));
  S.budget = migrateBudget(S.budget); // old states and old backup codes have none: they get an empty budget
  S.profileExample = !!S.profileExample;
  S.nightsExample = !!S.nightsExample;
  S.settings = { theme: 'auto', lastTab: 'tonight', csvMapping: null, ...(S.settings || {}) };
  S.schemaVersion = SCHEMA_VERSION;
  return S;
}

/* ---------- backup codes: base64 of the JSON state, UTF-8 safe ---------- */
function toB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
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
    if (!d || !d.profile || !Array.isArray(d.nights)) throw new Error('shape');
    return migrate(d);
  } catch (e) {
    throw new Error('bad-backup');
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
      req.onupgradeneeded = () => { try { req.result.createObjectStore(STORE); } catch (e) { /* ignore */ } };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch (e) { resolve(null); }
  });
  return dbPromise;
}
function idbGet(db) {
  return new Promise((resolve) => {
    try {
      const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(STATE_KEY);
      r.onsuccess = () => resolve(r.result === undefined ? null : r.result);
      r.onerror = () => resolve(null);
    } catch (e) { resolve(null); }
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
    } catch (e) { resolve(false); }
  });
}
function lsGet(key) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
}

/**
 * load(): reads IndexedDB (then localStorage v2, then legacy 'tipnet.v1'), migrates, fills the
 * in-memory cache and returns it. Never throws; falls back to the example state.
 */
export async function load() {
  let raw = null;
  try {
    const db = await openDB();
    if (db) raw = await idbGet(db);
  } catch (e) { raw = null; }
  if (!raw) raw = lsGet(LS_KEY);
  if (!raw) raw = lsGet(LEGACY_KEY);
  cache = migrate(raw);
  return cache;
}
/** Synchronous access to the cached state. Call load() first (returns the seed if not yet loaded). */
export function getState() {
  if (!cache) cache = seedState();
  return cache;
}
/** Replace the whole state (e.g. after restore or erase) and schedule a save. */
export function setState(next) {
  cache = migrate(next);
  scheduleSave();
  return cache;
}

let timer = null;
export function scheduleSave(delay = 400) {
  try {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; flush(); }, delay);
  } catch (e) { /* ignore */ }
}
/** Write now. Resolves true if something durable was written. */
export async function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!cache) return false;
  let ok = false;
  try {
    const snapshot = clone(cache);
    const db = await openDB();
    if (db) ok = await idbPut(db, snapshot);
    if (!ok) ok = lsSet(LS_KEY, snapshot);
    else lsSet(LS_KEY, snapshot); // belt and braces: keeps a fallback copy
  } catch (e) { ok = false; }
  return ok;
}
/** Ask the browser not to evict our data. Safe to call repeatedly. */
export async function requestPersist() {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
      if (navigator.storage.persisted && (await navigator.storage.persisted())) return true;
      return await navigator.storage.persist();
    }
  } catch (e) { /* ignore */ }
  return false;
}
/** Test/dev helper: drop the cache without touching disk. */
export function _resetCache() { cache = null; }
