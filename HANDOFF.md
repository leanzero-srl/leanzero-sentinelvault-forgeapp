# HANDOFF — site-wide AI allowance (cost guard), 2026-10-26

SESSION 3 (2026-10-26): CODE + TESTS DONE AND COMMITTED (751e645, 92a772b). Read 'Session 3' at the bottom first.

## Where the work is
- Worktree (Gabee's Mac): `~/Projects/leanzero-sentinelvault-forgeapp/.claude/worktrees/fix-ai-allowance`,
  branch `fix-ai-allowance` (`--no-track`, from origin/main b9c3cd5), `npm ci` done there.
- The workhorse repo `~/Projects/Sentinel Vault` is at the same origin/main. The door runs on the workhorse
  (forge auth: `set -a; source ~/.claude/skills/leanzero-analytics/references/credentials.env`). Load the
  `sentinel-vault` skill first. Raw `ssh workhorse 'npm ...'` is blocked by the node-dispatch hook: use
  `~/Projects/machine-sync/bin/node-run --host workhorse -- '<cmd>'`, or run tests here on Gabee.
- No SVT ticket exists yet. Add a KNOWN entry in `scripts/public-tracker/entries.mjs`, run the driver
  (`plan`, then `apply`) with `PUBLIC_TRACKER_ENV=~/Projects/CogniRunner/test-harness/.env` (that path is on the
  workhorse/laptop, not on Gabee).

## The task (owner, 2026-10-26)
Default site-wide monthly AI allowance = N x licensed users x $0.0305, N = 1 (one worst-case review:
10k tokens in, 4,096 out). Free sites (10 users or fewer) get the 10-user allowance. Meter it on the tokens the
model reports. When it is spent, AI review stops until the next month with a clear message to the admin and the
user; non-AI features keep working. An admin may LOWER it, never raise it above the default (no paid or own-key
path exists: grep found no API-key path, only Forge LLM). Ship via the door, live trip + reset check on
wolfaenpak dev, independent adversarial review before release (meter concurrency, month rollover, bypass paths,
licence count unavailable). Report max 12 lines.

## Facts already measured / read (do not redo)
- Price (Forge LLM pricing page, fetched today): Haiku 4.5 = $1 per 1M input, $5 per 1M output. Meter in
  micro-dollars: cost = in x 1 + out x 5. Worst case 10,000 + 4,096 x 5 = 30,480 micro-dollars ($0.0305).
  NOTE: AI-COST-CEILING.md line 11 quotes "$0.10 per 1M input credits": that is per CREDIT (10 credits per token
  for Haiku), so the effective price per token is $1/$5. Fix that sentence when you update the doc.
- The only LLM call sites: `src/server/infra/forge-llm.js` (callForgeLlmChat / runForgeLlmJson, retries 429/5xx
  3x) called ONLY from `src/server/capsules/validations/ai-worker.js` (handleGateReview line ~44, manual consumer
  line ~112). `test/ai-ceiling.test.mjs` already fails the build if another module calls the LLM or pushes onto
  `ai-validation-queue` without the gate. Enqueue paths: `actions.js` enqueuePageValidation + enqueueAiGate.
- Current gate: `logic.js` capAiConfig / checkAiSpend / aiGateRefusal (the ONE home). Usage is a per-SPACE
  read-modify-write row `ai-usage-<space>-<YYYYMM>` (accrueTokenUsage): racy, and the site budget is per space
  (leak 1 in AI-COST-CEILING.md). Default `monthlyTokenBudget: 0` = unlimited.
- Licence count: the Forge licence object and the License API (`GET /forge/app/v1/license` via
  asApp().requestAtlassian, no scope) carry NO user count (fields: active, type, isEvaluation, trialEndDate,
  subscriptionEndDate, billingPeriod, supportEntitlementNumber, ccpEntitlementId/Slug, capabilitySet).
  Confluence Cloud has no documented count endpoint (CONFCLOUD-82766). MEASURED on wolfaenpak with the admin USER
  token: `GET /wiki/rest/license/1.0/license/userCount` = 200 `{"count":9}` (maxUsers 150000, remainingSeats
  149991). NOT yet tested asApp from the app: do that first on dev (generic hook seam or a small resolver).
  Unofficial endpoint, reported 404 in some regions. Marketplace vendor API = egress + vendor creds = no.
- Users never supply the number; never read it from a payload.

## Design I settled on (attack it in review, but start here)
1. `allowance.js` (new, validations capsule): `defaultAllowanceMicro(users) = max(users,10) x 30480`.
   Count source = asApp userCount, cached in KVS `ai-licensed-users` {count, at} for 24 h; a failed read uses the
   last good count up to 35 days old, else the CONSERVATIVE fixed default = 10 users (say so in the UI:
   "Could not read the licensed user count; using the 10-user allowance"). Licence API isEvaluation true or
   active false -> 10-user allowance (a trial is not licence-funded; flag this choice in the report).
   Dev (no licence object) -> use the count.
2. Admin lowering: `validation-config-global.ai.monthlyAllowanceUsd` (or micro). Effective = min(stored, default);
   a value above the default is clamped on save AND on read (REST writes go through store-validation-config, so
   the clamp covers REST). Never raises.
3. Meter: one SITE row per month `ai-allowance-<YYYYMM>` {spentMicro, reservedMicro, runs, reservations{id:micro}}
   changed ONLY under `withLock("ai-allowance-lock", 15000, ...)` (shared/kvs-lock.js, takeover-safe).
   Consumer, right before the LLM call: reserve worst case for THIS prompt (ceil(chars/3) in + maxTokens x 5);
   refuse if spent+reserved+reserve > allowance. After the call: settle (drop reservation, add actual from
   res.usage, even on failure/parse error). A crash leaves the reservation counted (fail-safe). Lock busy or KVS
   read failed -> refuse "AI review is busy, try again" (fail closed). Enqueue paths do a cheap non-reserving
   check so users get the message at once. Month = UTC month from the row key; a new month = new row (rollover is
   automatic; test it with an injected clock). Keep the per-space budget as is (it still caps a space).
   The 3 transient retries in callForgeLlmChat are failed calls (no tokens); settle uses only reported usage.
4. Messages: user (panel manual review + workflow gate reason): "This site has used its AI review allowance for
   <Month>. AI review starts again on <1st of next month>. Other Sentinel Vault features keep working." Gate:
   onBudgetExhausted decides block/allow exactly like the per-space budget (aiGateRefusal, why "allowance").
   Admin: site Validations editor (ValidationsEditor.jsx, scope global) shows allowance, used, remaining, reset
   date, user count + its source, and a number field to lower it (custom controls only: no native select/alert,
   no left rails, no faded tints). One activity row `validation.ai-allowance-reached` per month when it trips.
5. REST: `get-validation-audit` / a new read resolver `get-ai-allowance` (site admin) + add to the config API
   ops (bundle.js op table) and docs/REST-CONFIG-API.md. Run `node scripts/gen-action-names.mjs` after adding
   buttons/refusal texts. Backup: register new KVS keys in backup/families.js (backup-families.test fails
   otherwise; the meter is runtime, not config). Action log: resolvers via registry define() only.
   Logs: errText only, no account ids.
6. Tests: test/ai-allowance.test.mjs (fake KVS with latency: 20 concurrent reservations never exceed the
   allowance; rollover; count unavailable -> 10 users; clamp on save and REST; settle on failure). Extend
   ai-ceiling.test.mjs so the LLM call must sit between reserve and settle.
7. Marketplace: no manifest/scope change expected (userCount is a Confluence REST read; check which scope the
   app call needs: if it needs a new scope, that is a MAJOR + admin re-consent -> then fall back to the
   10-user default instead and report it).

## Live check plan (wolfaenpak dev)
Deploy dev, lower the allowance to $0.01 as site admin, run one manual AI review (passes, meter shows actual),
run another (refused with the message; gate refused too), then raise it back to the default (works again);
seed the previous month's row as fully spent and show the current month is unaffected (rollover). Restore config.

## Session 2 (2026-10-26, Gabee) — code read, design pinned to the code. STILL NO CODE WRITTEN.
Stopped again at the 160k hook (the global CLAUDE.md + skill text alone cost ~45k; next agent: do NOT load the
whole sentinel-vault skill, its "Release speed", "Production door from the laptop" and "Action log" sections are
the only parts needed; grep them).

Code facts (read, file:line on f1bb2f2):
- ai-worker.js: handleGateReview (l.21-66) and aiValidationConsumer (l.72-159) both call checkAiSpend(spaceKey),
  build {system,user} via buildValidationPrompt, then `runForgeLlmJson({model,system,user})` (maxTokens defaults
  4096 in forge-llm.js l.51), then accrueTokenUsage(realmKey||spaceKey, res.usage). usage = {inputTokens,
  outputTokens,totalTokens}; on a failed call forge-llm returns zeros (l.129).
- logic.js: checkAiSpend l.194 is the ONE gate used by enqueuePageValidation (actions.js l.387), enqueueAiGate
  (l.402) and both consumer branches -> put the cheap allowance check INSIDE checkAiSpend (new why:"allowance",
  why:"busy"), and extend aiGateRefusal l.220 (allowance -> like budget: onBudgetExhausted block/allow, with the
  site message; busy -> verdict "failed" + "please retry", never allow).
- Lock: shared/kvs-lock.js makeLocks(kvs) -> {withLock(key, holdMs, fn, {waitMs})}; throws "lock ... is busy".
  Make allowance.js a factory makeAllowance({kvs, locks, now, fetchCount, licence}) so the test can inject the
  latency/FAIL_IF_EXISTS fake from test/kvs-lock.test.mjs (the SHARED fake test/_forge-fake/kvs.mjs IGNORES
  keyPolicy, so a lock there always wins: unusable for the concurrency test).
- Licence: `getAppContext().license` from @forge/api (runtime.d.ts: active, isEvaluation, ...) works in ANY
  invocation (no resolver context needed). Rule: license present and (isEvaluation || active===false) -> 10 users;
  environmentType PRODUCTION and no license -> 10 users; dev -> count.
- Count read: asApp requestConfluence(route`/wiki/rest/license/1.0/license/userCount`) (tests: onConfluence handler).
  Cache KVS `ai-licensed-users` {count, at}. NOT yet tested as the app: first dev deploy will tell; expose it via a
  test-hook fn (`what=invoke&fn=aiAllowance`) returning the allowance view incl. source.
- Admin lowering: site-only field `validation-config-global.ai.monthlyAllowanceMicro` (absent/<=0 = default);
  read from the GLOBAL ai only (never the space's, never via capAiConfig's merged view). Clamp: min(stored,
  default) on read; storeConfig (actions.js l.116) stores min too. REST: the config API stores through the same
  resolver, and the read side = add a derived `aiAllowance` view to loadConfig's global answer (export.js l.53 reads
  it -> REST export shows it) and strip `aiAllowance` in storeConfig next to `effectiveAi` (l.139). No new REST op.
