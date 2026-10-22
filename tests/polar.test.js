import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parsePolar,
  polarProvider,
  readConfig,
  getProvider,
  checkoutUrl,
  providerInfo,
  activateKey,
  revalidate,
  deactivate,
  isUnlocked,
} from '../app/js/billing.js';

const ORG = '21069ded-8117-4125-a4da-1e9c11e82ea8';
const BEN = 'b74169ed-9c5f-4dab-96c9-d1a9dbacd974';
const OTHER = '11111111-2222-4333-8444-555555555555';
const ACT = '5f1d6c2e-8a3b-4c4d-9e0f-1a2b3c4d5e6f';
const NOW = Date.parse('2026-10-01T12:00:00Z');
const DAY = 24 * 3600 * 1000;
const POLAR = {
  provider: 'polar',
  organizationId: ORG,
  benefitId: BEN,
  checkout: { monthly: 'https://buy.polar.sh/m', yearly: 'https://buy.polar.sh/y' },
};
const keyBody = (o = {}) => ({
  id: 'lk1',
  organization_id: ORG,
  benefit_id: BEN,
  status: 'granted',
  limit_activations: 3,
  expires_at: null,
  ...o,
});
const activated = (o = {}) => ({ id: ACT, license_key_id: 'lk1', label: 'x', license_key: keyBody(o) });
const validated = (o = {}) => ({ ...keyBody(o), activation: { id: ACT } });
const reply = (status, body) => async () => ({ status, json: async () => body });
const ent = (o = {}) => ({
  plan: 'monthly',
  key: 'TIPNET-AAAA',
  instanceId: ACT,
  status: 'active',
  validatedAt: new Date(NOW - DAY / 2).toISOString(),
  ...o,
});
const mk = (fetch) => polarProvider({ fetch, organizationId: ORG, benefitId: BEN });
const OLD = () => ent({ validatedAt: new Date(NOW - 2 * DAY).toISOString() });
const PROD = { hostname: 'tipnet.example' };

test('parsePolar: granted activate and validate bodies are ok and say active', () => {
  assert.deepEqual(parsePolar(activated(), BEN, ORG), { ok: true, status: 'active', instanceId: ACT });
  const v = parsePolar(validated(), BEN, ORG);
  assert.equal(v.ok, true);
  assert.equal(v.instanceId, ACT);
  assert.equal(parsePolar(validated({ benefit_id: BEN.toUpperCase() }), BEN, ORG).ok, true);
});

test('parsePolar: revoked, disabled, expired, unknown status and junk all refuse', () => {
  const r = parsePolar(validated({ status: 'revoked' }), BEN, ORG);
  assert.equal(r.ok, false);
  assert.equal(r.status, 'revoked');
  assert.match(parsePolar(validated({ status: 'disabled' }), BEN, ORG).error, /turned off/);
  const past = parsePolar(validated({ expires_at: '2026-01-01T00:00:00Z' }), BEN, ORG);
  assert.equal(past.ok, false);
  assert.equal(past.status, 'expired');
  assert.equal(parsePolar(validated({ status: 'mystery' }), BEN, ORG).ok, false);
  for (const junk of [null, undefined, 'x', 5, {}, []]) assert.equal(parsePolar(junk, BEN, ORG).ok, false);
  const future = parsePolar(validated({ expires_at: '2099-01-01T00:00:00Z' }), BEN, ORG);
  assert.equal(future.ok, true);
  assert.equal(future.expiresAt, '2099-01-01T00:00:00Z');
});

test('parsePolar: a key for another benefit or organization is refused', () => {
  for (const body of [validated({ benefit_id: OTHER }), activated({ benefit_id: OTHER })]) {
    const r = parsePolar(body, BEN, ORG);
    assert.equal(r.ok, false);
    assert.match(r.error, /different product/);
  }
  assert.equal(parsePolar(validated({ organization_id: OTHER }), BEN, ORG).ok, false);
  assert.equal(parsePolar(validated({ benefit_id: undefined }), BEN, ORG).ok, false);
});

