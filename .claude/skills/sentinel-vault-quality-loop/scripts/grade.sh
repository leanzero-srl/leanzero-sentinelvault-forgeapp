#!/usr/bin/env bash
# AQL grade: grades the app by running it — unit tests, lint, then black-box E2E
# against the REAL deployed dev app + forge log scan. Run from anywhere.
set -uo pipefail
REPO="/Users/mihaiperdum/Projects/Sentinel Vault"
FAIL=0
step() { echo; echo "=== $1 ==="; }

cd "$REPO" || exit 2

step "unit tests (npm test)"
npm test || FAIL=1

step "eslint (npm run lint)"
npm run lint || FAIL=1

step "forge lint"
forge lint || FAIL=1

step "E2E health"
( cd "$REPO/test-harness" && npm run health ) || FAIL=1

step "E2E seal fixture (prereq for seal-e2e)"
( cd "$REPO/test-harness" && npm run ensure-fixture ) || FAIL=1

# Run the seal REVERT test EARLY — it depends on timely delivery of an async attachment
# product-trigger, which backs up at the tail of a heavy suite. Running it before the
# workflow E2Es keeps the trigger queue clear so the revert fires promptly.
step "E2E seal REVERT (audit A5 — the flagship seal->tamper->assert-revert path)"
( cd "$REPO/test-harness" && npm run seal-revert-e2e ) || FAIL=1

step "E2E workflow engine (#42, assign/transition/log via dev hook)"
( cd "$REPO/test-harness" && npm run workflow-e2e ) || FAIL=1

step "E2E workflow auto-assign (#42, created:page trigger auto-assigns)"
( cd "$REPO/test-harness" && npm run workflow-autoassign-e2e ) || FAIL=1

step "E2E workflow bulk-assign (#42, apply to existing pages)"
( cd "$REPO/test-harness" && npm run workflow-bulk-e2e ) || FAIL=1

step "E2E workflow approvals (#43, multi-approver transitions)"
( cd "$REPO/test-harness" && npm run workflow-approval-e2e ) || FAIL=1

step "E2E workflow enforce (#44, revert-on-tamper / demote / sweep)"
( cd "$REPO/test-harness" && npm run workflow-enforce-e2e ) || FAIL=1

step "E2E workflow conditions (#46, content gate + AI review axis)"
( cd "$REPO/test-harness" && npm run workflow-conditions-e2e ) || FAIL=1

step "E2E live trigger exercise (real Confluence events)"
( cd "$REPO/test-harness" && node scripts/live-trigger-e2e.mjs ) || FAIL=1

step "E2E seal lifecycle smoke"
( cd "$REPO/test-harness" && npm run seal-e2e ) || FAIL=1

step "forge logs scan (crash/5xx/egress/LLM/parse signals)"
( cd "$REPO/test-harness" && npm run forge-logs ) || FAIL=1

echo
if [ "$FAIL" -eq 0 ]; then echo "GRADE: PASS"; else echo "GRADE: FAIL"; fi
exit $FAIL
