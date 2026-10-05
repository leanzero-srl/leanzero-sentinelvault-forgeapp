#!/usr/bin/env bash
# Sentinel Vault scope-trim regression lanes, sequential. Usage: sv7-lanes.sh <tag>
set -uo pipefail
TAG="$1"
S=/private/tmp/claude-501/-Users-mihaiperdum-Projects/65f66400-8299-45c3-a493-c5c5d89b85e6/scratchpad
H=$HOME/Projects/forge-live-harness
WT="/Users/mihaiperdum/Projects/Sentinel Vault/.claude/worktrees/sv-7-personal-data"
START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "start $START lanes=${LANES:-all}" >> "$S/sv7-$TAG-progress.log"
want() { [[ -z "${LANES:-}" || " $LANES " == *" $1 "* ]]; }
lane() { echo "$(date +%T) $1 begin" >> "$S/sv7-$TAG-progress.log"; }
cd "$H" || exit 2
if want rest; then lane rest
FILES=(); for s in approval-evidence authz-content-gate config-api-editreq config-api esignature expiry-sweep gate-revert page-section-seal-create perm-delete-cleanup read-confirmations revert-destructive sealed-artifact-trash sealed-media sealed-section workflow-pickers-inbox; do FILES+=("scenarios/sentinel-vault/$s.spec.ts"); done
RUN_ID="sv7-$TAG-rest" npx playwright test "${FILES[@]}" --project=chromium --workers=1 --reporter=line > "$S/sv7-$TAG-rest.log" 2>&1; echo "EXIT=$?" >> "$S/sv7-$TAG-rest.log"
fi
for l in groups purge privacy backup totp; do
  want $l || continue
  lane $l
  ( cd "$S" && node "$S/sv7-$l-lane.mjs" ) > "$S/sv7-$TAG-$l.log" 2>&1; echo "EXIT=$?" >> "$S/sv7-$TAG-$l.log"
done
if want browser; then lane browser
node scripts/recover-profile-lock.mjs > "$S/sv7-$TAG-profilelock.log" 2>&1
if ! grep -q "clean — nothing to do" "$S/sv7-$TAG-profilelock.log"; then
  if grep -qi "dead\|safe to reset\|would reset" "$S/sv7-$TAG-profilelock.log"; then node scripts/recover-profile-lock.mjs --fix >> "$S/sv7-$TAG-profilelock.log" 2>&1; fi
fi
FILES=(); for s in a11y admin-render api-access-tab backup-tab classification deploy-state-guard destructive-actions-perm my-work-page page-seal-unseal realm-console-deep ribbon-esignature sealed-delete-restore-journey settings-consoles steward-console-deep steward-global-persist privacy-status; do FILES+=("scenarios/sentinel-vault/$s.spec.ts"); done
HARNESS_REAL_VIEWPORT=1 RUN_ID="sv7-$TAG-browser" npx playwright test "${FILES[@]}" --project=chromium --workers=1 --reporter=line > "$S/sv7-$TAG-browser.log" 2>&1; echo "EXIT=$?" >> "$S/sv7-$TAG-browser.log"
fi
lane forgelogs
cd "$WT" && forge logs -e development --since "$START" -n 10000 > "$S/sv7-$TAG-forgelogs.log" 2>&1
echo "$(date +%T) DONE" >> "$S/sv7-$TAG-progress.log"