test('polarProvider activate: JSON to the portal endpoint with the organization id and the device label', async () => {
  const calls = [];
  const p = mk(async (url, init) => {
    calls.push({ url, init });
    return { status: 200, json: async () => activated() };
  });
  const r = await p.activate('  TIPNET-AAAA ', 'tipnet-abc');
  assert.deepEqual(r, { ok: true, status: 'active', instanceId: ACT });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.polar.sh/v1/customer-portal/license-keys/activate');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    key: 'TIPNET-AAAA',
    label: 'tipnet-abc',
    organization_id: ORG,
  });
  // activateKey uses the same random device name as Lemon Squeezy
  const labels = [];
  const q = mk(async (u, i) => {
    labels.push(JSON.parse(i.body).label);
    return { status: 200, json: async () => activated() };
  });
  const e = await activateKey('K', { provider: q, now: NOW });
  assert.equal(e.ok, true);
  assert.equal(e.entitlement.instanceId, ACT);
  assert.equal(e.entitlement.status, 'active');
  assert.match(labels[0], /^tipnet-[0-9a-z]{1,10}$/);
});

test('polarProvider validate: ok, revoked (404 or body), wrong benefit', async () => {
  const calls = [];
  const ok = mk(async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { status: 200, json: async () => validated() };
  });
  assert.equal((await ok.validate('K', ACT)).ok, true);
  assert.equal(calls[0].url, 'https://api.polar.sh/v1/customer-portal/license-keys/validate');
  assert.deepEqual(calls[0].body, { key: 'K', activation_id: ACT, organization_id: ORG });
  const gone = await mk(reply(404, { error: 'ResourceNotFound', detail: 'Not found' })).validate('K', ACT);
  assert.equal(gone.ok, false);
  assert.equal(gone.status, 'invalid');
  const revoked = await mk(reply(200, validated({ status: 'revoked' }))).validate('K', ACT);
  assert.equal(revoked.ok, false);
  assert.equal(revoked.status, 'revoked');
  const wrong = await mk(reply(200, validated({ benefit_id: OTHER }))).validate('K', ACT);
  assert.equal(wrong.ok, false);
  assert.match(wrong.error, /different product/);
});

test('polarProvider activate errors: not found, not permitted (revoked or device limit), bad request', async () => {
  const nf = await mk(reply(404, { error: 'ResourceNotFound', detail: 'Not found' })).activate('K');
  assert.match(nf.error, /not found/);
  const lim = await mk(reply(403, { error: 'NotPermitted', detail: 'x' })).activate('K');
  assert.equal(lim.ok, false);
  assert.match(lim.error, /most devices/);
  const bad = await mk(reply(422, { detail: [] })).activate('K');
  assert.equal(bad.ok, false);
  assert.notEqual(bad.status, 'network');
});

test('polarProvider deactivate: 204 and 404 free the seat; offline and busy keep it', async () => {
  const bodies = [];
  const spy = mk(async (url, init) => {
    bodies.push({ url, body: JSON.parse(init.body) });
    return { status: 204, json: async () => Promise.reject(new Error('no body')) };
  });
  assert.deepEqual(await deactivate(ent(), { provider: spy, online: true }), { ok: true });
  assert.equal(bodies[0].url, 'https://api.polar.sh/v1/customer-portal/license-keys/deactivate');
  assert.deepEqual(bodies[0].body, { key: 'TIPNET-AAAA', activation_id: ACT, organization_id: ORG });
  const nf = mk(reply(404, { error: 'ResourceNotFound' }));
  assert.deepEqual(await deactivate(ent(), { provider: nf, online: true }), { ok: true });
  const down = mk(async () => {
    throw new TypeError('Failed to fetch');
  });
  const off = await deactivate(ent(), { provider: down, online: true });
  assert.equal(off.ok, false);
  assert.equal(off.offline, true);
  const busy = await deactivate(ent(), { provider: mk(reply(503, {})), online: true });
  assert.equal(busy.ok, false);
  assert.equal(busy.offline, false);
});

test('network failure, 5xx, 429 and odd replies never lock a paying user (the 14-day grace applies)', async () => {
  const cases = [
    async () => {
      throw new TypeError('Failed to fetch');
    },
    reply(500, {}),
    reply(503, {}),
    reply(429, {}),
    reply(200, {}),
    reply(200, { unrelated: true }),
    reply(422, { detail: [] }),
    async () => ({ status: 200, json: async () => Promise.reject(new Error('not json')) }),
  ];
  for (const f of cases) {
    const p = mk(f);
    assert.equal((await p.validate('K', ACT)).status, 'network');
    assert.equal(await revalidate(OLD(), { provider: p, now: NOW, online: true }), null);
  }
  assert.equal((await mk(cases[0]).validate('K', ACT)).unreachable, true);
});

