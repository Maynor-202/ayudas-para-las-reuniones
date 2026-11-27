/* Service Worker - Ayudas para las Reuniones
   Estrategia:
   - Shell (HTML, data.js, manifest, iconos): network-first con fallback a cache
   - Imágenes locales (/img/): cache-first
   - API (/api/*): solo red (no se cachea audio/texto)
   - Navegación: network-first, fallback a index cacheado
*/
const CACHE = 'ayudas-v1';
const CORE = [
  '/',
  '/index.html',
  '/data.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Solo mismo origen; APIs y externos van directo a red
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Navegación SPA: network-first, fallback a index
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put('/index.html', copy));
        return res;
      }).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // data.js e index: network-first para recibir contenido semanal nuevo
  if (url.pathname === '/data.js' || url.pathname === '/index.html' || url.pathname === '/') {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Imágenes y resto de estáticos: cache-first
  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }).catch(() => cached);
    })
  );
});
