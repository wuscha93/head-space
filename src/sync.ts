// Verschlüsselter Sync über ein PRIVATES GitHub-Repository.
//
// Ablauf: Jedes Gerät lädt seine neuen Ereignisse als verschlüsseltes Paket hoch
// (events/<gerät>-<zeit>-<zufall>.json) und holt die Pakete der anderen Geräte.
// Da Ereignisse nur angehängt werden, gibt es keine Git-Konflikte. Gleichzeitige
// Änderungen am selben Feld entscheidet der neuere Zeitstempel.
//
// Im Repo liegt nur Verschlüsseltes (AES-256-GCM). Der Schlüssel wird aus deiner
// Passphrase abgeleitet und auf dem Gerät als nicht exportierbarer Schlüssel gespeichert.
// Das GitHub-Token liegt nur auf diesem Gerät.

import * as db from './db';
import * as S from './store';
import { SYNC_ITERATIONS, b64ToText, randomSalt, seal, syncKeyFromPassphrase, textToB64, unseal, type Sealed } from './crypto';
import type { GtdEvent } from './types';
import { IS_TEST } from './env';

/** In der Test-App gibt es keinen Sync: Test-Daten können so nie ins echte Repo gelangen. */
const TEST_BLOCK = 'In der Test-App ist die Synchronisation abgeschaltet.';

export interface SyncConfig { owner: string; repo: string; token: string; branch: string }

interface RepoHeader {
  format: 'kopf-frei-sync';
  version: 1;
  kdf: { name: 'PBKDF2-SHA256'; iterations: number; salt: string };
  check: Sealed;
  created: number;
}
interface Pack { v: 1; device: string; created: number; events: GtdEvent[] }

const API = 'https://api.github.com';
const HEADER_PATH = 'kopf-frei.json';
const DIR = 'events';
const CHECK_TEXT = 'kopf-frei-ok';

export type SyncState = 'off' | 'locked' | 'idle' | 'syncing' | 'error' | 'offline';
export const status = {
  state: 'off' as SyncState,
  last: 0,
  error: '',
  repo: '',
  pending: 0,
};

let config: SyncConfig | null = null;
let key: CryptoKey | null = null;
let running: Promise<void> | null = null;
let again = false;
let debounce = 0;

// ---------- GitHub-API ----------

export class GitHubError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function gh<T>(cfg: Pick<SyncConfig, 'token'>, path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API + path, {
      ...init,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${cfg.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  } catch {
    throw new GitHubError('Keine Verbindung zu GitHub.', 0);
  }
  if (res.ok) return (res.status === 204 ? null : await res.json()) as T;
  let msg = '';
  try { msg = (await res.json())?.message ?? ''; } catch { /* leer */ }
  const MESSAGES: Record<number, string> = {
    401: 'Das GitHub-Token ist ungültig oder abgelaufen.',
    403: /rate limit/i.test(msg) ? 'GitHub-Anfragelimit erreicht. In einer Stunde geht es wieder.' : 'Das Token hat keine Schreibrechte. Es braucht „Contents: Read and write“ für dieses Repository.',
    404: 'Repository nicht gefunden, oder das Token hat keinen Zugriff darauf.',
  };
  throw new GitHubError(MESSAGES[res.status] ?? `GitHub meldet Fehler ${res.status}${msg ? `: ${msg}` : ''}.`, res.status);
}

const repoPath = (c: SyncConfig) => `/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`;

async function readFile(c: SyncConfig, path: string): Promise<string | null> {
  try {
    const r = await gh<{ content: string }>(c, `${repoPath(c)}/contents/${path}?ref=${encodeURIComponent(c.branch)}`);
    return b64ToText(r.content);
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) return null;
    throw err;
  }
}

async function createFile(c: SyncConfig, path: string, text: string, message: string) {
  const body = JSON.stringify({ message, content: textToB64(text), branch: c.branch });
  for (let attempt = 0; ; attempt++) {
    try {
      return await gh(c, `${repoPath(c)}/contents/${path}`, { method: 'PUT', body });
    } catch (err) {
      // 409: ein anderes Gerät hat im selben Moment geschrieben. Kurz warten, nochmals versuchen.
      if (err instanceof GitHubError && err.status === 409 && attempt < 3) { await new Promise((r) => setTimeout(r, 600 * (attempt + 1))); continue; }
      throw err;
    }
  }
}

