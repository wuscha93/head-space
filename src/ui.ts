// Oberfläche: Navigation, Listen, Klär-Dialog, Bearbeiten, Einstellungen.
// Bewusst ohne Framework: Ansichten sind Funktionen, die HTML erzeugen;
// Klicks und Formulare laufen über data-action / data-form (Event-Delegation).

import * as S from './store';
import * as V from './voice';
import * as Sync from './sync';
import { IS_TEST, storageKey } from './env';
import { seedSample } from './sample';
import { destroy as destroyDb, allEvents as getAllEvents, getMeta } from './db';

declare const __APP_VERSION__: string;
declare const __APP_BUILD__: string;
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
const APP_BUILD = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : '';
import type { Item, ListName, Project } from './types';
import { restorePoints, Q, addDays, all, daysSince, dueState, esc, fmtDate, fmtTs, initials, isOpen, project, projColor, today, toClarify, type DueState } from './logic';
export { today } from './logic';

// ---------- Hilfsfunktionen ----------

function dueChip(iso?: string | null): string {
  if (!iso) return '';
  const s = dueState(iso);
  const label = s === 'today' ? 'heute fällig' : s === 'overdue' ? `überfällig seit ${fmtDate(iso)}` : `fällig ${fmtDate(iso)}`;
  return `<span class="chip due-${s}">${label}</span>`;
}


// ---------- Zustand der Oberfläche ----------

type View = 'inbox' | 'due' | 'next' | 'projects' | 'project' | 'waiting' | 'tickler' | 'someday' | 'reference' | 'done' | 'settings';
let route: { view: View; id?: string } = { view: 'inbox' };
let ctxFilter = 'all';
let backupText: string | null = null;
let busy = false;

type Step = 'actionable' | 'not' | 'multi' | 'project' | 'twomin' | 'donow' | 'who' | 'next' | 'delegate';
type Modal =
  | null
  | { kind: 'clarify'; id: string; step: Step; hist: Step[]; title: string }
  | { kind: 'edit'; id: string }
  | { kind: 'project'; id: string | null }
  | { kind: 'capture' }
  | { kind: 'confirm'; text: string; label: string; run: () => void }
  | { kind: 'next-step'; projectId: string; fromId: string }
  | { kind: 'due'; id: string; target: 'item' | 'project' }
  | { kind: 'voice-consent'; target: string; back: Modal }
  | { kind: 'voice-install'; target: string; back: Modal };
let modal: Modal = null;

// ---------- Navigation ----------

const NAV: { group: string; items: { view: View; label: string; count?: () => number; warn?: () => number }[] }[] = [
  { group: 'Erfassen', items: [{ view: 'inbox', label: 'Inbox', count: () => toClarify().length }] },
  {
    group: 'Tun',
    items: [
      { view: 'next', label: 'Nächste Schritte', count: () => Q.next().length },
      { view: 'due', label: 'Fristen', count: () => Q.dueItems().length + Q.dueProjects().length, warn: Q.urgent },
      { view: 'projects', label: 'Projekte', count: () => Q.projects('active').length, warn: () => Q.projects('active').filter(Q.stalled).length },
      { view: 'waiting', label: 'Warten auf', count: () => Q.waiting().length, warn: () => Q.waiting().filter((i) => i.tickler && i.tickler <= today()).length },
    ],
  },
  {
    group: 'Später',
    items: [
      { view: 'tickler', label: 'Wiedervorlage', count: () => Q.tickler().length },
      { view: 'someday', label: 'Irgendwann/Vielleicht', count: () => Q.someday().length + Q.projects('someday').length },
    ],
  },
  {
    group: 'Ablage',
    items: [
      { view: 'reference', label: 'Referenz', count: () => Q.reference().length },
      { view: 'done', label: 'Erledigt' },
    ],
  },
];

function renderNav() {
  const active = route.view === 'project' ? 'projects' : route.view;
  const groups = NAV.map((g) => `
    <div class="nav-group">
      <div class="nav-label">${g.group}</div>
      ${g.items.map((n) => {
        const c = n.count?.() ?? 0;
        const w = n.warn?.() ?? 0;
        return `<button class="nav-item${active === n.view ? ' is-active' : ''}" data-action="go" data-view="${n.view}" aria-current="${active === n.view ? 'page' : 'false'}">
          <span>${n.label}</span>
          ${w ? `<span class="badge warn" title="${w} brauchen Aufmerksamkeit">${w}</span>` : ''}
          ${n.count && c ? `<span class="count">${c}</span>` : ''}
        </button>`;
      }).join('')}
    </div>`).join('');
  document.getElementById('nav')!.innerHTML = `${groups}
    <div class="nav-group nav-foot">
      ${syncIndicator()}
      <button class="nav-item${active === 'settings' ? ' is-active' : ''}" data-action="go" data-view="settings"><span>Einstellungen</span></button>
    </div>`;
}

// ---------- Sync-Anzeige ----------

