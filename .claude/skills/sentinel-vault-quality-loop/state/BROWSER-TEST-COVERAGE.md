# Live-browser test coverage map (owner directive: test ALL user journeys, all possibilities, edge cases)

Goal: a comprehensive DEEP browser suite (forge-live-harness, real Confluence on wolfaenpak, shared `.auth/profile`) that drives every Sentinel Vault user journey end-to-end + edge cases — not the shallow "not-blank" render smoke, and NOT the mock screenshot harness (which hides stuck-loading, deploy staleness, and real render/integration bugs — see it26). Each journey = a deep spec that navigates, interacts, and asserts real outcomes. Build incrementally, one journey per loop tick; every UI tick must `forge install --upgrade` then run the relevant deep spec. Status: ✅ deep-covered · 🟡 partial · ⬜ TODO.

## Specs today (`~/Projects/forge-live-harness/scenarios/sentinel-vault/`)
- `realm-console-deep.spec.ts` ✅ — loads past spinner (it26 hang guard) + walks all 6 tabs asserting content.
- `steward-console-deep.spec.ts` ✅ — loads past spinner + walks General/Alerts/Validations + a save.
- `page-seal-state.spec.ts` ✅ — DEV doc-ribbon banner on the fixture page correctly reports the sealed attachment (env-scoped to dev; ignores the prod install).
- render smokes (`realm.spec.ts`,`admin-render.spec.ts`) — SHALLOW ("not blank"); keep as quick smoke, do NOT rely on them.
- REST/hook specs (validation, gate-revert, sealed-section, sealed-media, trash, expiry-sweep) — deep BACKEND, no browser.

## ⚠️ TEST-ENV GOTCHA (it27) — wolfaenpak has TWO installs of Sentinel Vault
The test site runs BOTH the **dev** install (env `17516615-12ef-4790-8ce2-29151b7ee9ac`) AND the
**prod** install (env `31eb89a3-9342-4489-b531-34ef0b19d722`). On any page-context surface
(doc-ribbon pageBanner, inline-panel macro) BOTH render, each reading its OWN separate storage —
so you see two banners with different seal counts (dev sees the dev seal → "1 sealed"; prod's
storage is empty → "none sealed"). This is NOT an app bug. Page-context specs MUST filter iframes
by the dev env id (`iframe[src*="17516615"]`) to test the app-under-test; otherwise the prod
install confounds the assertion. (This resolved the it26 "contradictory seal count" LEAD.)

## STEWARD / ADMIN journeys (Confluence space-page + global-settings)
- ✅ Space console loads (all tabs render) · ✅ Global console loads (all tabs render).
- 🟡 Global prefs: toggle each pref → Save → assert persisted (reload) + success banner. (save-surface verified; per-toggle persistence TODO)
- ⬜ Access Control: add operator (user picker) → save → reload persists; remove operator; add group (picker) → save; remove group; approve a steward request; deny; the "request steward access" path as a NON-steward.
- ⬜ Validations: add EACH rule type (required-heading/table/label, max/min-length) → configure → save → reload persists; the C6 override banner (block-floor vs advisory); toggle each enforcement mode; AI config (model/budget/prompts) save; delete a rule.
- ⬜ Workflow: enable → configure states → add approvers (people picker) + groups → decision rule (any/all/min) → enforce mode → review period → content conditions (rules/AI) → Apply to existing → dashboard counts → Export CSV (verified downloads). Save + reload persistence.
- ⬜ Reservation Duration: toggle off system-default → set a custom duration → save → reload persists.

## OPERATOR / USER journeys (on a page: doc-ribbon pageBanner + inline-panel macro)
- ⬜ Seal an attachment (inline-panel): seal → chip shows sealed → set duration/comment/labels → unseal → relinquish. As owner vs non-owner.
- ⬜ Edit requests: non-owner "Request Edit" → owner sees request in panel → Approve / Deny / Revoke (it14/D5 UI) → the editor gains/loses access.
- ⬜ Sealed sections: seal a heading's section → the section-setup UI → (backend tamper→revert already REST-covered).
- ⬜ Validation surfacing on a page: violating edit → advisory comment / gate fail / revert (REST-covered; add a UI check of the panel's validation state + AI findings dismiss/false-positive buttons).
- ⬜ Workflow on a page (doc-ribbon): transition menu (keyboard a11y it2) → awaiting-approval panel (it14 focus) → Approve/Deny (it21 aria) → review-due chip. As approver vs non-approver.
- ⬜ Watch / notifications toggle.

## EDGE CASES to build
- ⬜ EMPTY states: space with no seals / no rules / no workflow / no pending requests / no approvals-inbox → each surface's empty copy renders (not blank, not stuck).
- ⬜ ERROR states: force a resolver failure (dev hook) → the UI shows the error banner, not a false success or silent blank (it16/it18 guards, verify LIVE).
- ⬜ STUCK-LOADING: every Custom-UI surface must load past its spinner within N s (it26 hang guard — extend to steward-console, inline-panel, doc-ribbon, section-setup, overlay).
- ⬜ BOUNDARY inputs: 0 / negative / huge seal duration + token budget; very long labels; unicode/emoji in rule labels; a rule with no config.
- ⬜ RESPONSIVE: 360/768px on the consoles (it15 — re-verify LIVE, the mock proved built-bundle only).
- ⬜ ROLE views: steward vs non-steward vs org-admin render the correct tabs/controls.
- ⬜ DEPLOY-STATE guard: assert the served title is "Space Preferences" (catches un-upgraded install / stale deploy — it26).

## FINDINGS from the live hunt (it26+)
- FIXED: validation rule Label + config inputs clipped to 80px (`.val-rule-card > .form-input` full-width) — live-verified 873px.
- RESOLVED (it27, NOT a bug): the "contradictory seal count" was the dev+prod dual-install (see GOTCHA above) — two doc-ribbon banners from two installs reading separate storage, not one inconsistent component. Confirmed via iframe env ids: banner with env `17516615` (dev) = "1 sealed" (correct); banner with env `31eb89a3` (prod) = "none sealed" (prod storage empty). Guarded by `page-seal-state.spec.ts`.
- NOISE (not ours): `Uncaught Error: undefined missing ac/create` + some 404s on the page are atlassian-CONNECT/host, not this Forge app.
