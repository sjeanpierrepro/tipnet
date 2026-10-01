import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate, decodeBackup, encodeBackup, seedState, pickNewest } from '../app/js/storage.js';
import {
  isUnlocked,
  budgetVisible,
  parseLemonSqueezy,
  readConfig,
  getProvider,
  checkoutUrl,
} from '../app/js/billing.js';
import * as M from '../app/js/math.js';

const NOW = Date.parse('2026-10-01T12:00:00Z');
const code = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64');
const PROD = { hostname: 'tipnet.example' };
const ON = { provider: 'lemonsqueezy', productIds: [123] };

/* ---------- 1. paywall bypass ---------- */
test('hand-made backup code with an active entitlement does not unlock anything', () => {
  const base = seedState();
  base.settings.entitlement = {
    status: 'active',
    instanceId: null,
    validatedAt: new Date(NOW + 23 * 3600 * 1000).toISOString(),
  };
  const restored = decodeBackup(code(base));
  assert.equal('entitlement' in restored.settings, false);
  // even if it somehow got through, it is locked
  for (const cfg of [{}, ON])
    assert.equal(isUnlocked(base.settings.entitlement, NOW, { config: cfg, loc: PROD }), false);
  const dev = { plan: 'dev', status: 'active', validatedAt: new Date(NOW).toISOString() };
  const r2 = decodeBackup(code({ ...base, settings: { entitlement: dev } }));
  assert.equal('entitlement' in r2.settings, false);
});
test('a real entitlement needs key, instanceId, payments on, and a sane check time', () => {
  const good = {
    plan: 'monthly',
    key: 'K-1',
    instanceId: 'i1',
    status: 'active',
    validatedAt: new Date(NOW - 3600e3).toISOString(),
  };
  const u = (e, opts = { config: ON, loc: PROD }) => isUnlocked(e, NOW, opts);
  assert.equal(u(good), true);
  assert.equal(u(good, { config: {}, loc: PROD }), false, 'payments off');
  assert.equal(u({ ...good, instanceId: null }), false);
  assert.equal(u({ ...good, instanceId: '' }), false);
  assert.equal(u({ ...good, key: '' }), false);
  assert.equal(u({ ...good, key: undefined }), false);
  assert.equal(u({ ...good, validatedAt: new Date(NOW + 23 * 3600e3).toISOString() }), false, 'future date');
  assert.equal(u({ ...good, validatedAt: 'garbage' }), false);
  assert.equal(
    u({ plan: 'dev', status: 'active' }, { config: ON, loc: PROD }),
    false,
    'dev only on localhost',
  );
  assert.equal(u({ plan: 'dev' }, { config: {}, loc: { hostname: 'localhost' } }), true);
});
test('Budget tab visibility follows payments and entitlement', () => {
  assert.equal(budgetVisible(null, NOW, { config: {}, loc: PROD }), false);
  assert.equal(budgetVisible(null, NOW, { config: ON, loc: PROD }), true);
  assert.equal(budgetVisible({ plan: 'dev' }, NOW, { config: {}, loc: { hostname: 'localhost' } }), true);
  assert.equal(
    budgetVisible({ status: 'active', validatedAt: new Date(NOW).toISOString() }, NOW, {
      config: {},
      loc: PROD,
    }),
    false,
  );
});
test('encodeBackup never includes the entitlement', () => {
  const s = seedState();
  s.settings.entitlement = { key: 'SECRET' };
  assert.equal(Buffer.from(encodeBackup(s), 'base64').toString().includes('SECRET'), false);
});

