// The Stewart Nest — service worker: phone notifications (also when the app is closed), the count on the
// app icon, opening the app when a notification is tapped, and opening without signal.
//
// Offline: with signal everything comes fresh from the server (so a new version shows straight away);
// a copy is kept, and used only when there's no connection.
const SHELL = 'nest-shell';
const API = 'nest-api'; // cleared when someone logs out
const SHELL_FILES = ['/', '/style.css', '/alerts.js', '/app.js', '/phase2.js', '/phase3.js', '/phase4.js', '/phase5.js', '/phase6.js',
  '/phase7.js', '/phase8.js', '/manifest.webmanifest', '/icon.svg', '/logo.svg', '/mark.svg', '/icon-192.png'];
// screens worth showing from memory when offline (read-only)
const OFFLINE_API = /^\/api\/(me|users|settings|month|day|tasks|menu|recipes|catalog|trips\/current|items|events|chat|rewards|baby|notifications|lists)(\?|$)/;

self.addEventListener('install', (e) => e.waitUntil((async () => {
  try { const c = await caches.open(SHELL); await Promise.all(SHELL_FILES.map((f) => c.add(f).catch(() => {}))); } catch { /* ignore */ }
  await self.skipWaiting();
})()));
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

async function freshThenCopy(req, cacheName, fallbackUrl) {
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(cacheName).then((c) => c.put(req, copy)).catch(() => {}); }
    return res;
  } catch (err) {
    const hit = (await caches.match(req)) || (fallbackUrl && (await caches.match(fallbackUrl)));
    if (hit) return hit;
    throw err;
  }
}
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) {
    if (OFFLINE_API.test(url.pathname + url.search.replace(/^\?.*/, '?'))) e.respondWith(freshThenCopy(req, API));
    return; // photos, uploads and the rest go straight to the network
  }
  if (req.mode === 'navigate') return e.respondWith(freshThenCopy(req, SHELL, '/'));
  if (SHELL_FILES.includes(url.pathname) || /\.(js|css|svg|png|webmanifest)$/.test(url.pathname)) e.respondWith(freshThenCopy(req, SHELL));
});

// what this phone has already shown, so one push for a chat message doesn't re-show an old notification
async function lastShown() {
  try { const r = await (await caches.open('nest-push')).match('/last'); return r ? await r.json() : {}; } catch { return {}; }
}
async function saveShown(v) {
  try { await (await caches.open('nest-push')).put('/last', new Response(JSON.stringify(v))); } catch { /* ignore */ }
}
const setBadge = (n) => { try { n ? self.navigator.setAppBadge?.(n) : self.navigator.clearAppBadge?.(); } catch { /* not supported */ } };

// The server sends an empty "something's new" push; ask the Nest what it is and show it.
self.addEventListener('push', (e) => e.waitUntil((async () => {
  let b;
  try { const r = await fetch('/api/badges', { credentials: 'same-origin' }); if (!r.ok) return; b = await r.json(); } catch { return; }
  setBadge((b.chat || 0) + (b.notifications || 0));
  // the app is open on screen: it plays its own sound, no pop-up needed
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (wins.some((w) => w.visibilityState === 'visible')) return;
  const seen = await lastShown();
  const opts = { icon: '/icon-192.png', badge: '/icon-192.png', renotify: true, vibrate: [120, 60, 120] };
  const shows = [];
  if (b.chat && b.latest && b.latest.id > (seen.chat || 0)) {
    shows.push(self.registration.showNotification(`💬 ${b.latest.name || 'Family chat'}`,
      { ...opts, body: b.chat > 1 ? `${b.latest.body} (+${b.chat - 1} more)` : b.latest.body, tag: 'nest-#chat', data: { link: '#chat' } }));
    seen.chat = b.latest.id;
  }
  if (b.note && b.note.id > (seen.note || 0)) {
    shows.push(self.registration.showNotification('The Stewart Nest',
      { ...opts, body: b.notifications > 1 ? `${b.note.text} (+${b.notifications - 1} more)` : b.note.text, tag: 'nest-note', data: { link: b.note.link || '#calendar' } }));
    seen.note = b.note.id;
  }
  await Promise.all(shows);
  await saveShown(seen);
})()));

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || '#calendar';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) { c.navigate ? await c.navigate('/' + link).catch(() => {}) : 0; return c.focus(); } }
    return self.clients.openWindow('/' + link);
  })());
});
