#!/usr/bin/env bash
# Run a list of Sentinel Vault live specs from forge-live-harness against dev.
# Usage: sv-a774-run-lane.sh <run-id> <log> spec1 spec2 ...
set -uo pipefail
RUN="$1"; LOG="$2"; shift 2
cd "$HOME/Projects/forge-live-harness" || exit 2
FILES=()
for s in "$@"; do FILES+=("scenarios/sentinel-vault/$s.spec.ts"); done
RUN_ID="$RUN" npx playwright test "${FILES[@]}" --project=chromium --workers=1 --reporter=line > "$LOG" 2>&1
echo "EXIT=$?" >> "$LOG"
