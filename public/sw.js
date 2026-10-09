// Service Worker: macht die App offline nutzbar und liefert Updates kontrolliert aus.
// Speichert nur die App-Dateien, nie deine Daten.
const VERSION = '__BUILD__';
const CACHE = 'kopf-frei-' + VERSION;
const FILES = ['./', 'index.html', 'app.js', 'styles.css', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

// Neue Version: alle Dateien frisch vom Server holen (am HTTP-Cache vorbei) und dann warten,
// bis der Nutzer „Jetzt aktualisieren“ wählt. So mischen sich nie alte und neue Dateien.
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('kopf-frei-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// App-Dateien aus dem Cache dieser Version; alles andere (z. B. GitHub-API) direkt übers Netz.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true })
        || (req.mode === 'navigate' ? await cache.match('index.html') : undefined);
      return hit || fetch(req);
    }),
  );
});