function ago(ts: number): string {
  if (!ts) return 'noch nie';
  const min = Math.floor((Date.now() - ts) / 60_000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.floor(min / 60);
  if (h < 24) return `vor ${h} Std.`;
  return new Date(ts).toLocaleDateString('de-CH', { day: 'numeric', month: 'short' });
}

function syncIndicator(): string {
  const st = Sync.status;
  if (st.state === 'off') return '';
  const TEXT: Record<Sync.SyncState, string> = {
    off: '', idle: `Synchronisiert ${ago(st.last)}`, syncing: 'Synchronisiere …', error: 'Sync-Fehler',
    offline: 'Offline, wird nachgeholt', locked: 'Sync gesperrt: Passphrase nötig',
  };
  return `<button class="sync-pill sync-${st.state}" data-action="go" data-view="settings" title="${esc(st.error || TEXT[st.state])}">
    <i aria-hidden="true"></i><span>${TEXT[st.state]}</span></button>`;
}

// ---------- Bausteine ----------

const CAL_SVG = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
const CLOCK_SVG = `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.5V8l2.4 1.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

/**
 * Fälligkeit als eigener Platz in der Zeile. Ein Klick aufs Kalendersymbol öffnet die
 * Datumsauswahl des Systems; die Wahl wird sofort gespeichert (mit Rückgängig).
 */
function dueSlot(kind: 'item' | 'project', id: string, due: string | null | undefined, editable = true): string {
  const st = due ? dueState(due) : 'none';
  const text = !due ? '' : st === 'today' ? 'Heute' : fmtDate(due);
  if (!editable) return `<span class="slot slot-due">${due ? `<span class="due due-${st}">${CAL_SVG}<span>${text}</span></span>` : ''}</span>`;
  const label = !due ? 'Frist setzen' : `${st === 'overdue' ? 'Überfällig seit' : 'Fällig am'} ${fmtDate(due)}, ändern`;
  return `<span class="slot slot-due">
    <button type="button" class="due due-${st}" data-action="due-pick" data-kind="${kind}" data-id="${id}" title="${label}" aria-label="${label}">${CAL_SVG}${text ? `<span>${text}</span>` : ''}</button>
    <input type="date" class="due-input" tabindex="-1" aria-hidden="true" data-kind="${kind}" data-id="${id}" value="${due ?? ''}">
  </span>`;
}

/**
 * Attribute einer Aufgabe in festen Plätzen, damit nichts verrutscht:
 * Kontext | Fällig | Erinnerung (Erst ab / Nachfassen) | Projekt und weitere.
 */
function meta(it: Item, opts: { project?: boolean; list?: boolean } = {}): string {
  const open = isOpen(it) && it.list !== 'reference';
  const ctx = it.context ? `<span class="chip ctx">${esc(it.context)}</span>` : '';
  let rem = '';
  if (open && it.tickler) {
    const waiting = it.list === 'waiting';
    const label = `${waiting ? 'Nachfassen am' : 'Erst ab'} ${fmtDate(it.tickler)}`;
    rem = `<span class="chip date${waiting && it.tickler <= today() ? ' due' : ''}" title="${label}" aria-label="${label}">${CLOCK_SVG}${fmtDate(it.tickler)}</span>`;
  }
  const rest: string[] = [];
  const p = project(it.projectId);
  if (p && opts.project !== false) rest.push(`<span class="chip proj"><i class="pdot" aria-hidden="true"></i>${esc(p.title)}</span>`);
  if (it.waitingFor) rest.push(`<span class="chip">wartet auf ${esc(it.waitingFor)}</span>`);
  if (opts.list && it.list !== 'next') rest.push(`<span class="chip">${LIST_LABEL[it.list]}</span>`);
  if (it.notes && it.list !== 'reference') rest.push(`<span class="chip" title="Hat Notizen">Notiz</span>`);
  if (!open && !ctx && !rest.length) return '';
  return `<div class="row-meta">
    <span class="slot slot-ctx">${ctx}</span>${open ? dueSlot('item', it.id, it.due) : '<span class="slot slot-due"></span>'}<span class="slot slot-rem">${rem}</span><span class="slot slot-rest">${rest.join('')}</span>
  </div>`;
}

/**
 * Karte mit Wisch-Geste: Inhalt liegt in .row-inner, dahinter der Löschen-Knopf.
 * Nach links wischen legt den Knopf frei; Tippen löscht endgültig.
 */
function card(cls: string, rowId: string, kind: 'item' | 'project', inner: string): string {
  return `<li class="${cls}" data-row="${rowId}">
    <div class="row-inner">${inner}</div>
    <button type="button" class="swipe-del" data-action="swipe-delete" data-kind="${kind}" data-id="${rowId}" tabindex="-1" aria-hidden="true">Löschen</button>
  </li>`;
}

function row(it: Item, opts: { check?: boolean; clarify?: boolean; project?: boolean; list?: boolean; restore?: boolean } = {}): string {
  const lead = opts.check
    ? `<button class="check" data-action="complete" data-id="${it.id}" aria-label="Als erledigt markieren"></button>`
    : opts.restore
      ? `<button class="check is-done" data-action="restore" data-id="${it.id}" aria-label="Wiederherstellen" title="Wiederherstellen"></button>`
      : '';
  const p = opts.project !== false ? project(it.projectId) : undefined;
  return card(`row ${projColor(p?.id)}${opts.restore ? ' is-done' : ''}`, it.id, 'item', `
    ${lead}
    <span class="row-badge" aria-hidden="true">${p ? esc(initials(p.title)) : ''}</span>
    <div class="row-main" data-action="edit" data-id="${it.id}">
      ${p ? `<span class="row-eyebrow">${esc(p.title)}</span>` : ''}
      <button type="button" class="row-title" data-action="edit" data-id="${it.id}">${esc(it.title) || '<em>Ohne Titel</em>'}</button>
      ${meta(it, opts)}
      ${it.list === 'reference' && it.notes ? `<span class="row-notes">${esc(it.notes.slice(0, 160))}</span>` : ''}
    </div>
    ${opts.clarify ? `<button class="btn small" data-action="clarify" data-id="${it.id}">Klären</button>` : ''}`);
}

/** Zeile für ein Projekt: Fällig | Status | Ergebnis */
function projectRow(p: Project, status: string, icon = false): string {
  return card(`row ${projColor(p.id)}`, p.id, 'project', `
    ${icon ? '<span class="row-icon" aria-hidden="true">P</span>' : ''}
    <div class="row-main" data-action="open-project" data-id="${p.id}">
      <button type="button" class="row-title" data-action="open-project" data-id="${p.id}">${esc(p.title)}</button>
      <div class="row-meta proj-meta">
        ${dueSlot('project', p.id, p.due)}<span class="slot slot-status">${status}</span><span class="slot slot-rest">${p.outcome ? `<span class="chip muted">${esc(p.outcome.slice(0, 80))}</span>` : ''}</span>
      </div>
    </div>`);
}

const MIC_SVG = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
function mic(target: string): string {
  const on = V.activeTarget === target;
  return `<button type="button" class="btn mic${on ? ' is-listening' : ''}" data-action="voice" data-target="${target}" aria-pressed="${on}" aria-label="${on ? 'Aufnahme beenden' : 'Spracheingabe'}" title="Spracheingabe">${MIC_SVG}</button>`;
}

const list = (items: Item[], opts: Parameters<typeof row>[1] = {}) => `<ul class="rows">${items.map((i) => row(i, opts)).join('')}</ul>`;

const head = (title: string, lede: string, extra = '') =>
  `<header class="view-head"><div><h1>${title}</h1><p class="lede">${lede}</p></div>${extra}</header>`;

const empty = (title: string, text: string, extra = '') => `<div class="empty"><p class="empty-title">${title}</p><p>${text}</p>${extra}</div>`;

const LIST_LABEL: Record<ListName, string> = {
  inbox: 'Inbox', next: 'Nächster Schritt', waiting: 'Warten auf', someday: 'Irgendwann/Vielleicht',
  reference: 'Referenz', done: 'Erledigt', trash: 'Papierkorb',
};

function contextOptions(selected: string | null, none = 'Ohne Kontext') {
  return `<option value="">${none}</option>` +
    S.state.contexts.map((c) => `<option value="${esc(c)}"${c === selected ? ' selected' : ''}>${esc(c)}</option>`).join('');
}
function projectOptions(selected: string | null) {
  return `<option value="">Kein Projekt</option>` +
    Q.projects('active').concat(Q.projects('someday')).map((p) => `<option value="${p.id}"${p.id === selected ? ' selected' : ''}>${esc(p.title)}</option>`).join('');
}

// ---------- Ansichten ----------

function viewInbox(): string {
  const inbox = Q.inbox();
  const back = Q.resurfaced();
  const n = inbox.length + back.length;
  const nothingYet = all().length === 0;
  return `
    ${head('Inbox', 'Alles raus aus dem Kopf. Jetzt erfassen, später entscheiden.')}
    <form class="capture" data-form="capture">
      <label class="sr-only" for="capture-input">Neuer Eintrag</label>
      <input id="capture-input" name="title" placeholder="Was beschäftigt dich gerade?" autocomplete="off" enterkeyhint="done">
      ${mic('capture-input')}
      <button class="btn primary" type="submit">Erfassen</button>
    </form>
    ${n ? `<div class="callout"><span><strong class="num">${n}</strong> ${n === 1 ? 'Eintrag' : 'Einträge'} zu klären</span><button class="btn primary" data-action="clarify-first">Klären starten</button></div>` : ''}
    ${back.length ? `<h2 class="section">Wieder vorgelegt</h2>${list(back, { clarify: true })}` : ''}
    ${inbox.length ? `${back.length ? '<h2 class="section">Neu erfasst</h2>' : ''}${list(inbox, { clarify: true })}` : ''}
    ${!n ? empty(
      nothingYet ? 'Hier landet alles, was dir durch den Kopf geht.' : 'Inbox leer.',
      nothingYet
        ? 'Schreib oben auf, was dich beschäftigt, eine Idee pro Eintrag. Danach gehst du jeden Eintrag mit „Klären“ durch und entscheidest, was er bedeutet.'
        : 'Alles ist geklärt und an seinem Platz. Neues landet wieder hier.',
      nothingYet ? '<button class="btn" data-action="load-examples">Beispieleinträge laden</button>' : '',
    ) : ''}`;
}

function viewNext(): string {
  const items = Q.next();
  const used = S.state.contexts.filter((c) => items.some((i) => i.context === c));
  const hasNone = items.some((i) => !i.context);
  if (ctxFilter !== 'all' && ctxFilter !== '' && !used.includes(ctxFilter)) ctxFilter = 'all';
  const filterBtn = (val: string, label: string, n: number) =>
    `<button class="filter${ctxFilter === val ? ' is-active' : ''}" data-action="ctx" data-ctx="${esc(val)}" aria-pressed="${ctxFilter === val}">${esc(label)} <span class="num">${n}</span></button>`;
  const filters = `<div class="filters" role="toolbar" aria-label="Nach Kontext filtern">
    ${filterBtn('all', 'Alle', items.length)}
    ${used.map((c) => filterBtn(c, c, items.filter((i) => i.context === c).length)).join('')}
    ${hasNone ? filterBtn('', 'Ohne Kontext', items.filter((i) => !i.context).length) : ''}
  </div>`;
  let body: string;
  if (!items.length) {
    body = empty('Keine nächsten Schritte.', 'Klär deine Inbox oder füg einem Projekt einen konkreten nächsten Schritt hinzu.');
  } else if (ctxFilter === 'all') {
    const groups = [...used.map((c) => [c, items.filter((i) => i.context === c)] as const)];
    if (hasNone) groups.push(['Ohne Kontext', items.filter((i) => !i.context)]);
    body = groups.map(([c, its]) => `<h2 class="section">${esc(c)}</h2>${list(its, { check: true })}`).join('');
  } else {
    body = list(items.filter((i) => (i.context ?? '') === ctxFilter), { check: true });
  }
  return `${head('Nächste Schritte', 'Wähle nach Ort, Werkzeug und Energie, was jetzt dran ist.')}${items.length ? filters : ''}${body}`;
}

function viewDue(): string {
  const its = Q.dueItems();
  const ps = Q.dueProjects();
  if (!its.length && !ps.length) {
    return `${head('Fristen', 'Alles mit Fälligkeitsdatum, nach Dringlichkeit sortiert.')}
      ${empty('Keine Fristen.', 'Setz beim Klären oder Bearbeiten ein Datum unter „Fällig am“, dann erscheint der Eintrag hier.')}`;
  }
  const GROUPS: [string, (s: DueState) => boolean][] = [
    ['Überfällig', (s) => s === 'overdue'],
    ['Heute', (s) => s === 'today'],
    ['Nächste 7 Tage', (s) => s === 'soon' || s === 'week'],
    ['Später', (s) => s === 'later'],
  ];
  const projRow = (p: Project) => projectRow(p, `<span class="chip">Projekt${p.status === 'someday' ? ' · Irgendwann' : ''}</span>`, true);
  const body = GROUPS.map(([label, match]) => {
    const gi = its.filter((i) => match(dueState(i.due!)));
    const gp = ps.filter((p) => match(dueState(p.due!)));
    if (!gi.length && !gp.length) return '';
    const rows = [...gp.map(projRow), ...gi.map((i) => row(i, { check: i.list === 'next' || i.list === 'waiting', list: true }))];
    return `<h2 class="section">${label} <span class="num">${gi.length + gp.length}</span></h2><ul class="rows">${rows.join('')}</ul>`;
  }).join('');
  return `${head('Fristen', 'Alles mit Fälligkeitsdatum, nach Dringlichkeit sortiert. Harte Termine gehören laut Buch weiterhin in den Kalender.')}${body}`;
}

function viewProjects(): string {
  const ps = Q.projects('active').sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.title.localeCompare(b.title, 'de'));
  const rows = ps.map((p) => {
    const its = Q.projectItems(p.id);
    const open = its.filter((i) => i.list === 'next' || i.list === 'waiting').length;
    const stalled = Q.stalled(p);
    return projectRow(p, stalled ? '<span class="chip warn">Kein nächster Schritt</span>' : `<span class="chip">${open} offen</span>`);
  }).join('');
  return `${head('Projekte', 'Alles, was mehr als einen Schritt braucht. Jedes aktive Projekt hat einen nächsten Schritt.',
    '<button class="btn" data-action="new-project">Neues Projekt</button>')}
    ${ps.length ? `<ul class="rows">${rows}</ul>` : empty('Noch keine Projekte.', 'Projekte entstehen meistens beim Klären der Inbox: Braucht etwas mehr als einen Schritt, wird es ein Projekt.')}`;
}

function viewProject(id: string): string {
  const p = project(id);
  if (!p) return empty('Projekt nicht gefunden.', '', '<button class="btn" data-action="go" data-view="projects">Zu den Projekten</button>');
  const its = Q.projectItems(id);
  const next = its.filter((i) => i.list === 'next');
  const waiting = its.filter((i) => i.list === 'waiting');
  const other = its.filter((i) => i.list === 'someday' || i.list === 'reference');
  const done = its.filter((i) => i.list === 'done');
  const STATUS: Record<Project['status'], string> = { active: 'Aktiv', someday: 'Irgendwann/Vielleicht', done: 'Abgeschlossen', dropped: 'Verworfen' };
  return `
    <button class="back" data-action="go" data-view="${p.status === 'someday' ? 'someday' : 'projects'}">← ${p.status === 'someday' ? 'Irgendwann/Vielleicht' : 'Projekte'}</button>
    <header class="view-head">
      <div>
        <h1>${esc(p.title)}</h1>
        <p class="lede">${p.outcome ? `<span class="label">Ergebnis</span> ${esc(p.outcome)}` : 'Noch kein gewünschtes Ergebnis beschrieben.'}</p>
        ${p.due && (p.status === 'active' || p.status === 'someday') ? `<p class="head-meta">${dueChip(p.due)}</p>` : ''}
      </div>
      <span class="pill status-${p.status}">${STATUS[p.status]}</span>
    </header>
    ${p.status === 'active' && Q.stalled(p) ? '<div class="callout warn">Dieses Projekt hat keinen nächsten Schritt. Was ist die nächste sichtbare, physische Handlung?</div>' : ''}
    ${p.status === 'active' || p.status === 'someday' ? `
    <form class="capture compact" data-form="project-step" data-id="${p.id}">
      <label class="sr-only" for="step-input">Nächster Schritt</label>
      <input id="step-input" name="title" placeholder="Nächster Schritt, z. B. „Offerte bei Maler anfragen“" autocomplete="off" required>
      ${mic('step-input')}
      <label class="sr-only" for="step-ctx">Kontext</label>
      <select id="step-ctx" name="context">${contextOptions(null)}</select>
      <button class="btn primary" type="submit">Hinzufügen</button>
    </form>` : ''}
    ${next.length ? `<h2 class="section">Nächste Schritte</h2>${list(next, { check: true, project: false })}` : ''}
    ${waiting.length ? `<h2 class="section">Warten auf</h2>${list(waiting, { check: true, project: false })}` : ''}
    ${other.length ? `<h2 class="section">Weiteres</h2>${list(other, { project: false, list: true })}` : ''}
    ${done.length ? `<h2 class="section">Erledigt</h2>${list(done, { restore: true, project: false })}` : ''}
    <div class="actions-row">
      <button class="btn" data-action="edit-project" data-id="${p.id}">Bearbeiten</button>
      ${p.status === 'active' ? `<button class="btn" data-action="project-status" data-id="${p.id}" data-status="someday">Auf Irgendwann verschieben</button>
        <button class="btn" data-action="project-status" data-id="${p.id}" data-status="done">Abschliessen</button>` : ''}
      ${p.status !== 'active' ? `<button class="btn" data-action="project-status" data-id="${p.id}" data-status="active">Aktivieren</button>` : ''}
    </div>`;
}

function viewWaiting(): string {
  const its = Q.waiting();
  return `${head('Warten auf', 'Was andere für dich erledigen. Fass nach, wenn das Datum erreicht ist.')}
    ${its.length ? list(its, { check: true }) : empty('Du wartest auf niemanden.', 'Delegierte Aufgaben landen hier, mit Person und Datum zum Nachfassen.')}`;
}

function viewTickler(): string {
  const its = Q.tickler();
  return `${head('Wiedervorlage', 'Was erst ab einem bestimmten Tag wichtig wird. Bis dahin bleibt es aus dem Weg.')}
    ${its.length ? list(its, { list: true }) : empty('Nichts auf Wiedervorlage.', 'Setz beim Klären oder Bearbeiten ein Datum unter „Erst ab“, dann taucht der Eintrag an diesem Tag wieder auf.')}`;
}

function viewSomeday(): string {
  const its = Q.someday();
  const ps = Q.projects('someday');
  return `${head('Irgendwann/Vielleicht', 'Ideen und Wünsche ohne Verpflichtung. Schau sie bei der Wochendurchsicht an.')}
    ${ps.length ? `<h2 class="section">Projekte</h2><ul class="rows">${ps.map((p) => card(`row ${projColor(p.id)}`, p.id, 'project', `
        <div class="row-main" data-action="open-project" data-id="${p.id}"><button type="button" class="row-title" data-action="open-project" data-id="${p.id}">${esc(p.title)}</button>${p.outcome ? `<span class="row-notes">${esc(p.outcome.slice(0, 80))}</span>` : ''}</div>
        <button class="btn small" data-action="project-status" data-id="${p.id}" data-status="active">Aktivieren</button>`)).join('')}</ul>` : ''}
    ${its.length ? `${ps.length ? '<h2 class="section">Einzelne Ideen</h2>' : ''}${list(its)}` : ''}
    ${!its.length && !ps.length ? empty('Noch leer.', 'Beim Klären kannst du alles, was nicht jetzt dran ist, hierher schieben.') : ''}`;
}

function viewReference(): string {
  const its = Q.reference();
  return `${head('Referenz', 'Nützliches ohne Handlung: Informationen, Notizen, Nachschlagbares.')}
    ${its.length ? list(its) : empty('Keine Referenzen.', 'Beim Klären landet hier, was du aufbewahren willst, aber nicht tun musst.')}`;
}

function viewDone(): string {
  const its = Q.done();
  const trash = Q.trash();
  const shown = its.slice(0, 100);
  return `${head('Erledigt', 'Was du abgeschlossen hast. Ein Klick auf den Haken holt einen Eintrag zurück.')}
    ${its.length ? list(shown, { restore: true }) : empty('Noch nichts erledigt.', 'Abgehakte Schritte sammeln sich hier.')}
    ${its.length > shown.length ? `<p class="hint">Die letzten ${shown.length} von ${its.length} werden angezeigt.</p>` : ''}
    ${trash.length ? `<h2 class="section">Papierkorb <span class="num">${trash.length}</span></h2>
      <ul class="rows">${trash.map((i) => card('row is-done', i.id, 'item', `
        <div class="row-main" data-action="edit" data-id="${i.id}"><button type="button" class="row-title" data-action="edit" data-id="${i.id}">${esc(i.title)}</button></div>
        <button class="btn small" data-action="restore" data-id="${i.id}">Zurückholen</button>`)).join('')}</ul>
      <div class="actions-row"><button class="btn danger" data-action="empty-trash">Papierkorb leeren</button></div>` : ''}`;
}

let syncSetup: { owner: string; repo: string; token: string; probe: Sync.Probe } | null = null;
let syncDraft = { owner: '', repo: 'head-space-data', token: '' };

const TOKEN_HELP = `<details class="help">
  <summary>So erstellst du das Token</summary>
  <ol>
    <li>Auf github.com: Profilbild → <b>Settings</b> → <b>Developer settings</b> → <b>Personal access tokens</b> → <b>Fine-grained tokens</b> → <b>Generate new token</b>.</li>
    <li>Name z. B. „Kopf frei Sync“, Ablaufdatum nach Wunsch (läuft es ab, meldet die App das).</li>
    <li><b>Repository access:</b> „Only select repositories“ → nur dein Daten-Repository wählen.</li>
    <li><b>Permissions → Repository permissions → Contents:</b> „Read and write“. Sonst nichts.</li>
    <li>Token erzeugen, kopieren und hier einfügen. Es wird nur auf diesem Gerät gespeichert.</li>
  </ol>
</details>`;

function syncPanel(): string {
  const st = Sync.status;
  const headTxt = '<h2>Synchronisation über GitHub</h2>';
  if (IS_TEST) {
    return `<section class="panel" id="sync">${headTxt}
      <p class="hint">In der Test-App ist die Synchronisation abgeschaltet. So können Test-Daten nie in dein echtes Daten-Repository gelangen.</p>
    </section>`;
  }
  if (st.state === 'off' && !syncSetup) {
    return `<section class="panel" id="sync">
      ${headTxt}
      <p class="hint">Hält deine Geräte auf dem gleichen Stand. Die Daten liegen in einem privaten GitHub-Repository, aber nur verschlüsselt. Ohne deine Passphrase kann niemand sie lesen, auch GitHub nicht.</p>
      <form class="stack" data-form="sync-probe">
        <div class="grid2">
          <div class="field"><label for="sync-owner">GitHub-Benutzername</label><input id="sync-owner" name="owner" value="${esc(syncDraft.owner)}" autocomplete="username" autocapitalize="off" spellcheck="false" required></div>
          <div class="field"><label for="sync-repo">Privates Daten-Repository</label><input id="sync-repo" name="repo" value="${esc(syncDraft.repo)}" autocapitalize="off" spellcheck="false" required></div>
        </div>
        <div class="field"><label for="sync-token">Zugangs-Token</label><input id="sync-token" name="token" type="password" value="${esc(syncDraft.token)}" autocomplete="off" spellcheck="false" placeholder="github_pat_…" required></div>
        ${TOKEN_HELP}
        <button class="btn primary" type="submit"${busy ? ' disabled' : ''}>${busy ? 'Prüfe …' : 'Weiter'}</button>
      </form>
    </section>`;
  }
  if (st.state === 'off' && syncSetup) {
    const fresh = !syncSetup.probe.header;
    return `<section class="panel" id="sync">
      ${headTxt}
      <p class="status-line">Repository <strong>${esc(syncSetup.probe.fullName)}</strong> gefunden (privat).</p>
      <form class="stack" data-form="sync-connect">
        ${fresh ? `
          <p class="hint">Das Repository ist noch leer. Leg eine <b>Sync-Passphrase</b> fest. Du brauchst sie auf jedem weiteren Gerät. Geht sie verloren, sind die Daten im Repository nicht mehr lesbar. Bewahr sie im Passwortmanager auf.</p>
          <div class="field"><label for="sync-pass1">Neue Sync-Passphrase</label><input id="sync-pass1" name="pass1" type="password" minlength="10" autocomplete="new-password" required></div>
          <div class="field"><label for="sync-pass2">Passphrase wiederholen</label><input id="sync-pass2" name="pass2" type="password" minlength="10" autocomplete="new-password" required></div>
          <p class="hint">Was schon auf diesem Gerät ist, wird danach hochgeladen.</p>` : `
          <p class="hint">Dieses Repository wird schon von einem anderen Gerät genutzt. Gib die Sync-Passphrase ein, die du dort festgelegt hast. Einträge von diesem Gerät werden mit denen im Repository zusammengeführt.</p>
          <div class="field"><label for="sync-pass1">Sync-Passphrase</label><input id="sync-pass1" name="pass1" type="password" autocomplete="current-password" required></div>`}
        <div class="actions-row">
          <button type="button" class="btn" data-action="sync-back">Zurück</button>
          <button class="btn primary" type="submit"${busy ? ' disabled' : ''}>${busy ? 'Verbinde …' : 'Verbinden'}</button>
        </div>
      </form>
    </section>`;
  }
  if (st.state === 'locked') {
    return `<section class="panel" id="sync">
      ${headTxt}
      <p class="hint">Der Schlüssel fehlt auf diesem Gerät. Gib die Sync-Passphrase erneut ein.</p>
      <form class="stack" data-form="sync-unlock">
        <div class="field"><label for="sync-unlock-pass">Sync-Passphrase</label><input id="sync-unlock-pass" name="pass" type="password" autocomplete="current-password" required></div>
        <div class="actions-row"><button class="btn primary" type="submit"${busy ? ' disabled' : ''}>Entsperren</button><button type="button" class="btn" data-action="sync-disconnect">Verbindung trennen</button></div>
      </form>
    </section>`;
  }
  const STATE: Record<Sync.SyncState, string> = {
    off: '', locked: '', idle: 'Aktuell', syncing: 'Synchronisiere …', error: 'Fehler', offline: 'Offline',
  };
  return `<section class="panel" id="sync">
    ${headTxt}
    <dl class="facts">
      <dt>Status</dt><dd><span class="sync-pill sync-${st.state} static"><i aria-hidden="true"></i><span>${STATE[st.state]}</span></span></dd>
      <dt>Repository</dt><dd class="mono">${esc(st.repo)}</dd>
      <dt>Zuletzt</dt><dd>${ago(st.last)}</dd>
    </dl>
    ${st.error && st.state !== 'idle' ? `<div class="callout warn">${esc(st.error)}</div>` : ''}
    <p class="hint">Änderungen werden nach wenigen Sekunden hochgeladen. Beim Öffnen der App holt sie die Änderungen der anderen Geräte.</p>
    <div class="actions-row">
      <button class="btn primary" data-action="sync-now"${st.state === 'syncing' ? ' disabled' : ''}>Jetzt synchronisieren</button>
      <button class="btn" data-action="sync-disconnect">Verbindung trennen</button>
    </div>
  </section>`;
}

function viewSettings(): string {
  const lb = S.info.lastBackup;
  const theme = getTheme();
  const themeBtn = (t: Theme, label: string) =>
    `<button type="button" class="seg${theme === t ? ' is-active' : ''}" data-action="theme" data-value="${t}" aria-pressed="${theme === t}">${label}</button>`;
  const testPanel = IS_TEST ? `
    <section class="panel env-panel">
      <h2>Test-Umgebung</h2>
      <p class="hint">Hier probierst du neue Versionen mit Beispieldaten aus. Diese App hat eigene, getrennte Daten und synchronisiert nicht. Deine echte App bleibt unberührt.</p>
      <div class="actions-row">
        <button class="btn" data-action="sample-add">Beispieldaten hinzufügen</button>
        <button class="btn danger" data-action="test-reset">Test-App zurücksetzen</button>
      </div>
    </section>` : '';
  return `${head('Einstellungen', 'Darstellung, Kontexte, Synchronisation und Datensicherung.')}
    ${testPanel}
    <section class="panel">
      <h2>Darstellung</h2>
      <p class="hint">Gilt für dieses Gerät.</p>
      <div class="segmented" role="group" aria-label="Hell oder dunkel">
        ${themeBtn('system', 'Wie System')}${themeBtn('light', 'Hell')}${themeBtn('dark', 'Dunkel')}
      </div>
    </section>
    <section class="panel">
      <h2>Kontexte</h2>
      <p class="hint">Kontexte beschreiben, wo oder womit du etwas tun kannst. So siehst du unterwegs nur, was unterwegs geht.</p>
      <ul class="ctx-list">${S.state.contexts.map((c) => `<li><span class="chip ctx">${esc(c)}</span>
        <button class="link" data-action="remove-ctx" data-ctx="${esc(c)}" aria-label="${esc(c)} entfernen">Entfernen</button></li>`).join('')}</ul>
      <form class="capture compact" data-form="add-ctx">
        <label class="sr-only" for="ctx-input">Neuer Kontext</label>
        <input id="ctx-input" name="name" placeholder="@Einkaufen" autocomplete="off" required>
        <button class="btn" type="submit">Hinzufügen</button>
      </form>
    </section>

    ${syncPanel()}

    <section class="panel">
      <h2>Spracheingabe</h2>
      <p class="hint">Tipp auf das Mikrofon neben einem Eingabefeld und sprich. Der Text landet im Feld, du bestätigst mit „Erfassen“.</p>
      <dl class="facts">
        <dt>Erkennung auf dem Gerät</dt><dd id="voice-state">wird geprüft …</dd>
        ${V.lastIssue.at ? `<dt>Letztes Problem</dt><dd class="mono">${esc(V.lastIssue.code)} · ${esc(V.lastIssue.mode)} · ${new Date(V.lastIssue.at).toLocaleTimeString('de-CH')}</dd>` : ''}
      </dl>
      <label class="toggle" for="voice-cloud">
        <input type="checkbox" id="voice-cloud" ${S.info.voiceCloud ? 'checked' : ''}>
        <span>Online-Erkennung des Browsers erlauben, wenn es auf dem Gerät nicht geht<small>Die Aufnahme geht dann an den Browser-Anbieter (Google, Microsoft oder Apple).</small></span>
      </label>
      <details class="help" id="voice-diag" ${voiceDiagOpen ? 'open' : ''}>
        <summary>Spracheingabe testen</summary>
        <p class="hint">Tipp auf einen Knopf und sag einen kurzen Satz. Darunter erscheint, was der Browser Schritt für Schritt meldet. Bei Problemen: Screenshot davon an Claude schicken.</p>
        <div class="actions-row">
          <button type="button" class="btn small" data-action="voice-test" data-mode="online">Online testen</button>
          <button type="button" class="btn small" data-action="voice-test" data-mode="offline">Offline testen</button>
          <button type="button" class="btn small" data-action="voice-variants">Varianten testen</button>
        </div>
        ${V.browserBlocked() ? '<p class="hint">Der Mikrofon-Knopf öffnet zurzeit die Tastatur, weil der Browser die Erkennung blockiert hat. Ein erfolgreicher Test hier schaltet das wieder um.</p>' : ''}
        <label class="sr-only" for="voice-test-input">Erkannter Text</label>
        <input id="voice-test-input" readonly placeholder="Hier erscheint der erkannte Text">
        <pre class="voice-log" id="voice-log">${esc(voiceDiagText())}</pre>
      </details>
    </section>

    <section class="panel">
      <h2>Verschlüsseltes Backup</h2>
      <p class="hint">Das Backup wird hier im Gerät mit deiner Passphrase verschlüsselt (AES-256-GCM). Ohne Passphrase ist die Datei unlesbar, auch für dich. Bewahr die Passphrase sicher auf, z. B. im Passwortmanager.</p>
      <p class="status-line">${lb ? `Letztes Backup: <strong>${new Date(lb).toLocaleString('de-CH', { dateStyle: 'medium', timeStyle: 'short' })}</strong>` : '<strong>Noch kein Backup erstellt.</strong>'}</p>
      <form class="stack" data-form="export">
        <div class="field"><label for="pass1">Passphrase</label><input id="pass1" name="pass1" type="password" minlength="10" autocomplete="new-password" required></div>
        <div class="field"><label for="pass2">Passphrase wiederholen</label><input id="pass2" name="pass2" type="password" minlength="10" autocomplete="new-password" required></div>
        <button class="btn primary" type="submit"${busy ? ' disabled' : ''}>${busy ? 'Verschlüssele …' : 'Backup erstellen'}</button>
      </form>
      ${backupText ? `<div class="backup-out">
        <p>Backup erstellt. Speichere die Datei an einem sicheren Ort.</p>
        <div class="actions-row">
          <button class="btn primary" data-action="download-backup">Datei speichern</button>
          <button class="btn" data-action="copy-backup">Als Text kopieren</button>
        </div>
        <label class="sr-only" for="backup-text">Verschlüsseltes Backup</label>
        <textarea id="backup-text" readonly rows="3">${esc(backupText)}</textarea>
      </div>` : ''}
      <h3>Wiederherstellen</h3>
      <p class="hint">Einträge aus dem Backup werden mit den Daten auf diesem Gerät zusammengeführt. Nichts wird überschrieben.</p>
      <form class="stack" data-form="import">
        <div class="field"><label for="import-file">Backup-Datei</label><input id="import-file" name="file" type="file" accept=".json,.kfbackup,application/json"></div>
        <details><summary>Stattdessen Text einfügen</summary>
          <div class="field"><label for="import-text">Backup als Text</label><textarea id="import-text" name="text" rows="3"></textarea></div>
        </details>
        <div class="field"><label for="import-pass">Passphrase</label><input id="import-pass" name="pass" type="password" autocomplete="current-password" required></div>
        <button class="btn" type="submit"${busy ? ' disabled' : ''}>Wiederherstellen</button>
      </form>
    </section>

    <section class="panel" id="restore">
      <h2>Zurück auf früheren Stand</h2>
      <p class="hint">Falls ein Update oder eine Änderung etwas durcheinandergebracht hat. Es wird nichts gelöscht: Die App stellt den alten Stand mit neuen Änderungen wieder her. Auch das lässt sich wieder rückgängig machen.</p>
      <ul class="restore-list" id="restore-list"><li class="hint">Wird geladen …</li></ul>
      <form class="inline-form" data-form="restore-custom">
        <div class="field"><label for="restore-when">Eigener Zeitpunkt</label><input id="restore-when" name="when" type="datetime-local" required></div>
        <button class="btn" type="submit">Zu diesem Zeitpunkt</button>
      </form>
    </section>

    <section class="panel">
      <h2>Speicher</h2>
      <dl class="facts">
        <dt>Speicherort</dt><dd>${S.info.persistent ? 'Dieses Gerät (IndexedDB)' : '<span class="warn-text">Nur Arbeitsspeicher, Daten gehen beim Schliessen verloren</span>'}</dd>
        <dt>Geschützt vor automatischem Löschen</dt><dd id="persist-state">wird geprüft …</dd>
        <dt>Gespeicherte Änderungen</dt><dd class="num">${S.info.eventCount.toLocaleString('de-CH')}</dd>
        <dt>Geräte-ID</dt><dd class="mono">${esc(S.info.device.slice(0, 8))}</dd>
        <dt>App-Version</dt><dd class="num">${esc(APP_VERSION)}${APP_BUILD ? ` <span class="hint">(Build ${esc(APP_BUILD)})</span>` : ''}</dd>
      </dl>
      <div class="actions-row">
        <button class="btn" data-action="check-update">Nach Updates suchen</button>
        <button class="btn" data-action="repair-app">App reparieren</button>
      </div>
      <p class="hint">„App reparieren“ lädt die App frisch vom Server, falls ein Update hängen geblieben ist. Deine Daten bleiben erhalten.</p>
    </section>`;
}

// ---------- Darstellung (pro Gerät) ----------

export type Theme = 'system' | 'light' | 'dark';
const THEME_COLORS = { light: '#fdf6e3', dark: '#002b36' };

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem(storageKey('kf-theme'));
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch { return 'system'; }
}

export function applyTheme(t: Theme = getTheme()) {
  const root = document.documentElement;
  if (t === 'system') delete root.dataset.theme; else root.dataset.theme = t;
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    const mediaDark = (m.media || '').includes('dark');
    m.content = t === 'system' ? THEME_COLORS[mediaDark ? 'dark' : 'light'] : THEME_COLORS[t];
  });
}

function setTheme(t: Theme) {
  try { if (t === 'system') localStorage.removeItem(storageKey('kf-theme')); else localStorage.setItem(storageKey('kf-theme'), t); } catch { /* nur für diese Sitzung */ }
  applyTheme(t);
  render();
}

// ---------- Modale Dialoge ----------

function renderModal() {
  const root = document.getElementById('modal')!;
  if (!modal) {
    root.hidden = true; root.innerHTML = ''; document.body.classList.remove('has-modal');
    if (V.activeTarget && !document.getElementById(V.activeTarget)) V.stop();
    return;
  }
  root.hidden = false;
  document.body.classList.add('has-modal');
  let html = '';
  if (modal.kind === 'clarify') html = clarifyHtml(modal);
  else if (modal.kind === 'edit') html = editHtml(modal.id);
  else if (modal.kind === 'project') html = projectFormHtml(modal.id);
  else if (modal.kind === 'capture') html = `
    <form class="sheet" data-form="quick-capture">
      <div class="sheet-head"><h2>In die Inbox</h2><button type="button" class="link" data-action="close">Schliessen</button></div>
      <label class="sr-only" for="quick-input">Neuer Eintrag</label>
      <div class="capture compact">
        <input id="quick-input" name="title" placeholder="Was beschäftigt dich?" autocomplete="off" required enterkeyhint="done">
        ${mic('quick-input')}
      </div>
      <div class="actions-row end"><button class="btn primary" type="submit">Erfassen</button></div>
    </form>`;
  else if (modal.kind === 'next-step') html = nextStepHtml(modal.projectId, modal.fromId);
  else if (modal.kind === 'due') html = dueHtml(modal.id, modal.target);
  else if (modal.kind === 'voice-consent' && V.lastAvailability() === 'available') html = `
    <div class="sheet">
      <div class="sheet-head"><h2>Spracheingabe bereit</h2><button type="button" class="link" data-action="voice-cancel">Abbrechen</button></div>
      <p>Dieses Gerät erkennt Deutsch direkt auf dem Gerät. Deine Stimme verlässt es nicht.</p>
      <div class="actions-row end"><button class="btn primary" data-action="voice-local">Aufnahme starten</button></div>
    </div>`;
  else if (modal.kind === 'voice-consent') html = `
    <div class="sheet">
      <div class="sheet-head"><h2>Spracheingabe online?</h2><button type="button" class="link" data-action="voice-cancel">Abbrechen</button></div>
      <p>Dieser Browser kann Deutsch nicht direkt auf dem Gerät erkennen. Wenn du fortfährst, schickt er deine Aufnahme zur Erkennung an seinen Anbieter, bei Chrome an Google, bei Edge an Microsoft, bei Safari an Apple.</p>
      <p class="hint">Die App selbst speichert keine Aufnahmen und sendet nichts. Du kannst das jederzeit in den Einstellungen ändern. Alternativ geht das Mikrofon auf der Bildschirmtastatur; auch das arbeitet je nach Gerät online.</p>
      <div class="actions-row end">
        <button class="btn" data-action="voice-once">Nur dieses Mal</button>
        <button class="btn primary" data-action="voice-always">Immer erlauben</button>
      </div>
    </div>`;
  else if (modal.kind === 'voice-install') html = `
    <div class="sheet">
      <div class="sheet-head"><h2>Offline-Spracherkennung</h2><button type="button" class="link" data-action="voice-cancel">Abbrechen</button></div>
      <p>Dein Browser kann Deutsch auch direkt auf dem Gerät erkennen. Dafür lädt er einmalig ein Sprachpaket herunter. Danach verlässt deine Stimme das Gerät nicht mehr.</p>
      <div class="actions-row end">
        <button class="btn" data-action="voice-skip-install">Ohne Paket fortfahren</button>
        <button class="btn primary" data-action="voice-install-go"${busy ? ' disabled' : ''}>${busy ? 'Lädt …' : 'Sprachpaket laden'}</button>
      </div>
    </div>`;
  else if (modal.kind === 'confirm') html = `
    <div class="sheet">
      <p>${esc(modal.text)}</p>
      <div class="actions-row end"><button class="btn" data-action="close">Abbrechen</button><button class="btn danger" data-action="confirm">${esc(modal.label)}</button></div>
    </div>`;
  root.innerHTML = `<div class="scrim" data-action="close"></div><div class="modal-box" role="dialog" aria-modal="true">${html}</div>`;
  if (V.activeTarget && !document.getElementById(V.activeTarget)) V.stop();
  const first = root.querySelector<HTMLElement>('[autofocus], input:not([type=hidden]):not([type=checkbox]), button.primary');
  first?.focus();
}

function clarifyHtml(m: Extract<Modal, { kind: 'clarify' }>): string {
  const it = S.state.items.get(m.id);
  if (!it) return '';
  const queue = toClarify();
  const pos = queue.findIndex((i) => i.id === m.id) + 1;
  const q = (question: string, help: string, body: string) => `
    <h3 class="question">${question}</h3>${help ? `<p class="hint">${help}</p>` : ''}${body}`;
  const yesNo = (yes: string, no: string, yesLabel = 'Ja', noLabel = 'Nein') => `
    <div class="choice">
      <button class="btn choice-btn" data-action="step" data-step="${yes}">${yesLabel}</button>
      <button class="btn choice-btn" data-action="step" data-step="${no}">${noLabel}</button>
    </div>`;
  let body = '';
  switch (m.step) {
    case 'actionable':
      body = q('Ist das umsetzbar?', 'Musst oder willst du dazu etwas tun?', yesNo('multi', 'not'));
      break;
    case 'not':
      body = q('Was soll damit passieren?', '', `
        <div class="options">
          <button class="btn option" data-action="clarify-trash"><strong>Wegwerfen</strong><span>Brauchst du nicht mehr.</span></button>
          <button class="btn option" data-action="clarify-reference"><strong>Als Referenz ablegen</strong><span>Nützliche Information, keine Handlung.</span></button>
          <form class="option-form" data-form="clarify-someday">
            <strong>Irgendwann/Vielleicht</strong><span>Vielleicht später. Optional an einem Tag wieder vorlegen.</span>
            <div class="inline">
              <label for="someday-date">Wieder vorlegen am</label>
              <input id="someday-date" name="tickler" type="date" min="${today()}">
              <button class="btn" type="submit">Ablegen</button>
            </div>
          </form>
        </div>`);
      break;
    case 'multi':
      body = q('Braucht es mehr als einen Schritt?', 'Dann ist es ein Projekt, zum Beispiel „Ferien planen“ statt „Hotel buchen“.',
        yesNo('project', 'twomin', 'Ja, ein Projekt', 'Nein, ein Schritt'));
      break;
    case 'project':
      body = q('Projekt anlegen', '', `
        <form class="stack" data-form="clarify-project">
          <div class="field"><label for="p-title">Projektname</label><input id="p-title" name="ptitle" value="${esc(m.title)}" required></div>
          <div class="field"><label for="p-outcome">Gewünschtes Ergebnis</label><input id="p-outcome" name="outcome" placeholder="Woran erkennst du, dass es fertig ist?"></div>
          <div class="field"><label for="p-due">Projekt fällig am (optional)</label><input id="p-due" name="due" type="date" min="${today()}"></div>
          <div class="field"><label for="p-next">Nächster Schritt</label><input id="p-next" name="next" placeholder="Die nächste sichtbare, physische Handlung" required></div>
          <div class="field"><label for="p-ctx">Kontext</label><select id="p-ctx" name="context">${contextOptions(null)}</select></div>
          <div class="actions-row end"><button class="btn primary" type="submit">Projekt anlegen</button></div>
        </form>`);
      break;
    case 'twomin':
      body = q('Dauert es weniger als zwei Minuten?', 'Dann ist Erledigen schneller als Ablegen.', yesNo('donow', 'who'));
      break;
    case 'donow':
      body = q('Dann erledige es jetzt.', 'Komm zurück, wenn du fertig bist.', `
        <div class="choice">
          <button class="btn primary choice-btn" data-action="clarify-done">Erledigt</button>
          <button class="btn choice-btn" data-action="step" data-step="who">Dauert doch länger</button>
        </div>`);
      break;
    case 'who':
      body = q('Bist du die richtige Person dafür?', '', yesNo('next', 'delegate', 'Ja, mache ich', 'Nein, delegieren'));
      break;
    case 'next':
      body = q('Nächster Schritt', 'Formuliere eine konkrete Handlung. Der Titel oben ist editierbar.', `
        <form class="stack" data-form="clarify-next">
          <div class="field"><label for="n-ctx">Kontext</label><select id="n-ctx" name="context">${contextOptions(it.context)}</select></div>
          <div class="field"><label for="n-proj">Gehört zu Projekt</label><select id="n-proj" name="projectId">${projectOptions(it.projectId)}</select></div>
          <div class="grid2">
            <div class="field"><label for="n-due">Fällig am (optional)</label><input id="n-due" name="due" type="date" min="${today()}" value="${it.due ?? ''}"></div>
            <div class="field"><label for="n-tickler">Erst ab (optional)</label><input id="n-tickler" name="tickler" type="date" min="${today()}"></div>
          </div>
          <div class="actions-row end"><button class="btn primary" type="submit">Als nächsten Schritt ablegen</button></div>
        </form>`);
      break;
    case 'delegate':
      body = q('An wen geht es?', 'Du gibst die Aufgabe ab und behältst sie unter „Warten auf“ im Blick.', `
        <form class="stack" data-form="clarify-delegate">
          <div class="field"><label for="d-who">Person</label><input id="d-who" name="who" placeholder="Name" required></div>
          <div class="grid2">
            <div class="field"><label for="d-due">Fällig am (optional)</label><input id="d-due" name="due" type="date" min="${today()}" value="${it.due ?? ''}"></div>
            <div class="field"><label for="d-date">Nachfassen am (optional)</label><input id="d-date" name="tickler" type="date" min="${today()}"></div>
          </div>
          <div class="field"><label for="d-proj">Gehört zu Projekt</label><select id="d-proj" name="projectId">${projectOptions(it.projectId)}</select></div>
          <div class="actions-row end"><button class="btn primary" type="submit">Zu „Warten auf“</button></div>
        </form>`);
      break;
  }
  return `
    <div class="sheet card">
      <div class="sheet-head">
        <span class="eyebrow">Klären${pos > 0 ? ` · <span class="num">${pos}</span> von <span class="num">${queue.length}</span>` : ''}</span>
        <button class="link" data-action="close">Schliessen</button>
      </div>
      <label class="sr-only" for="clarify-title">Eintrag</label>
      <textarea id="clarify-title" class="card-title" rows="2" data-bind="clarify-title">${esc(m.title)}</textarea>
      ${body}
      <div class="sheet-foot">
        ${m.hist.length ? '<button class="link" data-action="step-back">← Zurück</button>' : '<span></span>'}
        <button class="link" data-action="clarify-skip">Überspringen</button>
      </div>
    </div>`;
}

/** Nach dem letzten offenen Schritt eines Projekts: gleich den nächsten festlegen. */
function nextStepHtml(pid: string, fromId: string): string {
  const p = project(pid);
  if (!p) return '';
  const done = S.state.items.get(fromId);
  const candidates = Q.projectItems(pid).filter((i) => i.list === 'someday' || i.list === 'inbox');
  return `
    <form class="sheet card" data-form="next-step" data-id="${p.id}">
      <div class="sheet-head">
        <span class="eyebrow">Projekt · Nächster Schritt</span>
        <button type="button" class="link" data-action="next-step-later">Später</button>
      </div>
      <h2 class="ns-project">${esc(p.title)}</h2>
      <p class="hint">${done ? `Erledigt: <s>${esc(done.title)}</s>. ` : ''}Das Projekt hat keinen offenen Schritt mehr.${p.outcome ? ` <span class="label">Ergebnis</span> ${esc(p.outcome)}` : ''}</p>
      ${candidates.length ? `
        <div class="field">
          <span class="field-label">Aus dem Projekt übernehmen</span>
          <div class="options">${candidates.map((c) => `
            <button type="button" class="btn option" data-action="promote" data-id="${c.id}">
              <strong>${esc(c.title)}</strong><span>${LIST_LABEL[c.list]}${c.due ? ` · fällig ${fmtDate(c.due)}` : ''}</span>
            </button>`).join('')}
          </div>
        </div>
        <p class="divider-label">oder neu formulieren</p>` : ''}
      <div class="field">
        <label for="ns-title">Nächster Schritt</label>
        <div class="capture compact">
          <input id="ns-title" name="title" placeholder="Die nächste sichtbare, physische Handlung" autocomplete="off" required>
          ${mic('ns-title')}
        </div>
      </div>
      <div class="grid3">
        <div class="field"><label for="ns-ctx">Kontext</label><select id="ns-ctx" name="context">${contextOptions(done?.context ?? null)}</select></div>
        <div class="field"><label for="ns-due">Fällig am</label><input id="ns-due" name="due" type="date" min="${today()}"></div>
        <div class="field"><label for="ns-tickler">Erst ab</label><input id="ns-tickler" name="tickler" type="date" min="${today()}"></div>
      </div>
      <div class="actions-row spread">
        <button type="button" class="btn" data-action="project-status" data-id="${p.id}" data-status="done">Projekt ist fertig</button>
        <button class="btn primary" type="submit">Schritt speichern</button>
      </div>
    </form>`;
}

/** Ersatz, falls der Browser die Datumsauswahl nicht direkt öffnen kann. */
function dueHtml(id: string, target: 'item' | 'project'): string {
  const obj = target === 'item' ? S.state.items.get(id) : project(id);
  if (!obj) return '';
  const t = today();
  const quick: [string, string][] = [['Heute', t], ['Morgen', addDays(t, 1)], ['In 1 Woche', addDays(t, 7)], ['In 2 Wochen', addDays(t, 14)]];
  return `
    <form class="sheet" data-form="due" data-id="${id}" data-kind="${target}">
      <div class="sheet-head"><h2>Frist setzen</h2><button type="button" class="link" data-action="close">Schliessen</button></div>
      <p class="hint">${esc(obj.title)}</p>
      <div class="quick-dates">${quick.map(([l, d]) => `<button type="button" class="filter" data-action="due-quick" data-date="${d}">${l}</button>`).join('')}</div>
      <div class="field"><label for="due-date">Fällig am</label><input id="due-date" name="due" type="date" value="${obj.due ?? ''}"></div>
      <div class="actions-row spread">
        ${obj.due ? '<button type="button" class="btn danger" data-action="due-clear">Frist entfernen</button>' : '<span></span>'}
        <button class="btn primary" type="submit">Speichern</button>
      </div>
    </form>`;
}

function editHtml(id: string): string {
  const it = S.state.items.get(id);
  if (!it) return '';
  const lists: ListName[] = ['inbox', 'next', 'waiting', 'someday', 'reference', 'done', 'trash'];
  return `
    <form class="sheet" data-form="edit" data-id="${it.id}">
      <div class="sheet-head"><h2>Eintrag bearbeiten</h2><button type="button" class="link" data-action="close">Schliessen</button></div>
      <div class="field"><label for="e-title">Titel</label><input id="e-title" name="title" value="${esc(it.title)}" required></div>
      <div class="field"><label for="e-notes">Notizen</label><textarea id="e-notes" name="notes" rows="4">${esc(it.notes)}</textarea></div>
      <div class="grid2">
        <div class="field"><label for="e-list">Liste</label><select id="e-list" name="list">${lists.map((l) => `<option value="${l}"${l === it.list ? ' selected' : ''}>${LIST_LABEL[l]}</option>`).join('')}</select></div>
        <div class="field"><label for="e-ctx">Kontext</label><select id="e-ctx" name="context">${contextOptions(it.context)}</select></div>
        <div class="field"><label for="e-proj">Projekt</label><select id="e-proj" name="projectId">${projectOptions(it.projectId)}</select></div>
        <div class="field"><label for="e-wait">Wartet auf</label><input id="e-wait" name="waitingFor" value="${esc(it.waitingFor ?? '')}" placeholder="Person"></div>
        <div class="field"><label for="e-due">Fällig am</label><input id="e-due" name="due" type="date" value="${it.due ?? ''}"></div>
        <div class="field"><label for="e-tickler">${it.list === 'waiting' ? 'Nachfassen am' : 'Erst ab'}</label><input id="e-tickler" name="tickler" type="date" value="${it.tickler ?? ''}"></div>
      </div>
      <p class="hint">„Fällig am“ ist die Frist. „Erst ab“ blendet den Eintrag bis zu diesem Tag aus.</p>
      <p class="hint">Erfasst ${fmtTs(it.created)}${it.completed ? ` · erledigt ${fmtTs(it.completed)}` : ''}</p>
      <div class="actions-row spread">
        ${it.list !== 'trash' ? `<button type="button" class="btn danger" data-action="trash" data-id="${it.id}">In den Papierkorb</button>` : '<span></span>'}
        <div class="actions-row">
          ${it.list === 'inbox' ? `<button type="button" class="btn" data-action="clarify" data-id="${it.id}">Klären</button>` : ''}
          <button class="btn primary" type="submit">Speichern</button>
        </div>
      </div>
    </form>`;
}

function projectFormHtml(id: string | null): string {
  const p = id ? project(id) : undefined;
  return `
    <form class="sheet" data-form="project" data-id="${p?.id ?? ''}">
      <div class="sheet-head"><h2>${p ? 'Projekt bearbeiten' : 'Neues Projekt'}</h2><button type="button" class="link" data-action="close">Schliessen</button></div>
      <div class="field"><label for="pf-title">Projektname</label><input id="pf-title" name="title" value="${esc(p?.title ?? '')}" required></div>
      <div class="field"><label for="pf-outcome">Gewünschtes Ergebnis</label><textarea id="pf-outcome" name="outcome" rows="2" placeholder="Woran erkennst du, dass es fertig ist?">${esc(p?.outcome ?? '')}</textarea></div>
      <div class="field"><label for="pf-due">Fällig am (optional)</label><input id="pf-due" name="due" type="date" value="${p?.due ?? ''}"></div>
      ${p ? '' : `<div class="field"><label for="pf-next">Nächster Schritt</label><input id="pf-next" name="next" placeholder="Die nächste sichtbare, physische Handlung"></div>
      <div class="field"><label for="pf-ctx">Kontext</label><select id="pf-ctx" name="context">${contextOptions(null)}</select></div>`}
      <div class="actions-row spread">
        ${p ? `<button type="button" class="btn danger" data-action="project-status" data-id="${p.id}" data-status="dropped">Verwerfen</button>` : '<span></span>'}
        <button class="btn primary" type="submit">${p ? 'Speichern' : 'Anlegen'}</button>
      </div>
    </form>`;
}

// ---------- Klär-Ablauf ----------

function startClarify(id?: string) {
  const queue = toClarify();
  const target = id ?? queue[0]?.id;
  const it = target ? S.state.items.get(target) : undefined;
  if (!it) { modal = null; renderModal(); toast('Die Inbox ist leer.'); return; }
  modal = { kind: 'clarify', id: it.id, step: 'actionable', hist: [], title: it.title };
  renderModal();
}

/** Speichert die Entscheidung und springt zum nächsten Eintrag der Inbox. */
function finishClarify(patch: Partial<Item>, message: string, onUndo?: () => void) {
  if (modal?.kind !== 'clarify') return;
  const m = modal;
  const title = m.title.trim() || S.state.items.get(m.id)?.title || '';
  const rest = toClarify().filter((i) => i.id !== m.id);
  if (rest.length) startClarify(rest[0].id);
  else { modal = null; renderModal(); go('next'); message = `${message} Inbox leer.`; }
  // Rückgängig legt den Eintrag zurück in die Inbox
  patchWithUndo(m.id, { title, ...patch }, message, onUndo);
}

// ---------- Spracheingabe ----------

let voiceBase = '';
let onVoiceDone: (() => void) | null = null;

function updateMicButtons() {
  document.querySelectorAll<HTMLButtonElement>('.mic').forEach((b) => {
    const on = b.dataset.target === V.activeTarget;
    b.classList.toggle('is-listening', on);
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', on ? 'Aufnahme beenden' : 'Spracheingabe');
  });
}

/**
 * Mikrofon-Knopf gedrückt: offline wenn möglich, sonst nur mit Erlaubnis online.
 * Wichtig: Die Aufnahme muss direkt im Tipp starten (ohne vorheriges Warten),
 * sonst brechen mobile Browser sie sofort wieder ab. Deshalb wird die Offline-
 * Verfügbarkeit vorab im Hintergrund geprüft und hier nur noch nachgeschaut.
 */
function startVoice(target: string) {
  if (V.activeTarget) { V.stop(); return; }
  if (!V.supported()) {
    toast('Dieser Browser kann keine Sprache erkennen. Nutze das Mikrofon auf deiner Bildschirmtastatur.', 'error');
    return;
  }
  if (V.browserBlocked() && V.lastAvailability() !== 'available') {
    // Chrome verweigert die Erkennung auf diesem Gerät: Tastatur öffnen (im Tipp, damit sie wirklich aufgeht)
    const input = document.getElementById(target) as HTMLInputElement | null;
    input?.focus();
    toast('Sprich über das Mikrofon deiner Tastatur. Die Spracherkennung des Browsers ist auf diesem Gerät blockiert.');
    return;
  }
  const avail = V.lastAvailability();
  // Noch nie geprüft: im Hintergrund nachschauen. Der Dialog passt sich an, sobald das Ergebnis da ist.
  if (avail === null) {
    void V.localAvailability().then((a) => {
      if (modal?.kind !== 'voice-consent') return;
      if (a === 'downloadable' || a === 'downloading') modal = { kind: 'voice-install', target: modal.target, back: modal.back };
      renderModal();
    });
  }
  if (avail === 'available') { beginVoice(target, true); return; }
  if (avail === 'downloadable' || avail === 'downloading') { modal = { kind: 'voice-install', target, back: modal }; renderModal(); return; }
  if (S.info.voiceCloud) { beginVoice(target, false); return; }
  modal = { kind: 'voice-consent', target, back: modal };
  renderModal();
}

function beginVoice(target: string, local: boolean) {
  const input = document.getElementById(target) as HTMLInputElement | null;
  if (!input) return;
  voiceBase = input.value.trim();
  const diag = target === 'voice-test-input';
  const placeholder = input.placeholder;
  const setPlaceholder = (t: string) => { const el = document.getElementById(target) as HTMLInputElement | null; if (el) el.placeholder = t; };
  const ok = V.start(target, local, {
    onText: (text) => {
      const el = document.getElementById(target) as HTMLInputElement | null;
      if (el) el.value = voiceBase ? `${voiceBase} ${text}` : text;
    },
    onEnd: (gotText, errored, heard) => {
      setPlaceholder(placeholder);
      updateMicButtons();
      onVoiceDone?.();
      if (heard && !local) V.markBrowserBlocked(false); // Online geht wieder: Mikrofon-Knopf normal
      if (diag) return; // Test in den Einstellungen: nur protokollieren
      if (gotText) { document.getElementById(target)?.focus(); return; }
      if (local && !heard) {
        // Offline-Erkennung funktioniert auf diesem Gerät nicht: ab jetzt online (mit Erlaubnis)
        V.markLocalBroken();
        if (S.info.voiceCloud) {
          toast('Offline-Erkennung geht hier nicht. Versuche es online …');
          beginVoice(target, false);
        } else {
          modal = { kind: 'voice-consent', target, back: modal };
          renderModal();
        }
        return;
      }
      if (errored) return; // Meldung kam schon aus onError
      toast('Es wurde nichts erkannt. Tipp aufs Mikrofon und sprich gleich los.', 'error');
    },
    onError: (code, heard) => {
      if (diag) return;
      // Offline ohne Aufnahme abgebrochen: onEnd wechselt still auf online, keine Fehlermeldung
      if (local && !heard) return;
      if (!local && !heard && (code === 'aborted' || code === 'service-not-allowed' || code === 'network')) {
        // Browser verweigert sofort: ab jetzt direkt die Tastatur anbieten
        V.markBrowserBlocked();
        toast(`Der Browser lässt die Spracherkennung hier nicht zu (${code}). Tipp ins Feld und nutze das Mikrofon deiner Tastatur. Ab jetzt öffnet der Mikrofon-Knopf direkt die Tastatur.`, 'error');
        return;
      }
      toast(`${V.ERRORS[code] ?? 'Die Spracheingabe hat nicht geklappt.'} (${code})`, 'error');
    },
  });
  if (!ok) toast('Die Spracheingabe konnte nicht starten.', 'error');
  else setPlaceholder('Sprich jetzt …');
  updateMicButtons();
}

/** Nach einem Zwischendialog (Erlaubnis, Sprachpaket) zurück zum vorherigen Dialog und Aufnahme starten. */
function resumeVoice(local: boolean) {
  if (modal?.kind !== 'voice-consent' && modal?.kind !== 'voice-install') return;
  const { target, back } = modal;
  modal = back;
  renderModal();
  beginVoice(target, local);
}

// ---------- Wischen zum Löschen ----------

const SWIPE_W = 88; // Breite des Löschen-Knopfs in px
let swipe: { inner: HTMLElement; x0: number; y0: number; base: number; dx: number; active: boolean; pid: number } | null = null;
let openInner: HTMLElement | null = null;
let swallowClick = false;

function setOffset(inner: HTMLElement, x: number, animate: boolean) {
  inner.style.transition = animate ? '' : 'none';
  inner.style.transform = x ? `translateX(${x}px)` : '';
  inner.parentElement?.classList.toggle('swipe-open', x < 0);
}

function closeSwipe(animate = true) {
  if (openInner) setOffset(openInner, 0, animate);
  openInner = null;
}

function onPointerDown(e: PointerEvent) {
  // Neue Berührung: der Klick einer vorherigen Wischgeste ist vorbei, dieser Tipp zählt
  swallowClick = false;
  if (e.pointerType === 'mouse' || modal) return;
  // Finger auf dem Löschen-Knopf: Karte offen lassen, damit der Tipp ankommt
  if ((e.target as HTMLElement).closest('.swipe-del')) return;
  const inner = (e.target as HTMLElement).closest<HTMLElement>('.row-inner');
  if (openInner && openInner !== inner) closeSwipe();
  if (!inner || (e.target as HTMLElement).closest('.due-input')) return;
  swipe = { inner, x0: e.clientX, y0: e.clientY, base: inner === openInner ? -SWIPE_W : 0, dx: 0, active: false, pid: e.pointerId };
}

function onPointerMove(e: PointerEvent) {
  if (!swipe || e.pointerId !== swipe.pid) return;
  const dx = e.clientX - swipe.x0;
  const dy = e.clientY - swipe.y0;
  if (!swipe.active) {
    if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { swipe = null; return; } // Scrollen
    if (Math.abs(dx) < 10) return;
    swipe.active = true;
  }
  swipe.dx = dx;
  const x = Math.max(-SWIPE_W * 1.35, Math.min(0, swipe.base + dx));
  setOffset(swipe.inner, x, false);
}

function onPointerUp(e: PointerEvent) {
  if (!swipe || e.pointerId !== swipe.pid) return;
  const s = swipe;
  swipe = null;
  if (!s.active) return;
  swallowClick = true; // die Geste ist kein Tippen auf die Karte
  setTimeout(() => { swallowClick = false; }, 350);
  const x = s.base + s.dx;
  if (x < -SWIPE_W / 2) { setOffset(s.inner, -SWIPE_W, true); openInner = s.inner; }
  else { setOffset(s.inner, 0, true); if (openInner === s.inner) openInner = null; }
}

function onPointerCancel() {
  if (swipe?.active) setOffset(swipe.inner, swipe.base, true);
  swipe = null;
}

// ---------- Rückgängig ----------

const UNDO_MS = 3000; // gleich lang wie die Animation .undo-bar in styles.css
let undoTimer = 0;
let undoFn: (() => void) | null = null;

/** Kleine Leiste am unteren Rand mit „Rückgängig“, verschwindet nach 3 Sekunden. */
function showUndo(text: string, fn: () => void) {
  const el = document.getElementById('undo')!;
  document.getElementById('toast')!.className = 'toast';
  el.innerHTML = `<span class="undo-text">${esc(text)}</span><button type="button" class="undo-btn" data-action="undo">Rückgängig</button><span class="undo-bar"></span>`;
  el.hidden = false;
  el.classList.remove('show');
  void el.offsetWidth; // Animation neu starten
  el.classList.add('show');
  undoFn = fn;
  clearTimeout(undoTimer);
  undoTimer = window.setTimeout(hideUndo, UNDO_MS);
}

function hideUndo() {
  clearTimeout(undoTimer);
  undoFn = null;
  const el = document.getElementById('undo')!;
  el.classList.remove('show');
  setTimeout(() => { if (!undoFn) el.hidden = true; }, 200);
}

/** Zeile kurz hervorheben, z. B. nach Rückgängig oder wenn sie durch eine neue Frist verschoben wurde. */
function flash(id: string) {
  const r = document.querySelector(`[data-row="${CSS.escape(id)}"]`);
  if (!r) return;
  r.classList.remove('flash');
  void (r as HTMLElement).offsetWidth;
  r.classList.add('flash');
}

const short = (t: string) => (t.length > 34 ? t.slice(0, 32) + '…' : t);

/**
 * Erledigen mit Rückgängig. War es der letzte offene Schritt eines aktiven Projekts,
 * fragt die App gleich nach dem nächsten Schritt.
 */
function completeWithUndo(id: string, extra: Partial<Item> = {}) {
  const it = S.state.items.get(id);
  if (!it) return;
  const before = { ...it };
  S.batch(() => {
    if (Object.keys(extra).length) S.patchItem(id, extra);
    S.completeItem(id);
  });
  const p = project(it.projectId);
  const askNext = !!p && p.status === 'active' && Q.stalled(p);
  showUndo(`Erledigt: ${short(it.title)}`, () => {
    if (modal?.kind === 'next-step' && modal.fromId === id) { modal = null; renderModal(); }
    S.patchItem(id, { list: before.list, completed: null, prevList: null, ...pick(before, Object.keys(extra) as (keyof Item)[]) });
    flash(id);
  });
  if (askNext && !modal) { modal = { kind: 'next-step', projectId: p!.id, fromId: id }; renderModal(); }
}

/** Änderung an einem Eintrag mit Rückgängig (stellt genau die geänderten Felder wieder her). */
function patchWithUndo(id: string, patch: Partial<Item>, text: string, onUndo?: () => void) {
  const it = S.state.items.get(id);
  if (!it) return;
  const before = pick({ ...it }, Object.keys(patch) as (keyof Item)[]);
  S.patchItem(id, patch);
  flash(id);
  showUndo(text, () => {
    S.patchItem(id, before);
    onUndo?.();
    flash(id);
  });
}

function pick<T extends object>(o: T, keys: (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  keys.forEach((k) => { out[k] = o[k]; });
  return out;
}

/** Frist direkt setzen (Kalendersymbol in der Zeile), mit Rückgängig. */
function setDue(kind: 'item' | 'project', id: string, due: string | null) {
  const obj = kind === 'item' ? S.state.items.get(id) : project(id);
  if (!obj) return;
  const prev = obj.due ?? null;
  if (prev === due) return;
  if (kind === 'item') S.patchItem(id, { due }); else S.patchProject(id, { due });
  flash(id);
  showUndo(due ? `Fällig am ${fmtDate(due)}` : 'Frist entfernt', () => {
    if (kind === 'item') S.patchItem(id, { due: prev }); else S.patchProject(id, { due: prev });
    flash(id);
  });
}

function openDuePicker(btn: HTMLElement) {
  const id = btn.dataset.id!;
  const kind = btn.dataset.kind as 'item' | 'project';
  const input = btn.parentElement?.querySelector<HTMLInputElement>('.due-input');
  if (input && typeof input.showPicker === 'function') {
    try { input.showPicker(); return; } catch { /* z. B. in eingebetteter Vorschau nicht erlaubt */ }
  }
  modal = { kind: 'due', id, target: kind };
  renderModal();
}

// ---------- Toast ----------

let toastTimer = 0;
export function toast(msg: string, kind: 'info' | 'error' = 'info') {
  const el = document.getElementById('toast')!;
  hideUndo();
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { el.className = 'toast'; }, kind === 'error' ? 6000 : 2600);
}

// ---------- Rendern ----------

let updateFn: (() => void) | null = null;

type AppActions = { checkForUpdate: () => Promise<'update' | 'current' | 'offline' | 'unsupported'>; repairApp: () => Promise<void> };
let appActions: AppActions | null = null;
export function setAppActions(a: AppActions) { appActions = a; }
/** Neue App-Version bereit: Hinweis zeigen, bis der Nutzer aktualisiert. */
export function offerUpdate(apply: () => void) {
  updateFn = apply;
  renderBanner();
}

function renderBanner() {
  const el = document.getElementById('banner')!;
  if (updateFn) {
    el.hidden = false;
    el.className = 'banner update';
    el.innerHTML = '<span><strong>Neue Version verfügbar.</strong> Deine Daten bleiben erhalten.</span><button class="btn primary small" data-action="apply-update">Jetzt aktualisieren</button>';
    return;
  }
  el.className = 'banner';
  const items = all();
  const hasData = items.length > 0;
  // Erinnern, wenn das letzte Backup (bzw. der erste Eintrag) mindestens 7 Tage zurückliegt
  const since = S.info.lastBackup || Math.min(...items.map((i) => i.created), Date.now());
  const days = daysSince(since);
  if (!S.info.persistent) {
    el.hidden = false;
    el.innerHTML = '<span>Dieser Browser erlaubt keinen dauerhaften Speicher. Änderungen gehen beim Schliessen verloren.</span>';
  } else if (!IS_TEST && hasData && days >= 7 && route.view !== 'settings') {
    el.hidden = false;
    el.innerHTML = `<span>${S.info.lastBackup ? `Letztes Backup vor ${days} Tagen.` : 'Noch kein Backup erstellt.'}</span><button class="link" data-action="go" data-view="settings">Jetzt sichern</button>`;
  } else {
    el.hidden = true;
  }
}

let lastRouteKey = '';
export function render() {
  renderNav();
  renderBanner();
  const main = document.getElementById('main')!;
  const views: Record<View, () => string> = {
    inbox: viewInbox, due: viewDue, next: viewNext, projects: viewProjects, project: () => viewProject(route.id ?? ''),
    waiting: viewWaiting, tickler: viewTickler, someday: viewSomeday, reference: viewReference, done: viewDone, settings: viewSettings,
  };
  const active = document.activeElement as HTMLElement | null;
  const keepId = active && main.contains(active) ? active.id : '';
  // Eingaben erhalten, wenn die Ansicht wegen Hintergrund-Änderungen (Sync) neu gezeichnet wird
  const routeKey = route.view + (route.id ?? '');
  const keep = new Map<string, string>();
  if (routeKey === lastRouteKey) {
    main.querySelectorAll<HTMLInputElement>('input[id], textarea[id], select[id]').forEach((f) => {
      if (['file', 'checkbox', 'radio'].includes(f.type) || f.classList.contains('due-input')) return;
      keep.set(f.id, f.value);
    });
  }
  lastRouteKey = routeKey;
  openInner = null;
  main.innerHTML = views[route.view]();
  keep.forEach((v, id) => {
    const f = document.getElementById(id) as HTMLInputElement | null;
    if (f && main.contains(f) && f.value !== v) f.value = v;
  });
  if (keepId) document.getElementById(keepId)?.focus();
  if (route.view === 'settings') { updatePersistState(); updateVoiceState(); void updateRestorePoints(); }
}

// ---------- Zurück auf früheren Stand ----------

async function updateRestorePoints() {
  const el = document.getElementById('restore-list');
  if (!el) return;
  const [events, versions, rewinds] = await Promise.all([
    getAllEvents(), getMeta<{ v: string; at: number }[]>('versionLog'), getMeta<{ at: number; to: number; when?: number }[]>('rewinds'),
  ]);
  const points = restorePoints(events, versions ?? [], rewinds ?? []);
  const list = document.getElementById('restore-list');
  if (!list) return;
  list.innerHTML = points.length
    ? points.map((p) => `<li><button type="button" class="restore-point" data-action="restore-point" data-ts="${p.ts}" data-label="${esc(p.label)}" data-changes="${p.changes}">
        <span>${esc(p.label)}</span><span class="hint num">${p.changes} ${p.changes === 1 ? 'spätere Änderung' : 'spätere Änderungen'}</span></button></li>`).join('')
    : '<li class="hint">Noch keine früheren Stände. Sie entstehen mit der Zeit (Tagesende, vor Updates).</li>';
}

function confirmRewind(ts: number, label: string, changes: number) {
  modal = {
    kind: 'confirm',
    text: `Zurück auf „${label}“? ${changes} spätere ${changes === 1 ? 'Änderung wird' : 'Änderungen werden'} ausgeglichen. Das lässt sich danach wieder rückgängig machen.`,
    label: 'Zurücksetzen',
    run: () => { void doRewind(ts); },
  };
  renderModal();
}

async function doRewind(ts: number) {
  const before = await S.lastEventTs();
  const n = await S.rewindTo(ts);
  if (!n) { toast('Es gab nichts zurückzusetzen.'); return; }
  render();
  showUndo(`Früherer Stand wiederhergestellt (${n} ${n === 1 ? 'Eintrag' : 'Einträge'})`, () => { void S.rewindTo(before).then(() => { render(); toast('Wieder wie vorher.'); }); });
}

let voiceDiagOpen = false;
let voiceEnv: string[] = [];
let variantLog: string[] = [];
function voiceDiagText(): string {
  if (variantLog.length) return [...voiceEnv, '', ...variantLog, ...(V.log.length ? V.log : [])].join('\n');
  return [...voiceEnv, ...(V.log.length ? ['', 'Letzte Aufnahme:', ...V.log] : [])].join('\n');
}

const VARIANTS: [string, V.Variant][] = [
  ['Standard', {}],
  ['Fortlaufend', { continuous: true }],
  ['Ohne Zwischenergebnisse', { interim: false }],
  ['Sprache de-CH', { lang: 'de-CH' }],
  ['Sprache de', { lang: 'de' }],
];

/** Probiert nacheinander mehrere Einstellungen der Online-Erkennung und protokolliert alles. */
function runVoiceVariants(i = 0, okCount = 0) {
  if (i === 0) variantLog = [];
  if (i >= VARIANTS.length) {
    variantLog.push('', okCount ? `Ergebnis: ${okCount} von ${VARIANTS.length} Varianten haben etwas aufgenommen.` : 'Ergebnis: Keine Variante kam bis zum Mikrofon (audiostart).');
    if (okCount) V.markBrowserBlocked(false);
    refreshVoiceLog();
    return;
  }
  const [name, variant] = VARIANTS[i];
  if (i > 0) variantLog.push(...V.log);
  variantLog.push('', `— Variante ${i + 1}: ${name} —`);
  const input = document.getElementById('voice-test-input') as HTMLInputElement | null;
  if (input) input.value = '';
  const ok = V.start('voice-test-input', false, {
    onText: (t) => { const el = document.getElementById('voice-test-input') as HTMLInputElement | null; if (el) el.value = t; },
    onError: () => {},
    onEnd: (_g, _e, heard) => {
      refreshVoiceLog();
      setTimeout(() => runVoiceVariants(i + 1, okCount + (heard ? 1 : 0)), 400);
    },
  }, variant);
  if (!ok) setTimeout(() => runVoiceVariants(i + 1, okCount), 100);
  refreshVoiceLog();
}
function refreshVoiceLog() {
  const el = document.getElementById('voice-log');
  if (el) el.textContent = voiceDiagText();
}

let probeNow = false;
async function updateVoiceState() {
  const el = document.getElementById('voice-state');
  if (!el) return;
  if (!V.supported()) { el.textContent = 'Dieser Browser hat keine Spracherkennung. Das Tastatur-Mikrofon funktioniert trotzdem.'; return; }
  const a = probeNow ? await V.localAvailability() : V.lastAvailability();
  probeNow = false;
  if (!a) {
    el.innerHTML = 'Noch nicht geprüft. <button class="link" data-action="voice-check">Jetzt prüfen</button>';
    return;
  }
  const TEXT: Record<V.Availability, string> = {
    available: 'Ja, deine Stimme verlässt das Gerät nicht.',
    downloadable: 'Möglich, nach einmaligem Laden des Sprachpakets.',
    downloading: 'Sprachpaket wird geladen …',
    unavailable: 'Nein, nur online über den Browser-Anbieter.',
    unknown: 'Nein, dieser Browser erkennt Sprache nur online über seinen Anbieter.',
  };
  el.textContent = TEXT[a];
}

async function updatePersistState() {
  const el = document.getElementById('persist-state');
  if (!el) return;
  try {
    const ok = await navigator.storage?.persisted?.();
    el.textContent = ok ? 'Ja' : 'Nein. Installier die App auf dem Homescreen und mach regelmässig Backups.';
  } catch { el.textContent = 'Unbekannt'; }
}

export function go(view: View, id?: string) {
  route = { view, id };
  try { history.replaceState(null, '', '#' + (id ? `${view}-${id}` : view)); } catch { /* Vorschau ohne History */ }
  render();
  document.getElementById('main')!.scrollTop = 0;
  window.scrollTo(0, 0);
  document.body.classList.remove('nav-open');
}

function readHash() {
  const h = (location.hash || '').slice(1);
  const views: View[] = ['inbox', 'due', 'next', 'projects', 'waiting', 'tickler', 'someday', 'reference', 'done', 'settings'];
  if (h.startsWith('project-')) route = { view: 'project', id: h.slice(8) };
  else if ((views as string[]).includes(h)) route = { view: h as View };
}

// ---------- Beispieldaten ----------

async function resetTestApp() {
  if (!IS_TEST) return;
  await S.whenSaved();
  await destroyDb();
  location.reload();
}

function loadExamples() {
  S.batch(() => {
    const pid = S.createProject({ title: 'Beispiel: Velo für den Winter bereit machen', outcome: 'Velo läuft, Licht funktioniert, Winterreifen montiert', due: addDays(today(), 21) });
    S.capture('Beispiel: Velomechaniker anrufen und Termin für Service vereinbaren', { list: 'next', context: '@Telefon', projectId: pid, due: addDays(today(), 2) });
    S.capture('Beispiel: Steuererklärung', { due: addDays(today(), 30) });
    S.capture('Beispiel: Idee für Geburtstagsgeschenk Anna', {});
    S.capture('Beispiel: Artikel über Wochendurchsicht lesen', {});
    S.capture('Beispiel: Offerte vom Elektriker', { list: 'waiting', waitingFor: 'Elektro Huber', tickler: today() });
    S.capture('Beispiel: Spanisch lernen', { list: 'someday' });
  });
  toast('Beispieleinträge geladen. Du erkennst sie am Wort „Beispiel“.');
}

// ---------- Ereignisse ----------

function val(form: HTMLFormElement, name: string): string {
  const v = new FormData(form).get(name);
  return typeof v === 'string' ? v.trim() : '';
}

function saveBackupFile() {
  if (!backupText) return;
  const stamp = new Date().toISOString().slice(0, 10);
  const blob = new Blob([backupText], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `kopf-frei-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function onClick(e: MouseEvent) {
  if (swallowClick) { swallowClick = false; e.preventDefault(); e.stopPropagation(); return; }
  if (openInner && !(e.target as HTMLElement).closest('.swipe-del')) {
    const insideOpen = openInner.contains(e.target as Node);
    closeSwipe();
    if (insideOpen) { e.preventDefault(); return; }
  }
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!el) return;
  const a = el.dataset.action!;
  const id = el.dataset.id ?? '';
  switch (a) {
    case 'go': go(el.dataset.view as View); break;
    case 'toggle-nav': document.body.classList.toggle('nav-open'); break;
    case 'open-project': go('project', id); break;
    case 'ctx': ctxFilter = el.dataset.ctx ?? 'all'; render(); break;
    case 'complete': {
      const row = el.closest('.row');
      row?.classList.add('completing');
      setTimeout(() => completeWithUndo(id), 220);
      break;
    }
    case 'undo': { const fn = undoFn; hideUndo(); fn?.(); break; }
    case 'swipe-delete': {
      closeSwipe(false);
      if (el.dataset.kind === 'project') {
        const pr = project(id);
        // Aufgaben des Projekts bleiben als Einzelaufgaben erhalten
        S.batch(() => {
          for (const it of all()) if (it.projectId === id) S.patchItem(it.id, { projectId: null });
          S.patchProject(id, { deleted: true, title: '', outcome: '' });
        });
        toast(`Projekt gelöscht${pr ? `: ${short(pr.title)}` : ''}.`);
        if (route.view === 'project' && route.id === id) go('projects');
      } else {
        const it = S.state.items.get(id);
        S.patchItem(id, { deleted: true, title: '', notes: '' });
        toast(`Gelöscht${it ? `: ${short(it.title)}` : ''}.`);
      }
      break;
    }
    case 'due-pick': openDuePicker(el); break;
    case 'due-quick':
    case 'due-clear':
      if (modal?.kind === 'due') {
        const { id: did, target } = modal;
        modal = null; renderModal();
        setDue(target, did, a === 'due-quick' ? el.dataset.date! : null);
      }
      break;
    case 'next-step-later': modal = null; renderModal(); break;
    case 'promote': {
      const c = S.state.items.get(id);
      if (!c) break;
      S.patchItem(id, { list: 'next', tickler: null });
      modal = null; renderModal();
      toast(`Nächster Schritt: ${short(c.title)}`);
      break;
    }
    case 'restore': S.restoreItem(id); toast('Zurückgeholt.'); break;
    case 'edit': modal = { kind: 'edit', id }; renderModal(); break;
    case 'trash': {
      const it = S.state.items.get(id);
      modal = null; renderModal();
      if (it) patchWithUndo(id, { list: 'trash', prevList: it.list }, `Gelöscht: ${short(it.title)}`);
      break;
    }
    case 'empty-trash':
      modal = { kind: 'confirm', text: 'Papierkorb endgültig leeren? Die Einträge sind danach nicht mehr lesbar.', label: 'Endgültig leeren', run: () => { S.emptyTrash(); toast('Papierkorb geleert.'); } };
      renderModal();
      break;
    case 'confirm': if (modal?.kind === 'confirm') { const run = modal.run; modal = null; renderModal(); run(); } break;
    case 'close': modal = null; renderModal(); break;
    case 'voice': startVoice(el.dataset.target!); break;
    case 'theme': setTheme(el.dataset.value as Theme); break;
    case 'check-update': {
      if (!appActions) { toast('Updates werden in dieser Ansicht nicht geprüft.'); break; }
      toast('Suche nach Updates …');
      void appActions.checkForUpdate().then((r) => {
        const MSG = { update: 'Neue Version gefunden. Tippe oben auf „Jetzt aktualisieren“.', current: `Du hast die neueste Version (${APP_VERSION}).`, offline: 'Keine Verbindung. Später nochmals versuchen.', unsupported: 'Updates werden in dieser Ansicht nicht geprüft.' };
        toast(MSG[r]);
      });
      break;
    }
    case 'repair-app':
      modal = { kind: 'confirm', text: 'App frisch vom Server laden? Deine Daten, der Sync und die Einstellungen bleiben erhalten.', label: 'Reparieren',
        run: () => { void (appActions?.repairApp() ?? Promise.resolve(location.reload())); } };
      renderModal();
      break;
    case 'restore-point': confirmRewind(Number(el.dataset.ts), el.dataset.label ?? '', Number(el.dataset.changes)); break;
    case 'sample-add': if (IS_TEST) { seedSample(); toast('Beispieldaten hinzugefügt.'); } break;
    case 'test-reset':
      if (!IS_TEST) break;
      modal = { kind: 'confirm', text: 'Alle Daten der Test-App löschen und mit frischen Beispieldaten neu starten? Deine echte App ist davon nicht betroffen.', label: 'Zurücksetzen',
        run: () => { void resetTestApp(); } };
      renderModal();
      break;
    case 'sync-now': void Sync.syncNow(); break;
    case 'sync-back': syncSetup = null; render(); break;
    case 'sync-disconnect':
      modal = { kind: 'confirm', text: 'Synchronisation auf diesem Gerät trennen? Deine Daten bleiben auf dem Gerät und im Repository. Token und Schlüssel werden von diesem Gerät entfernt.', label: 'Trennen',
        run: () => { void Sync.disconnect().then(() => toast('Sync getrennt.')); } };
      renderModal();
      break;
    case 'apply-update': {
      // Erst alles fertig speichern, dann neu starten
      const fn = updateFn;
      void S.whenSaved().then(() => fn?.());
      break;
    }
    case 'voice-check': probeNow = true; void updateVoiceState(); break;
    case 'voice-variants': {
      voiceDiagOpen = true;
      void V.environment().then((e) => { voiceEnv = e; refreshVoiceLog(); });
      runVoiceVariants();
      break;
    }
    case 'voice-test': {
      variantLog = [];
      // Eigener Knopf = ausdrückliche Zustimmung für diesen einen Test
      voiceDiagOpen = true;
      const offline = el.dataset.mode === 'offline';
      if (offline) V.resetLocalBroken();
      const input = document.getElementById('voice-test-input') as HTMLInputElement | null;
      if (input) input.value = '';
      const timer = window.setInterval(refreshVoiceLog, 250);
      onVoiceDone = () => { window.clearInterval(timer); onVoiceDone = null; void V.environment().then((e) => { voiceEnv = e; refreshVoiceLog(); }); };
      void V.environment().then((e) => { voiceEnv = e; refreshVoiceLog(); });
      beginVoice('voice-test-input', offline);
      break;
    }
    case 'voice-capture':
      modal = { kind: 'capture' }; renderModal();
      startVoice('quick-input');
      break;
    case 'voice-once': resumeVoice(false); break;
    case 'voice-local': resumeVoice(true); break;
    case 'voice-always': void S.setVoiceCloud(true); resumeVoice(false); break;
    case 'voice-cancel':
      if (modal?.kind === 'voice-consent' || modal?.kind === 'voice-install') { modal = modal.back; renderModal(); }
      break;
    case 'voice-skip-install':
      if (modal?.kind === 'voice-install') {
        if (S.info.voiceCloud) resumeVoice(false);
        else { modal = { kind: 'voice-consent', target: modal.target, back: modal.back }; renderModal(); }
      }
      break;
    case 'voice-install-go': {
      if (modal?.kind !== 'voice-install') break;
      busy = true; renderModal();
      void V.installLocal().then(async (ok) => {
        busy = false;
        if (ok && (await V.localAvailability()) === 'available') { toast('Sprachpaket bereit. Die Erkennung läuft jetzt offline.'); resumeVoice(true); }
        else { toast('Das Sprachpaket konnte nicht geladen werden.', 'error'); renderModal(); }
      });
      break;
    }
    case 'quick-capture': modal = { kind: 'capture' }; renderModal(); break;
    case 'clarify': startClarify(id); break;
    case 'clarify-first': startClarify(); break;
    case 'step':
      if (modal?.kind === 'clarify') { modal.hist.push(modal.step); modal.step = el.dataset.step as Step; renderModal(); }
      break;
    case 'step-back':
      if (modal?.kind === 'clarify' && modal.hist.length) { modal.step = modal.hist.pop()!; renderModal(); }
      break;
    case 'clarify-skip': {
      if (modal?.kind !== 'clarify') break;
      const q = toClarify();
      const idx = q.findIndex((i) => i.id === (modal as { id: string }).id);
      const nxt = q[idx + 1] ?? null;
      if (nxt) startClarify(nxt.id); else { modal = null; renderModal(); }
      break;
    }
    case 'clarify-trash': finishClarify({ list: 'trash', prevList: 'inbox', tickler: null }, 'Weggeworfen.'); break;
    case 'clarify-reference': finishClarify({ list: 'reference', tickler: null }, 'Als Referenz abgelegt.'); break;
    case 'clarify-done': finishClarify({ list: 'done', completed: Date.now(), prevList: 'next', tickler: null }, 'Erledigt. Gut gemacht.'); break;
    case 'new-project': modal = { kind: 'project', id: null }; renderModal(); break;
    case 'edit-project': modal = { kind: 'project', id }; renderModal(); break;
    case 'project-status': {
      const status = el.dataset.status as Project['status'];
      const pr = project(id);
      if (!pr) break;
      const prev = { status: pr.status, completed: pr.completed };
      S.patchProject(id, { status, completed: status === 'done' ? Date.now() : null });
      modal = null; renderModal();
      const msg: Record<Project['status'], string> = { active: 'Projekt aktiviert.', someday: 'Auf Irgendwann/Vielleicht verschoben.', done: 'Projekt abgeschlossen.', dropped: 'Projekt verworfen.' };
      showUndo(msg[status], () => { S.patchProject(id, prev); flash(id); });
      if ((status === 'done' || status === 'dropped') && route.view === 'project' && route.id === id) go('projects');
      break;
    }
    case 'remove-ctx': S.removeContext(el.dataset.ctx!); break;
    case 'load-examples': loadExamples(); break;
    case 'download-backup': saveBackupFile(); break;
    case 'copy-backup': {
      const ta = document.getElementById('backup-text') as HTMLTextAreaElement | null;
      navigator.clipboard?.writeText(backupText ?? '').then(() => toast('Backup in die Zwischenablage kopiert.'))
        .catch(() => { ta?.select(); toast('Text markiert. Kopier ihn mit Strg+C bzw. Kopieren.'); });
      break;
    }
  }
}

