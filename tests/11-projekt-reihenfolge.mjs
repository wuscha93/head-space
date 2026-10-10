// 0.8: Spracheingabe aus, Daten mit Symbol und Titel, Bearbeiten auf dem iPad, Projekt: Frist beim
// Hinzufügen, Ziehen (echte Touch-Ereignisse), Konflikt-Warnung, „Nur die nächste“
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { harden } from './helpers.mjs';
const SH = process.argv[2]; const URL = 'http://localhost:4173/test/';
const errors = []; const ok = (c, m) => { if (!c) errors.push('FAIL ' + m); else console.log('ok  ' + m); };
const iso = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

const browser = await chromium.launch();
// iPad hochkant, mit Touch
const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const page = harden(await ctx.newPage());
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const cdp = await ctx.newCDPSession(page);
const rowOf = (t) => page.locator('#main li.row', { has: page.locator('.row-title', { hasText: t }) });
const go = async (hash) => { await page.goto(URL + hash); await page.waitForSelector('#main h1'); };

/** Echte Touch-Geste: Finger auf den Griff, in Schritten nach oben/unten ziehen, loslassen */
async function touchDrag(handle, dy) {
  const b = await handle.boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  const tp = (yy) => [{ x, y: yy, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(y) });
  for (let i = 1; i <= 12; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(y + (dy * i) / 12) }); await page.waitForTimeout(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(250);
}

// 1. Spracheingabe ausgeschaltet: nirgends ein Mikrofon
await go('');
ok((await page.locator('.mic').count()) === 0, 'Inbox: kein Mikrofon');
ok(!(await page.locator('.fab-mic').isVisible()), 'Kein schwebender Mikrofon-Knopf');
await page.locator('.fab:not(.fab-mic)').tap(); await page.waitForSelector('#quick-input');
ok((await page.locator('#modal .mic').count()) === 0, 'Schnellerfassung: kein Mikrofon');
await page.locator('#modal .sheet-head [data-action=close]').tap();
await go('#settings'); await page.waitForSelector('.panel');
ok(!(await page.locator('#main').innerText()).includes('Spracheingabe'), 'Einstellungen: kein Bereich Spracheingabe');

// 2. Ereignisbox (0.9): ohne Titel, Nachfassen in derselben Box wie Fällig, Sanduhr bei „Warten auf“, alles auf einer Linie
await go('#waiting'); await page.waitForSelector('#main .row');
const lisa = rowOf('Antwort von Lisa');
ok((await lisa.locator('.cap').count()) === 0, 'Keine Titel über den Daten');
ok((await lisa.locator('.slot-ctx .ctx-wait').count()) === 1, 'Warten auf: Sanduhr im Kontext-Platz');
await lisa.locator('[data-action=due-pick]').tap();
await page.evaluate((v) => { const el = document.querySelector('.due-input'); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, iso(3));
await page.waitForSelector('#main .slot-due .due-soon');
const style = (loc) => loc.evaluate((el) => { const c = getComputedStyle(el); return [c.borderTopStyle, c.borderTopLeftRadius, c.height, c.backgroundColor === 'rgba(0, 0, 0, 0)' ? 'leer' : 'gefüllt'].join(' '); });
const fs = await style(lisa.locator('.slot-due .due')), ns = await style(lisa.locator('.slot-rem .due.rem'));
ok(fs.split(' ').slice(0, 3).join() === ns.split(' ').slice(0, 3).join() && ns.endsWith('gefüllt'), `Nachfassen gleiche Box wie Fällig (${fs} / ${ns})`);
ok(fs.includes('6px'), 'Datums-Boxen halb so stark gerundet wie die Karte');
const mids = await lisa.locator('.row-meta .slot-ctx .ico, .row-meta .slot-due .due, .row-meta .slot-rem .due').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; }));
ok(mids.length === 3 && Math.max(...mids) - Math.min(...mids) <= 1.5, `Symbol und Boxen auf einer Linie (${mids.map((m) => m.toFixed(1)).join(', ')})`);
await page.screenshot({ path: SH + '/p1-zwei-daten.png' });

// 3. Bearbeiten auf dem iPad: Datumsfelder bleiben in ihrer Spalte, Hinweis passt zur Liste
await lisa.locator('.row-title').tap(); await page.waitForSelector('#e-due');
for (const id of ['#e-due', '#e-tickler']) {
  const [f, fld] = await Promise.all([page.locator(id).boundingBox(), page.locator(id).locator('xpath=..').boundingBox()]);
  ok(f.x >= fld.x - 0.5 && f.x + f.width <= fld.x + fld.width + 0.5, `${id} bleibt in seiner Spalte`);
}
ok(await page.locator('#e-due').evaluate((el) => getComputedStyle(el).webkitAppearance === 'none' || getComputedStyle(el).appearance === 'none'), 'Datumsfeld ohne Safari-Eigenbreite');
const hint = await page.locator('#modal .hint').first().innerText();
ok(hint.includes('Nachfassen am') && !hint.includes('Erst ab'), 'Hinweis spricht von „Nachfassen am“');
await page.screenshot({ path: SH + '/p2-bearbeiten-ipad.png' });
await page.locator('#modal .sheet-head [data-action=close]').tap();

