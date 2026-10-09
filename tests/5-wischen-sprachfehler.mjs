const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const SH = process.argv[2]; const URL = 'http://localhost:4173/';
const errors = []; const ok = (c, m) => { if (!c) errors.push('FAIL ' + m); else console.log('ok  ' + m); };

// Simulierte Spracherkennung mit wählbarem Verhalten
const FAKE = `
  window.__mode = 'silent';
  class FakeSR {
    constructor() { this.processLocally = false; }
    start() {
      window.__starts = (window.__starts || 0) + 1;
      window.__srStarted = { local: this.processLocally };
      setTimeout(() => {
        if (window.__mode === 'aborted') this.onerror && this.onerror({ error: 'aborted' });
        if (window.__mode === 'ok') this.onresult && this.onresult({ results: [Object.assign([{ transcript: 'Hallo Welt' }], { isFinal: true })] });
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
const page = await ctx.newPage();
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
await page.click('h1');
await page.waitForTimeout(300);
ok((await page.locator('#main li.row.swipe-open').count()) === 0, 'Tippen daneben schliesst die Karte');

// 4. Löschen: sofort, ohne Rückgängig
const countBefore = await page.locator('#main li.row').count();
await swipe('#main li.row:nth-child(1) .row-inner', -140);
await page.locator('#main li.row.swipe-open .swipe-del').click();
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
await page.locator('#main li.row.swipe-open .swipe-del').click();
await page.waitForTimeout(200);
ok((await page.locator('#main li.row').count()) === 0, 'Projekt gelöscht');
await page.goto(URL + '#next'); await page.waitForSelector('#main li.row');
const step = page.locator('#main li.row', { has: page.locator('.row-title', { hasText: 'Velomechaniker' }) });
ok((await step.count()) === 1 && (await step.locator('.row-eyebrow').count()) === 0, 'Aufgabe des Projekts bleibt, ohne Projekt');

// 6. Spracheingabe: Offline liefert nichts → klare Meldung, nächster Tipp geht online
await page.goto(URL + '#inbox'); await page.waitForSelector('#capture-input');
await page.click('#main .mic');                     // 1. Tipp: Prüfung, Dialog „bereit“
await page.waitForSelector('[data-action=voice-local]');
await page.click('[data-action=voice-local]');      // offline, liefert nichts
await page.waitForSelector('.toast.error.show');
ok((await page.locator('#toast').innerText()).includes('Offline-Erkennung hat nichts geliefert'), 'Stille Offline-Erkennung: verständliche Meldung statt nichts');
await page.evaluate(() => { window.__mode = 'ok'; window.__srStarted = null; });
await page.click('#main .mic');                     // jetzt online → Zustimmung
await page.waitForSelector('[data-action=voice-once]');
await page.click('[data-action=voice-once]');
await page.waitForFunction(() => document.getElementById('capture-input').value === 'Hallo Welt');
ok(await page.evaluate(() => window.__srStarted.local === false), 'Danach online erkannt');

// 7. Abbruch durch den Browser wird angezeigt
await page.fill('#capture-input', '');
await page.evaluate(() => { window.__mode = 'aborted'; });
await page.click('#main .mic');
await page.waitForSelector('[data-action=voice-once]');
await page.click('[data-action=voice-once]');
await page.waitForFunction(() => document.getElementById('toast').textContent.includes('aborted'));
ok(true, 'Fehler „aborted“ wird angezeigt');
await page.goto(URL + '#settings'); await page.waitForSelector('#voice-state');
ok((await page.locator('.facts', { hasText: 'Letztes Problem' }).innerText()).includes('aborted'), 'Einstellungen zeigen letztes Problem');
await page.screenshot({ path: SH + '/w2-voice-settings.png', fullPage: true });

await browser.close();
console.log(errors.length ? '\nFEHLER:\n' + errors.join('\n') : '\nAlle Prüfungen bestanden.');
