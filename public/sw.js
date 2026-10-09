// Service Worker: macht die App offline nutzbar und liefert Updates kontrolliert aus.
// Speichert nur die App-Dateien, nie deine Daten.
const VERSION = '__BUILD__';
// Live: „kopf-frei-<build>“, Test: „kopf-frei-test-<build>“ (gleiche Domain, getrennte Caches)
const PREFIX = '__CACHE_PREFIX__';
const CACHE = PREFIX + VERSION;
const FILES = ['./', 'index.html', 'app.js', 'styles.css', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
// Ordner dieser App, z. B. /head-space/ (live) oder /head-space/test/ (test)
const BASE = new URL('./', self.location).pathname;
// Eigene Caches erkennen: Präfix + Ziffern (so räumt Live nie die Caches der Test-App weg)
const OWN = new RegExp('^' + PREFIX.replace(/[-]/g, '\\-') + '\\d+$');

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
      .then((keys) => Promise.all(keys.filter((k) => OWN.test(k) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Nur Dateien direkt in diesem Ordner gehören zur App. Unterordner (z. B. /test/) sind eine
// andere App und werden nicht angefasst.
function ownPath(url) {
  if (url.origin !== location.origin || !url.pathname.startsWith(BASE)) return false;
  return !url.pathname.slice(BASE.length).includes('/');
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || !ownPath(url)) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true })
        || (req.mode === 'navigate' ? await cache.match('index.html') : undefined);
      return hit || fetch(req);
    }),
  );
});
