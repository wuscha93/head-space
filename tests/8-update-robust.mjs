// Updates kommen vollständig an, auch wenn der Server (wie GitHubs Zwischenspeicher)
// nach einer Veröffentlichung noch kurz alte Dateien ausliefert.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { harden } from './helpers.mjs';
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
const SH = process.argv[2];
const SITE = new URL('../site/', import.meta.url).pathname;
const errors = []; const ok = (c, m) => { if (!c) errors.push('FAIL ' + m); else console.log('ok  ' + m); };

// Version A = aktueller Build, Version B = simulierte neue Veröffentlichung (andere Build-Nummer, Version 9.9.9)
const A = Object.fromEntries(readdirSync(SITE).filter((f) => f.includes('.')).map((f) => [f, readFileSync(join(SITE, f))]));
const buildA = String(A['sw.js']).match(/const VERSION = '(\d+)'/)[1];
const buildB = String(Number(buildA) + 1);
const verA = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version;
const toB = (buf) => Buffer.from(String(buf).split(buildA).join(buildB).split(`"${verA}"`).join('"9.9.9"'));
const B = { ...A, 'sw.js': toB(A['sw.js']), 'app.js': toB(A['app.js']) };

let mode = 'A'; // 'A' | 'stale' (neue Version, aber normale Adressen liefern noch alte Dateien) | 'B'
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let file = url.pathname.slice(1) || 'index.html';
  if (!A[file]) { res.writeHead(404); return res.end(); }
  const versioned = url.searchParams.has('v');
  const set = mode === 'A' ? A : mode === 'B' ? B : (file === 'sw.js' || versioned ? B : A);
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(set[file]);
});
await new Promise((r) => server.listen(4174, r));
const URL0 = 'http://localhost:4174/';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const page = harden(await ctx.newPage());
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const version = async () => { await page.goto(URL0 + '#settings'); await page.waitForSelector('.facts'); return (await page.locator('.facts', { hasText: 'App-Version' }).innerText()).match(/App-Version\s+([\d.]+)/)?.[1]; };

await page.goto(URL0); await page.waitForSelector('#capture-input');
await page.fill('#capture-input', 'Bleibt erhalten'); await page.keyboard.press('Enter');
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload(); await page.waitForSelector('#main h1');
ok((await version()) === verA, `Start mit Version ${verA}`);

// „Nach Updates suchen“ ohne neue Version
await page.locator('[data-action=check-update]').tap();
await page.waitForFunction(() => document.getElementById('toast').textContent.includes('neueste Version'), null, { timeout: 15000 });
ok(true, '„Nach Updates suchen“: meldet neueste Version');

// Neue Version veröffentlicht, aber der Zwischenspeicher liefert unter den normalen Adressen noch alte Dateien
mode = 'stale';
await page.locator('[data-action=check-update]').tap();
await page.waitForSelector('.banner.update', { timeout: 20000 });
ok(true, 'Neue Version gefunden, Hinweis erscheint');
await Promise.all([page.waitForEvent('load', { timeout: 20000 }), page.locator('[data-action=apply-update]').tap()]);
ok((await version()) === '9.9.9', 'Nach dem Update läuft wirklich die neue Version (keine alte Datei aus dem Zwischenspeicher)');
ok((await page.locator('.banner.update').count()) === 0, 'Kein Update-Hinweis mehr');
await page.goto(URL0 + '#inbox'); await page.waitForSelector('#main h1');
ok((await page.locator('#main .row-title', { hasText: 'Bleibt erhalten' }).count()) === 1, 'Daten nach Update erhalten');

// App reparieren: lädt frisch, Daten bleiben
mode = 'B';
await page.goto(URL0 + '#settings'); await page.waitForSelector('[data-action=repair-app]');
await Promise.all([page.waitForEvent('load', { timeout: 20000 }), (async () => { await page.locator('[data-action=repair-app]').tap(); await page.locator('[data-action=confirm]').tap(); })()]);
await page.waitForSelector('#main h1');
ok((await version()) === '9.9.9', '„App reparieren“: App läuft danach normal');
await page.evaluate(() => navigator.serviceWorker.ready);
ok(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length === 1), 'Service Worker danach wieder eingerichtet');
await page.goto(URL0 + '#inbox'); await page.waitForSelector('#main h1');
ok((await page.locator('#main .row-title', { hasText: 'Bleibt erhalten' }).count()) === 1, 'Daten nach Reparatur erhalten');

await browser.close();
server.close();
console.log(errors.length ? '\nFEHLER:\n' + errors.join('\n') : '\nAlle Prüfungen bestanden.');