- UI: src/ui/kit/ValidationsEditor.jsx (395 lines), AI section l.339-380; global scope only: allowance card
  (used / reserved / limit in $, reset date, users + source, lowered or not) + a number input in dollars
  (custom styles; MiniSelect exists, no native select). Exhausted: solid notice, not a tint, no left rail.
- Activity: recordActivity({type:"validation.ai-allowance-reached", pageId:null, spaceKey:null, actor:null,
  target:{kind:"site"...}, details:{month, limitMicro}}) once per month (row.reachedAt set inside the lock);
  add a case in src/ui/kit/activity-format.js next to validation.ai-capped (l.513) and to the list at l.36.
- Backup: register `ai-allowance-` (meter rows + lock) and `ai-licensed-users` as cls "runtime" in
  backup/families.js (l.91 block) — runtime so a backup restore can never roll the meter back (ai-usage- is
  "config", a pre-existing rollback hole for the per-space budget: mention to reviewer, not in scope).
- Meter row `ai-allowance-YYYYMM` {spentMicro, reservedMicro, runs, reservations:{[taskId]:{micro,at}}, reachedAt};
  settle by the MONTH IT WAS RESERVED IN (carry month in the reservation result). Reserve estimate:
  ceil((system.length+user.length)/3) + 4096*5. Pre-check refuses when limit-spent-reserved <= 4096*5.
