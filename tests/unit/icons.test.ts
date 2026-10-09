// Kontext-Symbole und Anzeige der Kontextnamen (ohne „@“)
import { describe, expect, test } from 'bun:test';
import { ctxLabel, ctxIconKey, ctxIcon, ctxBadge, ICON_PATHS } from '../../src/icons';

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
