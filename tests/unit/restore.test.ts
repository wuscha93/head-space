// „Zurück auf Stand vom …“: Rückkehr per Ausgleichs-Ereignissen
import { beforeEach, describe, expect, test } from 'bun:test';
import * as S from '../../src/store';
import * as db from '../../src/db';
import { Q, restorePoints } from '../../src/logic';

beforeEach(async () => {
  db.resetMemoryForTests(); S.resetForTests(); await S.init();
});

const lastTs = async () => { await S.whenSaved(); const e = await db.allEvents(); return e[e.length - 1].ts; };
const titles = () => [...S.state.items.values()].filter((i) => !i.deleted).map((i) => i.title).sort();

describe('rewindTo', () => {
  test('stellt Titel, Liste, Frist wieder her und entfernt später Erfasstes', async () => {
    const a = S.capture('Aufgabe A', { list: 'next', due: '2030-01-01' });
    const p = S.createProject({ title: 'Projekt' });
    S.addContext('@Garten');
    const point = await lastTs();
    S.patchItem(a, { title: 'A verändert', list: 'done', due: null });
    S.capture('Später erfasst');
    S.patchProject(p, { status: 'dropped', title: 'weg' });
    S.removeContext('@Garten'); S.addContext('@Neu');
    const n = await S.rewindTo(point);
    expect(n).toBeGreaterThan(0);
    expect(S.state.items.get(a)).toMatchObject({ title: 'Aufgabe A', list: 'next', due: '2030-01-01' });
    expect(titles()).toEqual(['Aufgabe A']);
    expect(S.state.projects.get(p)).toMatchObject({ title: 'Projekt', status: 'active' });
    expect(S.state.contexts).toContain('@Garten');
    expect(S.state.contexts).not.toContain('@Neu');
  });
  test('holt endgültig Gelöschtes zurück (inkl. Titel)', async () => {
    const a = S.capture('Wichtig', { notes: 'Notiz' });
    const point = await lastTs();
    S.patchItem(a, { deleted: true, title: '', notes: '' });
    await S.rewindTo(point);
    expect(S.state.items.get(a)).toMatchObject({ title: 'Wichtig', notes: 'Notiz' });
    expect(S.state.items.get(a)!.deleted).toBeFalsy();
    expect(Q.inbox().length).toBe(1);
  });
  test('erzeugt nur bekannte Ereignistypen (ältere Versionen und Sync verstehen es)', async () => {
    S.capture('x');
    const point = await lastTs();
    S.capture('y'); S.addContext('@Z');
    const before = (await db.allEvents()).length;
    await S.rewindTo(point);
    await S.whenSaved();
    const added = (await db.allEvents()).slice(before);
    expect(added.length).toBeGreaterThan(0);
    for (const e of added) expect(['item.patch', 'project.patch', 'context.add', 'context.remove']).toContain(e.type);
  });
  test('nichts geändert: keine Ereignisse', async () => {
    S.capture('x');
    const point = await lastTs();
    expect(await S.rewindTo(point)).toBe(0);
  });
  test('merkt sich den Zeitpunkt davor als eigenen Wiederherstellungspunkt', async () => {
    S.capture('alt');
    const point = await lastTs();
    S.capture('neu');
    await S.rewindTo(point);
    await S.whenSaved();
    const rewinds = (await db.getMeta<{ at: number; to: number }[]>('rewinds'))!;
    const pts = restorePoints(await db.allEvents(), [], rewinds);
    const back = pts.find((p) => p.kind === 'rewind')!;
    expect(back).toBeTruthy();
    expect(back.changes).toBeGreaterThan(0);
    await S.rewindTo(back.ts);
    expect(titles()).toEqual(['alt', 'neu']);
  });
  test('lässt sich selbst wieder rückgängig machen', async () => {
    S.capture('alt');
    const point = await lastTs();
    S.capture('neu');
    const beforeRewind = await lastTs();
    await S.rewindTo(point);
    expect(titles()).toEqual(['alt']);
    await S.rewindTo(beforeRewind);
    expect(titles()).toEqual(['alt', 'neu']);
  });
  test('alte Ereignisse bleiben unverändert (nur angehängt)', async () => {
    S.capture('x');
    const point = await lastTs();
    S.capture('y');
    const snapshot = JSON.stringify(await db.allEvents());
    await S.rewindTo(point); await S.whenSaved();
    const after = await db.allEvents();
    expect(JSON.stringify(after.slice(0, JSON.parse(snapshot).length))).toBe(snapshot);
  });
});

describe('Wiederherstellungspunkte', () => {
  const H = 3_600_000;
  const now = new Date(2026, 9, 9, 18, 0).getTime();
  const ev = (ts: number) => ({ id: String(ts), ts, device: 'x', type: 'item.patch', data: {} });
  test('vor Updates, Tagesende der letzten Tage, vor Zurücksetzen; neueste zuerst; Anzahl späterer Änderungen', () => {
    const events = [ev(now - 50 * H), ev(now - 26 * H), ev(now - 25 * H), ev(now - 2 * H), ev(now - 1 * H)];
    const points = restorePoints(events, [{ v: '0.5.0', at: now - 30 * H }, { v: '0.6.0', at: now - 3 * H }], [{ at: now - 90 * 60_000, to: now - 50 * H }], now);
    const kinds = points.map((p) => p.kind);
    expect(kinds).toContain('update');
    expect(kinds).toContain('day');
    expect(kinds).toContain('rewind');
    for (let i = 1; i < points.length; i++) expect(points[i].ts).toBeLessThanOrEqual(points[i - 1].ts);
    const upd = points.find((p) => p.kind === 'update' && p.label.includes('0.6.0'))!;
    expect(upd.ts).toBe(now - 3 * H - 1);
    expect(upd.changes).toBe(2);
    expect(points.every((p) => p.changes > 0)).toBe(true); // Punkte ohne spätere Änderungen sind sinnlos
  });
  test('Tagesende: nur Tage vor heute mit Änderungen danach, höchstens 7', () => {
    const events = Array.from({ length: 20 }, (_, i) => ev(now - i * 24 * H));
    const days = restorePoints(events, [], [], now).filter((p) => p.kind === 'day');
    expect(days.length).toBe(7);
    for (const d of days) expect(new Date(d.ts).getHours()).toBe(23);
  });
});
