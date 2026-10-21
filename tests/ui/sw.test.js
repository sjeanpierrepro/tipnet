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
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status || 200;
    this.ok = this.status >= 200 && this.status < 300;
    this.type = 'basic';
  }
  clone() {
    return Object.assign(Object.create(Response.prototype), this);
  }
  text() {
    return Promise.resolve(String(this.body));
  }
  static error() {
    const r = new Response(null, { status: 0 });
    r.type = 'error';
    return r;
  }
}
class Request {
  constructor(url, init = {}) {
    this.url = new URL(url, ORIGIN + '/').href;
    this.method = init.method || 'GET';
    this.cache = init.cache;
    this.mode = init.mode || 'cors';
  }
}
const offline = async () => {
  throw new TypeError('offline');
};

/**
 * A fresh worker in a sandbox. net(url, init) is the fake network. windows: the open pages' URLs (WindowClients);
 * navigate(url) on one is recorded in calls.navigated and returns nav(url) (default: resolves right away; nav: null =
 * a browser without navigate()). version: run the worker as another release (e.g. a future 'tipnet-v39').
 */
function load(net = offline, { windows = [ORIGIN + '/'], nav = async () => null, version } = {}) {
  const stores = new Map(); // cache name -> Map(url -> response)
  const calls = {
    fetch: [],
    added: [],
    claimed: 0,
    skipped: 0,
    deleted: [],
    posted: [],
    background: [],
    navigated: [],
    order: [], // 'delete <name>', 'claim', 'navigate <url>' as they happen
  };
  const handlers = {};
  const open = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  };
  const strip = (u) => u.split('?')[0];
  const caches = {
    open: async (name) => ({
      add: async (req) => {
        const res = await net(req.url, { cache: req.cache });
        if (!res.ok) throw new Error('bad status ' + res.status);
        calls.added.push({ url: req.url, cache: req.cache, into: name });
        open(name).set(strip(req.url), res);
      },
      put: async (req, res) => {
        open(name).set(strip(req.url), res);
      },
    }),
    keys: async () => [...stores.keys()],
    delete: async (name) => {
      calls.deleted.push(name);
      calls.order.push('delete ' + name);
      return stores.delete(name);
    },
    match: async (req) => {
      const url = strip(typeof req === 'string' ? new URL(req, ORIGIN + '/').href : req.url);
      for (const m of stores.values()) if (m.has(url)) return m.get(url);
      return undefined;
    },
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type, fn) => {
      handlers[type] = fn;
    },
    clients: {
      claim: async () => {
        calls.claimed++;
        calls.order.push('claim');
      },
      matchAll: async () =>
        windows.map((url) => {
          const c = { url, type: 'window', postMessage: (m) => calls.posted.push(m) };
          if (nav)
            c.navigate = (to) => {
              calls.navigated.push(to);
              calls.order.push('navigate ' + to);
              return nav(to);
            };
          return c;
        }),
    },
    skipWaiting: () => {
      calls.skipped++;
    },
  };
  const ctx = vm.createContext({
    self,
    caches,
    Request,
    Response,
    URL,
    Promise,
    setTimeout,
    clearTimeout,
    fetch: async (req, init) => {
      calls.fetch.push({ url: req.url, init });
      return net(req.url, init);
    },
  });
  const line = /^const VERSION = '[^']*';/m;
  assert.ok(!version || line.test(src), 'VERSION line not found in sw.js');
  vm.runInContext(version ? src.replace(line, `const VERSION = '${version}';`) : src, ctx, {
    filename: 'sw.js',
  });
  return {
    stores,
    calls,
    handlers,
    open,
    get: (name) => {
      const v = vm.runInContext(name, ctx);
      return Array.isArray(v) ? Array.from(v) : v;
    },
    /** Fire install/activate and wait for the worker's waitUntil promise. */
    async lifecycle(type) {
      let p;
      handlers[type]({
        waitUntil: (x) => {
          p = x;
        },
      });
      await p;
    },
    /** Fire a fetch event. null = the worker did not intercept it, otherwise the response. */
    async request(url, init = {}) {
      let p = null;
      handlers.fetch({
        request: new Request(url, init),
        respondWith: (x) => {
          p = x;
        },
        waitUntil: (x) => {
          calls.background.push(x);
        },
      });
      return p;
    },
  };
}