async function listPacks(c: SyncConfig): Promise<{ name: string; sha: string }[]> {
  try {
    const t = await gh<{ tree: { path: string; type: string; sha: string }[]; truncated: boolean }>(
      c, `${repoPath(c)}/git/trees/${encodeURIComponent(c.branch)}?recursive=1`);
    return t.tree
      .filter((e) => e.type === 'blob' && e.path.startsWith(DIR + '/') && e.path.endsWith('.json'))
      .map((e) => ({ name: e.path.slice(DIR.length + 1), sha: e.sha }));
  } catch (err) {
    // 409/404: leeres Repository oder Branch existiert noch nicht
    if (err instanceof GitHubError && (err.status === 409 || err.status === 404)) return [];
    throw err;
  }
}

async function readBlob(c: SyncConfig, sha: string): Promise<string> {
  const b = await gh<{ content: string }>(c, `${repoPath(c)}/git/blobs/${sha}`);
  return b64ToText(b.content);
}

// ---------- Einrichten ----------

export interface Probe { header: RepoHeader | null; branch: string; isPrivate: boolean; fullName: string }

/** Schritt 1: Repository und Token prüfen. */
export async function probe(owner: string, repo: string, token: string): Promise<Probe> {
  if (IS_TEST) throw new GitHubError(TEST_BLOCK, 0);
  const info = await gh<{ private: boolean; default_branch: string; full_name: string; permissions?: { push?: boolean } }>(
    { token }, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
  if (!info.private) throw new GitHubError('Das Repository ist öffentlich. Für deine Daten muss es privat sein.', 0);
  if (info.permissions && info.permissions.push === false) throw new GitHubError('Das Token darf in dieses Repository nicht schreiben.', 403);
  const c: SyncConfig = { owner, repo, token, branch: info.default_branch || 'main' };
  const text = await readFile(c, HEADER_PATH);
  let header: RepoHeader | null = null;
  if (text) {
    header = JSON.parse(text);
    if (header?.format !== 'kopf-frei-sync') throw new GitHubError('Das Repository enthält bereits andere Daten. Verwende ein leeres Repository.', 0);
    if (header.version > 1) throw new GitHubError('Die Daten im Repository stammen von einer neueren App-Version. Bitte zuerst die App aktualisieren.', 0);
  }
  return { header, branch: c.branch, isPrivate: info.private, fullName: info.full_name };
}

/** Schritt 2: Passphrase festlegen (neues Repo) oder prüfen (bestehendes Repo), dann verbinden. */
export async function connect(owner: string, repo: string, token: string, pass: string, p: Probe): Promise<void> {
  if (IS_TEST) throw new GitHubError(TEST_BLOCK, 0);
  const c: SyncConfig = { owner, repo, token, branch: p.branch };
  let header = p.header;
  if (!header) {
    const salt = randomSalt();
    const k = await syncKeyFromPassphrase(pass, salt, SYNC_ITERATIONS);
    header = {
      format: 'kopf-frei-sync', version: 1,
      kdf: { name: 'PBKDF2-SHA256', iterations: SYNC_ITERATIONS, salt },
      check: await seal(k, CHECK_TEXT), created: Date.now(),
    };
    try {
      await createFile(c, HEADER_PATH, JSON.stringify(header, null, 2), 'Kopf frei: Sync eingerichtet');
    } catch (err) {
      // 422: ein anderes Gerät war schneller. Dann dessen Einstellungen verwenden.
      if (!(err instanceof GitHubError && err.status === 422)) throw err;
      const text = await readFile(c, HEADER_PATH);
      if (!text) throw err;
      header = JSON.parse(text) as RepoHeader;
    }
  }
  const k = await syncKeyFromPassphrase(pass, header.kdf.salt, header.kdf.iterations);
  let ok = false;
  try { ok = (await unseal<string>(k, header.check)) === CHECK_TEXT; } catch { ok = false; }
  if (!ok) throw new GitHubError('Die Passphrase passt nicht zu den Daten in diesem Repository.', 0);
  config = c;
  key = k;
  await db.setMeta('syncConfig', c);
  await db.setMeta('syncKey', k);
  await db.setMeta('syncKnownFiles', []);
  await db.clearSynced();
  status.repo = `${owner}/${repo}`;
  status.state = 'idle';
  S.refresh();
  await syncNow();
}

/** Falls der Schlüssel auf diesem Gerät fehlt (z. B. Browser-Daten teilweise gelöscht): Passphrase erneut eingeben. */
export async function unlock(pass: string): Promise<void> {
  if (!config) return;
  const text = await readFile(config, HEADER_PATH);
  if (!text) throw new GitHubError('Im Repository fehlen die Sync-Einstellungen.', 0);
  const header = JSON.parse(text) as RepoHeader;
  const k = await syncKeyFromPassphrase(pass, header.kdf.salt, header.kdf.iterations);
  let ok = false;
  try { ok = (await unseal<string>(k, header.check)) === CHECK_TEXT; } catch { ok = false; }
  if (!ok) throw new GitHubError('Die Passphrase ist falsch.', 0);
  key = k;
  await db.setMeta('syncKey', k);
  status.state = 'idle';
  await syncNow();
}

/** Verbindung auf diesem Gerät trennen. Die Daten im Repo und auf dem Gerät bleiben. */
export async function disconnect() {
  config = null;
  key = null;
  await db.deleteMeta('syncConfig');
  await db.deleteMeta('syncKey');
  await db.deleteMeta('syncKnownFiles');
  await db.clearSynced();
  Object.assign(status, { state: 'off', last: 0, error: '', repo: '', pending: 0 });
  S.refresh();
}

// ---------- Synchronisieren ----------

async function runOnce() {
  if (!config || !key) return;
  const c = config;
  const k = key;
  status.state = 'syncing';
  S.refresh();
  // 1. Holen: alle Pakete, die dieses Gerät noch nicht kennt
  const known = new Set((await db.getMeta<string[]>('syncKnownFiles')) ?? []);
  const packs = await listPacks(c);
  const incoming: GtdEvent[] = [];
  const newlyKnown: string[] = [];
  for (const p of packs) {
    if (known.has(p.name)) continue;
    const sealed = JSON.parse(await readBlob(c, p.sha)) as Sealed & { v?: number };
    const pack = await unseal<Pack>(k, sealed);
    if (Array.isArray(pack?.events)) incoming.push(...pack.events);
    newlyKnown.push(p.name);
  }
  if (incoming.length) await S.mergeEvents(incoming);
  await db.markSynced(incoming.map((e) => e.id));
  if (newlyKnown.length) { newlyKnown.forEach((n) => known.add(n)); await db.setMeta('syncKnownFiles', [...known]); }

  // 2. Hochladen: alle Ereignisse, die noch nicht im Repo liegen
  const synced = await db.syncedIds();
  const outgoing = (await db.allEvents()).filter((e) => !synced.has(e.id));
  if (outgoing.length) {
    const rand = Math.random().toString(36).slice(2, 8);
    const name = `${S.info.device.slice(0, 8)}-${Date.now()}-${rand}.json`;
    const pack: Pack = { v: 1, device: S.info.device, created: Date.now(), events: outgoing };
    const sealed = await seal(k, pack);
    await createFile(c, `${DIR}/${name}`, JSON.stringify({ v: 1, ...sealed }), `Kopf frei: ${outgoing.length} Änderungen`);
    await db.markSynced(outgoing.map((e) => e.id));
    known.add(name);
    await db.setMeta('syncKnownFiles', [...known]);
  }
  status.pending = 0;
  status.last = Date.now();
  status.error = '';
  status.state = 'idle';
  await db.setMeta('syncLast', status.last);
}

/** Synchronisiert jetzt. Läuft schon ein Durchgang, folgt direkt ein weiterer. */
export function syncNow(): Promise<void> {
  if (!config || !key) return Promise.resolve();
  if (running) { again = true; return running; }
  running = (async () => {
    do {
      again = false;
      try {
        await runOnce();
      } catch (err) {
        const e = err as GitHubError;
        status.state = e.status === 0 && !navigator.onLine ? 'offline' : 'error';
        status.error = e.message || String(err);
      }
    } while (again && status.state === 'idle');
    running = null;
    S.refresh();
  })();
  return running;
}

/** Nach lokalen Änderungen: kurz warten (mehrere Änderungen bündeln), dann synchronisieren. */
export function schedule(delay = 4000) {
  if (!config || !key) return;
  status.pending++;
  clearTimeout(debounce);
  debounce = window.setTimeout(() => { void syncNow(); }, delay);
}

export const isConfigured = () => !!config;

/** Beim Start: gespeicherte Verbindung laden und automatische Auslöser einrichten. */
export async function initSync() {
  if (IS_TEST) { status.state = 'off'; return; }
  config = (await db.getMeta<SyncConfig>('syncConfig')) ?? null;
  key = (await db.getMeta<CryptoKey>('syncKey')) ?? null;
  status.last = (await db.getMeta<number>('syncLast')) ?? 0;
  if (config) status.repo = `${config.owner}/${config.repo}`;
  status.state = !config ? 'off' : key ? 'idle' : 'locked';
  S.onLocalChange(() => schedule());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void syncNow(); });
  window.addEventListener('online', () => { void syncNow(); });
  window.setInterval(() => { if (document.visibilityState === 'visible') void syncNow(); }, 5 * 60_000);
  if (config && key) void syncNow();
}
