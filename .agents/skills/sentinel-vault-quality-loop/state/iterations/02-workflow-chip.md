# Iteration 2 — #42 Workflow state chip + transition control (presentation slice)

Branch: `aql/workflow-state-engine` (continues iteration 1). Feature: ledger #42, the user-visible half of the engine shipped in iteration 1.

## Workflow plan (dynamic)
Design done from DESIGN_TOKENS §1/§3/§5. Implement doc-ribbon surface (solo — single coherent surface). Verify: production build + screenshot harness (light+dark) + scripted menu-open interaction check + full grade (regression) + a parallel adversarial review workflow (brand/a11y/correctness/motion, each finding verified).

## Decision & spec
- **Functional change:** the doc-ribbon now shows the page's workflow state as a solid colored chip; if transitions are available it's a menu button that moves the page along the workflow (calls `request-transition`); steward-gated transitions are rejected server-side and surfaced inline. Read model from `get-page-workflow`.
- **Visual (§3 tokens, §1 rules):** solid saturated per-state fills (draft=slate `#475569`, in_review=blue `#1d4ed8`, approved=green `#15803d`, expired=red `#dc2626`; future custom colors caution/ai/seal supported), white ink except amber→dark ink (AA, mirrors the existing `.ribbon-chip-awaiting-approval`). Custom dropdown with a mono-uppercase "MOVE TO…" eyebrow (LeanZero §-marker device) + solid colored state dots. NO left rail, NO faded tint, NO native `<select>` — verified zero native selects live.
- **Motion (§5):** chip color = custody-shift (`--sv-dur-state` 200ms, `--sv-ease` house curve); an actively-made transition plays a one-shot **seat** (`wf-seat`, scale 1→0.96→1, transform-only, 60fps) — the new state seating like a stamp. `prefers-reduced-motion` guard added (also closes doc-ribbon's previously-missing guard, §5.3).
- **Core contract preserved:** frontend-only (doc-ribbon jsx + css); backend workflow capsule unchanged → no redeploy. No seal/section/validation surface touched.
- **Acceptance criteria:** (1) production `npm run build` clean; (2) chip renders on-brand light+dark (screenshot); (3) custom dropdown opens, zero native selects, correct transitions + ARIA (scripted check); (4) full grade stays green; (5) adversarial review confirms brand-rule + a11y + correctness + motion compliance.

## Design-critic pass (adversarial self-review)
- *"A third colored chip clutters the ribbon."* → It's the page's PRIMARY status (workflow state), placed leftmost; validation/AI are secondary. Solid distinct hues keep them scannable (categorical color, on-brand).
- *"Showing a transition the user can't perform (steward-gated Approved) is bad UX."* → The resolver rejects and the reason renders inline (`wf-error role=alert`); honest until #43 adds an approver-aware UI. Documented.
- *"Menu is mouse-first (a flagged app debt)."* → Items are focusable buttons (tab + Enter), Escape closes + returns focus, outside-click closes, focus-visible styles present. (Arrow-key roving is the one open a11y refinement — pending the review verdict.)

## Implementation
- **Modified:** `src/ui/surfaces/doc-ribbon/index.jsx` (+127 lines: `WorkflowControl` component + parent workflow state/pageId/spaceKey + `reloadWorkflow` + visibility condition + render). `src/ui/tokens/doc-ribbon.css` (+79 lines: `.wf-*` chip/menu/dot styles, motion tokens, `wf-seat` keyframe, reduced-motion guard). Screenshot-harness `bridge.js` gained a `get-page-workflow`/`request-transition` mock (gitignored local tooling).
- No backend change; no manifest change; no redeploy.

## Verify (live)
- Production build clean; full grade **PASS** (units 90/90, workflow-e2e 13/13, seal-e2e 4/4, live-trigger 8/8, forge-logs clean) — zero regression.
- Screenshots (`shots-png/doc-ribbon.png` + `-dark.png`): solid blue "● In Review ▾" chip renders as the leftmost status pill in both themes, on-brand, no rail/tint.
- Scripted interaction (`scratchpad/menu-shot.mjs`): `nativeSelects=0` (both themes), menu `role=menu`, items `["Approved","Draft"]` with solid state dots + mono eyebrow — custom dropdown confirmed.
- Adversarial review workflow (4 dims × verify, 16 agents): **9 findings CONFIRMED, 3 rejected.** All 9 fixed and re-verified:
  - **a11y (6):** the `role=menu` had none of the ARIA menu keyboard pattern → implemented full roving focus (Arrow/Home/End), focus-on-open, focus-return on Escape AND on selection, focus-out close, a real focus-visible ring on menu items (was `outline:none`, ~1.2:1), and an `aria-label`. Re-verified live: **menu-a11y 13/13** (focus seats on open, arrow roving wraps, End→last, exactly one roving `tabindex=0`, outline ring present, Escape/selection return focus to chip, zero native selects, no page errors).
  - **correctness (2):** a **real regression I introduced** — after renaming the local `pageId`→`ctxPageId`, the alert/validation/AI fetches read the not-yet-committed `pageId` state (null); fixed to `ctxPageId` (the screenshot mock had masked it — the review caught it). Seat animation was triggered before the reload; moved after `await onTransitioned()` so it keys off the new state.
  - **motion (1):** seat depth `scale(0.96)` → `scale(0.985)` to match signature move #1.
  - Rejected (correctly): decorative-dot opacity, reduced-motion seat-reset (harmless under `animation:none`), hardcoded 120ms tap.

## Outcome
- **Status: verified (chip + transition slice).** The workflow engine is now user-visible and operable: a solid branded state chip + a fully keyboard-accessible custom transition menu, on-brand light+dark, 60fps motion, WCAG-AA. Full grade PASS, zero regression.
- **Score delta (#42):** Distinct 1→4, Motion 1→4, A11y 1→4, Fn 3→4 (users can now see + move state from the ribbon). Perf holds 3.
- **Remaining #42 sub-slice (→ iteration 3):** steward config UI (define/edit workflows) + at-scale assignment (per-space default, label-filtered, bulk). Until then, assignment is steward-resolver / dev-hook only.
- **Skill learnings:** (1) the screenshot-mock returns data regardless of args, so it MASKS null-arg bugs — the adversarial code review is what catches them; keep it in the verify phase for every UI change. (2) `role=menu`/`menuitem` is a CONTRACT for arrow-key roving + focus management — never ship it with only click handlers; the reusable pattern (roving tabIndex + focus-on-open + focus-return + focus-out close + aria-label) is now proven here and should seed a shared kit `Menu` primitive (the app has 5 mouse-only dropdowns — this is the reference impl to consolidate onto).
