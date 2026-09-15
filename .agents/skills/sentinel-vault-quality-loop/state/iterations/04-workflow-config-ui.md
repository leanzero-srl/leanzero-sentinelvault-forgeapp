# Iteration 4 — #42 Steward config UI + bulk apply (completes #42)

Branch: `aql/workflow-state-engine`. Feature: ledger #42, the last sub-slice — a steward can now turn workflow on for a space, auto-assign new pages, and apply it to existing pages, all from the realm console. This flips #42 to fully verified.

## Workflow plan (dynamic)
Research (done): the app's config-UI vocabulary is `ValidationsEditor` (a self-contained kit mounted per-space in the realm console). Mirror it. Implement a `WorkflowSettingsEditor` kit + a realm-console "Workflow" steward tab + a bulk-assign backend. Verify: match-the-app screenshots (light+dark) + a live bulk E2E + full grade + an adversarial review (brand-match / a11y / correctness).

## Decision & spec
- **Functional change:** realm-console "Workflow" tab (steward-only) with: Enable document workflow (toggle) → Auto-assign new pages (toggle) + a read-only workflow preview (Draft→In Review→Approved→Expired chips) + "Apply to existing pages" (bulk) + Save. Bulk assigns the space's workflow to pages that don't have one, bounded to one result page (≤25) per call ("run again" for large spaces).
- **Match-the-app (owner directive):** `WorkflowSettingsEditor` mirrors `ValidationsEditor` exactly — same `SettingsRow`/`Toggle`/`settings-panel`/`nested-control`/`btn-primary`/`btn-secondary`/`action-bar`/`alert-*` classes (all already defined in realm-console.css), mounted the same way as the Validations tab (steward-gated, `spaceKey={realmKey}`, excluded from the generic save-bar because it self-saves). Only new CSS: `.wf-state-*` preview chips (solid saturated hues, AA ink, no rail/tint) — matching the ribbon chips.
- **Backend:** `bulkAssignPagesInSpace` logic (callable by the resolver after authz AND the dev hook), `bulk-assign-workflow` resolver (steward + enabled gate + spaceId resolution). Idempotent (skips pages that already have a workflow); logs "bulk-assigned".
- **Core contract preserved:** additive. Bulk is bounded to ≤25 pages/call to stay inside the 25s function budget; the assign path is the same verified one from iterations 1–3.

## Design-critic pass (adversarial self-review)
- *"Bulk over a real space pollutes content."* → Confirmed during verify: the first bulk E2E scanned WFH's first 25 pages (my test pages were beyond the window) and assigned workflows to 25 REAL pages. Cleaned them up, and **redesigned the E2E to run in a dedicated throwaway space** (create space → pages → bulk → delete space) so it's isolated and non-polluting. Lesson captured.
- *"'Apply to existing' re-runs from scratch each press — wasteful?"* → Idempotent (skips assigned pages), so re-running is safe; each press advances by ≤25 unassigned pages. Honest UX ("run again to continue" + scanned count). A cursor-threading optimization is possible but not needed for v1.
- *"Custom workflow authoring?"* → Deliberate NON-GOAL (CAPABILITY_EXPANSION §3.5 — opinionated default avoids Comala's #1 complaint). The preview is read-only with a "planned" note.

## Implementation
- **New:** `src/ui/kit/WorkflowSettingsEditor.jsx`; `logic.js:bulkAssignPagesInSpace`; `test-harness/scripts/workflow-bulk-e2e.mjs`.
- **Modified:** `realm-console/index.jsx` (import + Workflow tab button + tab content + save-bar exclusion); `workflow/actions.js` (+`bulk-assign-workflow`); `realm-console.css` (+`.wf-state-*`); `test-hook.js` (+`bulkAssignWorkflow`); grade.sh + package.json (+workflow-bulk-e2e).
- Backend change → `forge deploy` (no manifest change → no re-consent).

## Verify (live)
- Full grade **PASS** (units 90/90, workflow-e2e 13/13, workflow-autoassign-e2e 8/8, **workflow-bulk-e2e 6/6**, live-trigger 8/8, seal-e2e 4/4, forge-logs clean) — zero regression.
- **Match-the-app screenshots** (`shots-png/realm-workflow.png` + `-dark.png`): the Workflow tab is visually indistinguishable in structure from the Validations/General tabs — same header, tab bar (teal active), settings rows, app toggles, `btn-primary` save; the state preview reads Draft→In Review→Approved→Expired in solid distinct hues. Consistent in light AND dark.
- workflow-bulk-e2e proved LIVE (isolated space): enable (auto-assign off) → pages start unassigned → bulk assigns them to draft with reason "bulk-assigned" → a second bulk run is idempotent (one log entry each).
- Adversarial review (brand-match / a11y / correctness, 11 agents): 4 CONFIRMED (3 distinct), 4 correctly rejected (all latent/unreachable — workflowId mismatch, unknown-color chip, save/apply banner race, bulk timeout — none reachable because there's no custom-workflow authoring UI). All fixed + re-verified:
  - **HIGH — bulk cursor dropped:** "Apply to existing pages" called `bulk-assign-workflow` with no cursor and ignored `nextCursor`, so after the first 25 pages every click re-scanned the same (now-assigned) 25 and reported "0 pages — run again" forever; pages 26+ were unreachable. **My E2E missed this** (the throwaway space had <25 pages, so never `capped`). Fixed by threading `cursor` in the kit's state. Verified with a Playwright test (`bulk-cursor.mjs` 6/6): the 2nd Apply sends the 1st response's `nextCursor`.
  - **MEDIUM — Toggle no accessible name:** bare checkbox announced as "checkbox, not checked." Added `aria-label` (threaded from the row label) to the Toggle — and applied the same to `ValidationsEditor` so the app stays consistent (owner directive; reviewer-recommended).
  - **LOW — status banner not announced:** added `role="status" aria-live="polite"` to both kits' banners.

## Outcome
- **Status: VERIFIED — #42 COMPLETE.** The Comala-style workflow-rules capability is end-to-end: engine (it1) → chip + transitions (it2) → auto-assign new pages (it3) → steward config UI + bulk apply to existing pages (it4). Full grade PASS (10 suites), match-the-app screenshots, cursor + a11y fixes verified.
- **Score delta (#42):** Fn 4→5 (fully usable: enable/auto-assign/transition/bulk from the UI). Distinct 4, Motion 4, A11y 4, Perf 3 hold. → ledger status `verified`.
- **Skill learnings:** (1) **an E2E on a too-small fixture silently skips the pagination branch** — the bulk cursor bug passed a 3-page throwaway-space E2E because `capped` was never true; verify cursor/pagination with either a >page-size fixture OR a stateful-mock UI test that asserts the cursor is threaded (`bulk-cursor.mjs` pattern). (2) The screenshot mock returns data regardless of args AND is stateless by default — instrument it (`window.__bulkCalls`) to verify request *sequencing*, not just render. (3) Bulk operations over a real space POLLUTE it — always test bulk in a dedicated throwaway space (create → use → delete), never the shared dev space. (4) Shared kit a11y gaps (Toggle accessible name, banner aria-live) are worth fixing across all consumers at once for consistency.