/* ---------- 2. migrate never throws and always renders ---------- */
function renders(state) {
  const p = state.workplaces[0].profile;
  const sh = M.shiftsPerPeriod(p, state.nights, '2026-09-29');
  state.nights.forEach((n) => M.computeNight(n, p, sh.n));
  const idx = M.periodIndex(p, '2026-09-29');
  M.periodTotals(p, state.nights, idx, '2026-09-29');
  M.summary(p, state.nights, '2026-09-29');
  M.rate(p);
  M.fixedTotal(p);
  assert.ok(Array.isArray(p.payTypes) && p.payTypes.length >= 1);
  assert.ok(Array.isArray(p.deductions));
  assert.ok(Array.isArray(state.nights) && Array.isArray(state.workplaces[0].calib));
  state.nights.forEach((n) => {
    assert.ok(Number.isFinite(M.parseISO(n.date)));
    assert.equal(typeof n.total, 'number');
  });
}
const GARBAGE = [
  null,
  undefined,
  0,
  1,
  'x',
  true,
  [],
  {},
  [1, 2],
  { a: 1 },
  NaN,
  '',
  '2026-13-45',
  -5,
  1e308,
  [null],
  [[]],
  { x: {} },
];
test('migrate: garbage in every position never throws and renders', () => {
  const fields = [
    'payTypes',
    'deductions',
    'tipout',
    'freq',
    'periodStart',
    'periodEnd',
    'gross',
    'shifts',
    'rateOverride',
    'payDelay',
  ];
  for (const g of GARBAGE) {
    for (const f of fields) {
      const s = seedState();
      s.workplaces[0].profile[f] = g;
      renders(migrate(s));
    }
    for (const top of ['nights', 'calib', 'budget', 'settings', 'profile']) {
      const s = seedState();
      s[top] = g;
      renders(migrate(s));
    }
    const s = seedState();
    s.nights = [
      g,
      { date: g, total: 5 },
      { date: '2026-09-22', total: g, cash: g, pay: g, id: g, barback: g },
      ...s.nights,
    ];
    s.workplaces[0].profile.payTypes = [g, { id: g, rate: g, unit: g, usual: g }];
    s.workplaces[0].profile.deductions = [g, { id: g, amount: g, mode: g }];
    renders(migrate(s));
    renders(migrate(g));
  }
});
test('migrate: random fuzz', () => {
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const val = (d = 0) => {
    const r = rnd();
    if (d > 3 || r < 0.5) return GARBAGE[Math.floor(rnd() * GARBAGE.length)];
    if (r < 0.75) return Array.from({ length: Math.floor(rnd() * 4) }, () => val(d + 1));
    const o = {};
    [
      'id',
      'date',
      'total',
      'cash',
      'pay',
      'rate',
      'unit',
      'usual',
      'amount',
      'mode',
      'name',
      'k',
      'on',
      'value',
    ].forEach((k) => {
      if (rnd() < 0.4) o[k] = val(d + 1);
    });
    return o;
  };
  for (let i = 0; i < 300; i++) {
    const s = seedState();
    Object.keys(s.workplaces[0].profile).forEach((k) => {
      if (rnd() < 0.5) s.workplaces[0].profile[k] = val();
    });
    if (rnd() < 0.5) s.nights = val();
    if (rnd() < 0.3) s.workplaces[0].calib = val();
    if (rnd() < 0.3) s.settings = val();
    renders(migrate(s));
  }
});
test('migrate: keeps good rows, drops bad ones, keeps the device entitlement shape', () => {
  const s = seedState();
  s.nights = [
    { id: 1, date: '2026-09-22', total: '120.5', cash: '', barback: false },
    { id: 1, date: 'nope', total: 5 },
    { id: 1, date: '2026-09-23', total: 50 },
  ];
  const m = migrate(s);
  assert.equal(m.nights.length, 2);
  assert.equal(m.nights[0].total, 120.5);
  assert.equal(m.nights[0].cash, null);
  assert.notEqual(m.nights[0].id, m.nights[1].id, 'duplicate ids get fixed');
  s.settings.entitlement = { key: 'k', instanceId: 'i', status: 'active', validatedAt: 'x', evil: { a: 1 } };
  assert.deepEqual(Object.keys(migrate(s).settings.entitlement).sort(), [
    'instanceId',
    'key',
    'status',
    'validatedAt',
  ]);
});

/* ---------- 5. license errors ---------- */
test('wrong product vs mistyped key', () => {
  const notFound = parseLemonSqueezy({ valid: false, error: 'license_key not found.' }, [123]);
  assert.match(notFound.error, /not found/);
  const wrong = parseLemonSqueezy(
    { valid: true, license_key: { status: 'active' }, meta: { product_id: 999 } },
    [123],
  );
  assert.equal(wrong.ok, false);
  assert.match(wrong.error, /different product/);
  const right = parseLemonSqueezy(
    { activated: true, license_key: { status: 'active' }, meta: { product_id: 123 } },
    [123],
  );
  assert.equal(right.ok, true);
});

/* ---------- 6. config skew ---------- */
test('billing config is read defensively', () => {
  for (const bad of [
    undefined,
    null,
    5,
    'x',
    {},
    { provider: 7, prices: 3, checkout: null, productIds: 'a' },
    { provider: 'other' },
  ]) {
    const c = readConfig(bad);
    assert.equal(c.provider, null);
    assert.deepEqual(c.productIds, []);
    assert.equal(typeof c.prices.monthly, 'string');
    assert.equal(getProvider(bad), null);
    assert.equal(checkoutUrl('monthly', bad), '');
  }
  assert.equal(
    readConfig({ provider: 'lemonsqueezy', extra: 1, checkout: { monthly: 'https://x' } }).checkout.monthly,
    'https://x',
  );
});

/* ---------- 7. load prefers the newer copy ---------- */
test('pickNewest chooses the newer saved copy', () => {
  const a = { _savedAt: 100, v: 'idb' },
    b = { _savedAt: 200, v: 'ls' };
  assert.equal(pickNewest(a, b).v, 'ls');
  assert.equal(pickNewest(b, a).v, 'ls');
  assert.equal(pickNewest(a, { _savedAt: 100, v: 'ls' }).v, 'idb', 'tie goes to IndexedDB');
  assert.equal(pickNewest({ v: 'idb' }, { _savedAt: 5, v: 'ls' }).v, 'ls', 'unstamped copy is oldest');
  assert.equal(pickNewest(null, b).v, 'ls');
  assert.equal(pickNewest(a, null).v, 'idb');
  assert.equal(pickNewest(null, null), null);
});
