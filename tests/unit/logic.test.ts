// Datum, Abfragen (Listen) und Hilfsfunktionen
import { beforeEach, describe, expect, test } from 'bun:test';
import * as S from '../../src/store';
import * as db from '../../src/db';
import * as L from '../../src/logic';

const T = L.today();
const d = (n: number) => L.addDays(T, n);

beforeEach(async () => {
  db.resetMemoryForTests();
  S.resetForTests();
  await S.init();
});

describe('Datum', () => {
  test('isoDate formatiert lokal als JJJJ-MM-TT', () => {
    expect(L.isoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
  test('addDays über Monats-, Jahres- und Schaltjahrgrenzen', () => {
    expect(L.addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(L.addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(L.addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(L.addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(L.addDays('2026-10-25', 1)).toBe('2026-10-26'); // Zeitumstellung
  });
  test('dueState: alle Stufen', () => {
    expect(L.dueState(d(-1))).toBe('overdue');
    expect(L.dueState(T)).toBe('today');
    expect(L.dueState(d(1))).toBe('soon');
    expect(L.dueState(d(3))).toBe('soon');
    expect(L.dueState(d(4))).toBe('week');
    expect(L.dueState(d(7))).toBe('week');
    expect(L.dueState(d(8))).toBe('later');
  });
  test('fmtDate: ohne Jahr im laufenden Jahr, mit Jahr sonst, leer bei null', () => {
    const year = new Date().getFullYear();
    expect(L.fmtDate(`${year}-03-07`)).not.toContain(String(year));
    expect(L.fmtDate(`${year + 1}-03-07`)).toContain(String(year + 1));
    expect(L.fmtDate(null)).toBe('');
  });
  test('daysSince', () => {
    expect(L.daysSince(Date.now() - 3 * 86_400_000 - 1000)).toBe(3);
    expect(L.daysSince(Date.now())).toBe(0);
  });
});

describe('Hilfsfunktionen', () => {
  test('esc entschärft HTML', () => {
    expect(L.esc('<img src=x onerror="alert(1)">&\'')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;');
    expect(L.esc(null)).toBe('');
  });
  test('initials: Anfangsbuchstaben, nur Wörter mit Buchstaben', () => {
    expect(L.initials('Velo winterfit machen')).toBe('VW');
    expect(L.initials('Steuererklärung 2025 einreichen')).toBe('SE');
    expect(L.initials('Übergabe – Ölwechsel')).toBe('ÜÖ');
    expect(L.initials('')).toBe('');
  });
  test('projColor: nach Erstellungsreihenfolge, 7 Farben im Kreis', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) { ids.push(S.createProject({ title: `P${i}` })); await Bun.sleep(2); }
    expect(L.projColor(ids[0])).toBe('pc-0');
    expect(L.projColor(ids[6])).toBe('pc-6');
    expect(L.projColor(ids[7])).toBe('pc-0');
    expect(L.projColor(null)).toBe('pc-none');
    expect(L.projColor('gibt-es-nicht')).toBe('pc-none');
  });
});

describe('Listen (Abfragen)', () => {
  test('Inbox in Erfassungsreihenfolge, gelöschte und andere Listen ausgeschlossen', async () => {
    const a = S.capture('A'); await Bun.sleep(2);
    const b = S.capture('B'); await Bun.sleep(2);
    S.capture('C', { list: 'next' });
    const x = S.capture('X'); S.patchItem(x, { deleted: true });
    expect(L.Q.inbox().map((i) => i.id)).toEqual([a, b]);
  });
  test('Nächste Schritte: Frist zuerst, „Erst ab“ in der Zukunft verborgen, Projekte nur aktiv', async () => {
    const pSome = S.createProject({ title: 'Irgendwann', status: 'someday' });
    const pAct = S.createProject({ title: 'Aktiv' });
    const ohne = S.capture('ohne Frist', { list: 'next' }); await Bun.sleep(2);
    const spaet = S.capture('später fällig', { list: 'next', due: d(9) });
    const frueh = S.capture('früh fällig', { list: 'next', due: d(1) });
    S.capture('noch nicht', { list: 'next', tickler: d(2) });
    const heuteAb = S.capture('ab heute', { list: 'next', tickler: T });
    S.capture('im Irgendwann-Projekt', { list: 'next', projectId: pSome });
    const imAktiv = S.capture('im aktiven Projekt', { list: 'next', projectId: pAct });
    const ids = L.Q.next().map((i) => i.id);
    expect(ids.slice(0, 2)).toEqual([frueh, spaet]);
    expect(ids).toContain(ohne);
    expect(ids).toContain(heuteAb);
    expect(ids).toContain(imAktiv);
    expect(ids.length).toBe(5);
  });
  test('Wieder vorgelegt: Irgendwann mit erreichtem Datum, kommt vor der Inbox beim Klären', () => {
    const inbox = S.capture('neu');
    const back = S.capture('wieder da', { list: 'someday', tickler: T });
    S.capture('noch weg', { list: 'someday', tickler: d(5) });
    expect(L.Q.resurfaced().map((i) => i.id)).toEqual([back]);
    expect(L.toClarify().map((i) => i.id)).toEqual([back, inbox]);
  });
  test('Irgendwann ohne Datum, Wiedervorlage mit Datum in der Zukunft (sortiert)', () => {
    const ohne = S.capture('Idee', { list: 'someday' });
    const w2 = S.capture('w2', { list: 'next', tickler: d(10) });
    const w1 = S.capture('w1', { list: 'waiting', tickler: d(3) });
    S.capture('inbox mit Datum', { list: 'inbox', tickler: d(3) });
    expect(L.Q.someday().map((i) => i.id)).toEqual([ohne]);
    expect(L.Q.tickler().map((i) => i.id)).toEqual([w1, w2]);
  });
  test('Warten auf: nach Nachfass-Datum sortiert', () => {
    const ohne = S.capture('ohne', { list: 'waiting', waitingFor: 'A' });
    const spaet = S.capture('spät', { list: 'waiting', tickler: d(5) });
    const frueh = S.capture('früh', { list: 'waiting', tickler: d(1) });
    expect(L.Q.waiting().map((i) => i.id)).toEqual([frueh, spaet, ohne]);
  });
  test('Referenz alphabetisch, Erledigt neueste zuerst, Papierkorb', async () => {
    S.capture('Zebra', { list: 'reference' });
    S.capture('Apfel', { list: 'reference' });
    expect(L.Q.reference().map((i) => i.title)).toEqual(['Apfel', 'Zebra']);
    const a = S.capture('a', { list: 'next' }); const b = S.capture('b', { list: 'next' });
    S.completeItem(a); await Bun.sleep(3); S.completeItem(b);
    expect(L.Q.done().map((i) => i.id)).toEqual([b, a]);
    S.trashItem(a);
    expect(L.Q.trash().map((i) => i.id)).toEqual([a]);
  });
  test('Fristen: offene Aufgaben und Projekte, Dringendes gezählt', () => {
    S.capture('überfällig', { list: 'next', due: d(-2) });
    S.capture('heute', { list: 'waiting', due: T });
    S.capture('bald', { list: 'next', due: d(2) });
    const erledigt = S.capture('erledigt', { list: 'next', due: d(-5) }); S.completeItem(erledigt);
    S.createProject({ title: 'Projekt heute', due: T });
    S.createProject({ title: 'fertig', status: 'done', due: d(-1) });
    expect(L.Q.dueItems().length).toBe(3);
    expect(L.Q.dueProjects().length).toBe(1);
    expect(L.Q.urgent()).toBe(3);
  });
  test('Projekte: nach Status und alphabetisch, gelöschte ausgeblendet', () => {
    S.createProject({ title: 'Beta' }); S.createProject({ title: 'Alpha' });
    const weg = S.createProject({ title: 'Weg' }); S.patchProject(weg, { deleted: true });
    S.createProject({ title: 'Später', status: 'someday' });
    expect(L.Q.projects('active').map((p) => p.title)).toEqual(['Alpha', 'Beta']);
    expect(L.Q.projects('someday').map((p) => p.title)).toEqual(['Später']);
  });
  test('Projekt ohne nächsten Schritt gilt als festgefahren (Warten auf zählt als Schritt)', () => {
    const p = S.createProject({ title: 'P' });
    const proj = () => S.state.projects.get(p)!;
    expect(L.Q.stalled(proj())).toBe(true);
    const w = S.capture('wartet', { list: 'waiting', projectId: p });
    expect(L.Q.stalled(proj())).toBe(false);
    S.completeItem(w);
    expect(L.Q.stalled(proj())).toBe(true);
    S.capture('Schritt', { list: 'next', projectId: p });
    expect(L.Q.stalled(proj())).toBe(false);
    expect(L.Q.projectItems(p).length).toBe(2);
  });
});