- Live trip plan: run one review at the default, read the meter via the hook, lower the allowance to spent+1000
  micro through store-validation-config (hook invoke as the site admin), run again -> refused message + gate
  refusal; restore the field; seed `ai-allowance-<last month>` fully spent -> current month unaffected; delete it.

## Session 3 (2026-10-26, Gabee) — IMPLEMENTED. Stopped at the 160k hook before release.
Commits on fix-ai-allowance: 751e645 (feature), 92a772b (tests, guards, AI-COST-CEILING.md price-per-token fix).
Done:
- `src/server/capsules/validations/allowance.js`: makeAllowance({kvs,locks,now,fetchCount,appContext,lockWaitMs})
  -> licensedUsers/limits/view/precheck/reserve/settle; real instance exported as `aiAllowance`. Row TTL 120 d.
  Expired reservations (>20 min) are charged at their reserved size; a late settle of an expired one adds nothing.
  Precheck/exhausted = remaining <= 20,480 (one output reserve). Busy lock (wait 8 s) / unreadable meter -> why "busy".
- logic.js checkAiSpend: allowance precheck after the space budget (returns globalAi); readGlobalAiForAllowance();
  aiGateRefusal: "busy" -> failed+retry, "allowance" -> onBudgetExhausted block/allow with the site message.
