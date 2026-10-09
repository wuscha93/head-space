// „Zurück auf Stand vom …“ in der Oberfläche
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { harden } from './helpers.mjs';
const SH = process.argv[2]; const URL = 'http://localhost:4173/';
const errors = []; const ok = (c, m) => { if (!c) errors.push('FAIL ' + m); else console.log('ok  ' + m); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const page = harden(await ctx.newPage());
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

// Ausgangslage von gestern direkt in die Datenbank (wie nach einem Tag Nutzung)
await page.goto(URL + 'icon.svg');
await page.evaluate(async () => {
  const y = new Date(); y.setDate(y.getDate() - 1); y.setHours(10, 0, 0, 0);
  const t = y.getTime();
  const ev = [
    { id: 'g1', ts: t, device: 'x', type: 'context.add', data: { name: '@Telefon' } },
    { id: 'g2', ts: t + 1, device: 'x', type: 'item.create', data: { id: 'a', title: 'Gestern erfasst', list: 'next', context: '@Telefon' } },
    { id: 'g3', ts: t + 2, device: 'x', type: 'item.create', data: { id: 'b', title: 'Wird heute gelöscht', list: 'next' } },
  ];
  await new Promise((res, rej) => {
    const r = indexedDB.open('kopf-frei', 2);
    r.onupgradeneeded = () => { for (const n of ['events', 'meta', 'synced']) if (!r.result.objectStoreNames.contains(n)) r.result.createObjectStore(n, n === 'events' ? { keyPath: 'id' } : undefined); };
    r.onsuccess = () => { const tx = r.result.transaction(['events', 'meta'], 'readwrite'); ev.forEach((e) => tx.objectStore('events').put(e)); tx.objectStore('meta').put(Date.now(), 'lastBackup'); tx.oncomplete = () => { r.result.close(); res(); }; tx.onerror = rej; };
  });
});
await page.goto(URL + '#next'); await page.waitForSelector('#main .row');

// Heute: umbenennen, wischen-löschen, neu erfassen
await page.locator('#main .row-title', { hasText: 'Gestern erfasst' }).tap();
await page.fill('#e-title', 'Heute umbenannt'); await page.locator('form[data-form=edit] button[type=submit]').tap();
const row = page.locator('#main li.row', { has: page.locator('.row-title', { hasText: 'Wird heute gelöscht' }) });
await row.locator('.row-inner').evaluate((el) => {
  const r = el.getBoundingClientRect(); const x0 = r.right - 30, y0 = r.top + r.height / 2;
  const ev = (type, x) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 3, pointerType: 'touch', clientX: x, clientY: y0, isPrimary: true }));
  ev('pointerdown', x0); for (let i = 1; i <= 8; i++) ev('pointermove', x0 - i * 18); ev('pointerup', x0 - 144);
});
await page.waitForTimeout(300);
await row.locator('.swipe-del').tap();
await page.waitForTimeout(200);
ok((await page.locator('#main .row-title', { hasText: 'Wird heute gelöscht' }).count()) === 0, 'Vorbereitung: per Wischen gelöscht');
await page.goto(URL + '#inbox'); await page.waitForSelector('#capture-input');
await page.fill('#capture-input', 'Heute neu'); await page.keyboard.press('Enter');

// Einstellungen: Punkt „Ende gestern“ anbieten
await page.goto(URL + '#settings'); await page.waitForSelector('#restore-list .restore-point');
const point = page.locator('#restore-list .restore-point', { hasText: 'Ende' }).first();
ok((await point.count()) === 1, 'Punkt „Ende <gestern>“ wird angeboten');
ok((await point.innerText()).includes('spätere Änderungen'), 'mit Anzahl späterer Änderungen');
await page.screenshot({ path: SH + '/r1-restore-list.png', fullPage: true });
await point.tap();
await page.waitForSelector('[data-action=confirm]');
ok((await page.locator('#modal').innerText()).includes('wieder rückgängig'), 'Bestätigung erklärt, dass es umkehrbar ist');
await page.locator('[data-action=confirm]').tap();
await page.waitForSelector('#undo.show');

const titlesNow = async () => { await page.goto(URL + '#next'); await page.waitForSelector('#main h1'); const a = await page.locator('#main .row-title').allInnerTexts(); await page.goto(URL + '#inbox'); await page.waitForSelector('#main h1'); return [...a, ...(await page.locator('#main .row-title').allInnerTexts())].sort(); };
const restored = await titlesNow();
ok(JSON.stringify(restored) === JSON.stringify(['Gestern erfasst', 'Wird heute gelöscht']), `Stand von gestern wiederhergestellt (${restored.join(', ')})`);

// Auch nach Neuladen
await page.reload(); await page.waitForSelector('#main h1');
ok(JSON.stringify(await titlesNow()) === JSON.stringify(['Gestern erfasst', 'Wird heute gelöscht']), 'bleibt nach Neuladen');

// Rückgängig über den neuen Punkt „Vor dem Zurücksetzen“
await page.goto(URL + '#settings'); await page.waitForSelector('#restore-list .restore-point');
const back = page.locator('#restore-list .restore-point', { hasText: 'Vor dem Zurücksetzen' });
ok((await back.count()) === 1, 'Punkt „Vor dem Zurücksetzen“ erscheint');
await back.tap(); await page.locator('[data-action=confirm]').tap();
await page.waitForSelector('#undo.show');
const again = await titlesNow();
ok(JSON.stringify(again) === JSON.stringify(['Heute neu', 'Heute umbenannt']), `Zurücksetzen wieder aufgehoben (${again.join(', ')})`);

// Eigener Zeitpunkt in der Zukunft wird abgelehnt
await page.goto(URL + '#settings'); await page.waitForSelector('#restore-when');
await page.fill('#restore-when', '2099-01-01T10:00');
await page.locator('form[data-form=restore-custom] button[type=submit]').tap();
await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Vergangenheit'));
ok(true, 'Zeitpunkt in der Zukunft: verständliche Meldung');

await browser.close();
console.log(errors.length ? '\nFEHLER:\n' + errors.join('\n') : '\nAlle Prüfungen bestanden.');
