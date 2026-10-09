// Klären: einzelner Eintrag vs. ganze Inbox, keine automatisch geöffnete Datumsauswahl
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { harden } from './helpers.mjs';
const SH = process.argv[2]; const URL = 'http://localhost:4173/';
const errors = []; const ok = (c, m) => { if (!c) errors.push('FAIL ' + m); else console.log('ok  ' + m); };

const browser = await chromium.launch();
// iPad-ähnlich: Touch, Datumsfelder öffnen beim Fokussieren den Kalender
const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });
const page = harden(await ctx.newPage());
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(URL); await page.waitForSelector('#capture-input');
for (const t of ['Erster', 'Zweiter', 'Dritter']) { await page.fill('#capture-input', t); await page.keyboard.press('Enter'); }
const focusedType = () => page.evaluate(() => { const a = document.activeElement; return a ? `${a.tagName.toLowerCase()}:${a.getAttribute('type') ?? ''}` : ''; });
const rowClarify = (t) => page.locator('#main li.row', { has: page.locator('.row-title', { hasText: t }) }).locator('[data-action=clarify]');

// 1. „Klären“ bei einem Eintrag klärt nur diesen
await rowClarify('Zweiter').tap();
await page.waitForSelector('[data-step=not]');
ok((await page.locator('#clarify-title').inputValue()) === 'Zweiter', 'Klären öffnet genau diesen Eintrag');
ok(!(await page.locator('.sheet-head .eyebrow').innerText()).toLowerCase().includes('von'), 'Kein „x von y“ beim einzelnen Eintrag');
ok((await page.locator('[data-action=clarify-skip]').count()) === 0, 'Kein „Überspringen“ beim einzelnen Eintrag');

// 2. „Nein“: nichts vorausgewählt, Datumsfeld nicht fokussiert (sonst öffnet das iPad den Kalender)
await page.locator('[data-step=not]').tap();
await page.waitForSelector('#someday-date');
ok(!(await focusedType()).endsWith(':date'), `Nach „Nein“ ist kein Datumsfeld fokussiert (${await focusedType()})`);
await page.screenshot({ path: SH + '/k1-nein.png' });
await page.locator('[data-action=clarify-reference]').tap();
await page.waitForTimeout(300);
ok(await page.locator('#modal').isHidden(), 'Nach der Entscheidung: Dialog zu, nicht der nächste Eintrag');
ok((await page.locator('#main .row-title').allInnerTexts()).join(',') === 'Erster,Dritter', 'Die anderen Einträge bleiben in der Inbox');
ok((await page.locator('#undo').innerText()).includes('Referenz'), 'Rückgängig-Leiste zur Entscheidung');

// 3. Auch im Schritt „Nächster Schritt“ kein fokussiertes Datumsfeld
await rowClarify('Erster').tap();
await page.locator('[data-step=multi]').tap(); await page.locator('[data-step=twomin]').tap();
await page.locator('[data-step=who]').tap(); await page.locator('[data-step=next]').tap();
await page.waitForSelector('#n-due');
ok(!(await focusedType()).endsWith(':date'), `Schritt „Nächster Schritt“: kein Datumsfeld fokussiert (${await focusedType()})`);
await page.locator('form[data-form=clarify-next] button[type=submit]').tap();
await page.waitForTimeout(300);
ok(await page.locator('#modal').isHidden(), 'Einzelner Eintrag als nächster Schritt abgelegt, Dialog zu');
ok((await page.locator('h1').innerText()) === 'Inbox', 'Man bleibt in der Inbox');

// 4. „Klären starten“ geht weiterhin alle der Reihe nach durch
await page.fill('#capture-input', 'Vierter'); await page.keyboard.press('Enter');
await page.locator('[data-action=clarify-first]').tap();
await page.waitForSelector('[data-step=not]');
ok((await page.locator('.sheet-head .eyebrow').innerText()).toLowerCase().includes('1 von 2'), '„Klären starten“: Durchgang mit Zähler');
await page.locator('[data-step=not]').tap(); await page.locator('[data-action=clarify-reference]').tap();
await page.waitForSelector('#clarify-title');
ok((await page.locator('.sheet-head .eyebrow').innerText()).toLowerCase().includes('1 von 1'), '„Klären starten“: danach automatisch der nächste');

await browser.close();
console.log(errors.length ? '\nFEHLER:\n' + errors.join('\n') : '\nAlle Prüfungen bestanden.');
