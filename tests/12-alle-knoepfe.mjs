// Jeder Knopf in jeder Ansicht und in den wichtigsten Dialogen reagiert auf Antippen (echte Touch-Ereignisse).
// Handy und iPad mit Chromium; zusätzlich iPad mit WebKit (Safari-Kern), wenn E2E_WEBKIT=1 (GitHub).
// „Reagiert“ heisst: die Seite ändert sich, die Adresse wechselt oder die Datumsauswahl wird geöffnet.
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { harden } from './helpers.mjs';
const URL = 'http://localhost:4173/test/';
const errors = []; const ok = (c, m) => { if (!c) errors.push('FAIL ' + m); else console.log('ok  ' + m); };

const VIEWS = ['inbox', 'next', 'due', 'projects', 'waiting', 'tickler', 'someday', 'reference', 'done', 'settings'];
// Zustände mit Dialogen bzw. Unteransichten: [Name, Hash, Vorbereitung]
const STATES = [
  ...VIEWS.map((v) => [v, '#' + v, null]),
  ['projekt', '#projects', async (p) => { await p.locator('#main .row-title', { hasText: 'Velo winterfit' }).first().tap({ timeout: 3000 }); await p.waitForSelector('#step-input', { timeout: 3000 }); }],
  ['bearbeiten', '#waiting', async (p) => { await p.locator('#main .row-title', { hasText: 'Lisa' }).first().tap({ timeout: 3000 }); await p.waitForSelector('#e-title', { timeout: 3000 }); }],
  ['klären', '#inbox', async (p) => { await p.locator('[data-action=clarify-first]').tap({ timeout: 3000 }); await p.waitForSelector('#clarify-title', { timeout: 3000 }); }],
  ['menü', '#inbox', async (p) => { if (await p.locator('.menu-btn').isVisible()) { await p.locator('.menu-btn').tap(); await p.waitForTimeout(300); } }],
  ['schnellerfassung', '#inbox', async (p) => { await p.locator('.fab:not(.fab-mic)').tap(); await p.waitForSelector('#quick-input'); }],
];
// Bewusst ohne sichtbare Reaktion: Griff (nur Ziehen), Löschen hinter der Karte (nur nach Wischen sichtbar)
const SKIP = '.drag-handle, .swipe-del';

const SPY = `(() => {
  // erreichbar = sichtbar und an seiner Mitte nicht von etwas anderem verdeckt (z. B. eingeklapptes Menü)
  window.__reachable = (el) => {
    const r0 = el.getBoundingClientRect();
    if (!r0.width || !r0.height || getComputedStyle(el).visibility === 'hidden') return false;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (hit === el || el.contains(hit));
  };
  window.__picker = 0;
  HTMLInputElement.prototype.showPicker = function () { window.__picker++; };
})();`;

