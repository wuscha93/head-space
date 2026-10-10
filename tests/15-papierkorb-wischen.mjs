// Papierkorb-Ablauf in der Oberfläche und Wischen in der Projektansicht auf dem iPad (neben dem Griff ⋮⋮)
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { harden } from './helpers.mjs';
const SH = process.argv[2]; const URL = 'http://localhost:4173/test/';
const errors = []; const ok = (c, m) => { if (!c) errors.push('FAIL ' + m); else console.log('ok  ' + m); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });
const page = harden(await ctx.newPage());
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const cdp = await ctx.newCDPSession(page);
const rowOf = (t) => page.locator('#main li.row', { has: page.locator('.row-title', { hasText: t }) });
const go = async (hash) => { await page.goto(URL + hash); await page.waitForSelector('#main h1, #main .back'); };

/** Echte Touch-Geste über das Chrome-Protokoll: Finger auf (x, y), um (dx, dy) ziehen */
async function touch(x, y, dx, dy) {
  const tp = (xx, yy) => [{ x: xx, y: yy, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(x, y) });
  for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(x + (dx * i) / 10, y + (dy * i) / 10) }); await page.waitForTimeout(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(350);
}
const swipeLeft = async (t) => { const b = await rowOf(t).locator('.row-title').boundingBox(); await touch(b.x + b.width / 2, b.y + b.height / 2, -150, 0); };

// 1. Projektansicht (iPad): Wischen auf der Karte öffnet „Löschen“, der Griff verschiebt
await go('#projects'); await page.locator('#main .row-title', { hasText: 'Velo winterfit' }).tap(); await page.waitForSelector('#step-input');
await swipeLeft('Kette ölen');
ok((await page.locator('#main li.row.swipe-open').count()) === 1, 'Projekt: Wischen auf der Karte zeigt „Löschen“');
await page.locator('#main li.row.swipe-open .swipe-del').tap(); await page.waitForTimeout(200);
ok((await rowOf('Kette ölen').count()) === 0 && await page.locator('#undo.show').isVisible(), 'Projekt: gelöscht mit Rückgängig');
await page.locator('[data-action=undo]').tap(); await page.waitForTimeout(200);
ok((await rowOf('Kette ölen').count()) === 1, 'Projekt: Rückgängig holt den Schritt zurück');
const order = async () => (await page.locator('[data-sortable] .row-title').allInnerTexts()).map((t) => t.split(' ')[0]);
const before = await order();
const h = await rowOf(before[1]).locator('.drag-handle').boundingBox();
const top = await rowOf(before[0]).boundingBox();
await touch(h.x + h.width / 2, h.y + h.height / 2, 0, top.y - h.y - 10);
ok((await order())[0] === before[1], `Griff verschiebt (${(await order()).join(',')})`);
ok((await page.locator('#main li.row.swipe-open').count()) === 0, 'Ziehen am Griff öffnet kein „Löschen“');
ok((await page.locator('#main [data-action=project-seq]').count()) === 0, 'Keine Wahl „Alle / Nur die nächste“');

// 2. Papierkorb: hineinlegen, Rückgängig, wieder hinein, zurückholen, leeren
await go('#next');
await rowOf('Altglas').locator('.row-title').tap(); await page.waitForSelector('#e-title');
await page.locator('[data-action=trash]').tap(); await page.waitForTimeout(200);
ok((await rowOf('Altglas').count()) === 0, 'In den Papierkorb gelegt');
await page.locator('[data-action=undo]').tap(); await page.waitForTimeout(200);
ok((await rowOf('Altglas').count()) === 1, 'Rückgängig');
await swipeLeft('Altglas'); await page.locator('#main li.row.swipe-open .swipe-del').tap(); await page.waitForTimeout(3400);
await go('#done');
ok((await rowOf('Altglas').count()) === 1, 'Liegt im Papierkorb');
await rowOf('Altglas').locator('[data-action=restore]').tap(); await page.waitForTimeout(200);
await go('#next');
ok((await rowOf('Altglas').count()) === 1, 'Zurückgeholt: wieder in Nächste Schritte');
await swipeLeft('Altglas'); await page.locator('#main li.row.swipe-open .swipe-del').tap(); await page.waitForTimeout(3400);
await go('#done');
await page.locator('[data-action=empty-trash]').tap();
ok((await page.locator('#modal').innerText()).includes('endgültig'), 'Leeren fragt nach');
await page.locator('#modal [data-action=confirm]').tap(); await page.waitForTimeout(200);
ok((await rowOf('Altglas').count()) === 0, 'Papierkorb geleert');
await page.reload(); await page.waitForSelector('#main h1');
ok((await rowOf('Altglas').count()) === 0, 'Bleibt weg nach Neuladen');

// 3. Projekt löschen: nur in der Projektansicht, mit Bestätigung, inkl. aller Aufgaben
await go('#projects');
ok((await page.locator('#main li.row .swipe-del').count()) === 0, 'Projektliste: kein Wischen');
await page.locator('#main .row-title', { hasText: 'Ferien Tessin' }).tap(); await page.waitForSelector('[data-action=delete-project]');
await page.locator('[data-action=delete-project]').tap();
ok((await page.locator('#modal').innerText()).includes('endgültig'), 'Projekt löschen fragt nach');
await page.locator('#modal [data-action=close].btn').tap();
ok((await page.locator('#main h1').innerText()).includes('Ferien'), 'Abbrechen lässt das Projekt bestehen');
await page.locator('[data-action=delete-project]').tap(); await page.locator('#modal [data-action=confirm]').tap(); await page.waitForTimeout(200);
await go('#projects');
ok((await page.locator('#main .row-title', { hasText: 'Ferien Tessin' }).count()) === 0, 'Projekt gelöscht');
await go('#next');
ok((await rowOf('Hotel in Ascona').count()) === 0 && (await rowOf('Zugverbindung').count()) === 0, 'Aufgaben des Projekts gelöscht');
await go('#done');
ok((await rowOf('Hotel in Ascona').count()) === 0, 'Nicht im Papierkorb (endgültig)');
await page.screenshot({ path: SH + '/pk-papierkorb.png' });

await browser.close();
if (errors.length) { console.log(errors.join('\n')); process.exit(1); }
console.log('Alle Prüfungen bestanden');
