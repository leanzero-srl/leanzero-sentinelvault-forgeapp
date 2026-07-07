# Iteration 9 — #45 Review dates & automatic expiry transitions

Branch: `aql/workflow-state-engine`. Approvals shouldn't silently go stale: an Approved page carries a review-due date and auto-moves to Expired once it passes. Low-risk — reuses the (just-hardened) `workflowSweep` + `transitionPageWorkflow` + the existing `Expired` state; no trigger-pipeline surgery.

## Implementation
- **Engine (logic.js):** `computeReviewDueAt(state, overrideDays)` — a steward's per-space `reviewAfterDays` overrides the state's built-in default (150). `transitionPageWorkflow` reads the override only when the target state actually has a review clock (keeps other transitions cheap). `setSpaceWorkflowSettings` persists `reviewAfterDays` (null = use default).
- **Sweep (triggers.js):** a review-expiry pass runs FIRST per index — an Approved record whose `reviewDueAt` is in the past auto-transitions to Expired + posts an "Approval expired" comment; leaving Approved also ends enforcement, so no enforce work that tick. Per-space def cache added (the pass now inspects every index, not just enforced ones — one `resolveWorkflowDef` per space, not per page). `expired` added to the sweep's return counts.
- **Notice (approval-blueprints.js):** `postEnforceComment` gains an `"expired"` kind ("this page's review period has elapsed… Re-submit it for review").
- **UI:** Workflow tab — "Re-review Approved pages after [N] days" input (blank = default 150) with a plain-language explanation. Ribbon — a solid caution "Review due {date}" indicator beside the Approved chip, turning solid-red "Review overdue" once past due (no faded tints; shown only in Approved, where `reviewDueAt` is set).

## Verify
- **Full grade PASS** — 9 E2E suites; workflow-enforce-e2e **23/23** incl. 4 new #45 checks: Approved has a review clock; sweep reports an expiry; an overdue Approved page auto-transitions to Expired; expiry clears the review clock + enforcement.
- Qualitative UX: settings tab renders #44 + #45 rows cohesively (screenshot verified); the ribbon indicator gives the user a clear "when does this need re-review" signal, and Expired (red chip) + comment explains the transition + the re-review path (Expired→In Review/Draft edges already exist).
- Loop-safety / idempotency (self-review): expiry writes KVS + content property only (no page body) → no trigger re-fire; after expiry `stateId=expired`, `reviewDueAt=null`, so the next sweep skips it (findState(expired).reviewAfterDays is undefined + !enforce). Concurrency with a live edit is safe (KVS write vs body write, no conflict; both outcomes non-destructive).

## Outcome
**#45 COMPLETE + verified.** Confidence HIGH — small, contained, reuses proven+hardened machinery (the sweep, the state machine, the notice helper). No full design/adversarial workflow (justified by the low blast radius and reuse), but the sweep restructure was self-reviewed for ordering/loop-safety/idempotency.
