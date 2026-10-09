const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const SH = process.argv[2];
const URL = 'http://localhost:4173/';
const errors = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const ok = (c, msg) => { if (!c) { errors.push('FAIL ' + msg); } else console.log('ok  ' + msg); };

await page.goto(URL);
await page.waitForSelector('#capture-input');
for (const t of ['Zahnarzt anrufen', 'Ferien Tessin planen', 'Offerte Fenster', 'Altes Kabel', 'Wlan-Passwort Ferienhaus', 'Segelkurs machen', 'Mail an Lisa beantworten'])
  { await page.fill('#capture-input', t); await page.keyboard.press('Enter'); }
ok((await page.locator('#main .row').count()) === 7, '7 Einträge in der Inbox');
ok((await page.inputValue('#capture-input')) === '', 'Eingabefeld nach Erfassen leer');
await page.screenshot({ path: SH + '/1-inbox.png' });

await page.click('[data-action=clarify-first]');
// 1: Zahnarzt -> ja, ein Schritt, >2min, ich, @Telefon
await page.click('[data-step=multi]'); await page.click('[data-step=twomin]'); await page.click('[data-step=who]'); await page.click('[data-step=next]');
await page.selectOption('#n-ctx', '@Telefon'); await page.click('form[data-form=clarify-next] button[type=submit]');
// 2: Ferien -> Projekt
await page.click('[data-step=multi]');
await page.screenshot({ path: SH + '/2-clarify.png' });
await page.click('[data-step=project]');
await page.fill('#p-outcome', 'Hotel und Zug gebucht'); await page.fill('#p-next', 'Hotels in Ascona vergleichen'); await page.selectOption('#p-ctx', '@Computer');
await page.click('form[data-form=clarify-project] button[type=submit]');
// 3: Offerte -> delegieren
await page.click('[data-step=multi]'); await page.click('[data-step=twomin]'); await page.click('[data-step=who]'); await page.click('[data-step=delegate]');
await page.fill('#d-who', 'Schreinerei Meier'); await page.fill('#d-date', new Date().toLocaleDateString('sv-SE'));
await page.click('form[data-form=clarify-delegate] button[type=submit]');
// 4: Kabel -> wegwerfen
await page.click('[data-step=not]'); await page.click('[data-action=clarify-trash]');
// 5: Wlan -> Referenz
await page.click('[data-step=not]'); await page.click('[data-action=clarify-reference]');
// 6: Segelkurs -> someday mit Wiedervorlage
await page.click('[data-step=not]'); await page.fill('#someday-date', '2027-03-01'); await page.click('form[data-form=clarify-someday] button[type=submit]');
// 7: Mail -> 2 Minuten, jetzt erledigt
await page.click('[data-step=multi]'); await page.click('[data-step=twomin]'); await page.click('[data-step=donow]'); await page.click('[data-action=clarify-done]');
ok(await page.locator('#modal').isHidden(), 'Klär-Dialog nach letztem Eintrag geschlossen');
ok((await page.locator('h1').innerText()) === 'Nächste Schritte', 'Danach Ansicht Nächste Schritte');
ok((await page.locator('#main .row').count()) === 2, '2 nächste Schritte');
await page.screenshot({ path: SH + '/3-next.png' });
await page.click('.filter[data-ctx="@Telefon"]');
ok((await page.locator('#main .row').count()) === 1, 'Kontextfilter @Telefon');

await page.click('[data-view=projects]');
ok((await page.locator('#main .row').count()) === 1, '1 Projekt');
await page.click('[data-action=open-project]');
await page.fill('#step-input', 'Zug reservieren'); await page.keyboard.press('Enter');
ok((await page.locator('#main .row').count()) === 2, 'Schritt im Projekt hinzugefügt');
// beide Schritte erledigen -> Projekt ohne Schritt
for (let i = 0; i < 2; i++) { await page.locator('#main .check').first().click(); await page.waitForTimeout(350); }
ok(await page.locator('form[data-form=next-step]').isVisible(), 'Letzter Schritt erledigt: Dialog für nächsten Schritt');
await page.click('[data-action=next-step-later]');
ok(await page.locator('.callout.warn').isVisible(), 'Warnung: Projekt ohne nächsten Schritt');
await page.screenshot({ path: SH + '/4-project.png' });

