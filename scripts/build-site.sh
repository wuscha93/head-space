#!/usr/bin/env bash
# Baut die ganze Website: Live-App nach site/, Test-App nach site/test/.
# Aufruf: scripts/build-site.sh [ORDNER_LIVE] [ORDNER_TEST]
#   Ohne Angaben werden beide aus dem aktuellen Stand gebaut (lokal, Tests).
#   In GitHub Actions: Live aus Branch main, Test aus Branch test.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIVE_SRC="${1:-$ROOT}"
TEST_SRC="${2:-$ROOT}"
rm -rf "$ROOT/site"
(cd "$LIVE_SRC" && KF_ENV=live KF_OUT="$ROOT/site" bun run build.mjs)
(cd "$TEST_SRC" && KF_ENV=test KF_OUT="$ROOT/site/test" bun run build.mjs)
