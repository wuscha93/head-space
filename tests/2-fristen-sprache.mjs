const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { harden } from './helpers.mjs';
const SH = process.argv[2]; const URL = 'http://localhost:4173/';
const errors = []; const ok = (c, m) => { if (!c) errors.push('FAIL ' + m); else console.log('ok  ' + m); };
const FAKE = `
  window.__avail = localStorage.getItem('fakeAvail') || 'unavailable';
  class FakeSR {
    constructor() { this.processLocally = false; this.lang = ''; }
    start() {
      window.__srStarted = { local: this.processLocally, lang: this.lang, activation: navigator.userActivation ? navigator.userActivation.isActive : true };
      setTimeout(() => {
        this.onresult && this.onresult({ results: [Object.assign([{ transcript: 'Zahnarzt' }], { isFinal: false })] });
        setTimeout(() => {
          this.onresult && this.onresult({ results: [Object.assign([{ transcript: window.__say || 'Zahnarzt anrufen' }], { isFinal: true })] });
          this.onend && this.onend();
        }, 120);
      }, 60);
    }
    stop() { this.onend && this.onend(); }
  }
  FakeSR.available = async () => window.__avail;
  FakeSR.install = async () => { window.__avail = 'available'; localStorage.setItem('fakeAvail','available'); return true; };
  window.webkitSpeechRecognition = FakeSR; window.SpeechRecognition = FakeSR;
`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
await ctx.addInitScript(FAKE + `; localStorage.setItem('kopf-frei-voice-enabled', '1');`); // Spracheingabe ist seit 0.8 ausgeschaltet; für diese Tests ein
const page = harden(await ctx.newPage());
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(URL); await page.waitForSelector('#capture-input');
const scenario = async (avail, say) => { await page.evaluate((a) => localStorage.setItem('fakeAvail', a), avail); await page.reload(); await page.waitForSelector('#main h1'); await page.evaluate((t) => { window.__say = t; window.__srStarted = null; }, say); };

// A: offline verfügbar. Erster Tipp: Prüfung läuft im Hintergrund, Dialog meldet „bereit“
await scenario('available', 'Zahnarzt anrufen');
await page.click('#main .mic');
await page.waitForSelector('[data-action=voice-local]');
ok(await page.evaluate(() => window.__srStarted === null), 'Erster Tipp: ohne Zustimmung keine Online-Aufnahme');
await page.click('[data-action=voice-local]');
await page.waitForFunction(() => document.getElementById('capture-input').value === 'Zahnarzt anrufen');
ok(await page.evaluate(() => window.__srStarted.local === true && window.__srStarted.lang === 'de-DE'), 'Sprache: offline erkannt, de-DE, Text im Feld');
ok(await page.evaluate(() => window.__srStarted.activation === true), 'Aufnahme startet direkt im Tipp (Nutzergeste erhalten)');
await page.fill('#capture-input', '');
await page.evaluate(() => { window.__srStarted = null; });
await page.click('#main .mic');
await page.waitForFunction(() => document.getElementById('capture-input').value === 'Zahnarzt anrufen');
ok(await page.locator('#modal').isHidden() && await page.evaluate(() => window.__srStarted.local === true && window.__srStarted.activation === true), 'Zweiter Tipp: sofort offline, kein Dialog');
await page.click('form[data-form=capture] button[type=submit]');

// B: nur online → Zustimmung nötig
await scenario('unavailable', 'Offerte Fenster einholen');
await page.click('#main .mic');
await page.waitForSelector('[data-action=voice-once]');
ok(await page.evaluate(() => window.__srStarted === null), 'Ohne Zustimmung keine Aufnahme');
await page.screenshot({ path: SH + '/v1-consent.png' });
await page.click('[data-action=voice-once]');
await page.waitForFunction(() => document.getElementById('capture-input').value === 'Offerte Fenster einholen');
ok(await page.evaluate(() => window.__srStarted.local === false && window.__srStarted.activation === true), 'Nur dieses Mal: online erkannt, direkt im Tipp gestartet');
await page.click('form[data-form=capture] button[type=submit]');
await page.evaluate(() => { window.__srStarted = null; });
await page.click('#main .mic');
await page.waitForSelector('[data-action=voice-once]');
ok(true, 'Nur dieses Mal: fragt beim nächsten Mal wieder');
await page.click('[data-action=voice-cancel]');
ok(await page.locator('#modal').isHidden(), 'Abbrechen schliesst Dialog');

// C: Schnellknopf + Sprachpaket herunterladbar
await scenario('downloadable', 'Geschenk für Anna');
await page.click('.fab-mic');
await page.waitForSelector('[data-action=voice-install-go]');
await page.screenshot({ path: SH + '/v2-install.png' });
await page.click('[data-action=voice-install-go]');
await page.waitForFunction(() => document.getElementById('quick-input')?.value === 'Geschenk für Anna');
ok(await page.evaluate(() => window.__srStarted.local === true), 'Sprachpaket geladen, dann offline erkannt im Schnell-Dialog');
await page.click('form[data-form=quick-capture] button[type=submit]');
ok((await page.locator('#main .row').count()) === 3, '3 Einträge per Sprache erfasst');

