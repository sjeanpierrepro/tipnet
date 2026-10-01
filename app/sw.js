/* TipNet service worker. Bump VERSION on every release so clients fetch a fresh shell.
   It does NOT skipWaiting on its own: the page shows "Update available: Refresh" and
   posts {type:'SKIP_WAITING'} (or the string 'SKIP_WAITING') when the user agrees. */
const VERSION = 'tipnet-v35';

const SHELL = [
  './',
  'index.html',
  'privacy.html',
  'terms.html',
  'manifest.webmanifest',
  'js/theme-boot.js',
  'js/legal.js',
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
  'js/inputs.js',
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
      // Every shell file must arrive. If one fails the install fails: the previous version (with its complete cache)
      // stays in charge, the half-filled new cache is thrown away, and the browser tries again later.
      Promise.all(SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })))).catch((err) =>
        caches.delete(VERSION).then(() => {
          throw err;
        }),
      ),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith('tipnet-') && k !== VERSION).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  const d = event.data;
  if (d === 'SKIP_WAITING' || (d && d.type === 'SKIP_WAITING')) self.skipWaiting();
});

/** Post a message to every open TipNet page. */
function tellPages(msg) {
  return self.clients
    .matchAll({ type: 'window', includeUncontrolled: true })
    .then((list) => list.forEach((c) => c.postMessage(msg)))
    .catch(() => {});
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Only same-origin files are cached; payment provider calls (api.lemonsqueezy.com) pass straight through.
  if (url.origin !== self.location.origin) return;

  // Payment settings: cache first, so the first screen never waits on the network (payments off or not), and
  // revalidated in the background on every request. When the file changed, open pages are told
  // ({type: 'BILLING_CONFIG_CHANGED'}) and re-read it; any page opened later gets the new copy straight away. So switching
  // payments on reaches installed apps without a VERSION bump.
  if (url.pathname.endsWith('/js/billing-config.js')) {
    const key = new Request(url.origin + url.pathname); // one cache entry, whatever ?query the page added
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then((hit) => {
        const hitCopy = hit ? hit.clone() : null; // read later, after the page has consumed hit
        const fresh = fetch(req, { cache: 'no-cache' })
          .then((res) => {
            if (!res || !res.ok) return hit ? null : res; // host error (404/5xx): keep the cached copy
            const forCache = res.clone();
            return Promise.all([res.clone().text(), hitCopy ? hitCopy.text() : null]).then(([now, was]) =>
              caches
                .open(VERSION)
                .then((c) => c.put(key, forCache))
                .then(() => {
                  if (hitCopy && now !== was)
                    return tellPages({ type: 'BILLING_CONFIG_CHANGED' }).then(() => res);
                  return res;
                }),
            );
          })
          .catch(() => (hit ? null : Response.error()));
        if (hit) {
          if (event.waitUntil) event.waitUntil(fresh);
          return hit;
        }
        return fresh; // nothing cached yet (first visit before install finished): the network answer
      }),
    );
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
    }),
  );
});
