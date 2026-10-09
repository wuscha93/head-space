// Gemeinsame Hilfen für die End-to-End-Tests.

/**
 * Vor jedem Neuladen bzw. Seitenwechsel warten, bis die App alles gespeichert hat.
 * (Ein Mensch lädt nie Millisekunden nach einer Änderung neu; der Test schon.)
 */
export function harden(page) {
  const wait = () => page.evaluate(() => window.kopfFrei?.whenSaved()).catch(() => {});
  const reload = page.reload.bind(page);
  const goto = page.goto.bind(page);
  page.reload = async (opts) => { await wait(); return reload(opts); };
  page.goto = async (url, opts) => { if (page.url().startsWith('http')) await wait(); return goto(url, opts); };
  return page;
}
