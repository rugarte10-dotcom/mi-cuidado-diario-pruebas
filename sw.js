// Service worker de Mi Cuidado Diario: funcionamiento sin conexión y notificaciones push.
const VERSION = '3.0.0-202610281946';
const CACHE = 'mcd-' + VERSION;
const ASSETS = ['./', './index.html', './app.js?v=' + VERSION, './styles.css?v=' + VERSION, './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('mcd-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // Red primero para la página (actualizaciones), caché si no hay conexión.
    event.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put('./index.html', c)); return r; })
      .catch(() => caches.match('./index.html').then(r => r || caches.match('./'))));
    return;
  }
  event.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
    if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); }
    return r;
  })));
});

// iOS exige mostrar una notificación por cada push recibido.
self.addEventListener('push', event => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data && event.data.text() }; }
  const title = d.title || 'Mi Cuidado';
  const opts = { body: d.body || 'Tienes actividades pendientes.', tag: d.tag || 'mcd', icon: 'icon-192.png', badge: 'icon-192.png', data: { url: d.url || './#hoy' }, timestamp: Date.now() };
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, opts),
    (typeof d.badge === 'number' && self.navigator && 'setAppBadge' in self.navigator) ? self.navigator.setAppBadge(d.badge).catch(() => { }) : Promise.resolve()
  ]));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data && event.notification.data.url || './#hoy', self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.startsWith(self.registration.scope) && 'focus' in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});

// Si el sistema renueva la suscripción, se informa al servicio con la credencial del dispositivo guardada en IndexedDB.
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil((async () => {
    const s = await new Promise(res => {
      const r = indexedDB.open('mi-cuidado-diario-3');
      r.onsuccess = () => { try { const g = r.result.transaction('kv').objectStore('kv').get('settings'); g.onsuccess = () => res(g.result); g.onerror = () => res(null); } catch (e) { res(null); } };
      r.onerror = () => res(null);
    });
    const P = s && s.push;
    if (!P || !P.serverUrl || !P.token || !P.vapidKey) return;
    const pad = '='.repeat((4 - P.vapidKey.length % 4) % 4);
    const key = Uint8Array.from(atob((P.vapidKey + pad).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await fetch(P.serverUrl + '/api/subscription', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${P.deviceId}.${P.token}` }, body: JSON.stringify({ subscription: sub.toJSON() }) });
  })().catch(() => { }));
});
