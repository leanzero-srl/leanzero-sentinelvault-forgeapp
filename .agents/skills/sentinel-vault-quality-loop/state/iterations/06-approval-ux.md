# Iteration 6 — #43 Approval UX (ribbon awaiting/decide + approver picker)

Branch: `aql/workflow-state-engine`. Feature: ledger #43 — makes the approval engine (iter 5) OPERABLE and CLEAR for every role. Built UX-first per the owner directive (implement → look at it as a user → does it make sense? → tweak).

## What it means to each person (the design frame)
- **Steward** (Workflow tab): "Require approval to reach Approved" → pick approvers + a rule (any / all / at least N). Copy connects setup to outcome: "the page stays In Review and shows 'Awaiting approval' on its ribbon."
- **Author** (ribbon): the transition reads **"Request approval → Approved"** (not "Move to") when approval is required — clicking it opens a pending approval, it does NOT move the page.
- **Anyone viewing**: an amber **"Awaiting approval · 1 of 2"** chip — the page is mid-approval and how far along.
- **Approver** (ribbon panel): "Approval to move to Approved · Requested by X · All approvers must approve", a **"1 of 2 approved"** progress line, each approver's status + reason, and — the key clarity fix — an OUTCOME line: **"You're the deciding approval — approving moves this page to Approved. Denying keeps it In Review."** + Approve/Deny with a reason.

## Implementation
- **Frontend:** doc-ribbon `WorkflowControl` gained an APPROVAL MODE (awaiting chip + decision panel reading `get-page-approvals`, calling `decide-approval`); the transition menu labels enforce transitions "Request approval → …" via a `requiresApproval` flag. `WorkflowSettingsEditor` gained an approver picker (custom user-search + removable chips, no native control) + a mode `MiniSelect`. CSS for the panel + picker (solid colors, no rails/tints).
- **Backend:** `search-workflow-users` resolver (Confluence user search); `get-page-workflow` enriches available transitions with `requiresApproval` (enforce state + approvers configured).
- Backend change → `forge deploy` (no manifest change).

## Verify (live) + qualitative
- Full grade PASS (7 E2E suites, units 47/47, zero regression). Screenshots (light+dark) of the approval panel + the config tab.
- **Two qualitative naive-user reviews** (the owner's mandated discipline):
  - Per-screen review → led to the initial build being clear.
  - **Holistic end-to-end walkthrough** (enable → move → approve, all screenshots together) found real JOURNEY-coherence breaks no per-screen check caught, all fixed:
    1. **"Move to Approved" was the wrong verb** (it requests, not moves) → "Request approval → Approved" (the single highest-impact fix — the hinge where setup and action collided).
    2. **The panel never said what Approve/Deny would DO** → added the outcome line ("you're the deciding approval — this moves the page…; Denying keeps it In Review").
    3. **"1 of 2" had no unit** → "1 of 2 approved".
    4. **Demo data was inconsistent** across config/panel → made the mock coherent (honest review).

## Outcome
- **Status: implemented — the approval flow is now user-operable end-to-end and clear.** Remaining (enhancements, not blockers): a standalone cross-page "My approvals" inbox (`list-my-approvals` resolver exists; no UI yet), mention-comment notifications to approvers on request, and group approvers (v1 is user-only). These make it *better*, not *operable* — the operable flow is done.
- **Score delta (#43):** Fn 3→4, Distinct 1→4, Motion 1→3, A11y 1→3, Perf 3.
- **Skill learnings:** (1) **A per-screen UX review is NOT a journey review** — the "Move to Approved"→"Request approval" verb bug only appears when you walk enable→act→approve in sequence; always do a HOLISTIC walkthrough of the whole flow across all screenshots, asking "if I set this up in step 1, does step 2 match what I was promised?". (2) A decision UI must state its OUTCOME before the user acts ("approving moves the page…") — never a blind Approve/Deny. (3) Keep demo/mock data coherent across surfaces or the walkthrough review derails on phantom inconsistencies. (4) Progress counts need a unit ("1 of 2 approved", not "1 of 2").