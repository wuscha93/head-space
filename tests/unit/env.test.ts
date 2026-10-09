// Umgebung (ohne Build-Angabe = Live) und Beispieldaten der Test-App
import { describe, expect, test } from 'bun:test';
import * as E from '../../src/env';
import * as S from '../../src/store';
import * as db from '../../src/db';
import { Q, today } from '../../src/logic';
import { seedSample } from '../../src/sample';

describe('Umgebung', () => {
  test('ohne Angabe beim Bauen: Live mit den bisherigen Namen (bestehende Daten bleiben erreichbar)', () => {
    expect(E.ENV).toBe('live');
    expect(E.IS_TEST).toBe(false);
    expect(E.DB_NAME).toBe('kopf-frei');
    expect(E.storageKey('kf-theme')).toBe('kf-theme');
  });
});

describe('Beispieldaten', () => {
  test('decken alle Listen und Fristen-Stufen ab', async () => {
    db.resetMemoryForTests(); S.resetForTests(); await S.init();
    seedSample();
    expect(Q.projects('active').length).toBe(4);
    expect(Q.projects('someday').length).toBe(1);
    expect(Q.inbox().length).toBe(3);
    expect(Q.next().length).toBeGreaterThan(5);
    expect(Q.waiting().length).toBe(2);
    expect(Q.someday().length).toBe(1);
    expect(Q.reference().length).toBe(1);
    expect(Q.tickler().length).toBe(2);
    expect(Q.dueItems().some((i) => i.due! < today())).toBe(true);
    expect(Q.dueItems().some((i) => i.due === today())).toBe(true);
  });
});
