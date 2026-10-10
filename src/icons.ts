// Symbole für Kontexte (Stil „Linie“). Gespeichert bleibt der Kontext wie bisher („@Computer“);
// die Anzeige zeigt das Symbol und den Namen ohne „@“.
import { esc } from './logic';

/** 24×24-Strichzeichnungen; Schlüssel: Kontextname klein, ohne „@“. */
export const ICON_PATHS: Record<string, string> = {
  computer: '<rect x="3" y="4" width="18" height="12" rx="1.8"/><path d="M9 20h6M12 16v4"/>',
  telefon: '<path d="M5.2 4.2c.3-.7 1-1.2 1.8-1.2h1.9l1.7 4.3-2.1 1.4a10.8 10.8 0 0 0 5.8 5.8l1.4-2.1 4.3 1.7v1.9c0 .8-.5 1.5-1.2 1.8C11 20.3 3.7 13 5.2 4.2z"/>',
  unterwegs: '<rect x="6" y="3" width="12" height="13" rx="3"/><path d="M6 9.5h12"/><circle cx="9" cy="12.8" r=".7"/><circle cx="15" cy="12.8" r=".7"/><path d="M9 16l-2.2 4.5M15 16l2.2 4.5M7.8 19h8.4"/>',
  zuhause: '<path d="M3.5 11.5L12 4l8.5 7.5"/><path d="M6 9.8V20h12V9.8"/><path d="M10 20v-5.2h4V20"/>',
  'büro': '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M8.5 7h2M13.5 7h2M8.5 10.5h2M13.5 10.5h2M8.5 14h2M13.5 14h2"/><path d="M10.8 21v-3.2h2.4V21"/>',
  besprechung: '<path d="M3 5.5A1.5 1.5 0 0 1 4.5 4h8.5A1.5 1.5 0 0 1 14.5 5.5v4.6a1.5 1.5 0 0 1-1.5 1.5H8.2L5.4 14v-2.4h-.9A1.5 1.5 0 0 1 3 10.1z"/><path d="M17 8.6h2.5A1.5 1.5 0 0 1 21 10.1v4.6a1.5 1.5 0 0 1-1.5 1.5h-.9v2.4l-2.8-2.4h-4.1a1.5 1.5 0 0 1-1.5-1.5v-.9"/>',
};
/** Allgemeines Etikett für selbst angelegte Kontexte */
const TAG_PATH = '<path d="M3.5 12.2V4.8c0-.7.6-1.3 1.3-1.3h7.4l8.3 8.3a1.3 1.3 0 0 1 0 1.8l-7.4 7.4a1.3 1.3 0 0 1-1.8 0z"/><circle cx="8.2" cy="8.2" r="1.4"/>';

/** Name für die Anzeige: ohne führende „@“ */
export const ctxLabel = (name: string) => name.trim().replace(/^@+/, '');

/** Schlüssel des festen Symbols oder null (eigener Kontext) */
export function ctxIconKey(name: string): string | null {
  const k = ctxLabel(name).toLocaleLowerCase('de');
  return k in ICON_PATHS ? k : null;
}

export function ctxIcon(name: string, size = 22): string {
  const k = ctxIconKey(name);
  return `<svg class="ico ${k ? `ico-${k === 'büro' ? 'buero' : k}` : 'ico-tag'}" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${k ? ICON_PATHS[k] : TAG_PATH}</svg>`;
}

/**
 * Kontext auf einer Karte: bekannte Kontexte nur als Symbol (Name als Hinweis und für Screenreader),
 * eigene Kontexte mit Etikett und Namen.
 */
export function ctxBadge(name: string, size = 22): string {
  const label = esc(ctxLabel(name));
  const text = ctxIconKey(name) ? `<span class="sr-only">${label}</span>` : `<span class="ctx-name">${label}</span>`;
  return `<span class="ctx-badge" title="${label}">${ctxIcon(name, size)}${text}</span>`;
}

/** Symbol und Name nebeneinander, auf einer Linie (Abschnittstitel, Einstellungen) */
export const ctxWithName = (name: string, size = 20) =>
  `<span class="ctx-line">${ctxIcon(name, size)}<span class="ctx-name">${esc(ctxLabel(name))}</span></span>`;

/** Sanduhr (Warten auf) und Fragezeichen (ohne Kontext), gleicher Strich wie die Kontext-Symbole */
const HOURGLASS_PATH = '<path d="M6 3h12M6 21h12M7.5 3c0 4.5 9 4.5 9 9s-9 4.5-9 9M16.5 3c0 4.5-9 4.5-9 9s9 4.5 9 9"/>';
const QUESTION_PATH = '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.2 1-1.2 1.9v.5"/><circle cx="12" cy="17" r=".6"/>';

/**
 * Was im Kontext-Platz einer Karte steht: „waiting“ (Sanduhr, auch mit Kontext),
 * der Kontext, „none“ (Fragezeichen: offen, aber ohne Kontext) oder null (nichts).
 */
export function itemSymbol(it: { list: string; context: string | null }): 'waiting' | 'none' | string | null {
  if (it.list === 'waiting') return 'waiting';
  if (it.context) return it.context;
  return ['next', 'someday'].includes(it.list) ? 'none' : null;
}

/** Sanduhr mit Name der Person (Name nur in der kompakten Handy-Ansicht sichtbar) */
export const waitBadge = (who: string | null, size = 22) =>
  `<span class="ctx-badge ctx-wait" title="Warten auf${who ? ` ${esc(who)}` : ''}"><svg class="ico ico-wait" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${HOURGLASS_PATH}</svg><span class="sr-only">Warten auf</span>${who ? `<span class="ctx-name wait-who">${esc(who)}</span>` : ''}</span>`;

export const noneBadge = (size = 22) =>
  `<span class="ctx-badge ctx-none" title="Ohne Kontext"><svg class="ico ico-none" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${QUESTION_PATH}</svg><span class="sr-only">Ohne Kontext</span></span>`;
