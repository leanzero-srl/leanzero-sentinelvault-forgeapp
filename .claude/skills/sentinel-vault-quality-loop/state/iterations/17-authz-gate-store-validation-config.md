# Iteration 17 — authz: gate store-validation-config

Branch: `aql/workflow-state-engine`. **Angle: security/authz** (the it16 lead).

## Verify-first
`storeConfig` (`store-validation-config`, validations/actions.js) had NO `authorizeSteward`/site-admin check, unlike its siblings `approvePageGate`/`enqueuePageValidation` and unlike `store-policy` (post-A1). Confirmed it's genuinely open, not gated elsewhere:
- `registry.js` wires resolvers with a plain `router.define(key, fn)` — NO global authz middleware.
- Every harness/E2E flow writes the config via DIRECT KVS (`kvsSet("validation-config-global"…)`, `validation-config-space-…`), never through the resolver → gating it breaks no E2E.

Impact: any authenticated user who can invoke `store-validation-config` could rewrite/disable the ORG-WIDE validation ruleset (incl. the C6 block-severity compliance FLOOR) or the AI budget/prompt (`monthlyTokenBudget`, compliance text).

## Fix (mirrors store-policy audit A1 exactly)
`storeConfig` now:
```
const caller = req.context?.accountId;
const authorized = !!caller && ((scope === "space" && key)
  ? await isOperatorSteward(caller, key)      // already returns true for site admins
  : await isOperatorSiteAdmin(caller));        // global config → site admin only
if (!authorized) return { success:false, reason:"Not authorized — steward or admin access required." };
```
- Uses `isOperatorSteward` (site-admin OR steward-of-space) NOT `authorizeSteward` — the latter also gates on the `allowAdminOverride` toggle, which is for force-unseal overrides, not config writes.
- Returns `{success:false,reason}` (not a throw) — surfaced by the it16 UI error-banner fix.

## Verify
- Grade PASS incl. conditions-e2e 18/18 (E2Es bypass the resolver via direct KVS → no regression) and editgrant-revoke-e2e 7/7 (test-hook untouched).
- Correct-by-inspection vs the proven A1 `canWriteGlobal`/`canWriteSpace`; `isOperatorSiteAdmin` catches its own asUser errors → clean DENY, no crash.
- HONEST CAVEAT: like A1/A3/B6, the ALLOW path can't be positively harness-driven (asUser has no webtrigger context). Verified by mirroring the proven gate + no-regression.

## Churn note — dropped a supplementary smoke test
Tried adding a `testStateFn` hook (`fn=storeValidationConfig`) to invoke `storeConfig` context-less and assert DENY + no-write. The branch NEVER went live after 2 deploys + ~90s polling, while it14's identical pattern (importing the lighter `editreq/actions.js`) worked in ~6s. Cause: importing the HEAVY `validations/actions.js` graph (forge-llm + doc-surgery + rules-engine + a top-level `new Queue(...)`) into `test-hook.js` silently breaks the `testStateFn` bundle — deploy "succeeds" but the function runs old code. Reverted the scaffolding cleanly (import + branch + `validation-authz-e2e.mjs` + the `storeConfig` export keyword); editgrant-revoke-e2e 7/7 confirms the hook is intact. Did NOT rabbit-hole (bias-against-churn).

## LESSON
Only import LIGHT capsule modules into `test-hook.js`. A capsule `actions.js` that instantiates a Queue or pulls the LLM/doc-surgery graph breaks the hook bundle SILENTLY (no deploy error, function serves stale code). For resolver-level hook tests, prefer a light `logic.js` export or a resolver whose deps are minimal.

## Open leads
- `setAiFindingState` (validations/actions.js) writes a per-finding annotation — check if it needs authz (lower stakes than config; not audited this tick).
- The a11y + responsive leads from it14/it15 remain (WorkflowInbox aria-labels, dashboard `<th scope>`, overlay tab-nav).
