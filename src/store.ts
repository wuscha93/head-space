// Zustand der App: entsteht aus dem Ereignis-Log.
// Jede Änderung = ein Ereignis → sofort angewendet und in IndexedDB gespeichert.

import * as db from './db';
import { ENV, IS_TEST } from './env';
import { decryptJSON, encryptJSON, type EncryptedFile } from './crypto';
import type { EventType, GtdEvent, Item, ListName, Project, State } from './types';

/** Format der Ereignisse. Nur erhöhen, wenn alte Apps neue Ereignisse nicht mehr verstehen dürften. */
export const EVENT_FORMAT = 1;

export const state: State = { items: new Map(), projects: new Map(), contexts: [] };
export const info = { device: '', eventCount: 0, lastBackup: 0 as number, persistent: true, voiceCloud: false };

/** Geräte-Einstellung (nicht im Ereignis-Log): Online-Spracherkennung des Browsers erlaubt? */
export async function setVoiceCloud(allowed: boolean) {
  info.voiceCloud = allowed;
  await db.setMeta('voiceCloud', allowed);
  notify();
}

const DEFAULT_CONTEXTS = ['@Computer', '@Telefon', '@Unterwegs', '@Zuhause', '@Büro', '@Besprechung'];

let lastTs = 0;
let batching = false;
let pending = false;
const listeners = new Set<() => void>();
let onErr: (msg: string) => void = (m) => console.error(m);

export function onChange(fn: () => void) { listeners.add(fn); }
/** Wird nach jeder lokalen Änderung aufgerufen (z. B. um den Sync anzustossen). */
const localListeners = new Set<() => void>();
export function onLocalChange(fn: () => void) { localListeners.add(fn); }
export function onError(fn: (msg: string) => void) { onErr = fn; }
function notify() {
  if (batching) { pending = true; return; }
  listeners.forEach((fn) => fn());
}

/** Mehrere Änderungen gemeinsam ausführen, die Oberfläche aktualisiert sich nur einmal. */
export function batch(fn: () => void) {
  batching = true;
  try { fn(); } finally {
    batching = false;
    if (pending) { pending = false; notify(); }
  }
}

