// Service worker: loaded in a vm sandbox with mocked self / caches / fetch / Request / Response.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../app');

const ORIGIN = 'https://tips.example.com';
const src = fs.readFileSync(path.join(APP_DIR, 'sw.js'), 'utf8');
const later = () => new Promise((r) => setImmediate(r));

class Response {
  constructor(body, init = {}) { this.body = body; this.status = init.status || 200; this.ok = this.status >= 200 && this.status < 300; this.type = 'basic'; }
  clone() { return Object.assign(Object.create(Response.prototype), this); }
  static error() { const r = new Response(null, { status: 0 }); r.type = 'error'; return r; }
}
class Request {
  constructor(url, init = {}) { this.url = new URL(url, ORIGIN + '/').href; this.method = init.method || 'GET'; this.cache = init.cache; this.mode = init.mode || 'cors'; }
}
const offline = async () => { throw new TypeError('offline'); };

/** A fresh worker in a sandbox. net(url, init) is the fake network. */
function load(net = offline) {
  const stores = new Map(); // cache name -> Map(url -> response)
  const calls = { fetch: [], added: [], claimed: 0, skipped: 0, deleted: [] };
  const handlers = {};
  const open = (name) => { if (!stores.has(name)) stores.set(name, new Map()); return stores.get(name); };
  const strip = (u) => u.split('?')[0];
  const caches = {
    open: async (name) => ({
      add: async (req) => {
        const res = await net(req.url, { cache: req.cache });
        if (!res.ok) throw new Error('bad status ' + res.status);
        calls.added.push({ url: req.url, cache: req.cache, into: name });
        open(name).set(strip(req.url), res);
      },
      put: async (req, res) => { open(name).set(strip(req.url), res); },
    }),
    keys: async () => [...stores.keys()],
    delete: async (name) => { calls.deleted.push(name); return stores.delete(name); },
    match: async (req) => {
      const url = strip(typeof req === 'string' ? new URL(req, ORIGIN + '/').href : req.url);
      for (const m of stores.values()) if (m.has(url)) return m.get(url);
      return undefined;
    },
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type, fn) => { handlers[type] = fn; },
    clients: { claim: async () => { calls.claimed++; } },
    skipWaiting: () => { calls.skipped++; },
  };
  const ctx = vm.createContext({
    self, caches, Request, Response, URL, Promise, setTimeout, clearTimeout,
    fetch: async (req, init) => { calls.fetch.push({ url: req.url, init }); return net(req.url, init); },
  });
  vm.runInContext(src, ctx, { filename: 'sw.js' });
  return {
    stores, calls, handlers, open,
    get: (name) => { const v = vm.runInContext(name, ctx); return Array.isArray(v) ? Array.from(v) : v; },
    /** Fire install/activate and wait for the worker's waitUntil promise. */
    async lifecycle(type) { let p; handlers[type]({ waitUntil: (x) => { p = x; } }); await p; },
    /** Fire a fetch event. null = the worker did not intercept it, otherwise the response. */
    async request(url, init = {}) {
      let p = null;
      handlers.fetch({ request: new Request(url, init), respondWith: (x) => { p = x; } });
      return p;
    },
  };
}

test('sw: every SHELL entry exists on disk under app/', () => {
  const shell = load().get('SHELL');
  assert.ok(shell.length > 20);
  for (const entry of shell) assert.ok(fs.existsSync(path.join(APP_DIR, entry === './' ? '' : entry)), 'missing from disk: ' + entry);
  assert.equal(new Set(shell).size, shell.length, 'no duplicates');
});

test('sw: every JS module in app/js is in SHELL (otherwise the app breaks offline)', () => {
  const shell = new Set(load().get('SHELL'));
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const js = walk(path.join(APP_DIR, 'js')).map((f) => path.relative(APP_DIR, f).split(path.sep).join('/')).filter((f) => f.endsWith('.js'));
  for (const f of js) assert.ok(shell.has(f), f + ' is not in SHELL');
});