// 4. Projekt: neuer Schritt mit Frist (Fahne statt Mikrofon)
await go('#projects'); await page.locator('#main .row-title', { hasText: 'Velo winterfit' }).tap();
await page.waitForSelector('#step-input');
ok((await page.locator('form[data-form=project-step] .mic').count()) === 0, 'Projekt: kein Mikrofon');
await page.evaluate(() => { HTMLInputElement.prototype.showPicker = function () { window.__picker = this; }; });
await page.fill('#step-input', 'Licht montieren');
await page.locator('[data-action=step-due-pick]').tap();
await page.evaluate((v) => { const el = window.__picker; el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, iso(1));
ok((await page.locator('.step-due-text').innerText()).includes('.'), 'Gewählte Frist neben der Fahne');
await page.locator('form[data-form=project-step] button[type=submit]').tap();
await page.waitForSelector('#main .row-title:has-text("Licht montieren")');
ok((await rowOf('Licht montieren').locator('.slot-due .due').innerText()).includes('.'), 'Neuer Schritt hat die Frist');
ok((await page.locator('.step-due-text').innerText()) === '', 'Frist-Feld nach dem Hinzufügen leer');
const order = async () => (await page.locator('[data-sortable] .row-title').allInnerTexts()).map((t) => t.split(' ')[0]);
ok((await order()).join(',') === 'Licht,Velomechaniker,Kette', `Nach Frist eingeordnet (${(await order()).join(',')})`);
ok((await page.locator('.conflict-btn').count()) === 0, 'Nach Frist sortiert: keine Warnung');

// 5. Ziehen mit dem Finger: Velomechaniker (später fällig) nach oben → Warnung bei Licht (früher fällig)
const h = await rowOf('Velomechaniker').locator('.drag-handle').boundingBox();
const top = await rowOf('Licht montieren').boundingBox();
await touchDrag(rowOf('Velomechaniker').locator('.drag-handle'), top.y - h.y - 10);
ok((await order()).join(',') === 'Velomechaniker,Licht,Kette', `Gezogen: eigene Reihenfolge (${(await order()).join(',')})`);
ok((await rowOf('Licht montieren').locator('.conflict-btn').count()) === 1, 'Warndreieck beim früher fälligen Schritt');
ok((await rowOf('Velomechaniker').locator('.conflict-btn').count()) === 0, 'Kein Warndreieck beim anderen');
ok(await rowOf('Licht montieren').locator('.conflict-btn').evaluate((el) => getComputedStyle(el).color) === 'rgb(166, 86, 0)', 'Warndreieck orange');
await page.screenshot({ path: SH + '/p3-konflikt.png' });
await page.reload(); await page.waitForSelector('[data-sortable]');
ok((await order()).join(',') === 'Velomechaniker,Licht,Kette', 'Reihenfolge bleibt nach Neuladen');

// Erklärung
await rowOf('Licht montieren').locator('.conflict-btn').tap();
await page.waitForSelector('#modal .conflict-list');
const expl = await page.locator('#modal').innerText();
ok(expl.includes('Licht montieren') && expl.includes('Velomechaniker'), 'Erklärung nennt beide Schritte');
await page.screenshot({ path: SH + '/p4-erklaerung.png' });
await page.locator('#modal [data-action=close].btn').tap();
ok(await page.locator('#modal').isHidden(), 'Erklärung schliesst, Reihenfolge bleibt (manuell dominiert)');
ok((await order())[0] === 'Velomechaniker', 'Manuelle Reihenfolge unverändert');

// Tastatur: Pfeil runter verschiebt
await rowOf('Velomechaniker').locator('.drag-handle').focus();
await page.keyboard.press('ArrowDown');
ok((await order()).join(',') === 'Licht,Velomechaniker,Kette', 'Pfeiltaste verschiebt');

// 6. Seit 0.10 keine Wahl „Alle / Nur die nächste“ mehr: alle Schritte in Nächste Schritte
ok((await page.locator('[data-action=project-seq], .up-next').count()) === 0, 'Keine Wahl „Alle / Nur die nächste“');
await go('#next'); await page.waitForSelector('#main .row');
const nextTitles = await page.locator('#main .row-title').allInnerTexts();
ok(['Licht', 'Velomechaniker', 'Kette'].every((w) => nextTitles.some((t) => t.includes(w))), 'Nächste Schritte: alle Schritte des Projekts');

// 7. Fristen: nur Aufgaben, keine Projekte (Velo hat eine Projekt-Frist)
await go('#due'); await page.waitForSelector('#main .row');
ok((await page.locator('#main .row-title', { hasText: 'Velo winterfit' }).count()) === 0, 'Fristen: kein Projekt');
ok((await page.locator('#main .row-icon').count()) === 0, 'Fristen: keine Projekt-Zeilen');

// Handy: kein horizontales Scrollen in der Projektansicht
const phone = harden(await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage());
await phone.goto(URL + '#projects'); await phone.waitForSelector('#main .row');
await phone.locator('#main .row-title', { hasText: 'Velo winterfit' }).tap(); await phone.waitForSelector('#step-input');
ok(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Handy: kein horizontales Scrollen');
const dueTxt = phone.locator('#main li.row', { has: phone.locator('.row-title', { hasText: 'Velomechaniker' }) }).locator('.slot-due .due span');
ok(await dueTxt.evaluate((el) => el.scrollWidth <= el.clientWidth), 'Handy: Datum mit Griff nicht abgeschnitten');
await phone.screenshot({ path: SH + '/p5-projekt-handy.png', fullPage: true });

await browser.close();
if (errors.length) { console.log(errors.join('\n')); process.exit(1); }
console.log('Alle Prüfungen bestanden');
