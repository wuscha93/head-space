const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { harden } from './helpers.mjs';
const SH = process.argv[2]; const URL = 'http://localhost:4173/';
const errors = []; const ok = (c, m) => { if (!c) errors.push('FAIL ' + m); else console.log('ok  ' + m); };
const iso = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
const page = harden(await ctx.newPage());
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(URL); await page.waitForSelector('#capture-input');
await page.click('[data-action=load-examples]');
await page.click('[data-view=next]');
const rowOf = (t) => page.locator('#main .row', { hasText: t });

// 1. Erledigen → Rückgängig-Leiste + Dialog (letzter Schritt im Projekt)
await rowOf('Velomechaniker').locator('.check').click();
await page.waitForSelector('#undo.show');
ok((await page.locator('#undo').innerText()).includes('Erledigt'), 'Rückgängig-Leiste erscheint');
ok(await page.locator('form[data-form=next-step]').isVisible(), 'Dialog „Nächster Schritt“ bei letztem Projektschritt');
const ub = await page.locator('#undo').boundingBox();
ok(ub.y < 100, 'Leiste oben, solange der Dialog offen ist');
await page.screenshot({ path: SH + '/u1-nextstep.png' });
await page.click('[data-action=undo]');
ok(await page.locator('#modal').isHidden(), 'Rückgängig schliesst den Dialog');
ok((await rowOf('Velomechaniker').count()) === 1, 'Rückgängig: Aufgabe wieder offen');
ok((await rowOf('Velomechaniker').locator('.due').innerText()).length > 0, 'Rückgängig: Frist erhalten');

// Leiste verschwindet nach 3 Sekunden
await rowOf('Velomechaniker').locator('.check').click();
await page.waitForSelector('#undo.show');
await page.waitForTimeout(3400);
ok(!(await page.locator('#undo').evaluate((e) => e.classList.contains('show'))), 'Leiste nach 3 Sekunden weg');
ok(await page.locator('form[data-form=next-step]').isVisible(), 'Dialog bleibt offen');
await page.fill('#ns-title', 'Kette ölen'); await page.selectOption('#ns-ctx', '@Zuhause'); await page.fill('#ns-due', iso(5));
await page.click('form[data-form=next-step] button[type=submit]');
ok((await rowOf('Kette ölen').count()) === 1, 'Neuer Schritt in Nächste Schritte');
ok((await rowOf('Kette ölen').locator('.ctx-badge').getAttribute('title')) === 'Zuhause', 'Neuer Schritt: Kontext');
ok((await rowOf('Kette ölen').locator('.chip.proj').count()) === 1, 'Neuer Schritt gehört zum Projekt');

// 2. Übernehmen eines vorhandenen Projekteintrags
await page.click('[data-view=projects]'); await page.click('#main .row-title');
await page.fill('#step-input', 'Licht testen'); await page.keyboard.press('Enter');
await page.locator('#main .row-title', { hasText: 'Licht testen' }).click();
await page.selectOption('#e-list', 'someday'); await page.click('form[data-form=edit] button[type=submit]');
await page.locator('#main .row', { hasText: 'Kette ölen' }).locator('.check').click();
await page.waitForSelector('[data-action=promote]');
ok((await page.locator('[data-action=promote]').innerText()).includes('Licht testen'), 'Dialog bietet Projekteintrag an');
await page.click('[data-action=promote]');
ok((await page.locator('#main .row', { hasText: 'Licht testen' }).locator('.check').count()) === 1, 'Übernommen als nächster Schritt');
ok((await page.locator('.callout.warn').count()) === 0, 'Projekt nicht mehr ohne Schritt');

// Nicht-letzter Schritt: kein Dialog
await page.fill('#step-input', 'Reifen kaufen'); await page.keyboard.press('Enter');
await page.locator('#main .row', { hasText: 'Reifen kaufen' }).locator('.check').click();
await page.waitForSelector('#undo.show');
ok(await page.locator('#modal').isHidden(), 'Kein Dialog, wenn noch Schritte offen sind');

// 3. Feste Plätze
await page.click('[data-view=inbox]');
await page.fill('#capture-input', 'Rechnung bezahlen'); await page.keyboard.press('Enter');
await page.locator('#main .row-title', { hasText: 'Rechnung' }).click();
await page.selectOption('#e-list', 'next'); await page.selectOption('#e-ctx', '@Telefon'); await page.fill('#e-tickler', iso(0));
await page.click('form[data-form=edit] button[type=submit]');
await page.click('[data-view=next]');
await page.click('.filter[data-ctx="all"]');
const box = async (t, sel) => (await rowOf(t).locator(sel).boundingBox())?.x;
const a1 = await box('Rechnung', '.slot-ctx'), a2 = await box('Licht testen', '.slot-ctx');
const d1 = await box('Rechnung', '.slot-due'), d2 = await box('Licht testen', '.slot-due');
const r1 = await box('Rechnung', '.slot-rest'), r2 = await box('Licht testen', '.slot-rest');
ok(a1 === a2 && d1 === d2 && r1 === r2, `Plätze gleich ausgerichtet (Kontext ${a1}/${a2}, Fällig ${d1}/${d2}, Projekt ${r1}/${r2})`);
ok((await rowOf('Rechnung').locator('.slot-rem .chip').count()) === 1, 'Erinnerung im eigenen Platz');
await page.screenshot({ path: SH + '/u2-slots.png' });