export function uid(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// ---------- Reducer: Ereignis → Zustand ----------
//
// KOMPATIBILITÄT (bitte bei jeder Erweiterung einhalten):
// 1. Ereignisse werden nie geändert oder gelöscht, nur neue angehängt.
// 2. Neue Felder sind immer optional. Fehlt ein Feld (ältere Daten), setzt normalize*() den Standardwert.
// 3. Unbekannte Felder bleiben erhalten (Spread/Object.assign), damit ältere App-Versionen
//    Daten neuerer Versionen beim Sync nicht beschädigen.
// 4. Unbekannte Ereignistypen werden übersprungen, aber gespeichert und weiter synchronisiert.
// 5. Felder werden nie umbenannt oder in ihrer Bedeutung geändert. Stattdessen: neues Feld.

/** Standardwerte für Felder, die ältere Versionen noch nicht kannten. */
export function normalizeItem(d: Partial<Item> & { id: string }, ts: number): Item {
  return {
    title: '', notes: '', list: 'inbox', context: null, projectId: null, waitingFor: null,
    tickler: null, due: null, completed: null, prevList: null,
    ...d,
    created: d.created ?? ts,
    updated: ts,
  } as Item;
}

export function normalizeProject(d: Partial<Project> & { id: string }, ts: number): Project {
  return {
    title: '', outcome: '', status: 'active', due: null, completed: null,
    ...d,
    created: d.created ?? ts,
    updated: ts,
  } as Project;
}

function apply(e: GtdEvent) {
  try { applyUnsafe(e); } catch (err) { console.warn('Ereignis übersprungen', e?.id, err); }
}

function applyUnsafe(e: GtdEvent) {
  const d = e.data;
  if (!d || typeof d !== 'object') return;
  switch (e.type) {
    case 'item.create':
      if (typeof d.id === 'string') state.items.set(d.id, normalizeItem(d, e.ts));
      break;
    case 'item.patch': {
      const it = state.items.get(d.id);
      if (it) Object.assign(it, d.patch, { updated: e.ts });
      break;
    }
    case 'project.create':
      if (typeof d.id === 'string') state.projects.set(d.id, normalizeProject(d, e.ts));
      break;
    case 'project.patch': {
      const p = state.projects.get(d.id);
      if (p) Object.assign(p, d.patch, { updated: e.ts });
      break;
    }
    case 'context.add':
      if (!state.contexts.includes(d.name)) state.contexts.push(d.name);
      break;
    case 'context.remove':
      state.contexts = state.contexts.filter((c) => c !== d.name);
      break;
    default:
      // Ereignis einer neueren App-Version: bleibt gespeichert, wird hier nicht ausgewertet.
      break;
  }
}

function rebuild(evs: GtdEvent[]) {
  state.items.clear();
  state.projects.clear();
  state.contexts = [];
  evs.forEach(apply);
  info.eventCount = evs.length;
  lastTs = evs.length ? evs[evs.length - 1].ts : 0;
}

function emit(type: EventType, data: unknown): GtdEvent {
  let ts = Date.now();
  if (ts <= lastTs) ts = lastTs + 1; // streng monoton, damit die Reihenfolge eindeutig ist
  lastTs = ts;
  const e: GtdEvent = { id: uid(), ts, device: info.device, type, data, v: EVENT_FORMAT };
  apply(e);
  info.eventCount++;
  track(db.putEvents([e]).catch((err) => onErr('Speichern fehlgeschlagen: ' + (err?.message ?? err))));
  notify();
  localListeners.forEach((fn) => fn());
  return e;
}

// ---------- Laufende Speichervorgänge ----------

const pendingWrites = new Set<Promise<unknown>>();
function track(p: Promise<unknown>) {
  pendingWrites.add(p);
  void p.finally(() => pendingWrites.delete(p));
}
/** Wartet, bis alle Änderungen dauerhaft gespeichert sind (z. B. vor einem Update-Neustart). */
export async function whenSaved(): Promise<void> {
  while (pendingWrites.size) await Promise.allSettled([...pendingWrites]);
}

// ---------- Start ----------

export async function init() {
  await db.open();
  info.persistent = db.persistent;
  let device = await db.getMeta<string>('device');
  if (!device) { device = uid(); await db.setMeta('device', device); }
  info.device = device;
  info.lastBackup = (await db.getMeta<number>('lastBackup')) ?? 0;
  info.voiceCloud = (await db.getMeta<boolean>('voiceCloud')) ?? false;
  const evs = await db.allEvents();
  rebuild(evs);
  if (evs.length === 0) batch(() => DEFAULT_CONTEXTS.forEach((c) => emit('context.add', { name: c })));
  notify();
}

// ---------- Aktionen ----------

export function capture(title: string, extra: Partial<Item> = {}): string {
  const id = uid();
  const item: Item = {
    id, title: title.trim(), notes: '', list: 'inbox', context: null, projectId: null,
    waitingFor: null, tickler: null, due: null, created: Date.now(), updated: Date.now(), completed: null, ...extra,
  };
  emit('item.create', item);
  return id;
}

export function patchItem(id: string, patch: Partial<Item>) {
  if (!state.items.has(id)) return;
  emit('item.patch', { id, patch });
}

export function completeItem(id: string) {
  const it = state.items.get(id);
  if (!it) return;
  patchItem(id, { list: 'done', completed: Date.now(), prevList: it.list });
}

export function restoreItem(id: string) {
  const it = state.items.get(id);
  if (!it) return;
  const back: ListName = it.prevList && it.prevList !== 'done' && it.prevList !== 'trash' ? it.prevList : 'next';
  patchItem(id, { list: back, completed: null, prevList: null });
}

export function trashItem(id: string) {
  const it = state.items.get(id);
  if (!it) return;
  patchItem(id, { list: 'trash', prevList: it.list });
}

export function emptyTrash() {
  batch(() => {
    for (const it of state.items.values()) if (it.list === 'trash' && !it.deleted) patchItem(it.id, { deleted: true, title: '', notes: '' });
  });
}

export function createProject(p: Partial<Project> & { title: string }): string {
  const id = uid();
  const project: Project = {
    id, title: p.title.trim(), outcome: p.outcome?.trim() ?? '', status: p.status ?? 'active', due: p.due ?? null,
    created: Date.now(), updated: Date.now(), completed: null,
  };
  emit('project.create', project);
  return id;
}

export function patchProject(id: string, patch: Partial<Project>) {
  if (!state.projects.has(id)) return;
  emit('project.patch', { id, patch });
}

export function normalizeContext(name: string): string {
  const n = name.trim().replace(/^@+/, '');
  return n ? '@' + n : '';
}

export function addContext(name: string): string {
  const n = normalizeContext(name);
  if (n && !state.contexts.includes(n)) emit('context.add', { name: n });
  return n;
}

export function removeContext(name: string) {
  emit('context.remove', { name });
}

// ---------- Verschlüsseltes Backup ----------

interface BackupPayload { app: 'kopf-frei'; exportedAt: number; device: string; events: GtdEvent[]; env?: 'live' | 'test' }

export async function exportBackup(pass: string): Promise<string> {
  const payload: BackupPayload = { app: 'kopf-frei', exportedAt: Date.now(), device: info.device, events: await db.allEvents(), env: ENV };
  const file = await encryptJSON(payload, pass);
  info.lastBackup = Date.now();
  await db.setMeta('lastBackup', info.lastBackup);
  notify();
  return JSON.stringify(file);
}

/**
 * Stellt ein Backup wieder her, indem die Ereignisse zusammengeführt werden:
 * Was in der Datei steht, kommt dazu; was nur auf diesem Gerät ist, bleibt erhalten.
 * (Genau dieses Prinzip trägt später auch den GitHub-Sync.)
 */
export async function importBackup(text: string, pass: string): Promise<{ added: number }> {
  let file: EncryptedFile;
  try { file = JSON.parse(text); } catch { throw new Error('Die Datei konnte nicht gelesen werden. Ist es ein Backup dieser App?'); }
  const payload = await decryptJSON<BackupPayload>(file, pass);
  if (payload?.app !== 'kopf-frei' || !Array.isArray(payload.events)) throw new Error('Das Backup hat ein unbekanntes Format.');
  // Test-Daten nie in die echten Daten übernehmen (umgekehrt erlaubt: echte Daten zum Testen kopieren)
  if (!IS_TEST && payload.env === 'test') throw new Error('Dieses Backup stammt aus der Test-App und wird nicht in deine echten Daten übernommen.');
  const added = await mergeEvents(payload.events);
  if (added) localListeners.forEach((fn) => fn()); // importierte Ereignisse auch hochladen
  return { added };
}

/** Fügt fremde Ereignisse (Backup, Sync) hinzu. Bekannte IDs werden übersprungen. Gibt die Anzahl neuer zurück. */
export async function mergeEvents(incoming: GtdEvent[]): Promise<number> {
  const current = await db.allEvents();
  const known = new Set(current.map((e) => e.id));
  const fresh = incoming.filter((e) => e && typeof e.id === 'string' && typeof e.ts === 'number' && typeof e.type === 'string' && !known.has(e.id));
  if (!fresh.length) return 0;
  await db.putEvents(fresh);
  rebuild(db.sortEvents([...current, ...fresh]));
  notify();
  return fresh.length;
}

/** Für Hinweise ausserhalb der Ereignisse (Sync-Status): Oberfläche neu zeichnen. */
export const refresh = () => notify();

/** Nur für Tests: Zustand zurücksetzen. */
export function resetForTests() {
  state.items.clear(); state.projects.clear(); state.contexts = [];
  info.eventCount = 0; lastTs = 0;
  listeners.clear(); localListeners.clear();
}
