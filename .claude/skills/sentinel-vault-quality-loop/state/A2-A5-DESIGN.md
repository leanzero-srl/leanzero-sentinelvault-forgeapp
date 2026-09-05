# A2 + A5 — On-tamper target state, and per-state expiry with a steward-editable review date (ledger #52, #53)

Design-first, 2026-09-05. Comala parity: their `updated` transition sends an edited Approved page
back to **Review** (not to the start), and any state can carry a **due date** that users can edit
from the dialog. Ours: demote always goes to the initial state (Draft), and only Approved has a
review clock (`reviewAfterDays`).

## A2 — where a tampered Approved page goes

Today `collectWorkflowEnforcementForPage` (event path) and `workflowSweep` (backstop) demote to
`getInitialState(def)`. Change: the demotion target is configurable per space,
`workflow-settings.demoteTo` ∈ { `"initial"` (default, today's behaviour), `<stateId>` } and the
resolved target must be a state that (a) exists in the definition, (b) is not an enforce state,
(c) is reachable from the enforce state by a defined transition — validated at save
(`setSpaceWorkflowSettings`) so a dead configuration is refused, not silently ignored at enforce time.
Both demote sites use ONE helper `resolveDemoteTarget(def, settings)` (pure, unit-tested; falls
back to initial when the configured state has vanished from a re-saved definition).

The demote comment and the A1 `workflow.enforced` row already name the editor; both gain the
editor's page version (`driftedVersion`) and the target state name. Settings editor: a custom
dropdown "When an Approved page is edited without approval, move it to" listing the non-enforce
states, default "the first state (Draft)"; visible only when enforce mode is demote.

## A5 — a review clock on any state, editable on the page

1. Definition: any state may carry `reviewAfterDays` (today only Approved does). The sweep's
   expiry pass currently checks only Approved (`stateId === "approved"` / enforce) — generalise:
   any record whose state has `reviewAfterDays` and whose `reviewDueAt` has passed transitions to
   `expired` when the definition has that transition, else records `workflow.expired` with
   `details.noTransition:true` and posts the comment (a page can be overdue without moving).
2. Per-space override stays (`reviewAfterDays` in settings applies to the enforce state only — as
   today — documented); new optional `reviewAfterDaysByState: { [stateId]: days }` for other
   states, edited in the settings tab as one row per state that has a clock.
3. **Steward-editable due date on the page (Comala's clock icon):** new resolver
   `set-review-due` { pageId, reviewDueAt | null } gated `canEditPage` AND `authorizeSteward`
   (space derived from the page record). Writes `record.reviewDueAt`, the by-state index row
   (the dashboard's overdue count reads it), appends a workflow-log entry `{ kind:"review-due-set" }`
   and an A1 row `workflow.review-due` (NEW type — add to `ACTIVITY_TYPES` and the formatter) with
   `{ from, to, by }`. Date must be in the future (Comala 5.0.4 parity); `null` clears the clock.
4. Ribbon: the existing "Review due {date}" / "Review overdue" indicator becomes a button for
   stewards, opening a small dialog (same `.wf-appr-panel` pattern) with a date input (native
   `<input type="date">` is NOT allowed by the owner's rules → reuse/extend the app's own
   date-entry primitive; if none exists, a minimal custom month grid in the kit) + Clear + Save.
   Non-stewards see the indicator as today.

## Proof

- Unit: `resolveDemoteTarget` (default, valid target, vanished target → initial, enforce-state
  target refused), due-date validation (past date refused, null clears).
- REST `workflow-demote-target.spec.ts`: settings with `demoteTo:"in_review"` → an unsanctioned
  edit on an Approved page (hook `enforceDecision` / real trigger as in workflow-enforce-e2e) lands
  the page in In Review, not Draft; the A1 row names the target.
- REST `review-due.spec.ts`: `set-review-due` as a steward moves the date (record + index row);
  past date refused; non-steward refused; a state other than Approved with a clock expires via
  `workflowSweep` (seeded overdue).
- Browser: ribbon indicator opens the dialog for a steward, saving updates the chip text.