async function onSubmit(e: SubmitEvent) {
  const form = e.target as HTMLFormElement;
  const kind = form.dataset.form;
  if (!kind) return;
  e.preventDefault();
  const id = form.dataset.id ?? '';
  switch (kind) {
    case 'capture':
    case 'quick-capture': {
      const t = val(form, 'title');
      if (!t) return;
      (form.querySelector('input') as HTMLInputElement).value = '';
      S.capture(t);
      if (kind === 'quick-capture') { modal = null; renderModal(); toast('In der Inbox.'); }
      else document.getElementById('capture-input')?.focus();
      break;
    }
    case 'project-step': {
      const t = val(form, 'title');
      if (!t) return;
      (form.querySelector('input[name=title]') as HTMLInputElement).value = '';
      S.capture(t, { list: 'next', projectId: id, context: val(form, 'context') || null });
      document.getElementById('step-input')?.focus();
      break;
    }
    case 'add-ctx': {
      const name = val(form, 'name');
      (form.querySelector('input') as HTMLInputElement).value = '';
      const n = S.addContext(name);
      if (n) toast(`${n} hinzugefügt.`);
      break;
    }
    case 'clarify-someday':
      finishClarify({ list: 'someday', tickler: val(form, 'tickler') || null }, 'Auf Irgendwann/Vielleicht gelegt.');
      break;
    case 'clarify-project': {
      if (modal?.kind !== 'clarify') return;
      const pid = S.createProject({ title: val(form, 'ptitle'), outcome: val(form, 'outcome'), due: val(form, 'due') || null });
      modal.title = val(form, 'next');
      finishClarify({ list: 'next', projectId: pid, context: val(form, 'context') || null, tickler: null }, 'Projekt angelegt.',
        () => S.patchProject(pid, { deleted: true }));
      break;
    }
    case 'clarify-next':
      finishClarify({ list: 'next', context: val(form, 'context') || null, projectId: val(form, 'projectId') || null, tickler: val(form, 'tickler') || null, due: val(form, 'due') || null }, 'Als nächsten Schritt abgelegt.');
      break;
    case 'clarify-delegate':
      finishClarify({ list: 'waiting', waitingFor: val(form, 'who'), tickler: val(form, 'tickler') || null, projectId: val(form, 'projectId') || null, due: val(form, 'due') || null }, 'Zu „Warten auf“ hinzugefügt.');
      break;
    case 'restore-custom': {
      const v = val(form, 'when');
      const ts = new Date(v).getTime();
      if (!v || Number.isNaN(ts)) return;
      if (ts >= Date.now()) { toast('Wähl einen Zeitpunkt in der Vergangenheit.', 'error'); return; }
      const after = (await getAllEvents()).filter((e) => e.ts > ts).length;
      if (!after) { toast('Seit diesem Zeitpunkt hat sich nichts geändert.'); return; }
      confirmRewind(ts + 59_999, new Date(ts).toLocaleString('de-CH', { dateStyle: 'medium', timeStyle: 'short' }), after);
      break;
    }
    case 'sync-probe': {
      const owner = val(form, 'owner'), repo = val(form, 'repo'), token = val(form, 'token');
      syncDraft = { owner, repo, token };
      busy = true; render();
      try {
        const probe = await Sync.probe(owner, repo, token);
        syncSetup = { owner, repo, token, probe };
      } catch (err) {
        toast((err as Error).message, 'error');
      }
      busy = false; render();
      break;
    }
    case 'sync-connect': {
      if (!syncSetup) return;
      const p1 = val(form, 'pass1');
      if (!syncSetup.probe.header) {
        if (p1 !== val(form, 'pass2')) { toast('Die beiden Passphrasen stimmen nicht überein.', 'error'); return; }
        if (p1.length < 10) { toast('Die Passphrase braucht mindestens 10 Zeichen.', 'error'); return; }
      }
      busy = true; render();
      try {
        const { owner, repo, token, probe } = syncSetup;
        await Sync.connect(owner, repo, token, p1, probe);
        syncSetup = null;
        syncDraft = { owner: '', repo: 'head-space-data', token: '' };
        toast(Sync.status.state === 'idle' ? 'Verbunden und synchronisiert.' : 'Verbunden.');
      } catch (err) {
        toast((err as Error).message, 'error');
      }
      busy = false; render();
      break;
    }
    case 'sync-unlock': {
      busy = true; render();
      try { await Sync.unlock(val(form, 'pass')); toast('Entsperrt.'); } catch (err) { toast((err as Error).message, 'error'); }
      busy = false; render();
      break;
    }
    case 'next-step': {
      const t = val(form, 'title');
      if (!t) return;
      S.capture(t, { list: 'next', projectId: id, context: val(form, 'context') || null, due: val(form, 'due') || null, tickler: val(form, 'tickler') || null });
      modal = null; renderModal();
      toast('Nächster Schritt gespeichert.');
      break;
    }
    case 'due': {
      if (modal?.kind !== 'due') return;
      const target = modal.target;
      modal = null; renderModal();
      setDue(target, id, val(form, 'due') || null);
      break;
    }
    case 'edit': {
      const it = S.state.items.get(id);
      if (!it) return;
      const list = val(form, 'list') as ListName;
      const patch: Partial<Item> = {
        title: val(form, 'title'), notes: (new FormData(form).get('notes') as string ?? '').trim(), list,
        context: val(form, 'context') || null, projectId: val(form, 'projectId') || null,
        waitingFor: val(form, 'waitingFor') || null, tickler: val(form, 'tickler') || null, due: val(form, 'due') || null,
      };
      modal = null; renderModal();
      if (list === 'done' && it.list !== 'done') {
        delete patch.list;
        completeWithUndo(id, patch);
        break;
      }
      if (list !== 'done' && it.list === 'done') patch.completed = null;
      if (list !== it.list) {
        if (list === 'trash') patch.prevList = it.list;
        patchWithUndo(id, patch, list === 'trash' ? `Gelöscht: ${short(patch.title ?? it.title)}` : `Verschoben nach ${LIST_LABEL[list]}`);
      } else {
        S.patchItem(id, patch);
        toast('Gespeichert.');
      }
      break;
    }
    case 'project': {
      const title = val(form, 'title');
      if (!title) return;
      if (id) {
        S.patchProject(id, { title, outcome: val(form, 'outcome'), due: val(form, 'due') || null });
        modal = null; renderModal(); toast('Projekt gespeichert.');
      } else {
        let pid = '';
        S.batch(() => {
          pid = S.createProject({ title, outcome: val(form, 'outcome'), due: val(form, 'due') || null });
          const next = val(form, 'next');
          if (next) S.capture(next, { list: 'next', projectId: pid, context: val(form, 'context') || null });
        });
        modal = null; renderModal(); go('project', pid);
      }
      break;
    }
    case 'export': {
      const p1 = val(form, 'pass1');
      if (p1 !== val(form, 'pass2')) { toast('Die beiden Passphrasen stimmen nicht überein.', 'error'); return; }
      if (p1.length < 10) { toast('Die Passphrase braucht mindestens 10 Zeichen.', 'error'); return; }
      busy = true; render();
      try {
        backupText = await S.exportBackup(p1);
        ['pass1', 'pass2'].forEach((i) => { const f = document.getElementById(i) as HTMLInputElement | null; if (f) f.value = ''; });
        busy = false; render();
        toast('Backup verschlüsselt.');
      } catch (err) {
        busy = false; render();
        toast('Backup fehlgeschlagen: ' + (err as Error).message, 'error');
      }
      break;
    }
    case 'import': {
      const fileInput = form.querySelector<HTMLInputElement>('input[type=file]');
      const file = fileInput?.files?.[0];
      const text = file ? await file.text() : val(form, 'text');
      if (!text) { toast('Wähl eine Backup-Datei aus oder füg den Text ein.', 'error'); return; }
      busy = true; render();
      try {
        const { added } = await S.importBackup(text, val(form, 'pass'));
        busy = false; render();
        toast(added ? `${added} Änderungen wiederhergestellt.` : 'Das Backup enthält nichts Neues. Alles ist schon da.');
      } catch (err) {
        busy = false; render();
        toast((err as Error).message, 'error');
      }
      break;
    }
  }
}

