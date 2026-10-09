// Lokale Speicherung in IndexedDB. Nichts verlässt das Gerät.
// Fällt IndexedDB aus (z. B. privates Fenster), läuft die App im Arbeitsspeicher weiter.

import type { GtdEvent } from './types';

const DB_NAME = 'kopf-frei';
/**
 * Datenbank-Version. Upgrades sind NUR additiv (neue Speicher, nie löschen oder umbauen),
 * damit bestehende Daten bei jedem Update erhalten bleiben.
 *  1 – events (Ereignis-Log), meta (Geräte-Einstellungen)
 *  2 – synced (IDs der Ereignisse, die schon im GitHub-Repo liegen)
 */
const DB_VERSION = 2;

/** Wird aufgerufen, wenn ein anderes Fenster mit älterer Version das Upgrade blockiert. */
export let onBlocked: () => void = () => {};
export function setOnBlocked(fn: () => void) { onBlocked = fn; }

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memory = { events: new Map<string, GtdEvent>(), meta: new Map<string, unknown>(), synced: new Set<string>() };
export let persistent = true;

export function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        // Additive Migrationen: jede Stufe prüft nur, ob ihr Speicher fehlt.
        if (!db.objectStoreNames.contains('events')) db.createObjectStore('events', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        if (!db.objectStoreNames.contains('synced')) db.createObjectStore('synced');
      };
      req.onsuccess = () => {
        const db = req.result;
        // Öffnet eine neuere Version die Datenbank in einem anderen Fenster: hier schliessen und neu laden.
        db.onversionchange = () => { db.close(); location.reload(); };
        resolve(db);
      };
      req.onerror = () => { persistent = false; resolve(null); };
      // Blockiert: NICHT auf Arbeitsspeicher ausweichen (Datenverlust), sondern warten und Hinweis zeigen.
      req.onblocked = () => onBlocked();
    } catch {
      persistent = false;
      resolve(null);
    }
  });
  return dbPromise;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaktion abgebrochen'));
  });
}

export function sortEvents(evs: GtdEvent[]): GtdEvent[] {
  return evs.sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export async function allEvents(): Promise<GtdEvent[]> {
  const db = await open();
  if (!db) return sortEvents([...memory.events.values()]);
  const tx = db.transaction('events', 'readonly');
  const evs = await req(tx.objectStore('events').getAll() as IDBRequest<GtdEvent[]>);
  return sortEvents(evs);
}

/** Fügt Ereignisse hinzu. Bereits vorhandene IDs werden einfach überschrieben (idempotent). */
export async function putEvents(evs: GtdEvent[]): Promise<void> {
  const db = await open();
  if (!db) { evs.forEach((e) => memory.events.set(e.id, e)); return; }
  const tx = db.transaction('events', 'readwrite');
  const store = tx.objectStore('events');
  evs.forEach((e) => store.put(e));
  await done(tx);
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await open();
  if (!db) return memory.meta.get(key) as T | undefined;
  const tx = db.transaction('meta', 'readonly');
  return (await req(tx.objectStore('meta').get(key))) as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await open();
  if (!db) { memory.meta.set(key, value); return; }
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').put(value, key);
  await done(tx);
}

/** Bittet den Browser, die Daten nicht automatisch zu löschen (wichtig auf iPad/Android). */
export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

// ---------- Sync-Buchhaltung ----------

/** IDs der Ereignisse, die bereits im Sync-Repo liegen. */
export async function syncedIds(): Promise<Set<string>> {
  const db = await open();
  if (!db) return new Set(memory.synced);
  const tx = db.transaction('synced', 'readonly');
  const keys = await req(tx.objectStore('synced').getAllKeys());
  return new Set(keys as string[]);
}

export async function markSynced(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = await open();
  if (!db) { ids.forEach((i) => memory.synced.add(i)); return; }
  const tx = db.transaction('synced', 'readwrite');
  const st = tx.objectStore('synced');
  ids.forEach((i) => st.put(1, i));
  await done(tx);
}

export async function clearSynced(): Promise<void> {
  const db = await open();
  if (!db) { memory.synced.clear(); return; }
  const tx = db.transaction('synced', 'readwrite');
  tx.objectStore('synced').clear();
  await done(tx);
}

export async function deleteMeta(key: string): Promise<void> {
  const db = await open();
  if (!db) { memory.meta.delete(key); return; }
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').delete(key);
  await done(tx);
}
