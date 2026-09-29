// TipNet billing: license-key entitlement for the paid budgeting add-on. No server of our own.
// Pure logic (isUnlocked, needsRevalidate, maskKey, parsers, provider) works in Node with fetch injected.
// The only network calls ever made go to the payment provider, and only when the user
// activates a key or a revalidation is due (at most once per 24 hours). They send the
// license key and a random device name, never budget or pay data.
import { BILLING } from './billing-config.js';

export const GRACE_MS = 14 * 24 * 3600 * 1000;   // offline grace after last successful validation
export const REVALIDATE_MS = 24 * 3600 * 1000;   // at most one silent check per day
const LS_API = 'https://api.lemonsqueezy.com/v1/licenses';

/* ---------- pure helpers ---------- */

/** "abcd-1234-efgh-5678" -> "••••-••••-••••-5678". For display only; the full key is stored. */
export function maskKey(key) {
  const k = String(key || '');
  if (!k) return '';
  if (k.length <= 4) return k;
  return k.slice(0, -4).replace(/[^-\s]/g, '•') + k.slice(-4);
}

/** A random, non-identifying name for this device, e.g. "tipnet-k3j9x2ab". */
export function randomInstanceName() {
  const c = globalThis.crypto;
  let s = '';
  if (c && c.getRandomValues) s = Array.from(c.getRandomValues(new Uint8Array(5)), (b) => b.toString(36).padStart(2, '0')).join('');
  else s = Math.random().toString(36).slice(2, 12);
  return 'tipnet-' + s.slice(0, 10);
}

const ACTIVE = new Set(['active', 'on_trial']);
const toMs = (v) => { const t = typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(t) ? t : null; };

/**
 * Is the add-on unlocked right now? ent: state.settings.entitlement or null. now: ms.
 * A dev entitlement always unlocks (it can only be created on localhost). Otherwise the status must be
 * active/on_trial and last validated within 14 days.
 */
export function isUnlocked(ent, now = Date.now()) {
  if (!ent || typeof ent !== 'object') return false;
  if (ent.plan === 'dev') return true;
  if (!ACTIVE.has(ent.status)) return false;
  const v = toMs(ent.validatedAt);
  if (v === null || now - v > GRACE_MS || v - now > REVALIDATE_MS) return false;
  return true;
}

/** True when a silent recheck is due: has a real key, online, and last check is 24h+ old. */
export function needsRevalidate(ent, now = Date.now(), online = true) {
  if (!ent || ent.plan === 'dev' || !ent.key || !ent.instanceId) return false;
  if (!online) return false;
  const v = toMs(ent.validatedAt);
  return v === null || now - v >= REVALIDATE_MS || v > now;
}

/**
 * Turns a Lemon Squeezy activate/validate JSON body into {ok, status, expiresAt?, instanceId?, error?}.
 * ok means "this key is good for use right now". productIds (optional) rejects keys from other products.
 */
export function parseLemonSqueezy(body, productIds = []) {
  const b = body && typeof body === 'object' ? body : {};
  const lk = b.license_key || {};
  const status = lk.status || null;
  const out = { ok: false, status: status || 'invalid' };
  if (lk.expires_at) out.expiresAt = lk.expires_at;
  if (b.instance && b.instance.id) out.instanceId = String(b.instance.id);
  const good = b.activated === true || b.valid === true;
  if (productIds && productIds.length) {
    const pid = b.meta && b.meta.product_id;
    if (!productIds.map(Number).includes(Number(pid))) {
      return { ok: false, status: 'invalid', error: 'This key is not for TipNet Budget.' };
    }
  }
  if (good && ACTIVE.has(status)) { out.ok = true; return out; }
  if (status === 'expired') out.error = 'This subscription has ended. Renew it to unlock again.';
  else if (status === 'disabled') out.error = 'This key was turned off (refunded or cancelled).';
  else out.error = friendlyError(b.error);
  return out;
}

function friendlyError(msg) {
  const m = String(msg || '').toLowerCase();
  if (!m) return 'That key did not work. Check it and try again.';
  if (m.includes('not found')) return 'That key was not found. Check it and try again.';
  if (m.includes('limit')) return 'This key is already on the most devices it allows. Turn it off on another device first.';
  return 'That key did not work. Check it and try again.';
}

/* ---------- providers ---------- */

/**
 * Lemon Squeezy License API. Public endpoints, no secret key. Verified to send CORS headers
 * (access-control-allow-origin: *), so browsers can call it directly. If proxyUrl is set, calls go there instead.
 * deps: { fetch, productIds, proxyUrl }
 */
