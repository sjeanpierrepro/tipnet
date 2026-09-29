import test from 'node:test';
import assert from 'node:assert/strict';
import { isUnlocked, needsRevalidate, maskKey, parseLemonSqueezy, lemonSqueezyProvider, activateKey, revalidate, devEntitlement, isDevHost, getProvider, GRACE_MS } from '../app/js/billing.js';

const NOW = Date.parse('2026-10-01T12:00:00Z');
const DAY = 24 * 3600 * 1000;
const ent = (o = {}) => ({ plan: 'monthly', key: 'AAAA-BBBB-CCCC-1234', instanceId: 'i1', status: 'active', validatedAt: new Date(NOW - DAY / 2).toISOString(), ...o });
const json = (body) => async () => ({ json: async () => body });

test('isUnlocked rules', () => {
  assert.equal(isUnlocked(null, NOW), false);
  assert.equal(isUnlocked(ent(), NOW), true);
  assert.equal(isUnlocked(ent({ status: 'on_trial' }), NOW), true);
  assert.equal(isUnlocked(ent({ status: 'expired' }), NOW), false);
  assert.equal(isUnlocked(ent({ validatedAt: new Date(NOW - GRACE_MS + 1000).toISOString() }), NOW), true);
  assert.equal(isUnlocked(ent({ validatedAt: new Date(NOW - GRACE_MS - 1000).toISOString() }), NOW), false);
  assert.equal(isUnlocked({ plan: 'dev' }, NOW), true);
});

test('needsRevalidate', () => {
  assert.equal(needsRevalidate(ent(), NOW, true), false);
  assert.equal(needsRevalidate(ent({ validatedAt: new Date(NOW - 2 * DAY).toISOString() }), NOW, true), true);
  assert.equal(needsRevalidate(ent({ validatedAt: new Date(NOW - 2 * DAY).toISOString() }), NOW, false), false);
  assert.equal(needsRevalidate({ plan: 'dev' }, NOW, true), false);
});

test('maskKey', () => {
  assert.equal(maskKey('AAAA-BBBB-CCCC-1234'), '••••-••••-••••-1234');
  assert.equal(maskKey(''), '');
});

test('parseLemonSqueezy', () => {
  const ok = parseLemonSqueezy({ activated: true, license_key: { status: 'active', expires_at: '2027-01-01T00:00:00Z' }, instance: { id: 'abc' }, meta: { product_id: 5 } });
  assert.deepEqual(ok, { ok: true, status: 'active', expiresAt: '2027-01-01T00:00:00Z', instanceId: 'abc' });
  assert.equal(parseLemonSqueezy({ valid: true, license_key: { status: 'active' }, meta: { product_id: 5 } }, [9]).ok, false);
  assert.equal(parseLemonSqueezy({ valid: true, license_key: { status: 'active' }, meta: { product_id: 5 } }, [5]).ok, true);
  assert.equal(parseLemonSqueezy({ valid: false, license_key: { status: 'expired' } }).ok, false);
  assert.match(parseLemonSqueezy({ valid: false, error: 'license_key not found.' }).error, /not found/);
  assert.equal(parseLemonSqueezy(null).ok, false);
});

test('provider sends form-encoded request to Lemon Squeezy only', async () => {
  const calls = [];
  const p = lemonSqueezyProvider({ fetch: async (url, init) => { calls.push([url, init]); return { json: async () => ({ activated: true, license_key: { status: 'active' }, instance: { id: 'z' } }) }; } });
  const r = await p.activate('KEY', 'dev1');
  assert.equal(r.ok, true);
  assert.equal(calls[0][0], 'https://api.lemonsqueezy.com/v1/licenses/activate');
  assert.equal(calls[0][1].body, 'license_key=KEY&instance_name=dev1');
  await p.validate('KEY', 'z');
  assert.equal(calls[1][1].body, 'license_key=KEY&instance_id=z');
});

test('network failure is reported as status network', async () => {
  const p = lemonSqueezyProvider({ fetch: async () => { throw new Error('offline'); } });
  assert.equal((await p.validate('K', 'i')).status, 'network');
});