// Fälligkeit
await page.click('[data-action=clarify-first]');
await page.click('[data-step=multi]'); await page.click('[data-step=twomin]'); await page.click('[data-step=who]'); await page.click('[data-step=next]');
const T = await page.evaluate(() => { const d = new Date(); return d.toISOString().slice(0, 10); });
await page.fill('#n-due', T); await page.selectOption('#n-ctx', '@Telefon');
await page.click('form[data-form=clarify-next] button[type=submit]');
// zweiter: Projekt mit Frist
await page.click('[data-step=multi]'); await page.click('[data-step=project]');
await page.fill('#p-due', '2026-12-20'); await page.fill('#p-next', 'Masse der Fenster aufnehmen'); await page.selectOption('#p-ctx', '@Zuhause');
await page.click('form[data-form=clarify-project] button[type=submit]');
// dritter: nächster Schritt ohne Frist
await page.click('[data-step=multi]'); await page.click('[data-step=twomin]'); await page.click('[data-step=who]'); await page.click('[data-step=next]');
await page.selectOption('#n-ctx', '@Telefon'); await page.click('form[data-form=clarify-next] button[type=submit]');
await page.click('[data-view=next]');
const firstTel = await page.locator('#main .rows').first().locator('.row-title').first().innerText();
ok(firstTel === 'Zahnarzt anrufen', 'Fällige Aufgabe steht zuoberst');
ok((await page.locator('.due.due-today').count()) === 1, 'Chip „heute fällig“');
ok((await page.locator('.nav-item[data-view=due] .badge.warn').innerText()) === '1', 'Fristen: Warnzähler 1');
await page.click('[data-view=due]');
ok((await page.locator('h2.section').allTextContents()).some((t) => t.startsWith('Heute')), 'Fristen: Gruppe Heute');
ok((await page.locator('.row-icon').count()) === 0, 'Fristen: keine Projekte (seit 0.10 nur Aufgaben)');
// überfällig per Bearbeiten
await page.locator('#main .row-main', { hasText: 'Zahnarzt' }).click();
await page.fill('#e-due', '2026-10-01'); await page.click('form[data-form=edit] button[type=submit]');
ok((await page.locator('.due.due-overdue').count()) === 1, 'Überfällig markiert');
ok((await page.locator('h2.section').allTextContents()).some((t) => t.startsWith('Überfällig')), 'Fristen: Gruppe Überfällig');
await page.screenshot({ path: SH + '/v3-due.png' });
// Projekt-Frist bearbeiten
await page.click('[data-view=projects]');
ok((await page.locator('#main .due-later, #main .due-week, #main .due-soon').count()) === 1, 'Projektliste zeigt Frist');
await page.click('[data-action=open-project]');
await page.click('[data-action=edit-project]');
ok((await page.inputValue('#pf-due')) === '2026-12-20', 'Projektformular zeigt Frist');
await page.fill('#pf-due', ''); await page.click('form[data-form=project] button[type=submit]');
ok((await page.locator('.head-meta').count()) === 0, 'Projekt-Frist entfernt');
await page.screenshot({ path: SH + '/v4-project.png' });

// Einstellungen
await page.click('[data-view=settings]');
if (await page.locator('[data-action=voice-check]').count()) await page.click('[data-action=voice-check]');
await page.waitForFunction(() => !document.getElementById('voice-state').textContent.includes('geprüft'));
ok((await page.locator('#voice-state').innerText()).length > 5, 'Einstellungen: Status Spracherkennung');
await page.check('#voice-cloud'); await page.waitForTimeout(400);
await page.reload(); await page.click('[data-view=settings]');
ok(await page.isChecked('#voice-cloud'), 'Einstellung Online-Erkennung bleibt gespeichert');
await scenario('unavailable', 'Ohne Nachfrage');
await page.click('[data-view=inbox]'); await page.click('#main .mic');
await page.waitForFunction(() => document.getElementById('capture-input').value === 'Ohne Nachfrage');
ok(await page.locator('#modal').isHidden(), 'Immer erlaubt: keine Nachfrage mehr');

// D: Browser ohne Spracherkennung
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx2.addInitScript(`delete window.SpeechRecognition; delete window.webkitSpeechRecognition; localStorage.setItem('kopf-frei-voice-enabled', '1');`);
const p2 = harden(await ctx2.newPage()); p2.on('pageerror', (e) => errors.push('p2: ' + e.message));
await p2.goto(URL); await p2.waitForSelector('#capture-input');
await p2.click('#main .mic');
await p2.waitForSelector('.toast.error.show');
ok((await p2.locator('#toast').innerText()).includes('Bildschirmtastatur'), 'Ohne Unterstützung: Hinweis auf Tastatur');
await p2.click('[data-action=load-examples]'); await p2.waitForTimeout(300);
await p2.screenshot({ path: SH + '/v5-phone.png' });
ok(await p2.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Handy: kein horizontales Scrollen');
// E: Absturz-Schutz – nach einem Absturz bei der Abfrage wird nicht mehr gefragt
const ctx3 = await browser.newContext();
await ctx3.addInitScript(FAKE + `; window.__called = false; window.SpeechRecognition.available = async () => { window.__called = true; return 'available'; }; localStorage.setItem('kopf-frei-voice-probe', 'pending'); localStorage.setItem('kopf-frei-voice-enabled', '1');`);
const p3 = harden(await ctx3.newPage()); await p3.goto(URL); await p3.waitForSelector('#capture-input');
await p3.click('#main .mic'); await p3.waitForSelector('[data-action=voice-once]');
ok(await p3.evaluate(() => window.__called === false), 'Absturz-Schutz: keine erneute Abfrage, direkt Nachfrage');
await browser.close();
console.log(errors.length ? '\nFEHLER:\n' + errors.join('\n') : '\nAlle Prüfungen bestanden.');
