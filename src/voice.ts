// Spracheingabe über die Web Speech API des Browsers.
//
// Datenschutz: Viele Browser schicken die Aufnahme zur Erkennung an ihren Anbieter
// (Chrome → Google, Edge → Microsoft, Safari → Apple). Neuere Chrome-Versionen können
// Deutsch auch direkt auf dem Gerät erkennen ("processLocally"). Die App nutzt das,
// wenn es verfügbar ist, und fragt sonst vorher um Erlaubnis.

export type Availability = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unknown';

export const LANG = 'de-DE';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const W = window as any;
const ctor = () => W.SpeechRecognition || W.webkitSpeechRecognition;

export const supported = (): boolean => !!ctor();

// Die Abfrage ist neu in Chrome. Manche Browser-Versionen hängen oder stürzen dabei ab.
// Deshalb: Ergebnis merken, mit Zeitlimit fragen, und einen Absturz beim nächsten Start erkennen.
const PROBE_KEY = 'kopf-frei-voice-probe';
const probe = {
  get: (): string | null => { try { return localStorage.getItem(PROBE_KEY); } catch { return null; } },
  set: (v: string | null) => { try { if (v === null) localStorage.removeItem(PROBE_KEY); else localStorage.setItem(PROBE_KEY, v); } catch { /* egal */ } },
};
const BROKEN_KEY = 'kopf-frei-voice-local-broken';
const localBrokenStored = (): boolean => { try { return localStorage.getItem(BROKEN_KEY) === '1'; } catch { return false; } };
let cached: Availability | null = localBrokenStored() ? 'unavailable' : null;
export const lastAvailability = () => cached;
/** Offline-Erkennung hat auf diesem Gerät versagt: ab jetzt dauerhaft online erkennen. */
export function markLocalBroken() {
  cached = 'unavailable';
  try { localStorage.setItem(BROKEN_KEY, '1'); } catch { /* nur für diese Sitzung */ }
}
/** Für den Diagnose-Test: Offline-Erkennung wieder zulassen. */
export function resetLocalBroken() {
  cached = null;
  try { localStorage.removeItem(BROKEN_KEY); } catch { /* egal */ }
}

/** Protokoll der letzten Aufnahme (für die Fehlersuche in den Einstellungen). */
export const log: string[] = [];

/** Letzter Fehler, für die Anzeige in den Einstellungen (Fehlersuche). */
export const lastIssue = { code: '', mode: '', at: 0 };

/** Kann dieser Browser Deutsch offline (auf dem Gerät) erkennen? */
export async function localAvailability(): Promise<Availability> {
  if (cached && cached !== 'downloading') return cached;
  const C = ctor();
  if (!C || typeof C.available !== 'function') return (cached = 'unknown');
  const flag = probe.get();
  if (flag === 'pending' || flag === 'broken') { probe.set('broken'); return (cached = 'unknown'); }
  probe.set('pending');
  try {
    const r = await Promise.race<Availability>([
      C.available({ langs: [LANG], processLocally: true }),
      new Promise<Availability>((res) => setTimeout(() => res('unknown'), 3000)),
    ]);
    cached = r ?? 'unknown';
  } catch {
    cached = 'unknown';
  }
  probe.set(null);
  return cached;
}

/** Lädt das Sprachpaket für die Offline-Erkennung (Download durch den Browser). */
export async function installLocal(): Promise<boolean> {
  const C = ctor();
  if (!C || typeof C.install !== 'function') return false;
  try {
    cached = null;
    return !!(await C.install({ langs: [LANG], processLocally: true }));
  } catch {
    return false;
  }
}

