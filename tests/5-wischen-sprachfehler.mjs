const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { harden } from './helpers.mjs';
const SH = process.argv[2]; const URL = 'http://localhost:4173/';
const errors = []; const ok = (c, m) => { if (!c) errors.push('FAIL ' + m); else console.log('ok  ' + m); };

// Simulierte Spracherkennung mit wählbarem Verhalten:
// silent = endet ohne Aufnahme, ok = erkennt „Hallo Welt“, aborted = Browser bricht ab
const FAKE = `
  window.__mode = 'silent';
  class FakeSR extends EventTarget {
    constructor() { super(); this.processLocally = false; }
    start() {
      window.__starts = (window.__starts || 0) + 1;
      window.__srStarted = { local: this.processLocally };
      const mode = window.__mode;
      this.dispatchEvent(new Event('start'));
      setTimeout(() => {
        if (mode === 'ok') {
          this.dispatchEvent(new Event('audiostart'));
          this.onresult && this.onresult({ results: [Object.assign([{ transcript: 'Hallo Welt' }], { isFinal: true })] });
        }
        if (mode === 'aborted') this.onerror && this.onerror({ error: 'aborted' });
        this.onend && this.onend();
      }, 50);
    }
    stop() { this.onend && this.onend(); }
  }
  FakeSR.available = async () => 'available';
  window.webkitSpeechRecognition = FakeSR; window.SpeechRecognition = FakeSR;
`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
await ctx.addInitScript(FAKE);
const page = harden(await ctx.newPage());
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(URL); await page.waitForSelector('#capture-input');
await page.click('[data-action=load-examples]');

// Wischgeste mit Touch-Pointer-Ereignissen nachspielen
async function swipe(sel, dx, dy = 0) {
  await page.evaluate(({ sel, dx, dy }) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    const x0 = r.right - 30, y0 = r.top + r.height / 2;
    const ev = (type, x, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, isPrimary: true }));
    ev('pointerdown', x0, y0);
    const steps = 8;
    for (let i = 1; i <= steps; i++) ev('pointermove', x0 + (dx * i) / steps, y0 + (dy * i) / steps);
    ev('pointerup', x0 + dx, y0 + dy);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x0 + dx, clientY: y0 + dy }));
  }, { sel, dx, dy });
  await page.waitForTimeout(300);
}
const rowSel = (t) => `#main li.row:has(.row-title:text-is("${t}")) .row-inner`;
const cssRow = async (t) => page.locator('#main li.row', { has: page.locator('.row-title', { hasText: t }) });

// 1. Kurz wischen: springt zurück
await swipe('#main li.row:nth-child(1) .row-inner', -30);
ok((await page.locator('#main li.row.swipe-open').count()) === 0, 'Kurzes Wischen: Karte springt zurück');
ok(await page.locator('#modal').isHidden(), 'Wischen öffnet nicht den Bearbeiten-Dialog');

// 2. Senkrecht: kein Wischen (Scrollen)
await swipe('#main li.row:nth-child(1) .row-inner', -15, 80);
ok((await page.locator('#main li.row.swipe-open').count()) === 0, 'Senkrechte Bewegung: kein Löschen-Knopf');

// 3. Weit nach links: Löschen-Knopf
const title = (await page.locator('#main li.row:nth-child(1) .row-title').innerText()).trim();
await swipe('#main li.row:nth-child(1) .row-inner', -140);
ok((await page.locator('#main li.row.swipe-open').count()) === 1, 'Nach links gewischt: Karte offen');
ok(await page.locator('#main li.row.swipe-open .swipe-del').isVisible(), 'Löschen-Knopf sichtbar');
ok(await page.locator('#modal').isHidden(), 'Dabei kein Dialog');
await page.screenshot({ path: SH + '/w1-swipe.png' });

// Tippen daneben schliesst
await page.locator('h1').tap();
await page.waitForTimeout(300);
ok((await page.locator('#main li.row.swipe-open').count()) === 0, 'Tippen daneben schliesst die Karte');

// 4. Löschen: sofort, ohne Rückgängig
const countBefore = await page.locator('#main li.row').count();
await swipe('#main li.row:nth-child(1) .row-inner', -140);
await page.locator('#main li.row.swipe-open .swipe-del').tap(); // echtes Tippen mit dem Finger
await page.waitForTimeout(200);
ok((await page.locator('#main .row-title', { hasText: title }).count()) === 0, `Gelöscht: „${title}“`);
ok(!(await page.locator('#undo').evaluate((e) => e.classList.contains('show'))), 'Kein Rückgängig');
ok((await page.locator('#toast').innerText()).includes('Gelöscht'), 'Hinweis „Gelöscht“');
await page.reload(); await page.waitForSelector('#main h1');
ok((await page.locator('#main .row-title', { hasText: title }).count()) === 0, 'Bleibt gelöscht nach Neuladen');
ok((await page.locator('#main li.row').count()) === countBefore - 1, 'Andere Einträge unberührt');

