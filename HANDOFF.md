# HANDOFF — site-wide AI allowance (cost guard), 2026-10-26

Stopped at the 160k context rule before writing code. Nothing is implemented yet. This file is the brief.

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
