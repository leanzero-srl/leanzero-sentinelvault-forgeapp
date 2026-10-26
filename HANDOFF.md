# HANDOFF — Sentinel Vault 8.22.1 (fix-user-count), Gabee, 2026-10-26

## 8.22.0 — DONE
- Laptop b7cae0e merged with origin d7060ff normally (merge 31fc045), pushed. Main merge 0bc39ea (no-ff), pushed.
- SVT-154 "AI review has a monthly allowance for the whole site": fixVersion 8.22.0, Done (anonymous read).
- Prod: production-release.json 8.22.0 @ e9b10257; forge deploy list production 2026-10-26T11:45Z Success (major 8).
- Worktrees removed by exact path: Gabee .claude/worktrees/fix-ai-allowance, laptop ~/Projects/Sentinel Vault/.claude/worktrees/fix-ai-allowance.
- NOT done: `gh run list --workflow ci.yml --commit 0bc39ea` (check once).

## 8.22.1 — commit e2dc58f on branch fix-user-count (pushed), base main 0bc39ea
Live measurement as the app on wolfaenpak dev (hook fn=userCountProbe, dev-only, stripped from prod):
licence userCount / maxUsers / remainingSeats 401; Jira group member + applicationrole 401;
/wiki/rest/api/group 200; confluence-users-wolfaenpak membersByGroupId = 50 members, 9 accountType=atlassian
(= admin view 9); search/user CQL totalSize 81 (org-wide, wrong); Forge License type has no user count.
Fix (allowance.js): licence count first, else people in default group `confluence-users-<site>` (legacy
`confluence-users`); active paid licence never < 250 users unless the licence count answered
(worst case 250 x $0.03048 = $7.62 / paid site / month); trial/inactive/prod-no-licence stay 10.
Card: row.refusedNeedMicro (smallest refused) -> viewExhausted(); precheck follows. Scope that would fix it
properly: none documented (CONFCLOUD-82766); the org/admin user-management API needs an org API key, not a Forge scope.
Live proof on dev: fresh read -> {users 9, source group}; paid seam (paid=1) -> {250, paid-floor, counted 9},
limit 7,620,000; card: tripped row without refusedNeed -> exhausted false, with refusedNeed 22000 -> true; row restored (was absent).
Tests: test/ai-allowance.test.mjs new blocks; on old main code 12 FAIL (proven in a temp worktree, removed).
Gate: laptop node-run gabee-20261026-140439-3009 exit 0, lint clean, 138/138 incl. responsive-dom 755/755.
(Gabee has no forge-live-harness playwright: responsive-dom fails there "Playwright not found" — env, not code.)
Release note 8.22.1 + entries rows 69dee81acf5fb68a / 2c4927a4bcc6a720 (component C) are IN e2dc58f.

## Open, in order
a. Independent review agent was launched on e2dc58f (result not yet read when this was written). Re-run a fresh
   general-purpose reviewer on `git show e2dc58f` if its result is lost; verify each finding before fixing.
   Areas to check myself: resolver time budget on the first daily read of a big site (25 group pages + 100 member
   pages inside load-validation-config), refusedNeedMicro blocking smaller reviews for the rest of the month.
b. Fix confirmed findings + red tests, re-gate on laptop: worktree `~/Projects/Sentinel Vault/.claude/worktrees/fix-user-count-gate`
   (detached at e2dc58f; `git fetch && git checkout --detach origin/fix-user-count`), via
   `~/Projects/machine-sync/bin/node-run --host laptop -- 'cd ...gate && export PATH=$HOME/.nvm/versions/node/v22.22.0/bin:$PATH && npm ci --silent && npm run lint && npm test 2>&1 | tail -4'`.
c. Door on the laptop in that gate worktree: `./scripts/deploy-prod.sh --sha <full tested sha>` (via node-run, like session 5).
   Then read the new SVT keys from scripts/public-tracker/receipt-leanzero-demo.json (rows above) and curl them anonymously.
d. Merge fix-user-count to main (normal merge, never force), push; remove both worktrees by exact path
   (Gabee .claude/worktrees/fix-user-count, laptop fix-user-count-gate).
e. Fixture restore on wolfaenpak dev: KVS key `ai-licensed-users` did not exist before (now {count 9, kind group});
   delete via hook `what=delete key=ai-licensed-users` (laptop: zsh ~/Projects/forge-live-harness/scratch/sv-ai-allowance/h.sh ...).
   Scratch card.mjs in that laptop folder can go.
## Traps
- Forge CLI on Gabee: `set -a; . ~/.claude/skills/leanzero-analytics/references/credentials.env; set +a` (keychain token invalid).
- `npm run build` before forge deploy; `git checkout -- src/build-info.js` after.
- `forge install --upgrade --license active` does nothing on an up-to-date dev install (no licence object in dev).
- Dev hook client lives on the laptop only (forge-live-harness/.env).
