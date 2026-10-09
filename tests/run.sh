#!/usr/bin/env bash
# Alle Tests: Typen, Unit-Tests (bun test) und End-to-End-Tests (Playwright gegen den Build).
# Aufruf: tests/run.sh                  → alles
#         tests/run.sh --nur-e2e        → nur End-to-End (Typen/Unit laufen in CI separat)
#         tests/run.sh 3 9              → Typen, Unit-Tests und nur die End-to-End-Tests 3 und 9
#                                         (für kleine Änderungen lokal; GitHub prüft immer alles)
# End-to-End-Tests laufen parallel (E2E_PARALLEL, Standard 4). Test 4 ändert die gebaute
# Website (simuliertes Update) und läuft deshalb allein am Schluss.
# Playwright: lokal installiert oder PLAYWRIGHT_MODULE zeigt auf das Modul.
set -euo pipefail
cd "$(dirname "$0")/.."
NUR_E2E=0
if [ "${1:-}" = "--nur-e2e" ]; then NUR_E2E=1; shift; fi
if [ $NUR_E2E -eq 0 ]; then
  echo "== Typen"; (command -v tsc >/dev/null && tsc -p .) || bunx -p typescript@5.8.3 tsc -p .
  echo "== Unit-Tests"; bun test
fi

ALL=$(ls tests/[0-9]*-*.mjs | sort -V)
if [ $# -gt 0 ]; then
  SEL=""
  for n in "$@"; do SEL="$SEL $(echo "$ALL" | grep -E "^tests/${n}-" || true)"; done
  ALL=$(echo $SEL | tr ' ' '\n' | grep . | sort -uV)
  [ -n "$ALL" ] || { echo "Keine End-to-End-Tests gefunden für: $*"; exit 1; }
fi

scripts/build-site.sh
python3 -m http.server 4173 --directory site >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER' EXIT
sleep 1
OUT=$(mktemp -d)
LOGS=$(mktemp -d)

run_one() { # $1 = Testdatei; schreibt Protokoll nach $LOGS
  local name; name=$(basename "$1" .mjs)
  node "$1" "$OUT" >"$LOGS/$name.log" 2>&1 || true
}
export -f run_one; export OUT LOGS

PAR=$(echo "$ALL" | grep -v "^tests/4-" || true)
SER=$(echo "$ALL" | grep "^tests/4-" || true)
START=$(date +%s)
[ -z "$PAR" ] || echo "$PAR" | xargs -P "${E2E_PARALLEL:-4}" -I{} bash -c 'run_one {}'
for t in $SER; do run_one "$t"; done

FAILED=0
for t in $ALL; do
  name=$(basename "$t" .mjs)
  LOG=$(cat "$LOGS/$name.log")
  echo "== $t"
  echo "$LOG" | grep -E "^(ok|FAIL)|FEHLER|Error|bestanden" || true
  if ! echo "$LOG" | grep -q "Alle Prüfungen bestanden"; then
    FAILED=1
    # In GitHub Actions als Anmerkung ausgeben (über die API lesbar)
    if [ -n "${GITHUB_ACTIONS:-}" ]; then
      MSG=$(echo "$LOG" | grep -vE "^ok " | grep -v "^\s*$" | tail -25 | sed 's/%/%25/g' | awk '{printf "%s%%0A", $0}')
      echo "::error title=$t::$MSG"
    fi
  fi
done
echo "End-to-End: $(( $(date +%s) - START )) s, Screenshots: $OUT"
if [ $FAILED -ne 0 ]; then echo "TESTS FEHLGESCHLAGEN"; exit 1; fi
echo "ALLE TESTS BESTANDEN"
