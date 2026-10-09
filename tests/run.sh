#!/usr/bin/env bash
# Alle Tests: Typen, Unit-Tests (bun test) und End-to-End-Tests (Playwright gegen den Build).
# Aufruf: tests/run.sh            → alles
#         tests/run.sh --nur-e2e  → nur End-to-End (Typen/Unit laufen in CI separat)
# Playwright: lokal installiert oder PLAYWRIGHT_MODULE zeigt auf das Modul.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "${1:-}" != "--nur-e2e" ]; then
  echo "== Typen"; (command -v tsc >/dev/null && tsc -p .) || bunx -p typescript@5.8.3 tsc -p .
  echo "== Unit-Tests"; bun test
fi
bun run build.mjs
python3 -m http.server 4173 --directory dist >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER' EXIT
sleep 1
OUT=$(mktemp -d)
FAILED=0
for t in tests/[0-9]-*.mjs; do
  echo "== $t"
  LOG=$(node "$t" "$OUT" 2>&1) || true
  echo "$LOG" | grep -E "^(ok|FAIL)|FEHLER|Error|bestanden" || true
  echo "$LOG" | grep -q "Alle Prüfungen bestanden" || FAILED=1
done
echo "Screenshots: $OUT"
if [ $FAILED -ne 0 ]; then echo "TESTS FEHLGESCHLAGEN"; exit 1; fi
echo "ALLE TESTS BESTANDEN"
