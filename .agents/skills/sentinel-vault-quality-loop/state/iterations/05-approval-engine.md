# Iteration 5 — #43 Multi-approver approval engine (backend)

Branch: `aql/workflow-state-engine`. Feature: ledger #43, the approval-decision backend — a transition into the enforce state (In Review → Approved) can require named approvers with any-of / all-of / min-N modes, gated until the threshold resolves. Binds to the #42 engine.

## Workflow plan (dynamic)
Research (done): mirrors the editreq request/decision/inbox lifecycle; F2 spec + Comala's tie→reject rule. Decompose #43: iteration 5 = decision engine + records + transition gating (backend, harness-verified); iteration 6 = approvals inbox UI + mention-comment notifications + approver-picker config + group expansion.

## Decision & spec
- **Functional change:** when a space has approvers configured, `request-transition` into the enforce state opens a *pending approval* (one record per approver) instead of transitioning; approvers `decide-approval` (approve/deny + reason); the transition completes only when the mode threshold is met, and is cleared on denial. Falls back to the #42 steward gate when no approvers are configured.
- **Decision modes (pure `evaluateApproval`, unit-tested):** `any` (first approval wins; all-denied rejects), `all` (any denial rejects; needs every approval), `min-N` (needs N approvals; rejects once N is unreachable). Empty approvers → auto-approve.
- **Data model (new file `workflow/approvals.js`):** `workflow-approval-{pageId}-{stateId}-{approvalId}-{approverAccountId}` (status/decidedAt/reason/pinnedVersion) + `workflow-pending-{pageId}` (toStateId/approvers/mode/min/pinnedVersion). Deliberately NOT under `edit-request-*`/`edit-grant-*` (seal sweeps + editreq inbox stay clean). `approvalId="approval"` (v1 single round; segment reserved for named rounds). Approver config in `workflow-settings-{key}.approval` = `{ approvers:[{type,id,name}], mode, min }`.
- **Core contract preserved:** additive; the completion path reuses the verified `transitionPageWorkflow`. The approvers ARE the authority for the enforce state (they replace the #42 steward gate when configured). v1 approvers are USER type; group expansion → iteration 6.

## Design-critic pass (adversarial self-review)
- *"Who can OPEN an approval?"* → Anyone who can request a transition (the requester). Only configured approvers can DECIDE (the record must exist). Self-approval (requester is also an approver) is allowed in v1 — flagged for the review as a possible policy gap.
- *"Concurrency on completion?"* → `decideApproval` re-reads ALL records before evaluating, and `clearPageApprovals` removes the pending marker; a second concurrent decision after clear finds no pending → no double-complete. Flagged for the review to confirm the window.
- *"Staleness (page changed since approvals requested)?"* → `pinnedVersion` is stored; enforcement/flagging is deferred to the inbox UI (iteration 6). Documented, not silently dropped.

## Implementation
- **New:** `src/server/capsules/workflow/approvals.js`; `test-harness/scripts/workflow-approval-e2e.mjs`.
- **Modified:** `workflow/actions.js` (requestTransition approval gate + decide-approval / get-page-approvals / list-my-approvals resolvers + `fetchPageVersion`); `workflow/logic.js` (setSpaceWorkflowSettings stores the approval block); `test-hook.js` (+requestApproval / decideApproval / pageApprovals); `test/workflow-engine.test.mjs` (+17 decision/resolve asserts); grade.sh + package.json.
- Backend change → `forge deploy` (no manifest change → no re-consent). Gotcha: right after deploy, one hook call briefly hit the pre-deploy function ("unknown fn"); re-running after propagation → green (documented).

## Verify (live)
- Unit 47/47 (incl. 17 new: every mode × edge, resolveApprovers). **Full grade PASS** (11 suites; **workflow-approval-e2e 11/11**, zero regression).
- workflow-approval-e2e proved LIVE: mode-`all` two approvers → approval opens, page NOT transitioned, first approval keeps pending, second completes the transition + clears pending; a denial rejects + clears + page stays In Review; a non-approver cannot decide.
- Adversarial review (decision / authz-integration; robustness lens rate-limited): **7 CONFIRMED, all fixed + re-verified (approval-e2e 11/11 after fixes).** Root cause of the three worst: I used eventually-consistent `kvs.query()` to read records I'd just written, when I already hold the exact approver list in the pending marker.
  - **HIGH — read-after-write on `kvs.query()`:** `decideApproval` aggregated via query (eventually consistent) → could miss its own just-written vote (single-approver "any" → stuck pending, nothing re-triggers) OR see empty → `total===0` → "approved" firing off zero records. Fixed: aggregate from strongly-consistent per-key `kvs.get` over `pending.approvers`.
  - **HIGH — cross-space authz:** the enforce/approval gate resolved settings + `authorizeSteward` from the caller-supplied `spaceKey`, so a steward of space X could drive a transition on a page in space Y. Fixed: derive the authoritative space from the page's own workflow record.
  - **MEDIUM ×3:** `clearPageApprovals` leaked phantom-pending records via an un-cursored query (→ delete the known keys); `min > approver count` denied on the first vote (→ clamp min in `resolveApprovers`); a re-request silently reset approvers' decisions (→ only requester/steward may re-open).
  - **MEDIUM — self-approval:** the requester could approve their own transition (→ SoD check: `approverAccountId !== pending.requestedBy`).
  - **LOW — decided record could flip** (→ status guard).
  - Rejected (correctly): pinnedVersion-not-enforced (documented deferral to the inbox UI).

## Outcome
- **Status: verified (approval-engine backend).** Multi-approver transitions (any/all/min-N) gate the enforce state, with strongly-consistent decisioning, cross-space-safe authz, and segregation of duties. approval-e2e 11/11, full grade PASS.
- **NOT yet user-facing** (deliberate): approvers can only be configured + decided via the dev hook — there is no config picker or approvals inbox UI yet, so no real user can reach a pending-approval state. **Iteration 6 MUST land the UX** (approver picker in the Workflow tab + an approvals inbox + a ribbon "awaiting approval" indicator + mention-comment notifications) before this is meaningfully "on" — shipping the engine without the UX would create a state users can reach but not resolve (the exact CogniRunner failure mode the owner warned about).
- **Skill learnings:** (1) **NEVER use `kvs.query()` to read a record you just `kvs.set()` — it's eventually consistent**; per-key `get`/`delete` over a known id list is strongly consistent (Forge KVS: only get/set/delete per-key are strict). Store the id list (here `pending.approvers`) precisely so you never need a query for correctness. (2) Resolve authz/space from the SERVER-OWNED record, never a caller-supplied payload field — cross-tenant/space privilege bugs hide there. (3) A green E2E does NOT prove concurrency/consistency correctness — the adversarial review caught what 11/11 live checks couldn't.