export interface Handlers {
  onText(text: string, final: boolean): void;
  /** gotText: wurde irgendein Text erkannt? errored: kam vorher ein Fehler? heard: hat das Mikrofon überhaupt aufgenommen? */
  onEnd(gotText: boolean, errored: boolean, heard: boolean): void;
  onError(code: string, heard: boolean): void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let current: any = null;
export let activeTarget: string | null = null;

/**
 * Startet eine Aufnahme. local = true erzwingt Erkennung auf dem Gerät;
 * kann der Browser das nicht garantieren, startet die Aufnahme gar nicht.
 */
export function start(target: string, local: boolean, h: Handlers): boolean {
  stop();
  const C = ctor();
  if (!C) return false;
  const rec = new C();
  if (local) {
    if (!('processLocally' in rec)) return false;
    rec.processLocally = true;
  }
  rec.lang = LANG;
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let gotText = false;
  let errored = false;
  let heard = false;
  const t0 = Date.now();
  log.length = 0;
  const note = (what: string) => { log.push(`${String(Date.now() - t0).padStart(5)} ms  ${what}`); };
  note(`start (${local ? 'offline' : 'online'}, ${LANG})`);
  // Alle Zwischenschritte festhalten: zeigt, wo der Browser aufgibt
  for (const ev of ['start', 'audiostart', 'soundstart', 'speechstart', 'speechend', 'soundend', 'audioend', 'nomatch']) {
    rec.addEventListener?.(ev, () => { if (ev === 'audiostart') heard = true; note(ev); });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rec.onresult = (e: any) => {
    let text = '';
    let final = true;
    for (let i = 0; i < e.results.length; i++) {
      text += e.results[i][0].transcript;
      if (!e.results[i].isFinal) final = false;
    }
    if (text.trim()) gotText = true;
    heard = true;
    note(`result${final ? ' (final)' : ''}: ${text.trim().slice(0, 40)}`);
    h.onText(text.trim(), final);
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rec.onerror = (e: any) => {
    errored = true;
    const code = e?.error ?? 'unknown';
    note(`error: ${code}${e?.message ? ` – ${e.message}` : ''}`);
    Object.assign(lastIssue, { code, mode: local ? 'offline' : 'online', at: Date.now() });
    h.onError(code, heard);
  };
  rec.onend = () => {
    if (current === rec) { current = null; activeTarget = null; }
    note('end');
    if (!gotText && !errored) Object.assign(lastIssue, { code: 'ended-without-result', mode: local ? 'offline' : 'online', at: Date.now() });
    h.onEnd(gotText, errored, heard);
  };
  current = rec;
  activeTarget = target;
  // Offene Bildschirmtastatur schliessen: Sie kann das Mikrofon belegen und die Aufnahme abbrechen
  try { (document.activeElement as HTMLElement | null)?.blur?.(); } catch { /* egal */ }
  try {
    rec.start();
  } catch (err) {
    current = null;
    activeTarget = null;
    note(`start fehlgeschlagen: ${(err as Error)?.name ?? err}`);
    Object.assign(lastIssue, { code: 'start-failed: ' + ((err as Error)?.name ?? ''), mode: local ? 'offline' : 'online', at: Date.now() });
    return false;
  }
  return true;
}

export function stop() {
  if (!current) return;
  try { current.stop(); } catch { /* schon beendet */ }
}

export const ERRORS: Record<string, string> = {
  'not-allowed': 'Kein Zugriff aufs Mikrofon. Erlaube den Zugriff in den Einstellungen des Browsers.',
  'service-not-allowed': 'Die Spracherkennung ist auf diesem Gerät nicht erlaubt. Prüf die Diktier-Einstellungen des Systems.',
  'audio-capture': 'Kein Mikrofon gefunden.',
  'no-speech': 'Nichts gehört. Tipp nochmals aufs Mikrofon und sprich gleich los.',
  'network': 'Die Spracherkennung dieses Browsers braucht eine Internetverbindung.',
  'language-not-supported': 'Deutsch wird von der Spracherkennung dieses Browsers nicht unterstützt.',
  'aborted': 'Die Aufnahme wurde vom Browser abgebrochen.',
};

/** Angaben zur Umgebung für die Fehlersuche. */
export async function environment(): Promise<string[]> {
  const out: string[] = [];
  out.push(`Browser: ${navigator.userAgent}`);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches;
  out.push(`Modus: ${standalone ? 'installierte App' : 'Browser-Tab'}`);
  out.push(`SpeechRecognition: ${W.SpeechRecognition ? 'ja' : 'nein'}, webkitSpeechRecognition: ${W.webkitSpeechRecognition ? 'ja' : 'nein'}`);
  out.push(`Offline-Erkennung: ${cached ?? 'nicht geprüft'}${localBrokenStored() ? ' (als defekt markiert)' : ''}`);
  try {
    const p = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
    out.push(`Mikrofon-Berechtigung: ${p?.state ?? 'unbekannt'}`);
  } catch { out.push('Mikrofon-Berechtigung: nicht abfragbar'); }
  out.push(`Online: ${navigator.onLine ? 'ja' : 'nein'}`);
  return out;
}