test('activateKey and revalidate', async () => {
  const p = lemonSqueezyProvider({ fetch: json({ activated: true, valid: true, license_key: { status: 'active' }, instance: { id: 'i9' } }) });
  const a = await activateKey(' KEY-1 ', { provider: p, plan: 'yearly', now: NOW });
  assert.equal(a.ok, true);
  assert.equal(a.entitlement.key, 'KEY-1');
  assert.equal(a.entitlement.instanceId, 'i9');
  assert.equal((await activateKey('', { provider: p })).ok, false);
  assert.equal((await activateKey('x', { provider: null })).ok, false);

  const stale = ent({ validatedAt: new Date(NOW - 2 * DAY).toISOString() });
  const r = await revalidate(stale, { provider: p, now: NOW, online: true });
  assert.equal(r.validatedAt, new Date(NOW).toISOString());
  assert.equal(await revalidate(ent(), { provider: p, now: NOW, online: true }), null);
  const off = lemonSqueezyProvider({ fetch: async () => { throw new Error('x'); } });
  assert.equal(await revalidate(stale, { provider: off, now: NOW, online: true }), null);
  const dead = lemonSqueezyProvider({ fetch: json({ valid: false, license_key: { status: 'disabled' } }) });
  assert.equal((await revalidate(stale, { provider: dead, now: NOW, online: true })).status, 'disabled');
});

test('devEntitlement only on localhost with ?unlock=dev', () => {
  assert.equal(devEntitlement({ hostname: 'localhost', search: '?unlock=dev' }).plan, 'dev');
  assert.equal(devEntitlement({ hostname: '127.0.0.1', search: '?unlock=dev' }).plan, 'dev');
  assert.equal(devEntitlement({ hostname: 'me.github.io', search: '?unlock=dev' }), null);
  assert.equal(devEntitlement({ hostname: 'localhost', search: '' }), null);
});

test('getProvider is null until configured', () => {
  assert.equal(getProvider({ provider: null }), null);
  assert.equal(getProvider({ provider: 'lemonsqueezy' }).id, 'lemonsqueezy');
});

test('a server error or rate limit never locks anyone', async () => {
  const stale = ent({ validatedAt: new Date(NOW - 2 * DAY).toISOString() });
  for (const status of [500, 503, 429]) {
    const p = lemonSqueezyProvider({ fetch: async () => ({ status, json: async () => ({ error: 'Server Error' }) }) });
    assert.equal((await p.validate('K', 'i')).status, 'network');
    assert.equal(await revalidate(stale, { provider: p, now: NOW, online: true }), null);
  }
  // a definite "not found" (404 with JSON) does lock
  const gone = lemonSqueezyProvider({ fetch: async () => ({ status: 404, json: async () => ({ valid: false, error: 'license_key not found.', license_key: null }) }) });
  assert.equal(isUnlocked(await revalidate(stale, { provider: gone, now: NOW, online: true }), NOW), false);
});

test('plan comes from the variant name when the caller does not give one', async () => {
  const body = (v) => ({ activated: true, license_key: { status: 'active' }, instance: { id: 'i' }, meta: { variant_name: v } });
  assert.equal((await activateKey('K', { provider: lemonSqueezyProvider({ fetch: json(body('Yearly')) }) })).entitlement.plan, 'yearly');
  assert.equal((await activateKey('K', { provider: lemonSqueezyProvider({ fetch: json(body('Monthly')) }) })).entitlement.plan, 'monthly');
  assert.equal((await activateKey('K', { provider: lemonSqueezyProvider({ fetch: json(body('Default')) }) })).entitlement.plan, null);
});

test('isDevHost', () => {
  assert.equal(isDevHost({ hostname: 'localhost' }), true);
  assert.equal(isDevHost({ hostname: 'tipnet.github.io' }), false);
  assert.equal(isDevHost(undefined), false);
});

test('revalidate: valid:false locks even when the key status is still active', async () => {
  const stale = ent({ validatedAt: new Date(NOW - 2 * DAY).toISOString() });
  // this device's instance was removed: the key is active but the answer is valid:false
  const noInstance = lemonSqueezyProvider({ fetch: async () => ({ status: 404, json: async () => ({ valid: false, error: 'license_key instance not found.', license_key: { status: 'active' } }) }) });
  const r = await revalidate(stale, { provider: noInstance, now: NOW, online: true });
  assert.equal(r.status, 'invalid');
  assert.equal(isUnlocked(r, NOW), false);
  const plain = lemonSqueezyProvider({ fetch: json({ valid: false, license_key: { status: 'on_trial' } }) });
  assert.equal(isUnlocked(await revalidate(stale, { provider: plain, now: NOW, online: true }), NOW), false);
  assert.equal(isUnlocked({ ...ent(), status: 'invalid' }, NOW), false);
  // a good answer still keeps it unlocked
  const good = lemonSqueezyProvider({ fetch: json({ valid: true, license_key: { status: 'active' } }) });
  const g = await revalidate(stale, { provider: good, now: NOW, online: true });
  assert.equal(g.status, 'active');
  assert.equal(isUnlocked(g, NOW), true);
});
