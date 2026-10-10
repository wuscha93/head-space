// Datenkonsistenz beim Löschen über zwei Geräte (Sync über simuliertes GitHub):
// Wischen + Rückgängig, Papierkorb, Papierkorb leeren, Projekt löschen, gleichzeitige Änderungen.
// Nach jedem Abgleich müssen beide Geräte exakt denselben Zustand haben.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { harden } from './helpers.mjs';
import { createHash } from 'node:crypto';
const SH = process.argv[2]; const BASE = 'http://localhost:4173/';
const errors = []; const ok = (c, m) => { if (!c) errors.push('FAIL ' + m); else console.log('ok  ' + m); };

// ---------- Simuliertes GitHub (wie Test 4) ----------
const files = new Map();
const shaOf = (p) => createHash('sha1').update(p).digest('hex'); // wie GitHub: eindeutig je Datei (früher: Präfix des Pfads, gleich bei Paketen eines Geräts)
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,PUT,OPTIONS' };
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function fakeGitHub(route) {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  const u = new URL(req.url());
  if (req.headers()['authorization'] !== 'Bearer github_pat_gut') return json(route, 401, { message: 'Bad credentials' });
  const m = u.pathname.match(/^\/repos\/adrian\/head-space-data(\/.*)?$/);
  if (!m) return json(route, 404, { message: 'Not Found' });
  const rest = m[1] ?? '';
  if (rest === '') return json(route, 200, { private: true, default_branch: 'main', full_name: 'adrian/head-space-data', permissions: { push: true } });
  if (rest.startsWith('/contents/')) {
    const path = decodeURIComponent(rest.slice('/contents/'.length));
    if (req.method() === 'GET') return files.has(path) ? json(route, 200, { content: files.get(path), sha: shaOf(path) }) : json(route, 404, { message: 'Not Found' });
    if (req.method() === 'PUT') {
      if (files.has(path)) return json(route, 422, { message: 'exists' });
      files.set(path, JSON.parse(req.postData()).content);
      return json(route, 201, { content: { path } });
    }
  }
  if (rest.startsWith('/git/trees/')) {
    if (!files.size) return json(route, 409, { message: 'Git Repository is empty.' });
    return json(route, 200, { tree: [...files.keys()].map((p) => ({ path: p, type: 'blob', sha: shaOf(p) })), truncated: false });
  }
  if (rest.startsWith('/git/blobs/')) {
    const p = [...files.keys()].find((k) => shaOf(k) === rest.slice('/git/blobs/'.length));
    return p ? json(route, 200, { content: files.get(p) }) : json(route, 404, { message: 'Not Found' });
  }
  return json(route, 404, { message: 'Not Found' });
}

const browser = await chromium.launch();
async function device(name, opts) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', ...opts });
  await ctx.route('https://api.github.com/**', fakeGitHub);
  const page = harden(await ctx.newPage());
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  return page;
}
const A = await device('A', { viewport: { width: 1180, height: 900 } });                                   // Computer
const B = await device('B', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });  // Handy

// Abgleich: zweimal, damit ein gerade laufender automatischer Abgleich die neueste Änderung nicht verpasst
const sync = async (...ps) => { for (const p of ps) { await p.evaluate(async () => { await window.kopfFrei.whenSaved(); await window.kopfFrei.sync(); await window.kopfFrei.sync(); }); } };
const snap = (p) => p.evaluate(() => window.kopfFrei.snapshot());
async function same(label) {
  await sync(A, B, A); // A schickt, B holt und schickt, A holt
  const [a, b] = [await snap(A), await snap(B)];
  ok(a === b, `${label}: beide Geräte gleich`);
  if (a !== b) console.log('A:', a, '\nB:', b);
}
const rowOf = (p, t) => p.locator('#main li.row', { has: p.locator('.row-title', { hasText: t }) });
const go = async (p, hash) => { await p.goto(BASE + hash); await p.waitForSelector('#main h1, #main .back'); };
/** Wischen mit echten Touch-Pointer-Ereignissen (Handy) */
async function swipe(p, t) {
  await p.locator('#main li.row', { has: p.locator('.row-title', { hasText: t }) }).locator('.row-inner').evaluate((el) => {
    const r = el.getBoundingClientRect(); const x0 = r.right - 30, y0 = r.top + r.height / 2;
    const ev = (type, x) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'touch', clientX: x, clientY: y0, isPrimary: true }));
    ev('pointerdown', x0); for (let i = 1; i <= 8; i++) ev('pointermove', x0 - (140 * i) / 8); ev('pointerup', x0 - 140);
  });
  await p.waitForTimeout(300);
  await p.locator('#main li.row.swipe-open .swipe-del').tap();
  await p.waitForTimeout(200);
}
async function connect(p, first) {
  await go(p, '#settings'); await p.waitForSelector('#sync-owner');
  await p.fill('#sync-owner', 'adrian'); await p.fill('#sync-repo', 'head-space-data'); await p.fill('#sync-token', 'github_pat_gut');
  await p.click('form[data-form=sync-probe] button[type=submit]');
  await p.waitForSelector('#sync-pass1');
  await p.fill('#sync-pass1', 'mein-geheimer-satz-123');
  if (first) await p.fill('#sync-pass2', 'mein-geheimer-satz-123');
  await p.click('form[data-form=sync-connect] button[type=submit]');
  await p.waitForSelector('#sync .sync-idle', { timeout: 30000 });
}

