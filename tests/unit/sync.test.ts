// Sync über ein simuliertes GitHub (kein Netzwerk)
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as S from '../../src/store';
import * as db from '../../src/db';
import * as Sync from '../../src/sync';
import * as C from '../../src/crypto';
import { createHash } from 'node:crypto';

// ---------- Simuliertes GitHub ----------
const TOKEN = 'github_pat_test';
let files: Map<string, string>;
let repo: { private: boolean; push: boolean };
let calls: string[];
let failNext: { status: number; match: string } | null;
let networkDown: boolean;

const sha = (p: string) => createHash('sha1').update(p).digest('hex'); // wie GitHub: eindeutig je Datei (früher: Präfix des Pfads, gleich bei Paketen eines Geräts)
const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const realFetch = globalThis.fetch;
function installFakeGitHub() {
  globalThis.fetch = (async (input: string, init: RequestInit = {}) => {
    if (networkDown) throw new TypeError('Failed to fetch');
    const url = new URL(input);
    const method = init.method ?? 'GET';
    calls.push(`${method} ${url.pathname}`);
    if (failNext && url.pathname.includes(failNext.match)) { const s = failNext.status; failNext = null; return res(s, { message: 'simuliert' }); }
    const auth = (init.headers as Record<string, string>)?.Authorization;
    if (auth !== `Bearer ${TOKEN}`) return res(401, { message: 'Bad credentials' });
    const m = url.pathname.match(/^\/repos\/ich\/daten(\/.*)?$/);
    if (!m) return res(404, { message: 'Not Found' });
    const rest = m[1] ?? '';
    if (rest === '') return res(200, { private: repo.private, default_branch: 'main', full_name: 'ich/daten', permissions: { push: repo.push } });
    if (rest.startsWith('/contents/')) {
      const path = decodeURIComponent(rest.slice(10));
      if (method === 'GET') return files.has(path) ? res(200, { content: files.get(path) }) : res(404, { message: 'Not Found' });
      if (method === 'PUT') {
        if (files.has(path)) return res(422, { message: 'exists' });
        files.set(path, JSON.parse(String(init.body)).content);
        return res(201, {});
      }
    }
    if (rest.startsWith('/git/trees/')) {
      if (!files.size) return res(409, { message: 'empty' });
      return res(200, { tree: [...files.keys()].map((p) => ({ path: p, type: 'blob', sha: sha(p) })), truncated: false });
    }
    if (rest.startsWith('/git/blobs/')) {
      const p = [...files.keys()].find((k) => sha(k) === rest.slice(11));
      return p ? res(200, { content: files.get(p) }) : res(404, {});
    }
    return res(404, {});
  }) as typeof fetch;
}
const repoText = () => [...files.values()].map((c) => C.b64ToText(c)).join('\n');
const packs = () => [...files.keys()].filter((k) => k.startsWith('events/'));

beforeEach(async () => {
  files = new Map(); repo = { private: true, push: true }; calls = []; failNext = null; networkDown = false;
  installFakeGitHub();
  db.resetMemoryForTests(); S.resetForTests(); await S.init();
  await Sync.disconnect();
});
afterEach(() => { globalThis.fetch = realFetch; });

async function connectFresh(pass = 'sync-passphrase-1') {
  const p = await Sync.probe('ich', 'daten', TOKEN);
  await Sync.connect('ich', 'daten', TOKEN, pass, p);
}

/** Ein zweites Gerät simulieren: Paket mit fremden Ereignissen direkt ins Repo legen. */
async function pushFromOtherDevice(pass: string, events: unknown[]) {
  const header = JSON.parse(C.b64ToText(files.get('kopf-frei.json')!));
  const key = await C.syncKeyFromPassphrase(pass, header.kdf.salt, header.kdf.iterations);
  const sealed = await C.seal(key, { v: 1, device: 'anderes', created: Date.now(), events });
  files.set(`events/anderes-${Date.now()}.json`, C.textToB64(JSON.stringify({ v: 1, ...sealed })));
}

describe('Prüfen (Schritt 1)', () => {
  test('falsches Token, fehlendes Repo, öffentliches Repo, keine Schreibrechte', async () => {
    await expect(Sync.probe('ich', 'daten', 'falsch')).rejects.toThrow('ungültig oder abgelaufen');
    await expect(Sync.probe('ich', 'gibtsnicht', TOKEN)).rejects.toThrow('nicht gefunden');
    repo.private = false;
    await expect(Sync.probe('ich', 'daten', TOKEN)).rejects.toThrow('öffentlich');
    repo = { private: true, push: false };
    await expect(Sync.probe('ich', 'daten', TOKEN)).rejects.toThrow('nicht schreiben');
  });
  test('leeres Repo: neu einrichten', async () => {
    const p = await Sync.probe('ich', 'daten', TOKEN);
    expect(p.header).toBeNull();
    expect(p.branch).toBe('main');
  });
  test('fremde Daten oder neueres Format werden abgelehnt', async () => {
    files.set('kopf-frei.json', C.textToB64(JSON.stringify({ format: 'etwas-anderes' })));
    await expect(Sync.probe('ich', 'daten', TOKEN)).rejects.toThrow('andere Daten');
    files.set('kopf-frei.json', C.textToB64(JSON.stringify({ format: 'kopf-frei-sync', version: 2 })));
    await expect(Sync.probe('ich', 'daten', TOKEN)).rejects.toThrow('neueren App-Version');
  });
  test('kein Netz: verständliche Meldung', async () => {
    networkDown = true;
    await expect(Sync.probe('ich', 'daten', TOKEN)).rejects.toThrow('Keine Verbindung');
  });
});

