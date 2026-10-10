// 0.9: Handy kompakt (Variante A), Symbole im Kontext-Platz, gleich grosse Felder im Bearbeiten-Dialog
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { harden } from './helpers.mjs';
const SH = process.argv[2]; const URL = 'http://localhost:4173/test/';
const errors = []; const ok = (c, m) => { if (!c) errors.push('FAIL ' + m); else console.log('ok  ' + m); };

const browser = await chromium.launch();
const phone = harden(await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })).newPage());
phone.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const rowOf = (p, t) => p.locator('#main li.row', { has: p.locator('.row-title', { hasText: t }) });
const go = async (p, hash) => { await p.goto(URL + hash); await p.waitForSelector('#main .row'); };
const centers = (loc) => loc.evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height > 0).map((e) => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; }));

// 1. Nächste Schritte: eine Zeile unter dem Titel, Symbol und Frist auf gleicher Höhe, blasse Fahne bleibt
await go(phone, '#next');
const zahn = rowOf(phone, 'Zahnarzt');
const c1 = await centers(zahn.locator('.row-meta .slot-ctx .ico, .row-meta .slot-due .due'));
ok(c1.length === 2 && Math.abs(c1[0] - c1[1]) <= 1.5, `Kontext-Symbol und Frist auf einer Linie (${c1.map((c) => c.toFixed(1))})`);
const h = (await zahn.boundingBox()).height;
ok(h <= 80, `Kompakte Karte (${Math.round(h)} px hoch)`);
ok((await rowOf(phone, 'Altglas').locator('.due-none').isVisible()), 'Blasse Fahne bleibt (Frist direkt setzen)');
ok((await phone.locator('#main .cap').count()) === 0, 'Keine Titel über den Daten');
await phone.screenshot({ path: SH + '/k1-handy-naechste.png' });

// Notiz als Symbol
const kette = rowOf(phone, 'Kette ölen');
ok(await kette.locator('.note-ico').isVisible() && !(await kette.locator('.note-chip').isVisible()), 'Notiz als Symbol statt Text');

// 2. Warten auf: Sanduhr mit Name, kein „wartet auf …“, Nachfassen gleiche Box wie Fällig
await go(phone, '#waiting');
const lisa = rowOf(phone, 'Antwort von Lisa');
ok(await lisa.locator('.ctx-wait .wait-who').isVisible() && (await lisa.locator('.wait-who').innerText()) === 'Lisa', 'Sanduhr mit Name der Person');
ok(!(await lisa.locator('.wait-chip').isVisible()), 'Kein zusätzliches „wartet auf Lisa“');
ok((await lisa.locator('.slot-rem .due.rem svg').count()) === 1, 'Nachfassen mit Glocke in eigener Box');
const c2 = await centers(lisa.locator('.row-meta .slot-ctx .ico, .row-meta .slot-due .due, .row-meta .slot-rem .due'));
ok(Math.max(...c2) - Math.min(...c2) <= 1.5, 'Sanduhr, Fahne und Glocke auf einer Linie');
await phone.screenshot({ path: SH + '/k2-handy-warten.png' });

// 3. Ohne Kontext: Fragezeichen; Erst ab: Mond
await go(phone, '#someday');
ok((await rowOf(phone, 'Kochkurs').locator('.ctx-none').count()) === 1, 'Ohne Kontext: Fragezeichen');
await go(phone, '#tickler');
ok((await phone.locator('#main .due.rem.rem-defer').count()) > 0, '„Erst ab“ in gleicher Box (Mond)');
ok(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Kein horizontales Scrollen');

// 4. Bearbeiten-Dialog (iPad): alle Felder unter den Notizen gleich hoch, zwei gleich breite Spalten
const ipad = harden(await (await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true })).newPage());
await go(ipad, '#waiting');
await rowOf(ipad, 'Antwort von Lisa').locator('.row-title').tap(); await ipad.waitForSelector('#e-due');
const boxes = await ipad.locator('#modal .grid2 input, #modal .grid2 select').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
ok(boxes.length === 6, `Sechs Felder (${boxes.length})`);
ok(new Set(boxes.map((b) => b[1])).size === 1, `Alle gleich hoch (${boxes.map((b) => b[1]).join(', ')})`);
ok(new Set(boxes.map((b) => b[0])).size === 1, `Alle gleich breit (${boxes.map((b) => b[0]).join(', ')})`);
await ipad.waitForTimeout(400); await ipad.screenshot({ path: SH + '/k3-bearbeiten-ipad.png' });

await browser.close();
if (errors.length) { console.log(errors.join('\n')); process.exit(1); }
console.log('Alle Prüfungen bestanden');
