// The Stewart Nest — service worker: phone notifications (also when the app is closed), the count on the
// app icon, and opening the app when a notification is tapped.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

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
