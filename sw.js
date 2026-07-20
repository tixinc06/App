// Service worker — caches the app shell so the tracker opens instantly and works
// offline once installed to the home screen.
// Strategy: network-first for ALL same-origin requests (so code edits/deploys
// always land when online), falling back to the cache only when offline. This
// avoids stale-JavaScript bugs after a deploy.
const CACHE = 'tracker-v3';
const ASSETS = [
  './', './index.html', './manifest.json',
  './css/styles.css',
  './js/app.js', './js/ui.js', './js/auth.js', './js/supabase.js', './js/config.js',
  './js/resell.js', './js/food.js', './js/fitness.js', './js/charts.js',
  './js/calendar.js', './js/products.js',
  './icons/icon.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS).catch(() => {})) // tolerate a missing asset
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Never cache Supabase API / auth calls — always go to the network.
  if (url.hostname.endsWith('.supabase.co')) return;

  // Only manage same-origin requests; let the browser handle CDN/fonts directly.
  if (url.origin !== self.location.origin) return;

  const isHTML = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  // Network-first: always try the network, cache a fresh copy, fall back to
  // cache (or the app shell for navigations) when offline.
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && res.status === 200) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(isHTML ? './index.html' : req, copy));
      }
      return res;
    } catch {
      const cached = await caches.match(req);
      if (cached) return cached;
      if (isHTML) return (await caches.match('./index.html')) || Response.error();
      return Response.error();
    }
  })());
});
