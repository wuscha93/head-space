const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { harden } from './helpers.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const SH = process.argv[2]; const BASE = 'http://localhost:4173/';
const errors = []; const ok = (c, m) => { if (!c) errors.push('FAIL ' + m); else console.log('ok  ' + m); };

// ---------- Simuliertes GitHub ----------
const files = new Map(); // path -> base64
let isPrivate = true;
const shaOf = (p) => Buffer.from(p).toString('hex').slice(0, 40).padEnd(40, '0');
const bySha = () => new Map([...files.keys()].map((p) => [shaOf(p), p]));
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,PUT,OPTIONS' };
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
let calls = 0;
async function fakeGitHub(route) {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  calls++;
  const u = new URL(req.url());
  if (req.headers()['authorization'] !== 'Bearer github_pat_gut') return json(route, 401, { message: 'Bad credentials' });
  const m = u.pathname.match(/^\/repos\/adrian\/head-space-data(\/.*)?$/);
  if (!m) return json(route, 404, { message: 'Not Found' });
  const rest = m[1] ?? '';
  if (rest === '') return json(route, 200, { private: isPrivate, default_branch: 'main', full_name: 'adrian/head-space-data', permissions: { push: true } });
  if (rest.startsWith('/contents/')) {
    const path = decodeURIComponent(rest.slice('/contents/'.length));
    if (req.method() === 'GET') return files.has(path) ? json(route, 200, { content: files.get(path), sha: shaOf(path) }) : json(route, 404, { message: 'Not Found' });
    if (req.method() === 'PUT') {
      if (files.has(path)) return json(route, 422, { message: 'sha wasn\'t supplied' });
      files.set(path, JSON.parse(req.postData()).content);
      return json(route, 201, { content: { path } });
    }
  }
  if (rest.startsWith('/git/trees/')) {
    if (!files.size) return json(route, 409, { message: 'Git Repository is empty.' });
    return json(route, 200, { tree: [...files.keys()].map((p) => ({ path: p, type: 'blob', sha: shaOf(p) })), truncated: false });
  }
  if (rest.startsWith('/git/blobs/')) {
    const p = bySha().get(rest.slice('/git/blobs/'.length));
    return p ? json(route, 200, { content: files.get(p) }) : json(route, 404, { message: 'Not Found' });
  }
  return json(route, 404, { message: 'Not Found' });
}
const repoText = () => [...files.entries()].map(([p, c]) => p + ' ' + Buffer.from(c, 'base64').toString('utf8')).join('\n');

const browser = await chromium.launch();
async function device(name, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 }, serviceWorkers: 'block', ...opts });
  await ctx.route('https://api.github.com/**', fakeGitHub);
  const page = harden(await ctx.newPage());
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/401|404|409|422/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
  return page;
}

// ---------- 1. Alte Daten (Version 0.1–0.3, Datenbank-Version 1) ----------
const A = await device('A');
await A.goto(BASE + 'icon.svg');
await A.evaluate(async () => {
  const t = Date.now() - 50000;
  const ev = [
    { id: 'e1', ts: t, device: 'alt', type: 'context.add', data: { name: '@Telefon' } },
    { id: 'e2', ts: t + 1, device: 'alt', type: 'project.create', data: { id: 'p1', title: 'Steuererklärung', outcome: '', status: 'active', created: t, updated: t, completed: null } },
    { id: 'e3', ts: t + 2, device: 'alt', type: 'item.create', data: { id: 'i1', title: 'Belege scannen', notes: '', list: 'next', context: '@Telefon', projectId: 'p1', waitingFor: null, tickler: null, created: t, updated: t, completed: null } },
    { id: 'e4', ts: t + 3, device: 'alt', type: 'item.create', data: { id: 'i2', title: 'Alter Eintrag mit Zusatzfeld', list: 'inbox', energie: 'hoch' } },
    { id: 'e5', ts: t + 4, device: 'neu', type: 'zukunft.ereignis', data: { irgendwas: 1 } },
  ];
  await new Promise((res, rej) => {
    const r = indexedDB.open('kopf-frei', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('events', { keyPath: 'id' }); r.result.createObjectStore('meta'); };
    r.onsuccess = () => {
      const tx = r.result.transaction(['events', 'meta'], 'readwrite');
      ev.forEach((e) => tx.objectStore('events').put(e));
      tx.objectStore('meta').put('alt-geraet-0001', 'device');
      tx.objectStore('meta').put(Date.now(), 'lastBackup');
      tx.oncomplete = () => { r.result.close(); res(); }; tx.onerror = rej;
    };
  });
});
await A.goto(BASE + '#next'); await A.waitForSelector('#main .row');
ok((await A.locator('#main .row', { hasText: 'Belege scannen' }).count()) === 1, 'Altdaten: Aufgabe sichtbar');
ok((await A.locator('#main .row', { hasText: 'Belege scannen' }).locator('button.due-none').count()) === 1, 'Altdaten: fehlende Frist = keine Frist');
ok((await A.locator('.row-eyebrow').innerText()).toLowerCase().includes('steuererklärung'), 'Altdaten: Projekt als Überzeile');
await A.click('[data-view=inbox]');
ok((await A.locator('#main .row', { hasText: 'Zusatzfeld' }).count()) === 1, 'Altdaten: unvollständiger Eintrag lesbar');
const dbInfo = await A.evaluate(() => new Promise((res) => { const r = indexedDB.open('kopf-frei'); r.onsuccess = () => { res({ v: r.result.version, stores: [...r.result.objectStoreNames] }); r.result.close(); }; }));
ok(dbInfo.v === 2 && dbInfo.stores.includes('synced') && dbInfo.stores.includes('events'), `Datenbank auf Version 2 erweitert (${dbInfo.stores})`);