// ---------- 1. Daten auf A, beide verbinden ----------
await go(A, '#inbox');
for (const t of ['Eins', 'Zwei', 'Drei']) { await A.fill('#capture-input', t); await A.keyboard.press('Enter'); }
await go(A, '#projects');
await A.click('[data-action=new-project]'); await A.fill('#pf-title', 'Umzug'); await A.fill('#pf-next', 'Kisten packen');
await A.click('form[data-form=project] button[type=submit]');
await A.waitForSelector('#step-input'); // neues Projekt öffnet sich direkt
await A.fill('#step-input', 'Möbel ausmessen'); await A.keyboard.press('Enter');
await connect(A, true);
await connect(B, false);
await same('Start');
await go(B, '#inbox');
ok((await rowOf(B, 'Eins').count()) === 1, 'B hat die Daten von A');

// ---------- 2. B wischt „Eins“ weg, nimmt zurück, wischt nochmals ----------
await swipe(B, 'Eins');
await B.locator('[data-action=undo]').tap(); await B.waitForTimeout(200);
ok((await rowOf(B, 'Eins').count()) === 1, 'B: Rückgängig holt „Eins“ zurück');
await swipe(B, 'Eins');
await B.waitForTimeout(3300);
await same('Gewischt (Papierkorb)');
await go(A, '#inbox');
ok((await rowOf(A, 'Eins').count()) === 0, 'A: „Eins“ nicht mehr in der Inbox');
await go(A, '#done');
ok((await rowOf(A, 'Eins').count()) === 1, 'A: „Eins“ im Papierkorb');

// ---------- 3. A legt „Zwei“ in den Papierkorb und nimmt es sofort zurück ----------
await go(A, '#inbox');
await rowOf(A, 'Zwei').locator('.row-title').click(); await A.waitForSelector('#e-title');
await A.click('[data-action=trash]');
await A.click('[data-action=undo]');
await same('Papierkorb + Rückgängig');
await go(B, '#inbox');
ok((await rowOf(B, 'Zwei').count()) === 1, 'B: „Zwei“ bleibt in der Inbox');

// ---------- 4. A leert den Papierkorb ----------
await go(A, '#done');
await A.click('[data-action=empty-trash]'); await A.click('[data-action=confirm]');
await same('Papierkorb geleert');
await go(B, '#done');
ok((await rowOf(B, 'Eins').count()) === 0, 'B: „Eins“ endgültig weg');
const bEins = await B.evaluate(() => JSON.parse(window.kopfFrei.snapshot()).items.filter((i) => i.deleted));
ok(bEins.length === 1 && bEins[0].title === '' && bEins[0].notes === '', 'B: Inhalt des gelöschten Eintrags geleert');

// ---------- 5. A löscht das Projekt (mit Bestätigung) ----------
await go(A, '#projects'); await A.locator('#main .row-title', { hasText: 'Umzug' }).click(); await A.waitForSelector('[data-action=delete-project]');
await A.click('[data-action=delete-project]');
ok((await A.locator('#modal').innerText()).includes('2 Aufgaben'), 'Bestätigung nennt die Anzahl Aufgaben');
await A.click('[data-action=confirm]');
await same('Projekt gelöscht');
await go(B, '#projects');
ok((await rowOf(B, 'Umzug').count()) === 0, 'B: Projekt weg');
await go(B, '#next');
ok((await rowOf(B, 'Kisten').count()) === 0 && (await rowOf(B, 'Möbel').count()) === 0, 'B: Aufgaben des Projekts weg');
await go(B, '#done');
ok((await rowOf(B, 'Kisten').count()) === 0, 'B: Aufgaben nicht im Papierkorb (endgültig)');

// ---------- 6. Gleichzeitig: A löscht „Drei“, B ändert den Titel (ohne Abgleich dazwischen) ----------
await go(A, '#inbox');
await rowOf(A, 'Drei').locator('.row-title').click(); await A.waitForSelector('#e-title');
await A.click('[data-action=trash]'); await A.waitForTimeout(3300);
await go(B, '#inbox');
await rowOf(B, 'Drei').locator('.row-title').tap(); await B.waitForSelector('#e-title');
await B.fill('#e-title', 'Drei geändert'); await B.click('form[data-form=edit] button[type=submit]');
await same('Gleichzeitig gelöscht und geändert');
for (const [n, p] of [['A', A], ['B', B]]) {
  await go(p, '#inbox');
  ok((await rowOf(p, 'Drei').count()) === 0, `${n}: „Drei“ bleibt im Papierkorb`);
  await go(p, '#done');
  ok((await rowOf(p, 'Drei geändert').count()) === 1, `${n}: neuer Titel von B ist trotzdem übernommen`);
}

// ---------- 7. Gleichzeitig: A leert den Papierkorb, B ändert die Notiz ----------
await go(A, '#done');
await A.click('[data-action=empty-trash]'); await A.click('[data-action=confirm]');
await go(B, '#done');
await rowOf(B, 'Drei geändert').locator('.row-title').tap(); await B.waitForSelector('#e-notes');
await B.fill('#e-notes', 'Notiz nach dem Löschen'); await B.click('form[data-form=edit] button[type=submit]');
await same('Gleichzeitig endgültig gelöscht und geändert');
const drei = await A.evaluate(() => JSON.parse(window.kopfFrei.snapshot()).items.filter((i) => i.deleted));
ok(drei.every((i) => i.title === '' && i.notes === ''), 'Endgültig Gelöschtes bleibt leer (spätere Änderung ignoriert)');

// ---------- 8. Nach Neuladen unverändert, erneuter Abgleich ändert nichts ----------
const before = await snap(B);
await B.reload(); await B.waitForSelector('#main h1');
ok((await snap(B)) === before, 'B: nach Neuladen gleicher Stand');
const n = files.size;
await sync(A, B);
ok(files.size === n, 'Ohne Änderungen kein weiterer Upload');

await browser.close();
if (errors.length) { console.log(errors.join('\n')); process.exit(1); }
console.log('Alle Prüfungen bestanden');