await page.click('[data-view=waiting]');
ok((await page.locator('.chip.due').count()) === 1, 'Warten auf: Nachfassen fällig markiert');
await page.click('[data-view=tickler]');
ok((await page.locator('#main .row').count()) === 1, 'Wiedervorlage: Segelkurs');
await page.click('[data-view=reference]');
ok((await page.locator('#main .row').count()) === 1, 'Referenz: 1');
await page.click('[data-view=done]');
ok((await page.locator('#main .rows').first().locator('.row').count()) === 3, 'Erledigt: 3');
ok((await page.locator('text=Papierkorb').count()) >= 1, 'Papierkorb sichtbar');

// Bearbeiten
await page.click('[data-view=reference]');
await page.click('#main .row-main');
await page.fill('#e-notes', 'Netz: Casa-Ticino, Passwort im Passwortmanager');
await page.click('form[data-form=edit] button[type=submit]');
ok((await page.locator('.row-notes').innerText()).includes('Casa-Ticino'), 'Notiz gespeichert');

// Neu laden -> persistiert
await page.reload(); await page.waitForSelector('#main h1');
await page.click('[data-view=reference]');
ok((await page.locator('.row-notes').count()) === 1, 'Daten nach Neuladen vorhanden');

// Schnellerfassung per Taste N
await page.keyboard.press('n');
await page.fill('#quick-input', 'Milch kaufen'); await page.keyboard.press('Enter');
await page.click('[data-view=inbox]');
ok((await page.locator('#main .row').count()) === 1, 'Schnellerfassung landet in Inbox');

// Backup
await page.click('[data-view=settings]');
await page.fill('#pass1', 'korrekt-pferd-batterie'); await page.fill('#pass2', 'korrekt-pferd-batterie');
await page.click('form[data-form=export] button[type=submit]');
await page.waitForSelector('#backup-text', { timeout: 15000 });
const backup = await page.inputValue('#backup-text');
ok(backup.includes('AES-256-GCM') && !backup.includes('Zahnarzt'), 'Backup verschlüsselt, kein Klartext');
const dl = page.waitForEvent('download');
await page.click('[data-action=download-backup]');
const d = await dl; ok(d.suggestedFilename().startsWith('kopf-frei-backup-'), 'Download: ' + d.suggestedFilename());
await d.saveAs(SH + '/backup.json');
await page.screenshot({ path: SH + '/5-settings.png', fullPage: true });

// Frisches Gerät: falsches Passwort, dann richtig
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const p2 = await ctx2.newPage();
p2.on('pageerror', (e) => errors.push('p2 pageerror: ' + e.message));
await p2.goto(URL + '#settings'); await p2.waitForSelector('#import-file');
await p2.setInputFiles('#import-file', SH + '/backup.json');
await p2.fill('#import-pass', 'falsch-falsch'); await p2.click('form[data-form=import] button[type=submit]');
await p2.waitForSelector('.toast.error.show', { timeout: 15000 });
ok((await p2.locator('#toast').innerText()).includes('Passphrase falsch'), 'Falsche Passphrase erkannt');
await p2.setInputFiles('#import-file', SH + '/backup.json');
await p2.fill('#import-pass', 'korrekt-pferd-batterie'); await p2.click('form[data-form=import] button[type=submit]');
await p2.waitForFunction(() => document.getElementById('toast').textContent.includes('wiederhergestellt'), null, { timeout: 15000 });
await p2.click('.menu-btn'); await p2.waitForTimeout(250);
await p2.screenshot({ path: SH + '/6-phone-nav.png' });
await p2.click('.nav-item[data-view=inbox]');
ok((await p2.locator('#main .row').count()) === 1, 'Wiederhergestellt auf neuem Gerät (Inbox 1)');
await p2.click('[data-action=clarify-first]'); await p2.waitForTimeout(250);
await p2.screenshot({ path: SH + '/7-phone-clarify.png' });

// Dark mode
const ctx3 = await browser.newContext({ viewport: { width: 1180, height: 820 }, colorScheme: 'dark' });
const p3 = await ctx3.newPage(); await p3.goto(URL); await p3.waitForSelector('#capture-input');
await p3.click('[data-action=load-examples]'); await p3.waitForTimeout(200);
await p3.screenshot({ path: SH + '/8-dark-examples.png' });
const ow = await p2.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
ok(ow <= 0, 'Handy: kein horizontales Scrollen');
await browser.close();
console.log(errors.length ? '\nFEHLER:\n' + errors.join('\n') : '\nAlle Prüfungen bestanden.');
