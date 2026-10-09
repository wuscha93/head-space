// Trennung von Live- und Test-App (gleiche Domain, wie auf GitHub Pages)
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { harden } from './helpers.mjs';
const SH = process.argv[2];
const LIVE = 'http://localhost:4173/';
const TEST = 'http://localhost:4173/test/';
const errors = []; const ok = (c, m) => { if (!c) errors.push('FAIL ' + m); else console.log('ok  ' + m); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1180, height: 860 } });
const page = harden(await ctx.newPage());
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

// Live: eigener Eintrag, dunkle Darstellung, Service Worker aktiv
await page.goto(LIVE); await page.waitForSelector('#capture-input');
await page.fill('#capture-input', 'LIVE-EINTRAG'); await page.keyboard.press('Enter');
await page.click('[data-view=settings]'); await page.click('[data-action=theme][data-value=dark]');
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload(); await page.waitForSelector('#main h1');
ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'Live: Service Worker aktiv');
ok((await page.locator('.env-strip').count()) === 0 && (await page.title()) === 'Kopf frei', 'Live: kein Test-Hinweis, Titel „Kopf frei“');

// Test-App: wird NICHT vom Live-Service-Worker übernommen
await page.goto(TEST); await page.waitForSelector('#main h1');
ok((await page.title()) === 'Kopf frei TEST', 'Test-App lädt ihre eigene Seite (Titel „Kopf frei TEST“)');
ok((await page.locator('.env-strip').innerText()).includes('TEST-UMGEBUNG'), 'Test-App: deutlicher Hinweis oben');
ok((await page.locator('.brand').first().innerText()).includes('TEST'), 'Test-App: Name in der Seitenleiste');
await page.click('[data-view=next]');
ok((await page.locator('#main .row-title', { hasText: 'Velomechaniker' }).count()) === 1, 'Test-App: startet mit Beispieldaten');
await page.click('[data-view=inbox]');
ok((await page.locator('#main .row-title', { hasText: 'LIVE-EINTRAG' }).count()) === 0, 'Test-App sieht keine Live-Daten');
ok((await page.evaluate(() => document.documentElement.dataset.theme)) === undefined, 'Test-App: eigene Einstellungen (Darstellung nicht von Live übernommen)');
await page.fill('#capture-input', 'TEST-EINTRAG'); await page.keyboard.press('Enter');
await page.evaluate(() => navigator.serviceWorker.ready);
const scopes = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => new URL(r.scope).pathname).sort());
ok(JSON.stringify(scopes) === JSON.stringify(['/', '/test/']), `Zwei getrennte Service Worker (${scopes.join(', ')})`);

// Sync in der Test-App abgeschaltet
await page.click('[data-view=settings]');
ok((await page.locator('#sync').innerText()).includes('abgeschaltet') && (await page.locator('#sync-owner').count()) === 0, 'Test-App: Sync abgeschaltet, kein Formular');
await page.screenshot({ path: SH + '/t1-test-settings.png', fullPage: true });

// Backup aus der Test-App wird von Live abgelehnt
await page.fill('#pass1', 'test-passphrase-1'); await page.fill('#pass2', 'test-passphrase-1');
await page.click('form[data-form=export] button[type=submit]');
await page.waitForSelector('#backup-text', { timeout: 20000 });
const testBackup = await page.inputValue('#backup-text');

// Zurück zu Live: Live-Daten unverändert, keine Test-Daten
await page.goto(LIVE); await page.waitForSelector('#main h1');
await page.click('[data-view=inbox]');
ok((await page.locator('#main .row-title', { hasText: 'LIVE-EINTRAG' }).count()) === 1, 'Live: eigener Eintrag noch da');
ok((await page.locator('#main .row-title', { hasText: 'TEST-EINTRAG' }).count()) === 0, 'Live: kein Test-Eintrag');
await page.click('[data-view=next]');
ok((await page.locator('#main .row-title', { hasText: 'Velomechaniker' }).count()) === 0, 'Live: keine Beispieldaten');
ok((await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'Live: Darstellung unverändert');
await page.click('[data-view=settings]');
await page.click('#import-text-toggle, details:has(#import-text) summary');
await page.fill('#import-text', testBackup); await page.fill('#import-pass', 'test-passphrase-1');
await page.click('form[data-form=import] button[type=submit]');
await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Test-App'), null, { timeout: 20000 });
ok(true, 'Live lehnt Backup aus der Test-App ab');

// Getrennte Datenbanken und Caches; Live räumt die Test-Caches nicht weg
const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name).sort());
ok(dbs.includes('kopf-frei') && dbs.includes('kopf-frei-test'), `Getrennte Datenbanken (${dbs.join(', ')})`);
const cacheNames = await page.evaluate(() => caches.keys());
ok(cacheNames.some((k) => /^kopf-frei-\d+$/.test(k)) && cacheNames.some((k) => /^kopf-frei-test-\d+$/.test(k)), `Getrennte Caches (${cacheNames.join(', ')})`);

// Test-App zurücksetzen: nur Test-Daten weg, Live unberührt
await page.goto(TEST); await page.waitForSelector('#main h1');
await page.click('[data-view=settings]');
await Promise.all([page.waitForEvent('load'), (async () => { await page.click('[data-action=test-reset]'); await page.click('[data-action=confirm]'); })()]);
await page.waitForSelector('#main h1');
await page.click('[data-view=inbox]');
ok((await page.locator('#main .row-title', { hasText: 'TEST-EINTRAG' }).count()) === 0, 'Test-App zurückgesetzt: eigener Eintrag weg');
await page.click('[data-view=next]');
ok((await page.locator('#main .row-title', { hasText: 'Velomechaniker' }).count()) === 1, 'Test-App zurückgesetzt: frische Beispieldaten');
await page.goto(LIVE); await page.waitForSelector('#main h1');
await page.click('[data-view=inbox]');
ok((await page.locator('#main .row-title', { hasText: 'LIVE-EINTRAG' }).count()) === 1, 'Live nach Zurücksetzen der Test-App unberührt');

// Handy-Ansicht der Test-App
const phone = harden(await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage());
await phone.goto(TEST + '#next'); await phone.waitForSelector('#main .row');
await phone.screenshot({ path: SH + '/t2-test-phone.png' });
ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Test-App Handy: kein horizontales Scrollen');

await browser.close();
console.log(errors.length ? '\nFEHLER:\n' + errors.join('\n') : '\nAlle Prüfungen bestanden.');