- ai-worker.js callWithinAllowance(): reserve -> runForgeLlmJson -> settle, both branches; refusal -> gate verdict /
  manual status error. Activity `validation.ai-allowance-reached` (site:true) on the first trip (activity-log.js
  ACTIVITY_TYPES + activity-format.js case + validation filter list).
- actions.js: global loadConfig adds derived `aiAllowance` view (REST export shows it); storeConfig strips
  `aiAllowance`, clamps ai.monthlyAllowanceMicro to the default (drops it for space scope or <=0).
- UI: src/ui/kit/AiAllowanceCard.jsx (global scope, above "Enable AI review"), CSS in tokens/realm-console.css
  (.val-ai-allowance*: full border, solid exhausted notice). gen-action-names run.
- backup/families.js: `ai-allowance-` and `ai-licensed-users` runtime.
- Tests: test/ai-allowance.test.mjs 41/41 (lock-test fake; 25 concurrent reservers never exceed 4 grants);
  ai-ceiling guard: one model call between reserve and settle; process-state allowlist `makeAllowance`.
  `npm test` 136/137 (only responsive-dom: Playwright missing on Gabee; run it on laptop/workhorse), lint clean.
Open, in order:
1. Independent adversarial review was LAUNCHED (background general-purpose agent, diff 9ac0f4b..HEAD); its report was
   not received before this stop. Re-run one if no result is in hand: lenses concurrency, rollover, bypass,
   missing count, backup/restore (note: a config restore can carry ai.monthlyAllowanceMicro — read side clamps
   to default, so it can never raise; meter is runtime so never rolled back). Verify each claim before fixing.
2. Not done: no test-hook fn for the live read (`what=invoke&fn=aiAllowance`); docs/REST-CONFIG-API.md not updated
   (export now includes `aiAllowance`). The live read can go through load-validation-config as a site admin.
3. SVT ticket: features get their row via the release-note line hash in entries.mjs ENTRIES (component "C"),
   written by the door's `release-gate.mjs prepare`; see skill lines 11-12, 61-74, 155-160, 528-540.
4. Release: forge is logged in only on the LAPTOP. Door per skill line 155: release worktree from origin/main
   after merging this branch, `npm ci`, `PUBLIC_TRACKER_ENV=$HOME/Projects/CogniRunner/test-harness/.env
   ./scripts/deploy-prod.sh --sha <tested sha> --non-interactive`. Feature = MINOR (no manifest/scope change).
5. Live on wolfaenpak dev (laptop forge): deploy dev, read view (confirm userCount works AS THE APP; if 403/404 the
   source shows "fallback" = 10 users), run one review, lower allowance to spent+1000 micro, run again -> refused
   with message + gate refusal, restore; seed `ai-allowance-<last month>` spent -> current month unaffected; delete.

## Review result (independent agent, 2026-10-26): FIX-THEN-SHIP. Each item still needs YOUR verification first.
1. MED storeConfig clamps the stored value with the CURRENT default; a save during a count outage (fallback 10 users)
   permanently lowers a big site's stored allowance. Fix: store `asked` as given (read side clamps), drop the save clamp.
2. MED AiAllowanceCard input is controlled by the stored micro value: typing "0." empties, "1" snaps to default.
   Fix: local text state, convert + clamp on blur.
3. MED userCount as the app never tested; log res.status when !res.ok (warn), then the live check decides.
4. LOW-MED licence: also treat `lic.isActive === false` as unlicensed (runtime.d.ts has both active? and isActive?).
5. MED bursts: two lock takes per review, wait 8 s < hold 15 s (kvs-lock L3 says wait > hold). Fix: waitMs = hold+5 s
   (consumer is 120 s), retry settle once; consider measuring 50 concurrent with the lock-test fake.
6. LOW estimate chars/3 is not worst case for CJK: use ceil(chars/1.5) (or cap) and fix the comment in settle.
7. LOW manual review id = taskId: a re-delivered event overwrites the first reservation. Fix: id `${taskId}:${Date.now()}`.
Rejected by the reviewer: limit overrun under concurrency, RMW outside the lock, rollover leak, LLM bypass, raising via
space/REST/restore, restore rolling the meter back, gate left hanging, double charge on expiry, dev install w/o licence.