async function run(engine, device, viewport) {
  const browser = await pw[engine].launch();
  let ctx = null, page = null;
  // Frische Umgebung (neue Datenbank mit Beispieldaten), damit frühere Knöpfe nichts verändern
  const fresh = async () => {
    if (ctx) await ctx.close();
    ctx = await browser.newContext({ viewport, hasTouch: true, isMobile: engine !== 'firefox', deviceScaleFactor: 2 });
    await ctx.addInitScript(SPY);
    page = harden(await ctx.newPage());
    page.on('pageerror', (e) => errors.push(`${engine}/${device} pageerror: ${e.message}`));
    page.on('dialog', (d) => d.dismiss());
  };
  const load = async (hash, prep) => {
    await page.goto('about:blank'); await page.goto(URL + hash); await page.waitForSelector('#main h1, #main .back');
    if (prep) await prep(page);
    await page.waitForTimeout(60);
  };
  const go = async (hash, prep) => {
    try { await load(hash, prep); } catch { await fresh(); await load(hash, prep); }
  };
  let tapped = 0;
  for (const [name, hash, prep] of STATES) {
    await fresh();
    await go(hash, prep);
    // ein Knopf pro Art (gleiche Aktion auf vielen Karten wird einmal geprüft)
    const sigs = await page.evaluate((skip) => {
      const out = new Set();
      for (const el of document.querySelectorAll('button, a[href]')) {
        if (el.closest(skip) || !window.__reachable(el)) continue;
        const d = el.dataset;
        out.add([el.tagName, d.action ?? '', d.view ?? '', d.status ?? '', d.seq ?? '', d.step ?? '', d.theme ?? '', d.mode ?? '', d.action ? '' : el.textContent.trim().slice(0, 30)].join('|'));
      }
      return [...out];
    }, SKIP);
    for (const sig of sigs) {
      if (process.env.KNOPF_DEBUG) console.log('sig', sig);
      await go(hash, prep);
      const found = await page.evaluate(([sig, skip]) => {
        const cands = [];
        for (const el of document.querySelectorAll('button, a[href]')) {
          if (el.closest(skip) || !window.__reachable(el)) continue;
          const d = el.dataset;
          const s = [el.tagName, d.action ?? '', d.view ?? '', d.status ?? '', d.seq ?? '', d.step ?? '', d.theme ?? '', d.mode ?? '', d.action ? '' : el.textContent.trim().slice(0, 30)].join('|');
          if (s === sig) cands.push(el);
        }
        // schon gewählte Schalter (Filter „Alle“, aktuelles Design) ändern nichts: einen anderen nehmen
        const el = cands.find((c) => c.getAttribute('aria-pressed') !== 'true' && !c.classList.contains('is-active')) ?? cands[0];
        if (!el) return 'missing';
        if (el.type === 'submit' && el.form) {
          // leere Textfelder ausfüllen, damit Absenden etwas bewirkt
          el.form.querySelectorAll('input:not([type]), input[type=text], textarea').forEach((f) => { if (!f.value && !f.readOnly) f.value = 'Knopf-Test'; });
          if (!el.form.checkValidity()) return 'invalid';
        }
        if (cands.length > 1 && el === cands[0] && (el.getAttribute('aria-pressed') === 'true' || el.classList.contains('is-active'))) return 'selected';
        window.__reachable(el);
        el.setAttribute('data-knopf', '1');
        return 'ok';
      }, [sig, SKIP]);
      if (found !== 'ok') continue;
      const loc = page.locator('[data-knopf="1"]');
      await loc.scrollIntoViewIfNeeded();
      const label = `${engine}/${device} ${name}: ${sig.split('|').filter(Boolean).slice(1).join(' ') || sig}`;
      const before = await page.evaluate(() => { const k = document.querySelector('[data-knopf]'); k?.removeAttribute('data-knopf'); const h = document.documentElement.outerHTML; k?.setAttribute('data-knopf', '1'); return { h, url: location.href, p: window.__picker }; });
      const t0 = Date.now();
      try { await loc.tap({ timeout: 2500 }); } catch (e) { errors.push(`FAIL ${label}: lässt sich nicht antippen (${e.message.split('\n')[0]})`); continue; }
      await page.waitForTimeout(200);
      const after = await page.evaluate(() => { document.querySelector('[data-knopf]')?.removeAttribute('data-knopf'); return { h: document.documentElement.outerHTML, url: location.href, p: window.__picker ?? 0 }; }).catch(() => ({ h: 'neu geladen', url: '', p: 0 }));
      const reacted = after.h !== before.h || after.url !== before.url || after.p > before.p;
      if (!reacted) errors.push(`FAIL ${label}: keine Reaktion`);
      if (process.env.KNOPF_DEBUG) console.log(`${Date.now() - t0}ms ${label}`);
      tapped++;
    }
  }
  ok(tapped > 40, `${engine}/${device}: ${tapped} Knopfarten angetippt, alle reagieren`);
  // Die Fahne öffnet die Datumsauswahl (bzw. den Ersatzdialog) beim ersten Antippen, auch im Projekt
  for (const [name, hash, prep] of [['Nächste Schritte', '#next', null], STATES.find((s) => s[0] === 'projekt')]) {
    await fresh();
    await go(hash, prep);
    const p0 = await page.evaluate(() => window.__picker);
    await page.locator('#main [data-action=due-pick]').first().tap();
    await page.waitForTimeout(200);
    const opened = (await page.evaluate(() => window.__picker)) > p0 || await page.locator('#modal form[data-form=due]').isVisible();
    ok(opened, `${engine}/${device} ${name}: Fahne öffnet die Datumsauswahl beim ersten Antippen`);
  }
  // Unsichtbare Felder hinter der Fahne behalten das Aussehen des Systems (sonst öffnet Safari nichts)
  const app = await page.locator('#main .due-input').first().evaluate((el) => getComputedStyle(el).webkitAppearance || getComputedStyle(el).appearance);
  ok(app !== 'none', `${engine}/${device}: Feld hinter der Fahne nicht umgestaltet (${app})`);
  await browser.close();
}

// Geräte parallel prüfen (je ein eigener Browser)
const runs = [run('chromium', 'Handy', { width: 390, height: 844 }), run('chromium', 'iPad', { width: 820, height: 1180 })];
if (process.env.E2E_WEBKIT === '1') runs.push(run('webkit', 'iPad', { width: 820, height: 1180 }));
else console.log('(WebKit übersprungen, läuft auf GitHub mit E2E_WEBKIT=1)');
await Promise.all(runs);

if (errors.length) { console.log(errors.join('\n')); process.exit(1); }
console.log('Alle Prüfungen bestanden');
