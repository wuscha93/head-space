// Verschlüsselung für Backup und Sync
import { describe, expect, test } from 'bun:test';
import * as C from '../../src/crypto';

describe('Backup-Verschlüsselung', () => {
  test('Hin und zurück, mit Umlauten', async () => {
    const value = { text: 'Grüezi – Spass für Äpfel 🍎', n: [1, 2, 3] };
    const file = await C.encryptJSON(value, 'passphrase-123');
    expect(file).toMatchObject({ format: 'kopf-frei-backup', version: 1, cipher: { name: 'AES-256-GCM' }, kdf: { name: 'PBKDF2-SHA256', iterations: 600_000 } });
    expect(await C.decryptJSON(file, 'passphrase-123')).toEqual(value);
  });
  test('jedes Mal neues Salz und neue IV', async () => {
    const a = await C.encryptJSON({ x: 1 }, 'pw-pw-pw-pw');
    const b = await C.encryptJSON({ x: 1 }, 'pw-pw-pw-pw');
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
    expect(a.data).not.toBe(b.data);
  });
  test('falsche Passphrase, Manipulation und fremdes Format schlagen fehl', async () => {
    const file = await C.encryptJSON({ x: 1 }, 'richtig-richtig');
    await expect(C.decryptJSON(file, 'falsch')).rejects.toThrow('Passphrase falsch');
    const flipped = file.data[5] === 'A' ? 'B' : 'A';
    const tampered = { ...file, data: file.data.slice(0, 5) + flipped + file.data.slice(6) };
    await expect(C.decryptJSON(tampered, 'richtig-richtig')).rejects.toThrow();
    await expect(C.decryptJSON({ format: 'x' } as any, 'p')).rejects.toThrow('keine Backup-Datei');
  });
  test('grosse Datenmengen (Base64 in Stücken)', async () => {
    const big = { s: 'x'.repeat(300_000) };
    const file = await C.encryptJSON(big, 'pw-pw-pw-pw');
    expect((await C.decryptJSON<typeof big>(file, 'pw-pw-pw-pw')).s.length).toBe(300_000);
  });
});

describe('Sync-Verschlüsselung', () => {
  test('seal/unseal mit abgeleitetem Schlüssel', async () => {
    const salt = C.randomSalt();
    const key = await C.syncKeyFromPassphrase('sync-pass-123', salt, 1000);
    const sealed = await C.seal(key, { events: [1, 2] });
    expect(JSON.stringify(sealed)).not.toContain('events');
    expect(await C.unseal(key, sealed)).toEqual({ events: [1, 2] });
  });
  test('gleiche Passphrase + gleiches Salz = gleicher Schlüssel (anderes Gerät kann lesen)', async () => {
    const salt = C.randomSalt();
    const k1 = await C.syncKeyFromPassphrase('gleich-gleich', salt, 1000);
    const k2 = await C.syncKeyFromPassphrase('gleich-gleich', salt, 1000);
    expect(await C.unseal(k2, await C.seal(k1, 'hallo'))).toBe('hallo');
  });
  test('falsche Passphrase: verständlicher Fehler', async () => {
    const salt = C.randomSalt();
    const k1 = await C.syncKeyFromPassphrase('richtig', salt, 1000);
    const k2 = await C.syncKeyFromPassphrase('falsch', salt, 1000);
    await expect(C.unseal(k2, await C.seal(k1, 'x'))).rejects.toThrow('falsche Passphrase');
  });
  test('Schlüssel ist nicht exportierbar', async () => {
    const key = await C.syncKeyFromPassphrase('pw', C.randomSalt(), 1000);
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  });
  test('Base64 für die GitHub-API ist UTF-8-sicher', () => {
    const t = 'Zürich ✓ — €';
    expect(C.b64ToText(C.textToB64(t))).toBe(t);
    expect(C.b64ToText(C.textToB64(t).replace(/(.{4})/g, '$1\n'))).toBe(t); // GitHub liefert Zeilenumbrüche
  });
});