test('sw: install precaches the whole shell with cache: reload into the versioned cache', async () => {
  const sw = load(async () => new Response('body'));
  await sw.lifecycle('install');
  const shell = sw.get('SHELL'), version = sw.get('VERSION');
  assert.match(version, /^tipnet-/);
  assert.equal(sw.calls.added.length, shell.length);
  assert.ok(sw.calls.added.every((a) => a.cache === 'reload' && a.into === version));
  assert.deepEqual(sw.calls.added.map((a) => new URL(a.url).pathname).sort(), shell.map((s) => new URL(s, ORIGIN + '/').pathname).sort());
  assert.equal(sw.calls.skipped, 0, 'does not skip waiting on its own');
});

test('sw: install survives a file that fails to download', async () => {
  const sw = load(async (url) => new Response('x', { status: url.endsWith('js/csv.js') ? 404 : 200 }));
  await sw.lifecycle('install');
  assert.equal(sw.calls.added.length, sw.get('SHELL').length - 1);
});

test('sw: activate deletes only other tipnet- caches and claims clients', async () => {
  const sw = load();
  const version = sw.get('VERSION');
  ['tipnet-v1', 'tipnet-v14', version, 'other-app', 'workbox-x'].forEach((n) => sw.open(n));
  await sw.lifecycle('activate');
  assert.deepEqual(sw.calls.deleted.sort(), ['tipnet-v1', 'tipnet-v14']);
  assert.deepEqual([...sw.stores.keys()].sort(), [version, 'other-app', 'workbox-x'].sort());
  assert.equal(sw.calls.claimed, 1);
});

test('sw: SKIP_WAITING (object or string) skips waiting; other messages do not', () => {
  const sw = load();
  sw.handlers.message({ data: { type: 'SKIP_WAITING' } });
  sw.handlers.message({ data: 'SKIP_WAITING' });
  sw.handlers.message({ data: 'hello' });
  assert.equal(sw.calls.skipped, 2);
});

const CFG = ORIGIN + '/js/billing-config.js';

test('sw: billing-config.js is network first and refreshes the cache', async () => {
  const sw = load(async () => new Response('fresh'));
  sw.open(sw.get('VERSION')).set(CFG, new Response('stale'));
  const res = await sw.request(CFG + '?x=1');
  assert.equal(res.body, 'fresh');
  assert.equal(sw.calls.fetch[0].init.cache, 'no-cache');
  await later();
  assert.equal(sw.open(sw.get('VERSION')).get(CFG).body, 'fresh', 'cache updated');
});

test('sw: billing-config.js falls back to the cache when offline', async () => {
  const sw = load(offline);
  sw.open(sw.get('VERSION')).set(CFG, new Response('cached'));
  assert.equal((await sw.request(CFG)).body, 'cached');
});

test('sw: billing-config.js falls back to the cache on a 5xx', async () => {
  const sw = load(async () => new Response('boom', { status: 503 }));
  sw.open(sw.get('VERSION')).set(CFG, new Response('cached'));
  assert.equal((await sw.request(CFG)).body, 'cached');
});

test('sw: billing-config.js with nothing cached: a 5xx is passed on, offline gives a network error', async () => {
  assert.equal((await load(async () => new Response('boom', { status: 503 })).request(CFG)).status, 503);
  assert.equal((await load(offline).request(CFG)).type, 'error');
});

test('sw: other same-origin requests are cache first, and stored after a network fetch', async () => {
  const sw = load(async () => new Response('net'));
  sw.open(sw.get('VERSION')).set(ORIGIN + '/js/app.js', new Response('cached'));
  assert.equal((await sw.request(ORIGIN + '/js/app.js?v=2')).body, 'cached');
  assert.equal(sw.calls.fetch.length, 0, 'no network when cached');
  assert.equal((await sw.request(ORIGIN + '/new.txt')).body, 'net');
  await later();
  assert.equal(sw.open(sw.get('VERSION')).get(ORIGIN + '/new.txt').body, 'net');
});

test('sw: an offline page navigation falls back to the cached index.html', async () => {
  const sw = load(offline);
  sw.open(sw.get('VERSION')).set(ORIGIN + '/index.html', new Response('shell'));
  assert.equal((await sw.request(ORIGIN + '/somewhere', { mode: 'navigate' })).body, 'shell');
});

test('sw: cross-origin and non-GET requests are not intercepted', async () => {
  const sw = load(async () => new Response('net'));
  assert.equal(await sw.request('https://api.lemonsqueezy.com/v1/licenses/activate'), null);
  assert.equal(await sw.request(ORIGIN + '/js/app.js', { method: 'POST' }), null);
});
