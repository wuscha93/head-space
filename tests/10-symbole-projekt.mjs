// Kontext-Symbole, Orange für „bald fällig“, Projektansicht nach Frist,
// Kalender übernimmt das Datum beim ersten Mal (auch wenn das Gerät nur „input“ meldet, wie iPad/Safari)
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { harden } from './helpers.mjs';
const SH = process.argv[2]; const URL = 'http://localhost:4173/test/';
const errors = []; const ok = (c, m) => { if (!c) errors.push('FAIL ' + m); else console.log('ok  ' + m); };

const browser = await chromium.launch();
// Handy mit echten Touch-Ereignissen
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const page = harden(await ctx.newPage());
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(URL); await page.waitForSelector('#main .view-head, #main h1');
const rowOf = (t) => page.locator('#main li.row', { has: page.locator('.row-title', { hasText: t }) });

// 1. Nächste Schritte: Symbole statt „@Text“
await page.goto(URL + '#next'); await page.waitForSelector('#main .row');
const main = await page.locator('#main').innerText();
ok(!main.includes('@'), 'Kein „@“ mehr in der Ansicht Nächste Schritte');
ok((await rowOf('Zahnarzt').locator('.ctx-badge svg.ico-telefon').count()) === 1, 'Karte: Telefon-Symbol');
ok((await rowOf('Zahnarzt').locator('.ctx-badge').getAttribute('title')) === 'Telefon', 'Karte: Name als Hinweis');
ok((await rowOf('Altglas').locator('svg.ico-unterwegs').count()) === 1, 'Karte: Unterwegs-Symbol (Zug)');
const sz = await rowOf('Zahnarzt').locator('.ctx-badge svg').boundingBox();
ok(sz.width >= 21 && sz.width <= 24, `Symbol etwas grösser als vorher (${sz.width}px)`);
ok((await page.locator('.filter[data-ctx="@Computer"] svg.ico-computer').count()) === 1, 'Filter: Computer-Symbol');

// Abschnittstitel: Symbol und Name auf einer Linie (vertikal mittig)
const h = page.locator('h2.section', { has: page.locator('.ico-computer') });
ok((await h.innerText()).trim().toLowerCase() === 'computer', 'Abschnitt heisst „Computer“ ohne @');
const [ib, tb] = await Promise.all([h.locator('svg').boundingBox(), h.locator('.ctx-name').boundingBox()]);
const dy = Math.abs((ib.y + ib.height / 2) - (tb.y + tb.height / 2));
ok(dy <= 1.5, `Symbol und Name auf einer Linie (Abweichung ${dy.toFixed(1)}px)`);
ok(Math.abs(ib.x + ib.width - tb.x) < 14, 'Name direkt neben dem Symbol');
await page.screenshot({ path: SH + '/s1-next.png' });

// Filter tippen
await page.locator('.filter[data-ctx="@Telefon"]').tap();
ok((await page.locator('#main .row').count()) === 3, 'Filter Telefon per Tippen');

// 2. Orange für „bald fällig“ (morgen / in 2 Tagen), Rot bleibt für heute
await page.goto(URL + '#due'); await page.waitForSelector('#main .row');
const col = async (t) => rowOf(t).locator('.due').evaluate((el) => getComputedStyle(el).color);
ok(await col('Velomechaniker') === 'rgb(166, 86, 0)', 'Bald fällig: Orange');
ok(await col('Zahnarzt') === 'rgb(220, 50, 47)', 'Heute: weiterhin Rot');

// 3. Projektansicht: früheste Frist zuoberst, ohne Datum danach
await page.goto(URL + '#projects'); await page.waitForSelector('#main .row');
await page.locator('#main .row-title', { hasText: 'Wohnzimmer' }).tap();
await page.waitForSelector('#step-input');
const titles = await page.locator('#main .row .row-title').allInnerTexts();
ok(titles[0].includes('Abdeckband') && titles[1].includes('Farbmuster'), 'Projekt: mit Frist zuerst, ohne Datum danach');

// 4. Kalender: Gerät meldet nur „input“ (kein „change“) → Datum trotzdem beim ersten Mal übernommen
await page.evaluate(() => { HTMLInputElement.prototype.showPicker = function () { window.__picker = this; }; });
const pick = async (title, value, events) => {
  await rowOf(title).locator('[data-action=due-pick]').tap();
  await page.evaluate(([v, evs]) => {
    const el = window.__picker; el.value = v;
    for (const e of evs) el.dispatchEvent(new Event(e, { bubbles: true }));
  }, [value, events]);
};
const iso = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
await pick('Farbmuster', iso(1), ['input']);
ok((await rowOf('Farbmuster').locator('.due').innerText()).trim().length > 0, 'Datum nach erstem Mal übernommen (nur input)');
ok(await page.locator('#undo.show').isVisible(), 'Rückgängig angeboten');
const titles2 = await page.locator('#main .row .row-title').allInnerTexts();
ok(titles2[0].includes('Farbmuster'), 'Neu sortiert: frühere Frist nach oben');
await page.screenshot({ path: SH + '/s2-projekt.png' });

// input + change hintereinander: nur eine Änderung
const before = await page.evaluate(() => window.kopfFrei.eventCount());
await pick('Abdeckband', iso(4), ['input', 'change']);
ok((await rowOf('Abdeckband').locator('.due').innerText()).includes('.'), 'Datum übernommen (input + change)');
const after = await page.evaluate(() => window.kopfFrei.eventCount());
ok(after - before === 1, 'input + change speichert nur einmal');

// Fokus im Datumsfeld (Rad-Auswahl): erst beim Verlassen übernehmen, damit die Auswahl nicht unterbrochen wird
await rowOf('Abdeckband').locator('[data-action=due-pick]').tap();
await page.evaluate((v) => {
  const el = window.__picker; el.style.pointerEvents = 'auto'; el.focus(); el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, iso(6));
ok(await page.evaluate(() => document.activeElement === window.__picker && document.contains(window.__picker)), 'Während der Auswahl wird nicht neu gezeichnet');
await page.evaluate(() => window.__picker.blur());
ok((await rowOf('Abdeckband').locator('.due').getAttribute('title')).includes('.'), 'Beim Verlassen übernommen');
const t3 = await rowOf('Abdeckband').locator('.due').getAttribute('aria-label');
ok(t3.includes(new Date(iso(6)).getDate() + '.'), `Gewähltes Datum gespeichert (${t3})`);

// 5. Auswahlfelder und Einstellungen ohne @
const opts = await page.locator('#step-ctx option').allInnerTexts();
ok(opts.includes('Telefon') && !opts.some((o) => o.includes('@')), 'Auswahlfeld Kontext ohne @');
await page.goto(URL + '#settings'); await page.waitForSelector('.ctx-list');
ok(!(await page.locator('.ctx-list').innerText()).includes('@'), 'Einstellungen: Kontexte ohne @');
ok((await page.locator('.ctx-list svg.ico-besprechung').count()) === 1, 'Einstellungen: Besprechung-Symbol');
await page.fill('#ctx-input', 'Garten'); await page.keyboard.press('Enter');
await page.waitForSelector('.ctx-list svg.ico-tag');
ok((await page.locator('.ctx-list').innerText()).includes('Garten'), 'Eigener Kontext mit Etikett-Symbol');
await page.screenshot({ path: SH + '/s3-einstellungen.png' });

await browser.close();
if (errors.length) { console.log(errors.join('\n')); process.exit(1); }
console.log('Alle Prüfungen bestanden');