// 5. Projekt löschen: Aufgaben bleiben als Einzelaufgaben
await page.goto(URL + '#projects'); await page.waitForSelector('#main li.row');
await swipe('#main li.row:nth-child(1) .row-inner', -140);
await page.locator('#main li.row.swipe-open .swipe-del').tap(); // echtes Tippen mit dem Finger
await page.waitForTimeout(200);
ok((await page.locator('#main li.row').count()) === 0, 'Projekt gelöscht');
await page.goto(URL + '#next'); await page.waitForSelector('#main li.row');
const step = page.locator('#main li.row', { has: page.locator('.row-title', { hasText: 'Velomechaniker' }) });
ok((await step.count()) === 1 && (await step.locator('.row-eyebrow').count()) === 0, 'Aufgabe des Projekts bleibt, ohne Projekt');

// 6. Spracheingabe: Offline startet, nimmt aber nichts auf → fragt automatisch nach Online
await page.goto(URL + '#inbox'); await page.waitForSelector('#capture-input');
await page.click('#main .mic');                     // 1. Tipp: Prüfung läuft, Dialog „bereit“
await page.waitForSelector('[data-action=voice-local]');
await page.click('[data-action=voice-local]');      // offline, endet ohne Aufnahme
await page.waitForSelector('[data-action=voice-once]');
ok(await page.locator('.toast.error.show').count() === 0, 'Offline geht nicht: keine Fehlermeldung, direkt Angebot online');
await page.evaluate(() => { window.__mode = 'ok'; window.__srStarted = null; });
await page.click('[data-action=voice-once]');
await page.waitForFunction(() => document.getElementById('capture-input').value === 'Hallo Welt');
ok(await page.evaluate(() => window.__srStarted.local === false), 'Danach online erkannt');

// Merkt sich das auch nach Neuladen: nächster Tipp gleich online (kein „bereit“-Dialog mehr)
await page.reload(); await page.waitForSelector('#capture-input');
await page.click('#main .mic');
await page.waitForSelector('[data-action=voice-once]');
ok((await page.locator('[data-action=voice-local]').count()) === 0, 'Offline-Problem bleibt gemerkt (nach Neuladen)');
await page.click('[data-action=voice-cancel]');

// 7. Abbruch durch den Browser (online) wird mit Hinweis angezeigt
await page.fill('#capture-input', '');
await page.evaluate(() => { window.__mode = 'aborted'; });
await page.click('#main .mic');
await page.waitForSelector('[data-action=voice-once]');
await page.click('[data-action=voice-once]');
await page.waitForFunction(() => document.getElementById('toast').textContent.includes('aborted'));
ok((await page.locator('#toast').innerText()).includes('Testen'), 'Fehler „aborted“ mit Hinweis auf den Test');

// 8. Diagnose-Test in den Einstellungen
await page.goto(URL + '#settings'); await page.waitForSelector('#voice-state');
ok((await page.locator('.facts', { hasText: 'Letztes Problem' }).innerText()).includes('aborted'), 'Einstellungen zeigen letztes Problem');
await page.click('#voice-diag summary');
await page.click('[data-action=voice-test][data-mode=online]');
await page.waitForFunction(() => /\bend\b/.test(document.getElementById('voice-log').textContent) && document.getElementById('voice-log').textContent.includes('Browser:'));
const logText = await page.locator('#voice-log').innerText();
if (!(logText.includes('start (online') && logText.includes('error: aborted'))) console.log(logText);
ok(logText.includes('start (online') && logText.includes('error: aborted') && logText.includes('Browser:'), 'Test protokolliert Schritte und Umgebung');
await page.evaluate(() => { window.__mode = 'ok'; });
await page.click('[data-action=voice-test][data-mode=offline]');
await page.waitForFunction(() => document.getElementById('voice-test-input').value === 'Hallo Welt');
ok((await page.locator('#voice-log').innerText()).includes('audiostart'), 'Offline-Test erkennt Text, Protokoll mit audiostart');
await page.screenshot({ path: SH + '/w2-voice-settings.png', fullPage: true });

// 9. Online erlaubt: Offline-Ausfall wechselt ohne Rückfrage auf online
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
await ctx2.addInitScript(FAKE);
const p2 = harden(await ctx2.newPage());
p2.on('pageerror', (e) => errors.push('p2: ' + e.message));
await p2.goto(URL + '#settings'); await p2.waitForSelector('#voice-cloud');
await p2.check('#voice-cloud'); await p2.waitForTimeout(300);
await p2.goto(URL + '#inbox'); await p2.waitForSelector('#capture-input');
await p2.click('#main .mic');                       // 1. Tipp: online (erlaubt), Prüfung im Hintergrund
await p2.waitForTimeout(300);
await p2.evaluate(() => { window.__mode = 'silent'; window.__starts = 0; });
await p2.fill('#capture-input', '');
await p2.click('#main .mic');                       // 2. Tipp: offline verfügbar → offline, endet still
await p2.waitForFunction(() => window.__starts >= 2, null, { timeout: 5000 });
ok(await p2.evaluate(() => window.__srStarted.local === false), 'Online erlaubt: nach Offline-Ausfall sofort online versucht');

await browser.close();
console.log(errors.length ? '\nFEHLER:\n' + errors.join('\n') : '\nAlle Prüfungen bestanden.');
