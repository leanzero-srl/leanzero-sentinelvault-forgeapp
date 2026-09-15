# Iteration 14 — a11y: approval-dialog focus management

Branch: `aql/workflow-state-engine`. **Angle: accessibility** (rotation — least-covered for the volume of interactive UI shipped in iterations 6–13; prior a11y work was only iteration-2's transition menu + iteration-4's Toggle `aria-label`).

## Verify-first (read the code, don't assume)
Read the new workflow surfaces' a11y. The ribbon **approval `role="dialog"`** (doc-ribbon `WorkflowControl`) had: Escape-to-close + focus-return-to-trigger, outside-click close, `aria-label` — but **no focus-on-open**. The sibling `role="menu"` correctly focuses its first item on open (line 86); the dialog did not. A `role="dialog"` that never receives focus is the exact SR defect the iteration-2 lesson flagged ("role=X is a CONTRACT"): opening it left focus on the trigger chip, so a screen reader never announced the dialog and a keyboard user had to Tab in blind to reach Approve/Deny.

## Change (WIP=1, high-confidence, not core-touching)
- `doc-ribbon/index.jsx`: on `panelOpen`, `requestAnimationFrame(() => panelRef.current?.focus())`; added `tabIndex={-1}` to the panel. Focus the **container**, not a control — focusing Approve/Deny risks accidental activation; focusing the container lets the SR announce the dialog (via `aria-label`) and the user Tabs to the controls (standard non-modal dialog pattern). Not `aria-modal` — it's a non-modal popover (outside-click closes it).
- `doc-ribbon.css`: `.wf-appr-panel:focus { outline: none }` — the container is programmatically focused (never tab-reached), so its own outline is noise; the panel appearing + the inner controls' focus rings are the visible cues (the Reach/Radix dialog convention).

## Verify
- **Scripted Playwright focus assertion 4/4** (`scratchpad/panel-focus.mjs`, the iteration-2 pattern): panel opens → `document.activeElement` is INSIDE `.wf-appr-panel` → Escape closes the dialog → focus returns to the trigger chip.
- Screenshots **light + dark**: ZERO visual regression — panel renders identically, no jarring container ring.
- Full grade PASS; units 131/131; deployed to dev; deep E2E not required (no core/trigger/KVS change).
- Qualitative UX: purely behavioral (no visual delta) → no naive-user confusion surface; it's an invisible-but-correct keyboard/SR improvement. No fresh-eyes-reviewer round needed for a zero-visual-change fix (the identical renders are the proof).

## Outcome
Approval dialog now meets the focus-management contract for `role="dialog"`. Confidence HIGH (standard pattern, scripted-verified, no visual/behavioral regression for mouse users).

## Next a11y leads (recorded so a future a11y tick doesn't re-scan)
- **WorkflowInbox** Approve/Deny buttons lack a per-item accessible name → an SR hears "Approve, Approve…". Add `aria-label` with the page title + target state.
- **WorkflowDashboard** `<th>` headers lack `scope="col"`.
(Both real but lower-impact than the dialog; deferred to keep WIP=1.)