test('revalidate with Polar: granted stays unlocked; 404, revoked and disabled lock', async () => {
  const cfg = { config: POLAR, loc: PROD };
  const good = await revalidate(OLD(), { provider: mk(reply(200, validated())), now: NOW, online: true });
  assert.equal(good.status, 'active');
  assert.equal(isUnlocked(good, NOW, cfg), true);
  for (const f of [
    reply(404, { error: 'ResourceNotFound' }),
    reply(200, validated({ status: 'revoked' })),
    reply(200, validated({ status: 'disabled' })),
  ]) {
    const r = await revalidate(OLD(), { provider: mk(f), now: NOW, online: true });
    assert.notEqual(r, null);
    assert.equal(isUnlocked(r, NOW, cfg), false);
  }
  // nothing unlocks while payments are off
  assert.equal(isUnlocked(good, NOW, { config: {}, loc: PROD }), false);
});

test('readConfig with polar: needs both ids, keeps checkout, ignores bad ids and mixed-up providers', () => {
  const c = readConfig(POLAR);
  assert.equal(c.provider, 'polar');
  assert.equal(c.organizationId, ORG);
  assert.equal(c.benefitId, BEN);
  assert.equal(checkoutUrl('monthly', POLAR), 'https://buy.polar.sh/m');
  assert.equal(checkoutUrl('yearly', POLAR), 'https://buy.polar.sh/y');
  for (const bad of [
    { ...POLAR, organizationId: '' },
    { ...POLAR, benefitId: undefined },
    { ...POLAR, benefitId: 'not-a-uuid' },
    { ...POLAR, organizationId: 5 },
    { provider: 'polar' },
  ]) {
    assert.equal(readConfig(bad).provider, null);
    assert.equal(getProvider(bad), null);
  }
  assert.equal(getProvider(POLAR).id, 'polar');
  assert.equal(getProvider({ provider: 'lemonsqueezy', productIds: [1] }).id, 'lemonsqueezy');
  assert.equal(readConfig({ provider: 'lemonsqueezy', organizationId: ORG, benefitId: BEN }).provider, null);
  assert.equal(readConfig({ provider: 'polar', productIds: [1] }).provider, null);
});

test('providerInfo: names, privacy links and portal per provider; off means the Lemon Squeezy wording', () => {
  const p = providerInfo(POLAR);
  assert.equal(p.name, 'Polar');
  assert.equal(p.privacyUrl, 'https://polar.sh/legal/privacy');
  assert.equal(p.manageUrl, 'https://polar.sh/tipnet/portal');
  assert.equal(
    providerInfo({ ...POLAR, portalUrl: 'https://polar.sh/x/portal' }).manageUrl,
    'https://polar.sh/x/portal',
  );
  assert.equal(
    providerInfo({ ...POLAR, portalUrl: 'javascript:1' }).manageUrl,
    'https://polar.sh/tipnet/portal',
  );
  for (const cfg of [{ provider: 'lemonsqueezy', productIds: [1] }, {}, null]) {
    const l = providerInfo(cfg);
    assert.equal(l.name, 'Lemon Squeezy');
    assert.equal(l.privacyUrl, 'https://www.lemonsqueezy.com/privacy');
    assert.equal(l.manageUrl, 'https://app.lemonsqueezy.com/my-orders');
  }
});

test('CSP on the app, Privacy and Terms allows exactly the two payment APIs', () => {
  for (const f of ['index', 'privacy', 'terms']) {
    const html = readFileSync(new URL(`../app/${f}.html`, import.meta.url), 'utf8');
    const m = html.match(/connect-src ([^;"]*)/);
    assert.deepEqual(m[1].trim().split(/\s+/), [
      "'self'",
      'https://api.lemonsqueezy.com',
      'https://api.polar.sh',
    ]);
  }
});

test('the shipped billing-config.js keeps payments off and carries the commented Polar block', async () => {
  const mod = await import('../app/js/billing-config.js');
  assert.equal(mod.BILLING.provider, null);
  const src = readFileSync(new URL('../app/js/billing-config.js', import.meta.url), 'utf8');
  assert.ok(src.includes(ORG));
  assert.ok(src.includes(BEN));
  assert.ok(src.includes('https://buy.polar.sh/polar_cl_aJdygUsBhyW7sa8I25xOkPxhVGuZD1fBaIFeR2CF3Bv'));
  assert.ok(src.includes('https://buy.polar.sh/polar_cl_EDrUG3TiCtUWWfIiwPbPulFbwx3TPThNFH4de1TG1IF'));
});