export function lemonSqueezyProvider(deps = {}) {
  const f = deps.fetch || ((...a) => globalThis.fetch(...a));
  const productIds = deps.productIds || [];
  const base = (deps.proxyUrl || LS_API).replace(/\/$/, '');
  async function call(path, fields) {
    let res;
    try {
      res = await f(`${base}/${path}`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
      });
    } catch (e) {
      return { ok: false, status: 'network', error: 'Could not reach the payment service. Check your connection.' };
    }
    let body = null;
    try { body = await res.json(); } catch (e) { /* not JSON */ }
    if (!body) return { ok: false, status: 'network', error: 'The payment service sent an unexpected reply. Try again later.' };
    return parseLemonSqueezy(body, productIds);
  }
  return {
    id: 'lemonsqueezy',
    activate: (key, instanceName) => call('activate', { license_key: String(key || '').trim(), instance_name: instanceName || randomInstanceName() }),
    validate: (key, instanceId) => call('validate', { license_key: String(key || '').trim(), instance_id: instanceId }),
    deactivate: (key, instanceId) => call('deactivate', { license_key: String(key || '').trim(), instance_id: instanceId }),
  };
}

/** Provider chosen in billing-config.js, or null while payments are switched off. */
export function getProvider(config = BILLING, deps = {}) {
  if (config.provider === 'lemonsqueezy') {
    return lemonSqueezyProvider({ productIds: config.productIds, proxyUrl: config.proxyUrl, ...deps });
  }
  return null;
}

/* ---------- entitlement flow (state.settings.entitlement) ---------- */

/**
 * User pastes a key. Returns {ok, entitlement?, error?}. On ok, the caller stores entitlement in
 * state.settings.entitlement and saves. plan ('monthly'|'yearly') is optional and stored as given. Never throws.
 */
export async function activateKey(key, { provider = getProvider(), plan = null, now = Date.now(), instanceName } = {}) {
  if (!provider) return { ok: false, error: 'Payments are not switched on yet.' };
  const k = String(key || '').trim();
  if (!k) return { ok: false, error: 'Paste your license key first.' };
  const r = await provider.activate(k, instanceName || randomInstanceName());
  if (!r.ok) return { ok: false, error: r.error || 'That key did not work.' };
  return {
    ok: true,
    entitlement: { plan, key: k, instanceId: r.instanceId || null, status: r.status, validatedAt: new Date(now).toISOString(), expiresAt: r.expiresAt || null },
  };
}

/**
 * Silent daily recheck. Returns the entitlement to store, or null for "no change" (not due, offline,
 * or a network failure: the 14-day grace covers that). A definite answer from the provider
 * (expired, disabled, not found) is stored so the add-on locks. Never throws.
 */
export async function revalidate(ent, { provider = getProvider(), now = Date.now(), online = (typeof navigator === 'undefined' ? true : navigator.onLine) } = {}) {
  if (!provider || !needsRevalidate(ent, now, online)) return null;
  const r = await provider.validate(ent.key, ent.instanceId);
  if (r.status === 'network') return null;
  return { ...ent, status: r.status, validatedAt: new Date(now).toISOString(), expiresAt: r.expiresAt || ent.expiresAt || null };
}

/** Frees this device's seat; the caller then deletes settings.entitlement. Best effort, never throws. */
export async function deactivate(ent, { provider = getProvider() } = {}) {
  try { if (provider && provider.deactivate && ent && ent.key && ent.instanceId) await provider.deactivate(ent.key, ent.instanceId); } catch (e) { /* ignore */ }
}

/** For UI display: entitlement with the key masked. Does not change what is stored. */
export function displayEntitlement(ent) {
  return ent ? { ...ent, key: maskKey(ent.key) } : null;
}

/**
 * Dev unlock, only on localhost / 127.0.0.1 with ?unlock=dev in the URL. Returns an entitlement or null.
 * loc: {hostname, search}. Never returns anything on other hosts.
 */
export function devEntitlement(loc = globalThis.location) {
  if (!loc) return null;
  const host = loc.hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') return null;
  if (new URLSearchParams(loc.search || '').get('unlock') !== 'dev') return null;
  return { plan: 'dev', key: '', instanceId: null, status: 'active', validatedAt: new Date().toISOString(), expiresAt: null };
}

/** Checkout link for a plan ('monthly'|'yearly'), or '' if not set up yet. */
export function checkoutUrl(plan, config = BILLING) {
  return (config.checkout && config.checkout[plan]) || '';
}