test('sw: every SHELL entry exists on disk under app/', () => {
  const shell = load().get('SHELL');
  assert.ok(shell.length > 20);
  for (const entry of shell)
    assert.ok(fs.existsSync(path.join(APP_DIR, entry === './' ? '' : entry)), 'missing from disk: ' + entry);
  assert.equal(new Set(shell).size, shell.length, 'no duplicates');
});

test('sw: every JS module in app/js is in SHELL (otherwise the app breaks offline)', () => {
  const shell = new Set(load().get('SHELL'));
  const walk = (d) =>
    fs
      .readdirSync(d, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const js = walk(path.join(APP_DIR, 'js'))
    .map((f) => path.relative(APP_DIR, f).split(path.sep).join('/'))
    .filter((f) => f.endsWith('.js'));
  for (const f of js) assert.ok(shell.has(f), f + ' is not in SHELL');
});

test('sw: install precaches the whole shell with cache: reload into the versioned cache', async () => {
  const sw = load(async () => new Response('body'));
  await sw.lifecycle('install');
  const shell = sw.get('SHELL'),
    version = sw.get('VERSION');
  assert.match(version, /^tipnet-/);
  assert.equal(sw.calls.added.length, shell.length);
  assert.ok(sw.calls.added.every((a) => a.cache === 'reload' && a.into === version));
  assert.deepEqual(
    sw.calls.added.map((a) => new URL(a.url).pathname).sort(),
    shell.map((s) => new URL(s, ORIGIN + '/').pathname).sort(),
  );
  assert.equal(sw.calls.skipped, 0, 'does not skip waiting on its own');
});

test('sw: install fails when a shell file fails to download, so the old version stays in charge', async () => {
  const sw = load(async (url) => new Response('x', { status: url.endsWith('js/math.js') ? 404 : 200 }));
  const old = sw.open('tipnet-v1'); // the previous, complete version
  old.set(ORIGIN + '/index.html', new Response('old'));
  await assert.rejects(sw.lifecycle('install'));
  assert.ok(sw.calls.deleted.includes(sw.get('VERSION')), 'the half-filled new cache is discarded');
  assert.ok(!sw.stores.has(sw.get('VERSION')));
  assert.ok(
    sw.stores.has('tipnet-v1'),
    'the previous cache is untouched (activate never runs after a failed install)',
  );
  assert.ok(!sw.calls.deleted.includes('tipnet-v1'));
  assert.equal(sw.calls.skipped, 0);
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

test('sw: taking over from a version before v38 reloads every open window at its own address', async () => {
  const pages = [ORIGIN + '/', ORIGIN + '/index.html?tab=periods'];
  const sw = load(offline, { windows: pages });
  const version = sw.get('VERSION');
  ['tipnet-v37', version].forEach((n) => sw.open(n));
  await sw.lifecycle('activate');
  await later();
  assert.deepEqual(sw.calls.navigated, pages, 'each window to its own URL');
  // after the old cache is gone and the new version controls the windows
  assert.deepEqual(sw.calls.order, ['delete tipnet-v37', 'claim', ...pages.map((u) => 'navigate ' + u)]);
  assert.deepEqual([...sw.stores.keys()], [version]);
  // much older versions too, and a later version that takes over straight from v37 (v38 never installed there)
  for (const [caches, as] of [
    [['tipnet-v9', 'other-app'], undefined],
    [['tipnet-v37'], 'tipnet-v39'],
  ]) {
    const old = load(offline, { windows: pages, version: as });
    [...caches, old.get('VERSION')].forEach((n) => old.open(n));
    await old.lifecycle('activate');
    await later();
    assert.deepEqual(old.calls.navigated, pages, caches.join(', ') + ' -> ' + old.get('VERSION'));
    assert.equal(old.calls.order.indexOf('claim'), old.calls.order.length - pages.length - 1, 'claim first');
  }
});

test('sw: from v38 on, a new version never reloads a window (no forced reload while someone types)', async () => {
  for (const [before, as] of [
    [['tipnet-v38'], 'tipnet-v39'], // v39 taking over from v38
    [['tipnet-v39', 'tipnet-v38'], 'tipnet-v40'],
    [['tipnet-v38'], 'tipnet-v38'], // v38 itself: only its own cache
    [['tipnet-v39'], undefined], // the shipped version with a v39 cache (its own, or the one it replaces)
    [[], undefined], // first install
    [['tipnet-v41', 'tipnet-v100'], undefined],
    [['other-app', 'tipnet-vX', 'old-tipnet-v1'], undefined], // not TipNet version caches
  ]) {
    const sw = load(offline, { version: as });
    [...before, sw.get('VERSION')].forEach((n) => sw.open(n));
    await sw.lifecycle('activate');
    await later();
    const label = before.join(', ') + ' -> ' + sw.get('VERSION');
    assert.deepEqual(sw.calls.navigated, [], label);
    assert.equal(sw.calls.claimed, 1, label);
    assert.deepEqual(
      sw.calls.deleted.sort(),
      before.filter((k) => k.startsWith('tipnet-') && k !== sw.get('VERSION')).sort(),
      label,
    );
  }
});

test('sw: the reload never holds up activation, and a window that can’t be navigated is skipped', async () => {
  // navigate() only settles once the page has loaded, which waits for activation: activate must not wait for it
  const stuck = load(offline, { nav: () => new Promise(() => {}) });
  stuck.open('tipnet-v37');
  await stuck.lifecycle('activate');
  await later();
  assert.equal(stuck.calls.navigated.length, 1);
  // a window that isn't controlled (navigate rejects, or throws): activation still succeeds and the others still reload
  for (const nav of [
    async () => {
      throw new TypeError('not controlled');
    },
    () => {
      throw new TypeError('not controlled');
    },
  ]) {
    const failing = load(offline, { windows: [ORIGIN + '/a', ORIGIN + '/b'], nav });
    failing.open('tipnet-v30');
    await failing.lifecycle('activate');
    await later();
    assert.deepEqual(failing.calls.navigated, [ORIGIN + '/a', ORIGIN + '/b']);
    assert.equal(failing.calls.claimed, 1);
  }
  // a browser without navigate(): nothing to reload, activation still succeeds
  const none = load(offline, { nav: null });
  none.open('tipnet-v37');
  await none.lifecycle('activate');
  await later();
  assert.deepEqual(none.calls.order, ['delete tipnet-v37', 'claim']);
});

test('sw: SKIP_WAITING (object or string) skips waiting; other messages do not', () => {
  const sw = load();
  sw.handlers.message({ data: { type: 'SKIP_WAITING' } });
  sw.handlers.message({ data: 'SKIP_WAITING' });
  sw.handlers.message({ data: 'hello' });
  assert.equal(sw.calls.skipped, 2);
});

const CFG = ORIGIN + '/js/billing-config.js';

test('sw: billing-config.js is cache first, so startup never waits on the network', async () => {
  let release;
  const slow = new Promise((r) => (release = r));
  const sw = load(() => slow.then(() => new Response('fresh')));
  sw.open(sw.get('VERSION')).set(CFG, new Response('cached'));
  const res = await sw.request(CFG + '?x=1');
  assert.equal(res.body, 'cached', 'answered before the network replied');
  assert.equal(sw.calls.fetch[0].init.cache, 'no-cache', 'revalidation started in the background');
  release();
  await Promise.all(sw.calls.background);
  assert.equal(sw.open(sw.get('VERSION')).get(CFG).body, 'fresh', 'cache refreshed for the next open');
  assert.deepEqual(
    JSON.parse(JSON.stringify(sw.calls.posted)),
    [{ type: 'BILLING_CONFIG_CHANGED' }],
    'pages told',
  );
});

test('sw: billing-config.js unchanged on the network: no message to the pages', async () => {
  const sw = load(async () => new Response('same'));
  sw.open(sw.get('VERSION')).set(CFG, new Response('same'));
  assert.equal((await sw.request(CFG)).body, 'same');
  await Promise.all(sw.calls.background);
  assert.deepEqual(sw.calls.posted, []);
});

test('sw: billing-config.js keeps the cached copy when offline or on a 5xx', async () => {
  for (const net of [offline, async () => new Response('boom', { status: 503 })]) {
    const sw = load(net);
    sw.open(sw.get('VERSION')).set(CFG, new Response('cached'));
    assert.equal((await sw.request(CFG)).body, 'cached');
    await Promise.all(sw.calls.background);
    assert.equal(sw.open(sw.get('VERSION')).get(CFG).body, 'cached');
    assert.deepEqual(sw.calls.posted, []);
  }
});

test('sw: billing-config.js with nothing cached: the network answer (a 5xx is passed on, offline is an error)', async () => {
  const sw = load(async () => new Response('net'));
  assert.equal((await sw.request(CFG)).body, 'net');
  await later();
  assert.equal(sw.open(sw.get('VERSION')).get(CFG).body, 'net', 'stored for next time');
  assert.deepEqual(sw.calls.posted, [], 'first copy: nothing to tell');
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
