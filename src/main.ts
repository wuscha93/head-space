import { info, init, recordVersion, whenSaved } from './store';
import { APP_VERSION, applyTheme, mount, offerUpdate, setAppActions } from './ui';
import { requestPersistence, setOnBlocked } from './db';
import { initSync } from './sync';
import { IS_TEST } from './env';
import { seedSample } from './sample';
import { getMeta, setMeta } from './db';
import { state } from './store';

declare global { interface Window { KF_NO_SW?: boolean; kopfFrei?: { whenSaved: () => Promise<void>; eventCount: () => number } } }

// Für Tests und Fehlersuche: warten, bis alles gespeichert ist; Anzahl gespeicherter Änderungen
window.kopfFrei = { whenSaved, eventCount: () => info.eventCount };
setAppActions({ checkForUpdate: () => checkForUpdate(), repairApp: () => repairApp() });

async function start() {
  applyTheme();
  setOnBlocked(() => {
    document.getElementById('main')!.innerHTML =
      '<div class="empty"><p class="empty-title">Update wartet</p><p>Die App ist noch in einem anderen Fenster oder Tab offen. Schliess die anderen Fenster, dann geht es hier automatisch weiter.</p></div>';
  });
  try {
    await init();
  } catch (err) {
    console.error(err);
  }
  try { await recordVersion(APP_VERSION); } catch { /* nicht kritisch */ }
  if (IS_TEST) {
    // Test-App deutlich kennzeichnen und beim ersten Start mit Beispieldaten füllen
    document.documentElement.classList.add('env-test');
    const strip = document.createElement('div');
    strip.className = 'env-strip';
    strip.textContent = 'TEST-UMGEBUNG · Beispieldaten · kein Sync';
    document.body.prepend(strip);
    if (!(await getMeta('sampleSeeded')) && state.items.size === 0) {
      seedSample();
      await setMeta('sampleSeeded', true);
    }
  }
  mount();
  try { await initSync(); } catch (err) { console.error(err); }
  requestPersistence();
  registerServiceWorker();
}

let registration: ServiceWorkerRegistration | null = null;

/** „Nach Updates suchen“: fragt den Server sofort nach einer neuen Version. */
async function checkForUpdate(): Promise<'update' | 'current' | 'offline' | 'unsupported'> {
  if (!registration) return 'unsupported';
  try { await registration.update(); } catch { return 'offline'; }
  // Kurz warten, bis eine gefundene Version installiert ist (dann erscheint der Hinweis)
  for (let i = 0; i < 40 && registration.installing; i++) await new Promise((r) => setTimeout(r, 250));
  return registration.waiting ? 'update' : 'current';
}

/** „App reparieren“: Offline-Kopie dieser App löschen und neu laden. Daten bleiben unberührt. */
async function repairApp() {
  await whenSaved();
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.() ?? [];
    const base = new URL('./', location.href).href;
    await Promise.all(regs.filter((r) => r.scope === base).map((r) => r.unregister()));
    const prefix = IS_TEST ? /^kopf-frei-test-\d+$/ : /^kopf-frei-\d+$/;
    await Promise.all((await caches.keys()).filter((k) => prefix.test(k)).map((k) => caches.delete(k)));
  } catch { /* trotzdem neu laden */ }
  location.reload();
}

function registerServiceWorker() {
  if (window.KF_NO_SW || !('serviceWorker' in navigator)) return;
  const secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!secure) return;
  let userAccepted = false;
  // Neue Version übernommen → einmal neu laden (nur wenn der Nutzer aktualisieren wollte)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!userAccepted) return;
    userAccepted = false;
    location.reload();
  });
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    registration = reg;
    const offer = (w: ServiceWorker) => offerUpdate(() => {
      userAccepted = true;
      w.postMessage('skip-waiting');
    });
    // Bereits heruntergeladen und wartend (z. B. beim letzten Öffnen)
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
      });
    });
    // Nach Updates schauen: beim Öffnen, beim Zurückkehren in die App und stündlich
    const check = () => { reg.update().catch(() => { /* offline */ }); };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    window.setInterval(check, 60 * 60_000);
  }).catch(() => { /* offline-Fähigkeit optional */ });
}

void start();
