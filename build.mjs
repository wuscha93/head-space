// Build: bun run build.mjs                 → Live-App (echte Daten)
//        KF_ENV=test bun run build.mjs     → Test-App (eigene Daten, Beispieldaten, kein Sync)
// Erzeugt dist/ (zum Hosten auf GitHub Pages) und preview/kopf-frei.html (eine Datei zum Ausprobieren).
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';

const ENV = process.env.KF_ENV === 'test' ? 'test' : 'live';
const TEST = ENV === 'test';
const NAME = TEST ? 'Kopf frei TEST' : 'Kopf frei';
const out = process.env.KF_OUT || 'dist';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const build = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
const result = await Bun.build({
  entrypoints: ['src/main.ts'], target: 'browser', minify: true,
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __APP_BUILD__: JSON.stringify(build), __APP_ENV__: JSON.stringify(ENV) },
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
const js = await result.outputs[0].text();
const css = ['src/styles.css', 'src/cards.css'].map((f) => readFileSync(f, 'utf8')).join('\n');
const shell = readFileSync('src/shell.html', 'utf8').replace(/>Kopf frei</g, `>${NAME}<`);

for (const f of readdirSync('public')) cpSync(`public/${f}`, `${out}/${f}`);
// Test-App: eigenes Symbol (orange), eigener Name
if (TEST && existsSync('public-test')) for (const f of readdirSync('public-test')) cpSync(`public-test/${f}`, `${out}/${f}`);
const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
if (TEST) Object.assign(manifest, { name: NAME, short_name: 'KF Test', theme_color: '#cb4b16', description: 'Test-Umgebung von Kopf frei mit Beispieldaten.' });
writeFileSync(`${out}/manifest.webmanifest`, JSON.stringify(manifest, null, 2));
writeFileSync(`${out}/app.js`, js);
writeFileSync(`${out}/styles.css`, css);
// Cache-Name je Umgebung, damit sich Live und Test (gleiche Domain) nie gegenseitig aufräumen
writeFileSync(`${out}/sw.js`, readFileSync('public/sw.js', 'utf8').replace('__BUILD__', build).replace('__CACHE_PREFIX__', TEST ? 'kopf-frei-test-' : 'kopf-frei-'));

writeFileSync(`${out}/index.html`, `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${NAME}</title>
<meta name="description" content="Persönliche Aufgabenverwaltung nach Getting Things Done. Alle Daten bleiben auf dem Gerät.">
<meta name="theme-color" content="#fdf6e3" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#002b36" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="${NAME}">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://api.github.com; object-src 'none'; base-uri 'none'">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="stylesheet" href="styles.css">
</head>
<body>
${shell}<script type="module" src="app.js"></script>
</body>
</html>
`);

// Vorschau als eine Datei (ohne Service Worker)
mkdirSync('preview', { recursive: true });
const safeJs = js.replace(/<\/script/gi, '<\\/script');
writeFileSync('preview/kopf-frei.html', `<title>${NAME}</title>
<style>
${css}
</style>
${shell}<script>window.KF_NO_SW = true;</script>
<script type="module">
${safeJs}
</script>
`);

console.log(`Fertig (${ENV}): ${out}/ Version ${pkg.version} (${(js.length / 1024).toFixed(1)} KB JavaScript), Build ${build}`);
