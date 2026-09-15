# Iteration 1 — #42 Workflow state engine (foundation)

Branch: `aql/workflow-state-engine` (cut from `harness/test-hook` — the dev test-hook the verify phase needs lives here, not on main).
Feature: ledger #42, Priority 23.0 (highest; doc-workflow domain pack; everything F2–F7 depends on it).

## Workflow plan (dynamic)
Research is done (CAPABILITY_EXPANSION.md §F1). This iteration = Phase 4 design → 5 implement → 6 verify → 7 capture. Subagents not needed — pure pattern transcription of an existing capsule; solo implement + adversarial self-critique + live harness.

## Decision & spec

**Scope (tightly-scoped slice of #42):** the BACKEND state engine only — state machine + storage + resolvers + the config def, verified by unit tests + a live test-hook-driven E2E. Deferred to a follow-up slice under #42: the doc-ribbon **state chip** (visual + motion) and the steward **config UI** / at-scale assignment (per-space/label/bulk). Foundation before presentation; F2–F7 all bind to the storage + state-machine this slice ships.

**Functional change:** a page can be assigned a workflow and carries a named state; users can move it along defined transitions; every transition is logged (who/when/from→to). No enforcement yet (that's #44), no approvers yet (that's #43).

**Deliberate deviation from CAPABILITY_EXPANSION §F1 — storage:** use **KVS + hand-rolled indexes**, NOT Custom Entity Store.
- Why: the entire app is KVS; `space-protection-{spaceId}-{attachmentId}` is a proven KVS secondary index rebuilt by a scan worker (`realmScanConsumer`). Custom Entity Store has zero in-repo precedent → a novel primitive + a manifest change + `forge install` re-consent, which contradicts F1's own "Risk 2 / pure transcription" basis.
- Migration safety: if query scale ever demands entity store, the move follows the same scan-worker rebuild the app already uses — we are deferring a primitive we don't need yet, not cornering ourselves.
- Payoff: zero manifest change → `forge deploy` only, no re-consent; smaller diff; matches every sibling capsule.
- Recorded so F7 (dashboard) queries the `workflow-idx-*` prefix, and a later entity-store migration is a conscious choice, not a surprise.

**Data model (all KVS, `storage:app` held):**
- `workflow-def-global` / `workflow-def-space-{sanitizedKey}` — workflow definition; absent → built-in `DEFAULT_WORKFLOW` (Draft→In Review→Approved→Expired).
- `workflow-state-{pageId}` — full record `{ workflowId, stateId, enteredAt, enteredBy, enteredByName, spaceKey, reviewDueAt? }`.
- `workflow-idx-{sanitizedSpaceKey}-{stateId}-{pageId}` — by-state index for F7 (mirrors `space-protection-*`).
- `workflow-log-{pageId}-{ts}` — transition log, **NO TTL** (compliance artifact).
- Content property `sentinel-vault-workflow` = `{ workflowId, stateId, enteredAt }` — CQL-discoverable + cheap trigger probe. NEVER overload `sentinel-vault-validation`.

**Structure (testability):** `logic.js` = pure state-machine helpers + storage/orchestration fns taking explicit args; `actions.js` = thin resolvers that pull pageId/spaceKey/accountId from `req` and add auth. This lets unit tests hit the pure core and the dev test-hook invoke the real storage paths with explicit args.

**Authz (v1, pre-#43):** `assign-workflow` and `store-workflow-config` require `authorizeSteward`. `request-transition` INTO an `enforce`-marked state (Approved) requires steward (placeholder until the #43 approver model); all other transitions allowed for any logged-in actor. Documented so #43 replaces the enforce-entry gate.

**Visual & motion:** none this slice (backend). The chip's state-change settle motion (house easing `cubic-bezier(0.22,1,0.36,1)`, ≤300ms, reduced-motion → instant) is specced for the follow-up.

**Core contract preserved:** purely additive — new capsule, new KVS prefixes, new content-property key. Touches no seal/section/validation code, no trigger. `sentinel-vault-workflow` is a separate property key from `sentinel-vault-validation` (contract V/X clauses untouched). Registry gains one spread.

**Acceptance criteria:**
1. `npm test` green incl. a new `workflow-engine` suite (transition validity, initial-state, config fallback, log ordering).
2. `npm run lint` + `forge lint` clean.
3. `forge deploy` succeeds with NO `forge install` (proves zero manifest change).
4. Existing grade stays green (live-trigger 8/8, seal-e2e 4/4, forge-logs clean) — proves the capsule didn't break the app.
5. New live E2E via the dev hook: assign default workflow to a real page → assert `workflow-state-{pageId}` + content property + initial log; transition Draft→In Review → assert new state + 2nd log entry; reject an illegal transition (Draft→Approved) → assert unchanged; cleanup.

## Design-critic pass (adversarial self-review)
- *"KVS deviation will bite F7's dashboard with unbounded scans."* → F7 queries the `workflow-idx-{space}-{state}-*` prefix (bounded per space+state), exactly the `space-protection-*` scan F7 already planned; no worse than the app's existing steward-console listing. Accepted with the index shipped now.
- *"Content property + KVS + index = 3 writes per transition; partial failure leaves them disagreeing."* → Real. Order: write KVS record first (source of truth), then index, then content property (best-effort, mirrors `writeValidationState` which already swallows property errors). A reconcile pass belongs with #44's integrity sweep; for v1 the KVS record is authoritative and the property is a cache. Documented.
- *"Any logged-in user can transition — spoofable?"* → `req.context.accountId` is Forge-authenticated; the enforce-entry steward gate protects the only consequential state until #43. Non-enforce transitions are advisory in v1 (no enforcement until #44), so the blast radius of a wrong transition is a wrong label, reverted by the next legitimate transition. Acceptable for the slice.
- *"Sanitize regex allows `#`/spaces in the index key — collision risk?"* → identical to the existing `space-protection` sanitize; pageId + stateId segments are app-controlled. No new risk beyond the app's status quo.

## Implementation
- **New:** `src/server/capsules/workflow/logic.js` (pure state machine: `findState`/`getInitialState`/`listTransitions`/`validateTransition`; KVS storage: config fallback, `workflow-state-*` record, `workflow-idx-*` by-state index, `workflow-log-*` no-TTL log; content-property mirror `sentinel-vault-workflow`; orchestration: `assignPageWorkflow`/`transitionPageWorkflow`/`getPageWorkflow`/`getWorkflowLog`). `src/server/capsules/workflow/actions.js` (6 thin resolvers with steward gating on assign/config + enforce-entry). `test/workflow-engine.test.mjs` (25 pure-logic asserts). `test-harness/scripts/workflow-e2e.mjs` (13 live checks).
- **Modified:** `registry.js` (+workflowActions spread); `test-hook.js` (+`invoke fn=assignWorkflow|transitionWorkflow|getWorkflow`, dev-gated, mirrors the expirySweep precedent); `package.json` (+workflow-engine test); `test-harness/package.json` (+workflow-e2e); `grade.sh` (+ensure-fixture prereq + workflow-e2e).
- **Zero manifest change** — resolvers route through existing `action-router`, KVS on held `storage:app`. `forge deploy` deployed v5.7.0 with no `forge install`/re-consent, as designed.
- One bug found+fixed during verify: `getWorkflowLog` passed `.cursor(undefined)` on the first KVS query → 500 "request body invalid". Fixed to the repo convention (first query cursorless; `WhereConditions.beginsWith`; add `.cursor(nextCursor)` only on later pages; cap iterations).

## Verify (live)
- Harness grade: **PASS** (exit 0). Units 90/90 (incl. workflow-engine 25/25), eslint + forge lint clean, health OK, ensure-fixture OK, **workflow-e2e 13/13**, live-trigger 8/8, seal-e2e 4/4, forge-logs clean. Acceptance criteria 1–5 all met.
- workflow-e2e proved LIVE against the deployed backend: assign → initial `draft`; KVS record + by-state index + `sentinel-vault-workflow` content property all written; `draft→in_review` transition moves the index (stale removed, new present); illegal `in_review→expired` rejected with state unchanged; log has ordered assign + transition entries; read model returns available transitions `[approved, draft]`.
- **Runs-on-Atlassian:** the eligibility flag ("webtrigger can egress") is **pre-existing** — the `harness-test-state` dev webtrigger (commit 12e86af), stripped for prod. The workflow capsule itself has zero egress (asApp/asUser Confluence + KVS only). Invariant intact.
- Red-team (above): concurrency index-leak + def-drift + log cap documented as known advisory-mode limitations; none blocking. Enforcement/approvals are #44/#43.

## Outcome
- **Status: verified (engine slice).** #42's backend foundation is live and green. Remaining sub-slice (tracked on the ledger row): the doc-ribbon **state chip** (visual + state-change settle motion) and the steward **config UI** + at-scale assignment — the next iteration should continue #42 there before #43 (which binds to this engine).
- **Score delta (#42):** Fn 1→3 (engine works, no UI yet), Perf 1→3 (bounded queries, indexed), Distinct/Motion/A11y stay 1 (no surface yet).
- **Skill changes:** grade.sh now seeds the seal fixture + runs workflow-e2e; test-hook workflow-invoke pattern + KVS `.cursor()`-never-undefined gotcha captured in the changelog; storage-convention decision (KVS-index over entity store) recorded here for F7/migration.