function onChange(e: Event) {
  const el = e.target as HTMLInputElement;
  if (el.classList.contains('due-input')) {
    setDue(el.dataset.kind as 'item' | 'project', el.dataset.id!, el.value || null);
    return;
  }
  if (el.id === 'voice-cloud') {
    void S.setVoiceCloud(el.checked);
    toast(el.checked ? 'Online-Erkennung erlaubt.' : 'Online-Erkennung aus. Die App fragt wieder nach.');
  }
}

function onInput(e: Event) {
  const el = e.target as HTMLElement;
  if (el.dataset.bind === 'clarify-title' && modal?.kind === 'clarify') modal.title = (el as HTMLTextAreaElement).value;
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && modal) { modal = null; renderModal(); return; }
  const t = e.target as HTMLElement;
  const typing = t.matches('input, textarea, select, [contenteditable]');
  if (!typing && !modal && (e.key === 'n' || e.key === 'N') && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    modal = { kind: 'capture' }; renderModal();
  }
  if (t.id === 'clarify-title' && e.key === 'Enter' && !e.shiftKey) e.preventDefault();
}

export function mount() {
  readHash();
  document.addEventListener('click', onClick, true);
  document.addEventListener('pointerdown', onPointerDown, { passive: true });
  document.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerCancel);
  document.addEventListener('submit', (e) => { void onSubmit(e as SubmitEvent); });
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  window.addEventListener('hashchange', () => { readHash(); render(); });
  document.addEventListener('toggle', (e) => { if ((e.target as HTMLElement).id === 'voice-diag') voiceDiagOpen = (e.target as HTMLDetailsElement).open; }, true);
  document.addEventListener('keydown', onKey);
  S.onChange(render);
  S.onError((m) => toast(m, 'error'));
  render();
}
