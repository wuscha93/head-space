// Reine Logik ohne Oberfläche: Datum, Abfragen auf den Zustand, Hilfsfunktionen.
// Wird von ui.ts genutzt und in tests/unit/ direkt geprüft.

import * as S from './store';
import type { Item, Project } from './types';

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const pad = (n: number) => String(n).padStart(2, '0');
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function today(): string {
  return isoDate(new Date());
}
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return isoDate(d);
}
export type DueState = 'overdue' | 'today' | 'soon' | 'week' | 'later';
export function dueState(iso: string): DueState {
  const t = today();
  if (iso < t) return 'overdue';
  if (iso === t) return 'today';
  if (iso <= addDays(t, 3)) return 'soon';
  if (iso <= addDays(t, 7)) return 'week';
  return 'later';
}
export function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('de-CH', sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}
export function fmtTs(ts: number | null): string {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('de-CH', { day: 'numeric', month: 'short' });
}
export function daysSince(ts: number): number {
  return Math.floor((Date.now() - ts) / 86_400_000);
}

// ---------- Abfragen ----------

export const all = () => [...S.state.items.values()].filter((i) => !i.deleted);
export const project = (id: string | null) => (id ? S.state.projects.get(id) : undefined);
export const byCreated = (a: Item, b: Item) => a.created - b.created;
/** Fällige zuerst (frühestes Datum oben), danach in Erfassungsreihenfolge */
export const byDue = (a: Item, b: Item) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || byCreated(a, b);
export const isOpen = (i: Item) => i.list !== 'done' && i.list !== 'trash';

export const Q = {
  inbox: () => all().filter((i) => i.list === 'inbox').sort(byCreated),
  resurfaced: () => all().filter((i) => i.list === 'someday' && i.tickler && i.tickler <= today()).sort(byCreated),
  next: () =>
    all().filter((i) => {
      if (i.list !== 'next') return false;
      if (i.tickler && i.tickler > today()) return false;
      const p = project(i.projectId);
      return !p || p.status === 'active';
    }).sort(byDue),
  dueItems: () => all().filter((i) => i.due && isOpen(i)).sort(byDue),
  dueProjects: () => [...S.state.projects.values()].filter((p) => !p.deleted && p.due && (p.status === 'active' || p.status === 'someday'))
    .sort((a, b) => a.due!.localeCompare(b.due!)),
  /** Überfällig oder heute fällig: braucht Aufmerksamkeit */
  urgent: () => Q.dueItems().filter((i) => i.due! <= today()).length + Q.dueProjects().filter((p) => p.due! <= today()).length,
  waiting: () => all().filter((i) => i.list === 'waiting').sort((a, b) => (a.tickler ?? '9').localeCompare(b.tickler ?? '9') || byDue(a, b)),
  tickler: () =>
    all().filter((i) => i.tickler && i.tickler > today() && ['next', 'someday', 'waiting', 'reference'].includes(i.list))
      .sort((a, b) => a.tickler!.localeCompare(b.tickler!)),
  someday: () => all().filter((i) => i.list === 'someday' && !i.tickler).sort(byCreated),
  reference: () => all().filter((i) => i.list === 'reference').sort((a, b) => a.title.localeCompare(b.title, 'de')),
  done: () => all().filter((i) => i.list === 'done').sort((a, b) => (b.completed ?? 0) - (a.completed ?? 0)),
  trash: () => all().filter((i) => i.list === 'trash'),
  projects: (status: Project['status']) =>
    [...S.state.projects.values()].filter((p) => !p.deleted && p.status === status).sort((a, b) => a.title.localeCompare(b.title, 'de')),
  projectItems: (pid: string) => all().filter((i) => i.projectId === pid),
  /** GTD-Regel: Jedes aktive Projekt braucht einen nächsten Schritt (oder wartet auf jemanden). */
  stalled: (p: Project) => !all().some((i) => i.projectId === p.id && (i.list === 'next' || i.list === 'waiting')),
};

export const toClarify = () => [...Q.resurfaced(), ...Q.inbox()];

/** Projektfarbe: nach Reihenfolge der Erstellung, 7 Farben im Kreis (Rot bleibt für Überfälliges reserviert). */
export function projColor(pid: string | null | undefined): string {
  if (!pid) return 'pc-none';
  const ordered = [...S.state.projects.values()].sort((a, b) => a.created - b.created);
  const i = ordered.findIndex((p) => p.id === pid);
  return i < 0 ? 'pc-none' : `pc-${i % 7}`;
}
export function initials(title: string): string {
  const words = title.split(/[\s–-]+/).filter((w) => /^\p{L}/u.test(w));
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}



// ---------- Wiederherstellungspunkte ----------

export interface RestorePoint { ts: number; label: string; kind: 'update' | 'day' | 'rewind'; changes: number }

const fmtWhen = (ts: number) => new Date(ts).toLocaleString('de-CH', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Sinnvolle Zeitpunkte zum Zurückkehren: vor jedem Update, jeweils Tagesende der letzten 7 Tage
 * und vor jedem früheren Zurücksetzen. Nur Punkte, nach denen sich etwas geändert hat. Neueste zuerst.
 */
export function restorePoints(
  events: { ts: number }[],
  versionLog: { v: string; at: number }[],
  rewinds: { at: number; to: number; when?: number }[],
  now = Date.now(),
): RestorePoint[] {
  const tss = events.map((e) => e.ts).sort((a, b) => a - b);
  const after = (t: number) => { let lo = 0, hi = tss.length; while (lo < hi) { const m = (lo + hi) >> 1; if (tss[m] <= t) lo = m + 1; else hi = m; } return tss.length - lo; };
  const out: RestorePoint[] = [];
  for (const v of versionLog.slice(1)) out.push({ ts: v.at - 1, label: `Vor dem Update auf Version ${v.v} (${fmtWhen(v.at)})`, kind: 'update', changes: 0 });
  for (const r of rewinds) out.push({ ts: r.at - 1, label: `Vor dem Zurücksetzen am ${fmtWhen(r.when ?? r.at)}`, kind: 'rewind', changes: 0 });
  const d = new Date(now);
  for (let i = 1; out.filter((p) => p.kind === 'day').length < 7 && i <= 60; i++) {
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() - i, 23, 59, 59, 999).getTime();
    if (after(end) > 0 && tss.length && tss[0] <= end) {
      out.push({ ts: end, label: `Ende ${new Date(end).toLocaleDateString('de-CH', { weekday: 'long', day: 'numeric', month: 'long' })}`, kind: 'day', changes: 0 });
    }
  }
  for (const p of out) p.changes = after(p.ts);
  return out.filter((p) => p.changes > 0).sort((a, b) => b.ts - a.ts);
}
