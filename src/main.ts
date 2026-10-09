import { init, whenSaved } from './store';
import { applyTheme, mount, offerUpdate } from './ui';
import { requestPersistence, setOnBlocked } from './db';
import { initSync } from './sync';

declare global { interface Window { KF_NO_SW?: boolean; kopfFrei?: { whenSaved: () => Promise<void> } } }

// Für Tests und Fehlersuche: warten, bis alles gespeichert ist
window.kopfFrei = { whenSaved };

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
  mount();
  try { await initSync(); } catch (err) { console.error(err); }
  requestPersistence();
  registerServiceWorker();
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
