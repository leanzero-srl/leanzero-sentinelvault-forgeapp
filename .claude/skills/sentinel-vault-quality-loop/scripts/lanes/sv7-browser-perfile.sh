#!/bin/zsh
# Browser lane one spec FILE at a time, recovering the shared profile between files, so one
# crashed browser (a download, an OOPIF) cannot turn every later test into PROFILE_UNAVAILABLE.
S=/private/tmp/claude-501/-Users-mihaiperdum-Projects/65f66400-8299-45c3-a493-c5c5d89b85e6/scratchpad
TAG=$1; OUT=$S/sv7-$TAG-perfile.log; : > $OUT
cd ~/Projects/forge-live-harness
for f in a11y admin-render api-access-tab backup-tab classification deploy-state-guard destructive-actions-perm my-work-page page-seal-unseal realm-console-deep ribbon-esignature sealed-delete-restore-journey settings-consoles steward-console-deep steward-global-persist privacy-status; do
  node scripts/recover-profile-lock.mjs 2>&1 | grep -q stale && node scripts/recover-profile-lock.mjs --fix >/dev/null 2>&1
  HARNESS_REAL_VIEWPORT=1 RUN_ID=sv7-$TAG npx playwright test scenarios/sentinel-vault/$f.spec.ts --project=chromium --workers=1 --reporter=line > $S/sv7-$TAG-b-$f.log 2>&1
  echo "== $f: $(grep -E '^\s+[0-9]+ (passed|failed|flaky|did not run)' $S/sv7-$TAG-b-$f.log | tr -s ' ' | tr '\n' ' ')" >> $OUT
  grep -E "^\s+\[chromium\].*›" $S/sv7-$TAG-b-$f.log | sed 's/^ */   FAIL /' | cut -c1-170 >> $OUT
done
echo DONE >> $OUT
