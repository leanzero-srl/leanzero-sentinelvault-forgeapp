# Iteration 15 — responsive: realm-console reflow to narrow widths

Branch: `aql/workflow-state-engine`. **Angle: responsive/overflow at narrow widths** (rotation).

## Verify-first (measured, not assumed)
Wrote a scripted overflow probe (`static/_screenshot-harness/_narrow-check.mjs`, temporary): render each surface at 360/768px, assert `document.documentElement.scrollWidth <= innerWidth`, screenshot, and name the widest element poking past the viewport. Result: the **realm-console forces horizontal body scroll** (docScrollW 853 at BOTH 360 and 768) — a WCAG 2.1 AA **Reflow (1.4.10)** failure (content must reflow to a 320px-equiv viewport without 2D scroll; gate = `a11y: wcag_AA`). The inline-panel and steward-console already fit.

## Root causes (three, coupled) + fix — CSS-only, one surface class
1. **`.tab-navigation`** was `display: inline-flex` → it shrink-wraps to content, so its existing `overflow-x: auto` never fires. The 6-tab row needs ~771px + 80px side margins = 851px, which exceeds even the container's intended `min-width: 800px` — so it overflowed at the *design* width, not just narrow. FIX: `flex-wrap: wrap` + `max-width: calc(100% - 80px)`. At wide widths content < cap ⇒ the pill hugs the tabs byte-identically; narrow widths wrap instead of overflowing.
2. **Explicit `min-width` pins** held the canvas wide: `.space-admin-container` (800), `.permission-section` (500), `.form-section` (500) — removed. NOTE: `.attachments-table table { min-width: 900px }` is ALREADY correct — its wrapper `.attachments-table` has `overflow-x: auto`, so the table scrolls in its own box (never the body); the probe correctly never flagged it. Left untouched.
3. Removing the pins made it *fit* but the 2-column `.settings-row` (`.settings-row-info { flex:1; min-width:0 }` + control) collapsed labels to ~1 word/line and collided the control — a half-reflow is WORSE than honest scroll (violates the mandatory qualitative-UX bar). FIX: `@media (max-width: 640px) { .settings-row { flex-direction: column; align-items: flex-start; gap: 10px } }`. The chip rows (`wf-state-preview`, `wf-userpicker-chips`, `wf-dash-stats`) already `flex-wrap: wrap`.

Applied the tab + settings-row fixes to **steward-console.css** as well (each console has its own copy of these classes — same defect class; iteration-4 "fix across all consumers" principle).

## Verify
- Scripted probe: **all tabs of realm-console AND steward-console fit at 360 AND 768** (docScrollW == innerW).
- Screenshots @360 **light + dark**: every setting stacked + readable, state-flow/approver chips wrapped, dashboard stats wrapped, table scrolls in its own wrap, nothing clipped.
- **@1280 desktop pixel-identical — ZERO regression** (tabs single-row pill, 2-col settings, dashboard row).
- Full grade PASS; units 131/131; deployed to dev. Not core-touching (CSS only) → no deep E2E.
- The "Save workflow settings" bar appearing over the dashboard in a fullPage screenshot is a fixed-position capture artifact (renders at its viewport-fixed spot in the tall capture), not a live overlap.

## Outcome
The realm-console (and steward-console) now reflow cleanly to 320–360px — WCAG 1.4.10 satisfied — with the desktop layout untouched. Confidence HIGH (CSS-only, empirically measured before+after, desktop verified unchanged).

## Notes for future responsive ticks
- The overlay surface (`overlay.css`) also has a `.tab-navigation` copy — not audited this tick (it's a fixed-size modal, lower narrow-width risk). Check if a responsive tick revisits overlays.
- Reusable probe pattern: viewport-loop + `scrollWidth>innerWidth` + widest-element report catches body-overflow objectively; keep it for future responsive audits.