// ---------- 2. Darstellung ----------
await A.click('[data-view=settings]');
await A.click('[data-action=theme][data-value=dark]');
ok((await A.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'Dunkel gesetzt');
ok((await A.evaluate(() => getComputedStyle(document.body).backgroundColor)) === 'rgb(0, 43, 54)', 'Hintergrund Solarized dunkel');
await A.reload(); await A.waitForSelector('#main h1');
ok((await A.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'Dunkel bleibt nach Neuladen');
await A.screenshot({ path: SH + '/s1-settings-dark.png', fullPage: true });
await A.click('[data-action=theme][data-value=light]');
ok((await A.evaluate(() => getComputedStyle(document.body).backgroundColor)) === 'rgb(253, 246, 227)', 'Hell: Solarized hell');
await A.click('[data-action=theme][data-value=system]');
ok((await A.evaluate(() => document.documentElement.dataset.theme)) === undefined, 'Wie System: kein fester Wert');

// ---------- 3. Sync einrichten auf Gerät A ----------
const step1 = async (P, token) => {
  await P.fill('#sync-owner', 'adrian'); await P.fill('#sync-repo', 'head-space-data'); await P.fill('#sync-token', token);
  await P.click('form[data-form=sync-probe] button[type=submit]');
};
await step1(A, 'github_pat_falsch');
await A.waitForSelector('.toast.error.show');
ok((await A.locator('#toast').innerText()).includes('ungültig'), 'Falsches Token: verständliche Meldung');
isPrivate = false;
await step1(A, 'github_pat_gut');
await A.waitForFunction(() => document.getElementById('toast').textContent.includes('öffentlich'));
ok(true, 'Öffentliches Repo wird abgelehnt');
isPrivate = true;
await step1(A, 'github_pat_gut');
await A.waitForSelector('#sync-pass2');
await A.fill('#sync-pass1', 'mein-geheimer-satz-123'); await A.fill('#sync-pass2', 'mein-geheimer-satz-123');
await A.click('form[data-form=sync-connect] button[type=submit]');
await A.waitForSelector('#sync .sync-idle', { timeout: 30000 });
ok(files.has('kopf-frei.json') && [...files.keys()].some((p) => p.startsWith('events/')), 'Repo: Einstellungen und erstes Paket angelegt');
const txt = repoText();
ok(!/Belege|Steuer|Zusatzfeld|@Telefon/.test(txt), 'Im Repo kein Klartext');
ok((await A.locator('.nav-foot .sync-pill').innerText()).includes('Synchronisiert'), 'Seitenleiste zeigt Sync-Status');
await A.screenshot({ path: SH + '/s2-sync-connected.png', fullPage: true });

// ---------- 4. Gerät B verbindet sich ----------
const B = await device('B', { viewport: { width: 390, height: 844 } });
await B.goto(BASE + '#settings'); await B.waitForSelector('#sync-owner');
await step1(B, 'github_pat_gut');
await B.waitForSelector('#sync-pass1');
ok((await B.locator('#sync-pass2').count()) === 0, 'Gerät B: bestehendes Repo erkannt (nur eine Passphrase)');
await B.fill('#sync-pass1', 'falsche-passphrase');
await B.click('form[data-form=sync-connect] button[type=submit]');
await B.waitForFunction(() => document.getElementById('toast').textContent.includes('passt nicht'), null, { timeout: 30000 });
ok(true, 'Gerät B: falsche Passphrase abgelehnt');
await B.fill('#sync-pass1', 'mein-geheimer-satz-123');
await B.click('form[data-form=sync-connect] button[type=submit]');
await B.waitForSelector('#sync .sync-idle', { timeout: 30000 });
await B.goto(BASE + '#next'); await B.waitForSelector('#main .row');
ok((await B.locator('#main .row', { hasText: 'Belege scannen' }).count()) === 1, 'Gerät B hat die Daten von A');

// B erfasst etwas → automatisch hochgeladen
await B.goto(BASE + '#inbox'); await B.waitForSelector('#capture-input');
const before = files.size;
await B.fill('#capture-input', 'Von Gerät B erfasst'); await B.keyboard.press('Enter');
await B.waitForFunction(() => document.querySelector('.sync-pill')?.className.includes('sync-idle'), null, { timeout: 15000 });
await B.waitForTimeout(5500);
ok(files.size === before + 1, 'Gerät B: Änderung automatisch hochgeladen');

// A holt
await A.click('[data-action=sync-now]');
await A.waitForTimeout(1500);
await A.click('[data-view=inbox]');
ok((await A.locator('#main .row', { hasText: 'Von Gerät B' }).count()) === 1, 'Gerät A hat die Änderung von B');

// Unbekanntes Ereignis wurde mitsynchronisiert (nicht verloren)
const bEvents = await B.evaluate(() => new Promise((res) => { const r = indexedDB.open('kopf-frei'); r.onsuccess = () => { const q = r.result.transaction('events').objectStore('events').getAll(); q.onsuccess = () => res(q.result.map((e) => e.type)); }; }));
ok(bEvents.includes('zukunft.ereignis'), 'Ereignis einer neueren Version bleibt erhalten und wird weitergegeben');
const bItem = await B.evaluate(() => new Promise((res) => { const r = indexedDB.open('kopf-frei'); r.onsuccess = () => { const q = r.result.transaction('events').objectStore('events').get('e4'); q.onsuccess = () => res(q.result?.data?.energie); }; }));
ok(bItem === 'hoch', 'Unbekanntes Feld bleibt erhalten');

// Keine doppelten Uploads bei erneutem Sync ohne Änderungen
const n = files.size;
await A.click('[data-view=settings]');
await A.click('[data-action=sync-now]'); await A.waitForTimeout(1200);
ok(files.size === n, 'Kein Upload ohne Änderungen');

// Trennen
await A.click('[data-action=sync-disconnect]'); await A.click('[data-action=confirm]');
await A.waitForSelector('#sync-owner');
ok((await A.locator('.nav-foot .sync-pill').count()) === 0, 'Getrennt: Anzeige weg, Formular wieder da');
await A.click('[data-view=inbox]');
ok((await A.locator('#main .row', { hasText: 'Von Gerät B' }).count()) === 1, 'Getrennt: Daten bleiben auf dem Gerät');
await B.screenshot({ path: SH + '/s3-phone.png' });

// ---------- 5. Update-Hinweis (mit Service Worker) ----------
const ctxU = await browser.newContext({ viewport: { width: 1180, height: 800 } });
const U = harden(await ctxU.newPage());
U.on('pageerror', (e) => errors.push('U pageerror: ' + e.message));
await U.goto(BASE); await U.waitForSelector('#capture-input');
await U.evaluate(() => navigator.serviceWorker.ready);
await U.reload(); await U.waitForSelector('#capture-input');
ok(await U.evaluate(() => !!navigator.serviceWorker.controller), 'Service Worker aktiv (offline-fähig)');
await U.fill('#capture-input', 'Bleibt nach Update'); await U.keyboard.press('Enter');
const swPath = new URL('../dist/sw.js', import.meta.url).pathname;
const swOrig = readFileSync(swPath, 'utf8');
writeFileSync(swPath, swOrig.replace(/const VERSION = '([^']+)'/, "const VERSION = '$1-neu'"));
try {
  await U.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
  await U.waitForSelector('.banner.update', { timeout: 20000 });
  ok((await U.locator('.banner.update').innerText()).includes('Neue Version'), 'Neue Version wird angezeigt');
  await U.screenshot({ path: SH + '/s4-update.png' });
  await Promise.all([U.waitForEvent('load', { timeout: 20000 }), U.click('[data-action=apply-update]')]);
  await U.waitForSelector('#main h1');
  ok((await U.locator('.banner.update').count()) === 0, 'Nach Update: Hinweis weg');
  ok((await U.locator('#main .row', { hasText: 'Bleibt nach Update' }).count()) === 1, 'Nach Update: Daten erhalten');
} finally {
  writeFileSync(swPath, swOrig);
}
await browser.close();
console.log(errors.length ? '\nFEHLER:\n' + errors.join('\n') : '\nAlle Prüfungen bestanden.');
