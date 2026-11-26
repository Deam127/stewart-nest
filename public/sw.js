// The Stewart Nest — service worker: shows phone notifications and opens the app when one is tapped.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || '#calendar';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) { c.navigate ? await c.navigate('/' + link).catch(() => {}) : 0; return c.focus(); } }
    return self.clients.openWindow('/' + link);
  })());
});