// 4. Kalendersymbol: Frist direkt setzen
const dueBtn = rowOf('Rechnung').locator('button.due');
await dueBtn.click();
ok(await page.locator('#modal').isHidden(), 'Kalender öffnet Auswahl, nicht den Bearbeiten-Dialog');
await rowOf('Rechnung').locator('.due-input').evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, iso(1));
ok((await rowOf('Rechnung').locator('button.due').innerText()).trim().length > 0, 'Frist sofort gespeichert');
ok((await page.locator('#undo').innerText()).includes('Fällig am'), 'Rückgängig für Friständerung');
await page.click('[data-action=undo]');
ok((await rowOf('Rechnung').locator('button.due').innerText()).trim() === '', 'Friständerung rückgängig');
await page.reload(); await page.waitForSelector('#main h1');
ok((await rowOf('Rechnung').locator('button.due-none').count()) === 1, 'Rückgängig auch nach Neuladen');

// Fallback, wenn showPicker nicht geht
await page.evaluate(() => { HTMLInputElement.prototype.showPicker = () => { throw new Error('blocked'); }; });
await rowOf('Rechnung').locator('button.due').click();
await page.waitForSelector('form[data-form=due]');
await page.click('[data-action=due-quick][data-date="' + iso(1) + '"]');
ok((await rowOf('Rechnung').locator('button.due').innerText()).trim().length > 0, 'Ersatzdialog: Morgen gesetzt');
await rowOf('Rechnung').locator('button.due').click();
await page.click('[data-action=due-clear]');
ok((await rowOf('Rechnung').locator('button.due-none').count()) === 1, 'Ersatzdialog: Frist entfernt');

// Projekt-Frist direkt
await page.click('[data-view=projects]');
await page.locator('#main .row button.due').first().click();
await page.click('[data-action=due-quick][data-date="' + iso(7) + '"]');
ok((await page.locator('#main .row button.due').first().innerText()).trim().length > 0, 'Projekt-Frist direkt gesetzt');

// Bearbeiten → Erledigt: auch mit Rückgängig
await page.click('[data-view=next]');
await rowOf('Rechnung').locator('.row-title').click();
await page.selectOption('#e-list', 'done'); await page.fill('#e-title', 'Rechnung bezahlt');
await page.click('form[data-form=edit] button[type=submit]');
ok((await page.locator('#undo').innerText()).includes('Erledigt'), 'Erledigt über Bearbeiten: Rückgängig');
await page.click('[data-action=undo]');
ok((await rowOf('Rechnung bezahlen').count()) === 1, 'Rückgängig stellt auch Titel wieder her');

// 5. Handy
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const p2 = harden(await ctx2.newPage()); p2.on('pageerror', (e) => errors.push('p2: ' + e.message));
await p2.goto(URL); await p2.waitForSelector('#capture-input');
await p2.click('[data-action=load-examples]');
await p2.click('.menu-btn'); await p2.click('.nav-item[data-view=waiting]');
await p2.locator('#main .check').first().click();
await p2.waitForSelector('#undo.show');
const u = await p2.locator('#undo').boundingBox(); const f = await p2.locator('.fab:not(.fab-mic)').boundingBox();
ok(u.x + u.width <= f.x, 'Handy: Leiste verdeckt den Plus-Knopf nicht');
await p2.screenshot({ path: SH + '/u3-phone-undo.png' });
await p2.click('[data-action=undo]');
await p2.click('.menu-btn'); await p2.click('.nav-item[data-view=next]');
await p2.screenshot({ path: SH + '/u4-phone-next.png' });
ok(await p2.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Handy: kein horizontales Scrollen');

const ctx3 = await browser.newContext({ viewport: { width: 1180, height: 820 }, colorScheme: 'dark' });
const p3 = harden(await ctx3.newPage()); await p3.goto(URL); await p3.waitForSelector('#capture-input');
await p3.click('[data-action=load-examples]'); await p3.click('[data-view=waiting]');
await p3.locator('#main .check').first().click(); await p3.waitForSelector('#undo.show');
await p3.screenshot({ path: SH + '/u5-dark.png' });
await browser.close();
console.log(errors.length ? '\nFEHLER:\n' + errors.join('\n') : '\nAlle Prüfungen bestanden.');
