#!/usr/bin/env bash
# AQL FULL grade (it57): grade.sh (unit + lint + REST/hook e2e + log scan) PLUS the live browser
# suite. grade.sh alone CANNOT fail a UI-layer regression (it never runs the Playwright specs), so a
# live crash/hang/deploy-staleness passes it silently (e.g. the realm-console setError crash). This is
# the pre-commit gate for any UI-touching tick. Backend-only ticks can keep using grade.sh (faster).
#
# Prereqs: the CURRENT frontend must be built+deployed+installed (npm run build → forge deploy -e
# development → forge install --upgrade) — the browser lane tests the DEPLOYED app, not src/ui.
set -uo pipefail
REPO="/Users/mihaiperdum/Projects/Sentinel Vault"
HARNESS="${SV_HARNESS:-$HOME/Projects/forge-live-harness}"
FAIL=0
step() { echo; echo "=== $1 ==="; }

step "backend grade (grade.sh)"
bash "$REPO/.claude/skills/sentinel-vault-quality-loop/scripts/grade.sh" || FAIL=1

# Browser lane — single shared .auth/profile ⇒ workers:1, NEVER concurrent (the it49 Chrome-kill
# trap). The playwright config already pins workers:1. Clean any stale Chrome lock first.
step "browser suite (forge-live-harness/scenarios/sentinel-vault)"
if [ -d "$HARNESS" ]; then
  pkill -f "Google Chrome for Testing" 2>/dev/null
  rm -f "$HARNESS/.auth/profile/SingletonLock" "$HARNESS/.auth/profile/SingletonSocket" 2>/dev/null
  ( cd "$HARNESS" && RUN_ID="grade-full" npx playwright test scenarios/sentinel-vault --project=chromium --reporter=line ) || FAIL=1
else
  echo "WARN: harness not found at $HARNESS (set SV_HARNESS) — skipping browser lane"; FAIL=1
fi

echo
if [ "$FAIL" -eq 0 ]; then echo "GRADE-FULL: PASS"; else echo "GRADE-FULL: FAIL"; fi
exit "$FAIL"