describe('Verbinden und Synchronisieren', () => {
  test('erstes Gerät: legt Einstellungen an und lädt vorhandene Daten verschlüsselt hoch', async () => {
    S.capture('Zahnarzt anrufen', { notes: 'Dr. Muster' });
    await connectFresh();
    expect(files.has('kopf-frei.json')).toBe(true);
    expect(packs().length).toBe(1);
    expect(repoText()).not.toContain('Zahnarzt');
    expect(repoText()).not.toContain('Muster');
    expect(Sync.status.state).toBe('idle');
    expect(Sync.status.repo).toBe('ich/daten');
  });
  test('ohne Änderungen kein weiterer Upload', async () => {
    await connectFresh();
    const n = packs().length;
    await Sync.syncNow();
    expect(packs().length).toBe(n);
  });
  test('neue lokale Änderung wird als neues Paket hochgeladen', async () => {
    await connectFresh();
    S.capture('neu');
    await Sync.syncNow();
    expect(packs().length).toBe(2);
  });
  test('Änderungen eines anderen Geräts werden geholt und nicht zurückgeschickt', async () => {
    await connectFresh('gemeinsam-123');
    await pushFromOtherDevice('gemeinsam-123', [{ id: 'x1', ts: Date.now(), device: 'anderes', type: 'item.create', data: { id: 'fremd', title: 'Vom Tablet' } }]);
    const before = packs().length;
    await Sync.syncNow();
    expect(S.state.items.get('fremd')!.title).toBe('Vom Tablet');
    expect(packs().length).toBe(before);
  });
  test('zweites Gerät: richtige Passphrase verbindet, falsche wird abgelehnt', async () => {
    await connectFresh('erstes-geraet');
    db.resetMemoryForTests(); S.resetForTests(); await S.init(); await Sync.disconnect();
    const p = await Sync.probe('ich', 'daten', TOKEN);
    expect(p.header).not.toBeNull();
    await expect(Sync.connect('ich', 'daten', TOKEN, 'falsch', p)).rejects.toThrow('passt nicht');
    await Sync.connect('ich', 'daten', TOKEN, 'erstes-geraet', p);
    expect(Sync.status.state).toBe('idle');
  });
  test('gleichzeitiges Einrichten (422): übernimmt die Einstellungen des anderen Geräts', async () => {
    const p = await Sync.probe('ich', 'daten', TOKEN);
    const salt = C.randomSalt();
    const key = await C.syncKeyFromPassphrase('gleich-gleich', salt, 1000);
    files.set('kopf-frei.json', C.textToB64(JSON.stringify({ format: 'kopf-frei-sync', version: 1, kdf: { name: 'PBKDF2-SHA256', iterations: 1000, salt }, check: await C.seal(key, 'kopf-frei-ok'), created: 1 })));
    await Sync.connect('ich', 'daten', TOKEN, 'gleich-gleich', p);
    expect(Sync.status.state).toBe('idle');
  });
  test('Konflikt beim Hochladen (409) wird wiederholt', async () => {
    await connectFresh();
    S.capture('nach Konflikt');
    failNext = { status: 409, match: '/contents/events/' };
    await Sync.syncNow();
    expect(Sync.status.state).toBe('idle');
    expect(packs().length).toBe(2);
  });
  test('Fehler werden angezeigt, nichts geht verloren; später wird nachgeholt', async () => {
    await connectFresh();
    S.capture('offline erfasst');
    failNext = { status: 401, match: '/git/trees/' };
    await Sync.syncNow();
    expect(Sync.status.state).toBe('error');
    expect(Sync.status.error).toContain('Token');
    await Sync.syncNow();
    expect(Sync.status.state).toBe('idle');
    expect(packs().length).toBe(2);
  });
  test('Trennen entfernt Token und Schlüssel, Daten bleiben', async () => {
    S.capture('bleibt');
    await connectFresh();
    await Sync.disconnect();
    expect(Sync.status.state).toBe('off');
    expect(Sync.isConfigured()).toBe(false);
    expect(await db.getMeta('syncKey')).toBeUndefined();
    expect(await db.getMeta('syncConfig')).toBeUndefined();
    expect([...S.state.items.values()].some((i) => i.title === 'bleibt')).toBe(true);
  });
  test('Entsperren mit Passphrase, falls der Schlüssel fehlt', async () => {
    await connectFresh('entsperr-pass');
    await expect(Sync.unlock('falsch')).rejects.toThrow('falsch');
    await Sync.unlock('entsperr-pass');
    expect(Sync.status.state).toBe('idle');
  });
});
