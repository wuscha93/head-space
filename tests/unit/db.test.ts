// Speicher-Schicht (hier im Arbeitsspeicher-Modus, wie im privaten Browserfenster)
import { beforeEach, describe, expect, test } from 'bun:test';
import * as db from '../../src/db';

beforeEach(() => db.resetMemoryForTests());

describe('Ereignisse', () => {
  test('nach Zeit sortiert, bei gleicher Zeit nach ID (gleiche Reihenfolge auf allen Geräten)', async () => {
    await db.putEvents([
      { id: 'b', ts: 2, device: 'x', type: 't', data: {} },
      { id: 'c', ts: 1, device: 'x', type: 't', data: {} },
      { id: 'a', ts: 2, device: 'x', type: 't', data: {} },
    ]);
    expect((await db.allEvents()).map((e) => e.id)).toEqual(['c', 'a', 'b']);
  });
  test('gleiche ID zweimal speichern ergibt keinen Doppeleintrag', async () => {
    const e = { id: 'a', ts: 1, device: 'x', type: 't', data: {} };
    await db.putEvents([e]); await db.putEvents([e]);
    expect((await db.allEvents()).length).toBe(1);
  });
});

describe('Einstellungen und Sync-Buchhaltung', () => {
  test('meta setzen, lesen, löschen', async () => {
    await db.setMeta('k', { a: 1 });
    expect(await db.getMeta('k')).toEqual({ a: 1 });
    await db.deleteMeta('k');
    expect(await db.getMeta('k')).toBeUndefined();
  });
  test('synchronisierte IDs merken und zurücksetzen', async () => {
    await db.markSynced(['a', 'b']); await db.markSynced([]);
    expect([...(await db.syncedIds())].sort()).toEqual(['a', 'b']);
    await db.clearSynced();
    expect((await db.syncedIds()).size).toBe(0);
  });
});
