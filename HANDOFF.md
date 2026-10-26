# HANDOFF — Sentinel Vault 8.22.1 (fix-user-count), Gabee, 2026-10-26

## DONE 2026-10-26 (released as 8.23.0) — nothing open
- Paging proven live (wolfaenpak, limit=5 on confluence-users-wolfaenpak): membersByGroupId returns
  _links.next "?next=true&limit=N&start=M" (no totalSize), none on the last page, limit>200 = 400. Test f7a7906
  drives 437 members in that shape over 3 pages of 200; red when the next link is ignored.
- Door on laptop, sha f7a79068b69648379e684674894a0ee91faf93d0: deployed, eligible for Runs on Atlassian.
  Forge numbered it 8.23.0 (every prod deploy is minor+1), so the note/record/tracker were renamed 8.22.1 -> 8.23.0
  (4d4f0ab) + guard in test/release-notes.test.mjs (no x.y.N>0). Deployed bundle's What's new says 8.22.1 until the next deploy.
- Tracker: door stopped at apply (stale rows for the pre-review wording); fixed, applied: SVT-155, SVT-156 (fixVersion
  8.23.0, read anonymously), verified 152/152.
- SV production is NOT installed on wolfaenpak (dev only), so no live prod allowance read there.
- Merged to main normally, worktrees removed by exact path.

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

## Review result (independent agent, on e2dc58f): FIX-THEN-SHIP. Verify each before fixing.
H1 (agent reproduced): precheck uses viewExhausted -> after one LARGE refused review (e.g. 150k with 120k left)
   precheck refuses every smaller review for the rest of the month (reserve would accept 30k). Fix: precheck keeps
   plain isExhausted; refusedNeedMicro only for the card wording. Red test: small review passes precheck after big refusal.
M2: failed count is not cached -> every view/precheck/reserve re-lists all groups. Fix: cache {kind:"none", at} 1-6 h.
M3: 25 group + 100 member pages serially can exceed the 25 s resolver budget. Fix: time budget (~8 s), cache partial as "group".
M4: paging breaks on r.length < 200; if server caps limit lower, undercount. Fix: page on b._links.next / b.limit.
M5: renamed site/custom domain -> legacy `confluence-users` may be ANOTHER site's group in a multi-site org. Fix: legacy
   name only when no `confluence-users-*` group exists at all; else floor.
L6: release-note "always gets at least 250" false (admin lowering, licence count < 250); reword; 2nd line after H1.
L7: >5,000 groups misses the default group. L8: deactivated accounts may be counted (slight overcount).
Rejected by reviewer: client-controlled count, floor bypass via cache, lower-then-raise, rollover, settle, trials.
Note: old-code red run crashed on import for the group block; the behavioural block was shown red separately (12 FAIL).


## SESSION 2026-10-26 (Gabee, agent 2) — STATE AT HANDOFF (context limit)
Branch head 4a9e0fb (pushed): 2c86fc1 = H1/M2/M3/M4/M5/L6 fixes; 4a9e0fb = 2nd independent review fixes
(single-scanner lease scanUntil, failure never overwrites a fresh count, budget 4 s, unparseable/capped list = fail,
null app context -> paid floor, inactive members excluded, comments). Each finding has a red test (proven red on the
previous commit in a temp worktree, removed). test/ai-allowance.test.mjs 108/108.
GATE on laptop fix-user-count-gate @4a9e0fb: node-run gabee-20261026-142725-24cd exit 0, lint clean, 138/138, responsive-dom 755/755.
Dev deployed from Gabee worktree (21.116.0, development). Dev cache key ai-licensed-users DELETED (again after probes).
LIVE (wolfaenpak dev, scratch/sv-ai-allowance/h1.mjs on laptop): count {users 9, source group}; paid probe
{250, paid-floor, counted 9}, limit 7,620,000; big review REFUSED (refusedNeed 41,175, left 32,000, card exhausted true)
then small review DONE (spent 1,153). All 4 keys restored = snapshot. groups API has _links.next (confirmed live).
Reviewer known limit (kept, safe side): custom-domain or legacy-group site in a multi-site org -> fallback / paid floor.

## STILL OPEN (in order)
1. Confirm membersByGroupId also returns _links.next (if not, members stop after page 1 = undercount >200).
   Was probing with a user-token script; env var names in forge-live-harness/data/env.mjs unknown. Easiest:
   redeploy dev with the probe `links=1` branch fixed to look up confluence-users-wolfaenpak with limit=200, or
   call it with limit=5 via the hook (add a `memberLimit` param). If no next link: fall back to "page full => continue".
2. Door on the laptop: node-run --host laptop -- 'cd ~/Projects/"Sentinel Vault"/.claude/worktrees/fix-user-count-gate &&
   PATH=$HOME/.nvm/versions/node/v22.22.0/bin:$PATH ./scripts/deploy-prod.sh --sha 4a9e0fb76ae495414c97e27eb005b71cc7338824'
   TRAP: forge in a node-run detached job fails on Keychain on the laptop -> export creds from
   ~/.claude/skills/leanzero-analytics/references/credentials.env (set -a; . file; set +a) inside the job.
   Then SVT keys from scripts/public-tracker/receipt-leanzero-demo.json; curl anonymously.
3. Merge to main (normal), push; remove worktrees by exact path; mark this HANDOFF done.

## Open, in order (previous session)
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
