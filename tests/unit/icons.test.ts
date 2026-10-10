// Kontext-Symbole und Anzeige der Kontextnamen (ohne „@“)
import { describe, expect, test } from 'bun:test';
import { ctxLabel, ctxIconKey, ctxIcon, ctxBadge, ICON_PATHS, itemSymbol } from '../../src/icons';

describe('Kontextname', () => {
  test('Anzeige ohne @, gespeicherter Wert bleibt unverändert', () => {
    expect(ctxLabel('@Computer')).toBe('Computer');
    expect(ctxLabel('@@Garten')).toBe('Garten');
    expect(ctxLabel('Ohne')).toBe('Ohne');
    expect(ctxLabel('  @Büro ')).toBe('Büro');
  });
});

describe('Symbole', () => {
  test('alle sechs Standard-Kontexte haben ein Symbol', () => {
    for (const c of ['@Computer', '@Telefon', '@Unterwegs', '@Zuhause', '@Büro', '@Besprechung']) {
      expect(ctxIconKey(c)).not.toBeNull();
      expect(ctxIcon(c)).toContain('<svg');
    }
    expect(Object.keys(ICON_PATHS).length).toBe(6);
  });
  test('Gross-/Kleinschreibung und @ spielen keine Rolle', () => {
    expect(ctxIconKey('@telefon')).toBe(ctxIconKey('@Telefon'));
    expect(ctxIconKey('Telefon')).toBe(ctxIconKey('@Telefon'));
  });
  test('eigene Kontexte bekommen ein allgemeines Etikett-Symbol', () => {
    expect(ctxIconKey('@Garten')).toBeNull();
    expect(ctxIcon('@Garten')).toContain('ico-tag');
  });
  test('Grösse einstellbar, Symbol ist für Screenreader verborgen', () => {
    const s = ctxIcon('@Computer', 24);
    expect(s).toContain('width="24"');
    expect(s).toContain('aria-hidden="true"');
  });
  test('Plakette: bekannte Kontexte nur Symbol, eigene mit Namen; immer mit Namen für Screenreader', () => {
    const known = ctxBadge('@Computer');
    expect(known).toContain('title="Computer"');
    expect(known).toContain('sr-only">Computer<');
    expect(known).not.toContain('@');
    const own = ctxBadge('@Garten');
    expect(own).toContain('class="ctx-name">Garten<');
  });
  test('Namen werden maskiert', () => {
    expect(ctxBadge('@<b>')).toContain('&lt;b&gt;');
    expect(ctxBadge('@<b>')).not.toContain('<b>');
  });
});

describe('Symbol im Kontext-Platz', () => {
  const it = (o: Record<string, unknown>) => ({ list: 'next', context: null, ...o } as any);
  test('Warten auf: immer die Sanduhr, auch mit Kontext', () => {
    expect(itemSymbol(it({ list: 'waiting' }))).toBe('waiting');
    expect(itemSymbol(it({ list: 'waiting', context: '@Telefon' }))).toBe('waiting');
  });
  test('mit Kontext: der Kontext; offen ohne Kontext: Fragezeichen', () => {
    expect(itemSymbol(it({ context: '@Büro' }))).toBe('@Büro');
    expect(itemSymbol(it({}))).toBe('none');
    expect(itemSymbol(it({ list: 'someday' }))).toBe('none');
  });
  test('Inbox, Referenz, Erledigt, Papierkorb ohne Kontext: kein Symbol', () => {
    for (const list of ['inbox', 'reference', 'done', 'trash']) expect(itemSymbol(it({ list }))).toBeNull();
    expect(itemSymbol(it({ list: 'done', context: '@Büro' }))).toBe('@Büro');
  });
});
