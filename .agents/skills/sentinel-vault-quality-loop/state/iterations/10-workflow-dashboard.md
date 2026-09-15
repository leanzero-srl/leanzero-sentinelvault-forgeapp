# Iteration 10 — #48 Workflow dashboard & CSV export

Branch: `aql/workflow-state-engine`. A steward-facing, read-only reporting view: state distribution across the space + a recent-pages table + CSV export. Closes the Comala-style workflow-rules pack (#42→#43→#44→#45→#48).

## Implementation
- **Resolver (actions.js) `get-workflow-dashboard`:** cursor-paginates `workflow-idx-{sanitize(space)}-*` (bounded 30×100). Counts + overdue are EXACT from the index (which carries `stateId` + `reviewDueAt` — no per-page record reads). The recent-pages list is bounded to 100 (most-recent by `enteredAt`), titles fetched in PARALLEL via `Promise.all`. Returns `{ total, truncated, overdue, states:[{id,name,color,count}], pages:[{title,url,stateName,enteredAt,reviewDueAt,overdue}] }`. Registered `["get-workflow-dashboard", …]`.
- **UI (WorkflowDashboard.jsx):** mounted at the TOP of the Workflow tab (above settings). Solid saturated stat blocks reusing `wf-state-{color}` (slate/blue/green/red — no faded tints, no left rails), a red "Review overdue" block, a linked page table with state chips + solid-red overdue dates, and an **Export CSV** button (client-side `Blob` download — no new egress, no backend CSV). Truncation note when > listCap.

## Verify
- **Full grade PASS** — 9 E2E suites; workflow-enforce-e2e **27/27** incl. 4 new #48 checks: total counts all indexed pages; per-state tally correct; overdue Approved count correct; rows carry resolved state names. (Seeded a throwaway `DASHTEST` space's index directly — counts come from the index, so fake pageIds are fine.)
- **Qualitative UX (screenshot-verified):** the Workflow tab now reads as a complete steward story — "Approvals waiting on you" (inbox) → "Workflow status" (34 pages; 11 Draft / 6 In Review / 15 Approved / 2 Expired / 2 overdue; table with an overdue row in bold red; Export CSV) → settings (enable → approval → enforcement → review period → apply). Distinctive, confident, solid-color — not a template default.

## Outcome
**#48 COMPLETE + verified.** Confidence HIGH — read-only, bounded, reuses the by-state index built for exactly this (the ledger's "F7 dashboard" note on the idx). Client-side CSV keeps "Runs on Atlassian" (no egress). The Comala-style workflow-rules capability is now complete end-to-end: engine + auto-assign + config + bulk (#42), multi-approver approvals + notifications + inbox + groups (#43), enforced Approved state / revert-on-tamper (#44), review dates + auto-expiry (#45), and this dashboard + CSV (#48).
