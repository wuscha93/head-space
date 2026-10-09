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

// Neue Version: alle Dateien frisch vom Server holen und dann warten, bis der Nutzer
// „Jetzt aktualisieren“ wählt. So mischen sich nie alte und neue Dateien.
// Jede Datei wird mit „?v=<Build>“ geholt: Diese Adresse kennt kein Zwischenspeicher (auch nicht
// der von GitHub), also kommt garantiert die neue Datei. Gespeichert wird sie unter dem normalen Namen.
// Passt die geladene app.js nicht zu dieser Version, bricht die Installation ab und wird später wiederholt.
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Jede Antwort sofort vollständig lesen: Unfertig gelesene Antworten blockieren sonst
    // Verbindungen, und bei langsamen Netzen bleibt die Installation hängen.
    const files = await Promise.all(FILES.map(async (f) => {
      const res = await fetch(new Request(`${f}${f.includes('?') ? '&' : '?'}v=${VERSION}`, { cache: 'reload' }));
      if (!res.ok) throw new Error(`${f}: ${res.status}`);
      const body = await res.arrayBuffer();
      return { f, body, type: res.headers.get('content-type') || '' };
    }));
    const app = files.find((x) => x.f === 'app.js');
    if (!new TextDecoder().decode(app.body).includes(VERSION)) throw new Error('app.js passt nicht zu dieser Version');
    await Promise.all(files.map((x) => cache.put(x.f, new Response(x.body, { headers: { 'content-type': x.type } }))));
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
  if (e.data === 'version') e.source?.postMessage({ version: VERSION });
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
