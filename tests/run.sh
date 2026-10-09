#!/usr/bin/env bash
# Alle Tests gegen den aktuellen Build ausführen.
# Voraussetzung: Playwright mit Chromium (PLAYWRIGHT_MODULE zeigt auf das Modul, falls nicht lokal installiert).
set -e
cd "$(dirname "$0")/.."
bun run build.mjs
python3 -m http.server 4173 --directory dist >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER' EXIT
sleep 1
OUT=$(mktemp -d)
for t in tests/[0-9]-*.mjs; do
  echo "== $t"
  node "$t" "$OUT"
done
echo "Screenshots: $OUT"
