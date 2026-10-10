// Projekt: eigene Reihenfolge (Ziehen), Konflikte mit Fristen, „nur die nächste Aufgabe“
import { beforeEach, describe, expect, test } from 'bun:test';
import * as S from '../../src/store';
import * as db from '../../src/db';
import * as L from '../../src/logic';
import type { Item } from '../../src/types';

const T = L.today();
const d = (n: number) => L.addDays(T, n);
const titles = (its: Item[]) => its.map((i) => i.title);
const steps = (pid: string) => L.Q.projectItems(pid).filter((i) => i.list === 'next');

beforeEach(async () => {
  db.resetMemoryForTests();
  S.resetForTests();
  await S.init();
});

describe('Rückwärtskompatibilität', () => {
  test('alte Einträge und Projekte: keine eigene Reihenfolge, alle Schritte sichtbar', () => {
    expect(S.normalizeItem({ id: 'a', title: 'x' } as any, 1).order).toBeNull();
    expect(S.normalizeProject({ id: 'p', title: 'y' } as any, 1).sequential).toBe(false);
  });
});

describe('Eigene Reihenfolge', () => {
  test('ohne eigene Reihenfolge: nach Frist', () => {
    const p = S.createProject({ title: 'P' });
    S.capture('ohne', { list: 'next', projectId: p });
    S.capture('spät', { list: 'next', projectId: p, due: d(9) });
    S.capture('früh', { list: 'next', projectId: p, due: d(1) });
    expect(titles(steps(p))).toEqual(['früh', 'spät', 'ohne']);
  });
  test('erstes Verschieben nummeriert alle, danach ändert sich nur der verschobene Eintrag', () => {
    const p = S.createProject({ title: 'P' });
    const a = S.capture('A', { list: 'next', projectId: p, due: d(1) });
    S.capture('B', { list: 'next', projectId: p, due: d(2) });
    const c = S.capture('C', { list: 'next', projectId: p, due: d(3) });
    S.moveProjectItem(p, c, 0);
    expect(titles(steps(p))).toEqual(['C', 'A', 'B']);
    const before = S.info.eventCount;
    S.moveProjectItem(p, a, 2);
    expect(titles(steps(p))).toEqual(['C', 'B', 'A']);
    expect(S.info.eventCount - before).toBe(1);
  });
  test('reorderPatches: Mitte zwischen Nachbarn, an den Rändern ±1000', () => {
    const mk = (id: string, order: number | null) => ({ id, order } as Item);
    const its = [mk('a', 1000), mk('b', 2000), mk('c', 3000)];
    expect(L.reorderPatches(its, 'c', 1)).toEqual([{ id: 'c', order: 1500 }]);
    expect(L.reorderPatches(its, 'a', 2)).toEqual([{ id: 'a', order: 4000 }]);
    expect(L.reorderPatches(its, 'c', 0)).toEqual([{ id: 'c', order: 0 }]);
    expect(L.reorderPatches(its, 'b', 1)).toEqual([]);
  });
  test('Einträge ohne Position (z. B. beim Klären einem Projekt zugeordnet) kommen nach den sortierten', () => {
    const p = S.createProject({ title: 'P' });
    S.capture('A', { list: 'next', projectId: p });
    const b = S.capture('B', { list: 'next', projectId: p });
    S.moveProjectItem(p, b, 0);
    S.capture('neu mit Frist', { list: 'next', projectId: p, due: d(1) });
    expect(titles(steps(p))).toEqual(['B', 'A', 'neu mit Frist']);
  });
  test('neuer Schritt im Projekt wird nach Frist eingeordnet', () => {
    const p = S.createProject({ title: 'P' });
    S.capture('A', { list: 'next', projectId: p, due: d(1) });
    const b = S.capture('B', { list: 'next', projectId: p, due: d(5) });
    S.capture('C', { list: 'next', projectId: p });
    S.moveProjectItem(p, b, 0); // B, A, C
    S.addProjectStep(p, 'früh', { due: d(0) });
    S.addProjectStep(p, 'mittel', { due: d(3) });
    S.addProjectStep(p, 'ohne Frist', {});
    expect(titles(steps(p))).toEqual(['früh', 'B', 'A', 'mittel', 'C', 'ohne Frist']);
  });
  test('ohne eigene Reihenfolge bekommt ein neuer Schritt keine Position', () => {
    const p = S.createProject({ title: 'P' });
    const id = S.addProjectStep(p, 'X', { due: d(2), context: '@Telefon' });
    expect(S.state.items.get(id)).toMatchObject({ order: null, due: d(2), context: '@Telefon', list: 'next', projectId: p });
  });
  test('Reihenfolge nach Fristen zurücksetzen', () => {
    const p = S.createProject({ title: 'P' });
    S.capture('A', { list: 'next', projectId: p, due: d(1) });
    const b = S.capture('B', { list: 'next', projectId: p, due: d(2) });
    S.moveProjectItem(p, b, 0);
    S.resetProjectOrder(p);
    expect(titles(steps(p))).toEqual(['A', 'B']);
    expect(steps(p).every((i) => i.order === null)).toBe(true);
  });
});

describe('Konflikte mit Fristen', () => {
  test('frühere Frist unter späterer: Warnung beim Eintrag mit der früheren Frist (ohne Frist zählt nicht)', () => {
    const mk = (id: string, due: string | null) => ({ id, title: id, due } as Item);
    const its = [mk('spät', d(9)), mk('ohne', null), mk('früh', d(1)), mk('später', d(12))];
    const c = L.orderConflicts(its);
    expect([...c.keys()]).toEqual(['früh']);
    expect(c.get('früh')!.map((i) => i.id)).toEqual(['spät']);
  });
  test('nach Frist sortiert: keine Konflikte; gleiche Frist ist kein Konflikt', () => {
    const mk = (id: string, due: string | null) => ({ id, title: id, due } as Item);
    expect(L.orderConflicts([mk('a', d(1)), mk('b', d(1)), mk('c', d(3)), mk('d', null)]).size).toBe(0);
  });
});

describe('„Nur die nächste“ (0.8, ab 0.10 entfernt)', () => {
  test('gespeicherte Einstellung wird ignoriert: alle Schritte bleiben in Nächste Schritte', async () => {
    // Daten aus 0.8/0.9: Projekt mit sequential = true
    const t = Date.now();
    await S.mergeEvents([
      { id: 's1', ts: t, device: 'alt', type: 'project.create', data: { id: 'p', title: 'P', status: 'active', sequential: true } },
      { id: 's2', ts: t + 1, device: 'alt', type: 'item.create', data: { id: 'a', title: 'A', list: 'next', projectId: 'p', order: 1000 } },
      { id: 's3', ts: t + 2, device: 'alt', type: 'item.create', data: { id: 'b', title: 'B', list: 'next', projectId: 'p', order: 2000 } },
    ]);
    expect(titles(L.Q.next()).sort()).toEqual(['A', 'B']);
    expect((S.state.projects.get('p') as any).sequential).toBe(true); // Feld bleibt erhalten
  });
});
