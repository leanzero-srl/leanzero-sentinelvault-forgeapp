# Live-browser test coverage map (owner directive: test ALL user journeys, all possibilities, edge cases)

Goal: a comprehensive DEEP browser suite (forge-live-harness, real Confluence on wolfaenpak, shared `.auth/profile`) that drives every Sentinel Vault user journey end-to-end + edge cases — not the shallow "not-blank" render smoke, and NOT the mock screenshot harness (which hides stuck-loading, deploy staleness, and real render/integration bugs — see it26). Each journey = a deep spec that navigates, interacts, and asserts real outcomes. Build incrementally, one journey per loop tick; every UI tick must `forge install --upgrade` then run the relevant deep spec. Status: ✅ deep-covered · 🟡 partial · ⬜ TODO.

## Specs today (`~/Projects/forge-live-harness/scenarios/sentinel-vault/`)
- `realm-console-deep.spec.ts` ✅ — loads past spinner (it26 hang guard) + walks all 6 tabs asserting content.
- `steward-console-deep.spec.ts` ✅ — loads past spinner + walks General/Alerts/Validations + a save.
- `page-seal-state.spec.ts` ✅ — DEV doc-ribbon banner on the fixture page correctly reports the sealed attachment (env-scoped to dev; ignores the prod install).
- `realm-reservation-persist.spec.ts` ✅ — change space seal duration → Apply (success banner) → reload → value persists (store-policy → KVS round-trip; guards silent-save-fail + reload-staleness).
- `realm-validation-crud.spec.ts` ✅ — add a validation rule → Save → reload persists → delete → Save → reload gone (store-validation-config CRUD round-trip; self-cleaning).
- `page-seal-unseal.spec.ts` ✅ — open the doc-ribbon "Manage Attachments" Modal → Relinquish (unseal-artifact) → card flips to Seal → re-Seal (seal-artifact) → flips back. Reversible (restores fixture). Core operator seal lifecycle through real resolvers. GOTCHA: the inline-panel macro ALSO renders artifact cards behind the modal — target the modal by largest bounding box.
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
- 🟡 Validations: add a rule → save → reload persists → delete → reload gone (`realm-validation-crud.spec.ts`, it27). STILL ⬜: per-rule-type config (required-heading text/level, table minCount, label list, max/min chars); the C6 override banner (block-floor vs advisory); toggle each enforcement mode; AI config (model/budget/prompts) save.
- ⬜ Workflow: enable → configure states → add approvers (people picker) + groups → decision rule (any/all/min) → enforce mode → review period → content conditions (rules/AI) → Apply to existing → dashboard counts → Export CSV (verified downloads). Save + reload persistence.
- ✅ Reservation Duration: toggle off system-default → set a custom duration → save → reload persists (`realm-reservation-persist.spec.ts`, it27).

## OPERATOR / USER journeys (on a page: doc-ribbon pageBanner + inline-panel macro)
- 🟡 Seal an attachment (Manage Attachments Modal): Relinquish → re-Seal round-trip DONE (`page-seal-unseal.spec.ts`, it28). STILL ⬜: seal a FRESH/available attachment, set duration/comment/labels, as owner vs non-owner. NOTE: the inline-panel MACRO renders artifact cards in the page body (it lazy-loads — earlier thought absent) → the panel seal/unseal journey + the ribbon-vs-panel comparison are now buildable.
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
- FIXED (it28, found via the seal journey): the overlay's `formatRemainingTime` showed raw hours ("8643h 56m") with no day rollup — unreadable. Added the day rollup (mirrors realm-console's formatter) → now "360d 3h" / "3d 0h". Live-verified in the overlay PNG.
- FIXED (it29): realm-console's two inline "lapses" renderers (index.jsx ~204/~314) showed raw hours — converged with the overlay onto ONE shared helper `src/ui/kit/format-duration.js` (`formatRemaining`), preserving the Overdue warning-colour span. Overlay delegates too (kills the triplication). Live-verified via the overlay ("2d 23h"); realm-console render couldn't be screenshotted (its Sealed Files index shows 0 — see lead below) but calls the identical helper. (Dead `formatCountdown` left untouched.)
- RESOLVED (it30, NOT a persistent bug — investigated with a live diagnostic): the it29 "0 sealed files" was a TRANSIENT empty-index window, not a broken write/read. EVIDENCE: added a temp `[SEAL-DIAG]` log to `sealArtifact` + deployed + resealed the fixture via the overlay → the modal context lacks `extension.content.space` (`extContentKeys=["id","type"]`, `hasCtxSpace=false`) BUT `realmId=851971` still resolves (from `extension.space.id`/the `admin-settings-space-{key}` policy fallback), so the index key `space-protection-851971-{att}` IS written. The read (`enumerate-realm-seals`) then logged `Querying prefix space-protection-851971- → Got 10 results`, and the UI showed **"10 sealed files"** (10 cards). So write+read prefixes MATCH and the machinery is correct. The it29 "0→10" flip happened with NO read-code change → the KVS index was genuinely empty at it29 and got repopulated by the 30-min scan-worker cron. Diagnostic removed; net-zero code change; grade PASS. NARROWED FOLLOW-UP (lower severity): WHY did the index transiently empty at it29? The scan-worker rebuild WRITES-first then cleans stale (no empty window from the cron itself), so the wipe likely came from a reconstruct (`launch-realm-audit`) clear-then-rebuild race OR the stale-key cleanup over-deleting — a scan-worker/reconstruct investigation for a future tick (background-job, needs its own diagnostic; low user impact — the reconstruct button + cron self-heal it).
- OBSERVATION (it30, minor layout — future polish, not this tick): in the realm-console Sealed Files cards, an expired seal's "Overdue" lapses label is truncated to "Over…" in the cramped card meta row (it sits next to the Watch button). Candidate for a responsive/overflow polish tick.
