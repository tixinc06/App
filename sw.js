// Service worker — caches the app shell so the tracker opens instantly and works
// offline once installed to the home screen.
// Strategy: network-first for ALL same-origin requests (so code edits/deploys
// always land when online), falling back to the cache only when offline. This
// avoids stale-JavaScript bugs after a deploy.
const CACHE = 'tracker-v20';
const ASSETS = [
  './', './index.html', './manifest.json',
  './css/styles.css',
  './js/app.js', './js/ui.js', './js/auth.js', './js/supabase.js', './js/config.js',
  './js/resell.js', './js/food.js', './js/fitness.js', './js/charts.js',
  './js/calendar.js', './js/products.js', './js/home.js', './js/workouts.js',
  './js/gamedata.js', './js/progression.js', './js/progress.js',
  './js/standards.js', './js/ranks.js', './js/shop.js', './js/theme.js', './js/social.js',
  './js/streaks.js', './js/quests.js', './js/achievements.js',
  './js/profile.js', './js/resellgoals.js',
  './js/exercises.js', './js/resttimer.js', './js/avatar.js', './js/admin.js',
  './js/rankart.js', './js/sound.js', './js/tdee.js', './js/barcode.js', './js/messages.js',
  './js/push.js', './js/platecalc.js', './js/measurements.js', './js/photos.js', './js/workoutcal.js',
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

// ── Web Push ─────────────────────────────────────────────────────────────────
self.addEventListener('push', e => {
  let payload = {};
  try { payload = e.data ? e.data.json() : {}; } catch { /* non-JSON payload — use defaults */ }
  const title = payload.title || 'Tracker';
  const body = payload.body || '';
  const url = payload.url || './';
  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: payload.tag || 'tracker-push',
      renotify: true,
      data: { url }
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || './';
  e.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientsList) {
      if (client.url.includes(self.location.origin) && 'focus' in client) return client.focus();
    }
    return self.clients.openWindow(url);
  })());
});
