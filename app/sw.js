/* TipNet service worker. Bump VERSION on every release so clients fetch a fresh shell.
   It does NOT skipWaiting on its own: the page shows "Update available: Refresh" and
   posts {type:'SKIP_WAITING'} (or the string 'SKIP_WAITING') when the user agrees. */
const VERSION = 'tipnet-v13';

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'js/theme-boot.js',
  'css/fonts.css',
  'css/tokens.css',
  'css/components.css',
  'fonts/big-shoulders-display.woff2',
  'fonts/figtree.woff2',
  'fonts/ibm-plex-mono-500.woff2',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
  'js/app.js',
  'js/math.js',
  'js/storage.js',
  'js/csv.js',
  'js/billing.js',
  'js/billing-config.js',
  'js/budget.js',
  'js/integrations/source.js',
  'js/ui/tonight.js',
  'js/ui/periods.js',
  'js/ui/setup.js',
  'js/ui/importer.js',
  'js/ui/backup.js',
  'js/ui/common.js',
  'js/ui/budget.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) =>
      // Add one by one so a single missing file cannot block installation.
      Promise.all(SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {})))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('tipnet-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  const d = event.data;
  if (d === 'SKIP_WAITING' || (d && d.type === 'SKIP_WAITING')) self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Only same-origin files are cached; payment provider calls (api.lemonsqueezy.com) pass straight through.
  if (url.origin !== self.location.origin) return;

  // Payment settings: network first so switching payments on reaches installed apps on their next open.
  // Falls back to the cached copy when offline, or when the network is slower than 4 seconds.
  if (url.pathname.endsWith('/js/billing-config.js')) {
    event.respondWith(new Promise((resolve) => {
      let done = false;
      const finish = (res) => { if (!done) { done = true; clearTimeout(timer); resolve(res); } };
      const cached = () => caches.match(req, { ignoreSearch: true });
      const timer = setTimeout(() => cached().then((hit) => { if (hit) finish(hit); }), 4000);
      fetch(req, { cache: 'no-cache' })
        .then((res) => {
          if (res && res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
          finish(res);
        })
        .catch(() => cached().then((hit) => finish(hit || Response.error())));
    }));
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => (req.mode === 'navigate' ? caches.match('index.html') : Response.error()));
    })
  );
});
