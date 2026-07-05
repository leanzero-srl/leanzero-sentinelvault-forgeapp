# Feature Ledger — sentinel-vault
status legend: discovered -> researched -> designed -> implemented -> verified | skipped(reason)

| # | Feature | Surface | Status | Fn | Distinct | Motion | Perf | A11y | Priority | Branch |
|---|---------|---------|--------|----|----------|--------|------|------|----------|--------|
| 42 | Workflow state engine & state chip | Doc ribbon + realm console + backend | implemented (engine+chip verified; config UI + at-scale assignment pending) | 4 | 4 | 4 | 3 | 4 | 23.0 | aql/workflow-state-engine |
| 43 | Multi-approver transitions & approvals inbox | Realm console + inline panel + comments | discovered | 1 | 1 | 1 | 1 | 1 | 22.0 | — |
| 45 | Review dates & expiry transitions | Backend → sweep + notices | discovered | 1 | 1 | 1 | 1 | 1 | 22.0 | — |
| 44 | Enforced Approved state (revert-on-tamper) | Backend → ribbon/comments | discovered | 1 | 1 | 1 | 1 | 1 | 21.0 | — |
| 48 | Workflow dashboard & CSV export | Realm console (space page) | discovered | 1 | 1 | 1 | 1 | 1 | 21.0 | — |
| 46 | Transition conditions (rules + AI gate) | Backend + realm console config | discovered | 1 | 1 | 1 | 1 | 1 | 19.0 | — |
| 47 | Native content-state mirroring | Backend → native status chip | discovered | 1 | 1 | 1 | 1 | 1 | 16.0 | — |
| 1 | Sealed Sections group (picker, seal/unseal) | Inline panel | discovered | 3 | 3 | 2 | 3 | 3 | 15.6 | — |
| 2 | Watch / Notify me | Inline panel + overlay + realm console | discovered | 4 | 3 | 2 | 2 | 3 | 14.6 | — |
| 6 | Edit requests & grants — attachments | Inline panel + realm console | discovered | 3 | 3 | 3 | 2 | 3 | 14.6 | — |
| 3 | Notifications system (4 channels) | Backend → comments/banners/toasts | discovered | 4 | 3 | 2 | 4 | 3 | 14.4 | — |
| 4 | Seal / relinquish actions | Inline panel + overlay | discovered | 5 | 4 | 3 | 3 | 3 | 14.2 | — |
| 5 | Access Control tab (activation, stewards, guilds, pending) | Realm console | discovered | 3 | 3 | 3 | 2 | 2 | 14.2 | — |
| 7 | Validations tab — per-space rules | Realm console | discovered | 4 | 3 | 2 | 4 | 2 | 14.0 | — |
| 8 | Delete/trash protection engine | Backend → ribbon/comments | discovered | 5 | 3 | 2 | 4 | 3 | 13.8 | — |
| 9 | Validations tab — global rules + Semantic AI config | Steward console | discovered | 3 | 3 | 2 | 4 | 2 | 13.6 | — |
| 10 | My Sealed Files tab (+ edit-request inbox) | Realm console | discovered | 4 | 3 | 3 | 3 | 2 | 13.0 | — |
| 11 | Reservation Duration tab | Realm console | discovered | 4 | 3 | 2 | 4 | 2 | 13.0 | — |
| 21 | Validation group (status, re-check, violations) | Inline panel | discovered | 3 | 4 | 2 | 3 | 3 | 13.0 | — |
| 12 | Attachment cards & grouping (expand, thumbnails, 2-phase load) | Inline panel | discovered | 5 | 4 | 3 | 2 | 3 | 12.8 | — |
| 13 | Upload zone (drag-drop, 4 MB) | Inline panel | discovered | 4 | 4 | 3 | 3 | 3 | 12.8 | — |
| 14 | Doc ribbon (counts, alerts, status chips) | Doc ribbon | discovered | 4 | 4 | 2 | 4 | 3 | 12.8 | — |
| 15 | Sealed-section macro surface (config card + view frame) | Section setup | discovered | 3 | 4 | 1 | 5 | 4 | 12.8 | — |
| 16 | General tab (10 policy settings) | Steward console | discovered | 4 | 3 | 2 | 4 | 4 | 12.8 | — |
| 17 | Alerts tab (7 notification toggles) | Steward console | discovered | 4 | 3 | 2 | 4 | 4 | 12.8 | — |
| 18 | Labels (add/remove) | Inline panel + overlay | discovered | 4 | 3 | 2 | 3 | 2 | 12.6 | — |
| 19 | Realm Sealed Files tab (steward audit view) | Realm console | discovered | 4 | 3 | 3 | 2 | 2 | 12.6 | — |
| 20 | Delete / restore / purge actions | Inline panel + overlay | discovered | 4 | 3 | 3 | 3 | 3 | 12.4 | — |
| 22 | Macro tab (auto-insert + position) | Realm console | discovered | 4 | 3 | 2 | 4 | 3 | 12.4 | — |
| 23 | Sealed-section tamper detection & restore engine | Backend → section macro/comments | discovered | 4 | 3 | 1 | 4 | 3 | 12.0 | — |
| 24 | Semantic AI validation engine (Forge LLM worker) | Backend → AI Review group | discovered | 4 | 3 | 2 | 3 | 3 | 12.0 | — |
| 25 | Roles & authorization (steward model) | Backend → all consoles | discovered | 4 | 3 | 2 | 3 | 3 | 12.0 | — |
| 26 | AI Review group (run, findings, dismiss/false-positive) | Inline panel | discovered | 5 | 3 | 3 | 3 | 3 | 11.8 | — |
| 27 | Attachment edit auto-reversion engine | Backend → ribbon/comments/toasts | discovered | 5 | 3 | 2 | 4 | 3 | 11.8 | — |
| 28 | Flash messages / toasts | All page surfaces (kit) | discovered | 4 | 3 | 3 | 4 | 3 | 11.8 | — |
| 29 | Steward access request workflow | Realm console (2 tabs) | discovered | 4 | 3 | 2 | 3 | 2 | 11.6 | — |
| 30 | Seal expiry & scheduled maintenance | Backend → panel badges/comments | discovered | 4 | 2 | 2 | 3 | 3 | 11.6 | — |
| 31 | Page-body content protection engine (media surgery) | Backend → ribbon/comments | discovered | 4 | 3 | 2 | 4 | 3 | 11.4 | — |
| 32 | Section edit requests & grants | Inline panel + section macro | discovered | 4 | 3 | 2 | 3 | 3 | 11.0 | — |
| 33 | Overlay management modal | Overlay | discovered | 4 | 3 | 4 | 2 | 3 | 10.4 | — |
| 34 | Conditions & Validations engine (advisory/gate/revert) | Backend → panel/ribbon/comments | discovered | 4 | 3 | 2 | 4 | 3 | 10.4 | — |
| 37 | Realm audit & seal index maintenance | Realm console + backend cron | discovered | 3 | 2 | 2 | 3 | 3 | 10.2 | — |
| 35 | Onboarding explainer | Inline panel | discovered | 3 | 3 | 1 | 5 | 3 | 10.0 | — |
| 36 | Live status sync (5s stamp polling) | Ribbon + panel + overlay | discovered | 4 | 3 | 2 | 2 | 3 | 9.6 | — |
| 38 | Auto-insert / replace-attachments macro | Backend → page ADF | discovered | 4 | 3 | 2 | 4 | 3 | 9.4 | — |
| 39 | Theming, dark mode & token system | All 7 surfaces | discovered | 4 | 3 | 2 | 4 | 3 | 9.4 | — |
| 40 | Panel setup (macro preferences dialog) | Panel setup | discovered | 4 | 4 | 4 | 5 | 3 | 9.0 | — |
| 41 | Lifecycle cleanup (uninstall wipe) | Backend (no UI) | discovered | 3 | 3 | 3 | 4 | 3 | 8.4 | — |

---

## 1. Sealed Sections group (picker, seal/unseal)
- **Does:** From the panel's Sealed Sections group, a user picks a page heading and seals that heading + its content; the app wraps it in the bodied "Sealed Section" macro with a stable sectionId and snapshots it. Owner/steward can unseal (unwraps in place). "No headings to seal" empty state. NO snapshot-refresh control exists in any UI (see notes).
- **Lives:** `src/ui/surfaces/inline-panel/index.jsx` (SectionRow etc.), `src/ui/tokens/inline-panel.css`; backend `src/server/capsules/section-seals/{actions,logic}.js`, `src/server/infra/doc-surgery.js` (buildSealedSectionNode, computeSectionRange).
- **Core calls:** `list-page-headings`, `enumerate-section-seals`, `seal-section`, `unseal-section`. (`refresh-section-snapshot` resolver exists at `section-seals/actions.js:294` but has ZERO UI callers.)
- **Baseline:** Fn 3 · Distinct 3 · Motion 2 · Perf 3 · A11y 3.
- **Impact 5** — content sealing is a headline v4 capability. **Effort 3** — panel group UI plus server wrap/unwrap paths. **Risk 3** — seal-section does live ADF surgery with 409 retries and staleness checks; a wrong range computation mangles pages.
- **Notes-risks:** PHANTOM FEATURE (Fn 3 evidence): the snapshot-refresh path is backend-only — SectionRow offers only Unseal / Request Edit (`inline-panel/index.jsx:1051–1104`), yet `docs/features/content-sealing.md` (Troubleshooting) instructs users to "use refresh snapshot", an instruction that cannot be followed anywhere in the product. Either wire a UI affordance or fix the docs. Heading pickers are real buttons (good); group collapse carets are unlabeled `▾` text. Section-level N+1 resolver calls per SectionRow contribute to the panel's fan-out. Non-heading blocks seal only themselves — behavior worth surfacing in UI copy.

## 2. Watch / Notify me
- **Does:** Watch a file sealed by someone else; when the seal is released (manual, expiry, steward override) each watcher gets a release notice via comment @mention. Toggle off with "Watching".
- **Lives:** buttons in `src/ui/surfaces/inline-panel/index.jsx`, `overlay/index.jsx`, `realm-console/index.jsx`; backend `src/server/capsules/bulletins/{actions,logic}.js` (`notify-request-{artifactId}-{accountId}`, 7d TTL, notifyWatchers).
- **Core calls:** `watch-artifact`, `check-watch`, `unwatch-artifact`; consumed by `notifyWatchers` on every unseal path.
- **Baseline:** Fn 4 · Distinct 3 · Motion 2 · Perf 2 · A11y 3.
- **Impact 4** — the main "tell me when I can edit" loop for non-owners. **Effort 2** — small UI + existing key family. **Risk 2** — `check-watch` is fired N+1 per sealed card in overlay and realm console on every list change; fixing the fan-out touches shared list effects.
- **Perf note:** overlay's `check-watch` loop re-fires on every fileList merge/enrich — the concrete Perf-2 evidence.

## 3. Notifications system (4 channels)
- **Does:** Toasts, page banners, app-authored footer comments, and native comment-with-mention notices (7 notice types incl. violation, halfway, expiry, watcher release, steward override). All globally toggleable; no external egress — Confluence's own engine emails mentioned users.
- **Lives:** `src/server/infra/notice-composer.js` (dispatchNotice), `notice-blueprints.js` (11 XML-escaped layouts), `outbound-notify.js` (postCommentWithMention, 3x retry 600ms→5s), `src/server/capsules/bulletins/logic.js` (recordDispatch, short-TTL dispatch keys), `src/server/shared/bulletin-flags.js` (legacy toggle names).
- **Core calls:** `load-bulletin-toggles`, `recent-dispatches`, `acknowledge-dispatch`, `list-breach-dispatches`; trigger-side `dispatchNotice`/`sendViolationNotifications`.
- **Baseline:** Fn 4 · Distinct 3 · Motion 2 · Perf 4 · A11y 3 (scored via ribbon banners + comment output).
- **Impact 5** — every protection feature communicates through this layer. **Effort 3** — 11 blueprints + toggle hierarchy across 3 files. **Risk 3** — contract C16 (toggle hierarchy, comments-only egress) and legacy KVS field names must not drift; docs still contain stale email wording that could mislead changes.
- **Notes-risks:** PERIODIC_REMINDER is banner-only by design. Users who disabled mention emails only get in-product banners — worth surfacing. Comment layout distinctiveness (Distinct 3) is an improvable axis.

## 4. Seal / relinquish actions
- **Does:** One click seals an attachment under the user's account with a countdown (duration: payload → space override → global default 24h → 48h baseline); Unseal/Relinquish releases it, notifies watchers, sweeps grants. Re-sealing an expired seal by another user is allowed.
- **Lives:** action buttons in `src/ui/surfaces/inline-panel/index.jsx` + `overlay/index.jsx`; backend `src/server/capsules/sealing/{actions,logic,confluence-sync}.js`.
- **Core calls:** `seal-artifact`, `unseal-artifact`, `enumerate-doc-artifacts`, `enumerate-page-seals`, `check-seal-stamp`.
- **Baseline:** Fn 5 · Distinct 4 · Motion 3 · Perf 3 · A11y 3.
- **Impact 5** — the core value prop. **Effort 2** — polished flow; iteration is mostly UX/motion refinement. **Risk 3** — seal-artifact writes the KVS triad + content property + auto-insert; contract C11/C12 key stability sits under every change.
- **Notes-risks:** Every action triggers a full `onRefresh` (re-fetch seals + list) — cheap wins available. One `protection-` content property per page (last seal wins) is a known modeling quirk.

## 5. Access Control tab (activation, stewards, guilds, pending)
- **Does:** Stewards toggle Realm Activation (Active/Disabled), add/remove steward users via search, manage guilds (Confluence groups) as steward teams, and approve/deny pending steward-access requests (count badge on tab).
- **Lives:** `src/ui/surfaces/realm-console/index.jsx` (~2264 lines total), `src/ui/tokens/realm-console.css`; backend `src/server/capsules/realms/actions.js`, `operators/actions.js`, `policies/actions.js` (space `adminUsers`/`adminGroups`).
- **Core calls:** `store-realm-ruleset`/`store-policy`, `search-operators`, `enumerate-operators`, `enumerate-teams`, `list-steward-requests`, `approve-steward-request`, `deny-steward-request`.
- **Baseline:** Fn 3 · Distinct 3 · Motion 3 · Perf 2 · A11y 2.
- **Impact 4** — governs who can administer seals per space. **Effort 3** — three search/dropdown systems plus request cards. **Risk 2** — mostly frontend repair; the authorization semantics behind it stay put.
- **Notes-risks:** CONFIRMED latent bug: `findOperators` catch calls `setError(...)` which doesn't exist (realm-console/index.jsx:1136) — operator-search failure throws a ReferenceError (Fn 3 evidence). `enumerate-teams` eagerly fetches up to 200 groups on load; body-wide MutationObservers wire infinite scroll; activation "select" is a div tabIndex=0 with blur-timeout close (A11y 2 evidence).

## 6. Edit requests & grants — attachments
- **Does:** Non-owner requests edit access with an optional reason (button cycles Request Edit → Requested → Can Edit / Declined); owner approves/denies from the in-panel inbox or realm console My Sealed Files; stewards can approve. Approved editor's upload is kept and the seal re-baselines to it. One pending request per file; 48h cooldown after denial; all swept on seal teardown. NO revoke or grant-listing exists in any UI (see notes).
- **Lives:** `src/ui/surfaces/inline-panel/index.jsx` (reason input, inbox), `realm-console/index.jsx` (inbox); backend `src/server/capsules/editreq/{actions,logic}.js`, re-baseline in `src/server/triggers.js:handleSealedArtifactEdit`.
- **Core calls:** `request-edit-access`, `check-edit-request`, `list-edit-requests`, `list-my-edit-requests`, `approve-edit-request`, `deny-edit-request`. (`revoke-edit-grant` at `editreq/actions.js:402` and `list-edit-grants` exist as resolvers but have ZERO UI callers.)
- **Baseline:** Fn 3 · Distinct 3 · Motion 3 · Perf 2 · A11y 3.
- **Impact 5** — the sanctioned-collaboration path that makes sealing livable. **Effort 3** — two inboxes + request states across surfaces. **Risk 4** — grant honor + seal re-baseline is core contract C7; a regression silently reverts approved work or keeps stale baselines. Lower confidence on any change near `getActiveEditGrant`/TTL semantics — flag for extra verification.
- **Notes-risks:** PHANTOM FEATURE (Fn 3 evidence): once approved, a grant cannot be revoked or even listed from any surface — the enforcement-restore half of the lifecycle is UI-missing. `check-edit-request` fires per sealed-by-other card (N+1). Reason input has autoFocus + Enter/Escape (good pattern to keep). `list-my-edit-requests` does a full KVS scan.

## 7. Validations tab — per-space rules
- **Does:** Space stewards author page rules scoped to the space (same editor as global); space rules override global; empty = inherit.
- **Lives:** `src/ui/surfaces/realm-console/index.jsx` (tab shell), shared `src/ui/kit/ValidationsEditor.jsx` (251 lines); backend `src/server/capsules/validations/{actions,logic}.js` (`validation-config-space-{sanitizedKey}`, resolveEffectiveConfig).
- **Core calls:** `load-validation-config`, `store-validation-config`, `validate-page-now`.
- **Baseline:** Fn 4 · Distinct 3 · Motion 2 · Perf 4 · A11y 2.
- **Impact 4** — per-space governance is what makes rules adoptable. **Effort 2** — shared editor; scoping plumbing exists. **Risk 2** — override/inherit resolution is well-factored (resolveEffectiveConfig); main risk is UI state confusion between global and space configs.
- **Notes-risks:** MiniSelect in ValidationsEditor is div-based, blur-timeout close, no keyboard/ARIA — shared A11y debt with row 9 (fix once, both tabs benefit).

## 8. Delete/trash protection engine
- **Does:** Sealed attachment trashed → automatically restored from trash, seal stays active, owner notified. Permanently deleted → all seal state cleaned (record, content property, realm index, grants) and owner notified.
- **Lives:** `src/server/triggers.js:handleSealedArtifactTrash` (~704) and `handleSealedArtifactDeleted` (~766); cleanup helpers in `src/server/capsules/sealing/confluence-sync.js`.
- **Core calls:** trigger `artifact-trigger` on `avi:confluence:trashed|deleted:attachment`; surfaced via ribbon alerts + comments.
- **Baseline:** Fn 5 · Distinct 3 · Motion 2 · Perf 4 · A11y 3 (scored via ribbon/comment surface).
- **Impact 5** — deletion is the bluntest attack on a seal. **Effort 2** — focused handlers. **Risk 4** — restore uses the v1 content PUT with version+1; failure path must clean state without stranding records; wrong handling loses the seal or the file reference.
- **Notes-risks:** On failed trash-restore the seal state is deliberately cleaned and a "delete" violation sent — that fallback is contract-adjacent; keep notifications after the outcome is known.

## 9. Validations tab — global rules + Semantic AI config
- **Does:** Steward authors tenant-wide page rules (required headings/tables/labels, hierarchy, length limits), picks enforcement mode (Advisory / Gate / Hard revert), and configures Semantic AI review: enable toggle, Haiku-only model dropdown, custom rules, style guide, tone, compliance, severity threshold, notify-author, monthly token budget. "Runs on Atlassian" badge. NO required-macro rule authoring and NO token-usage/audit display exist in any UI (see notes).
- **Lives:** `src/ui/surfaces/steward-console/index.jsx` (tab shell), shared `src/ui/kit/ValidationsEditor.jsx`; backend `src/server/capsules/validations/actions.js` (`validation-config-global`, Haiku clamp on save).
- **Core calls:** `load-validation-config`, `store-validation-config`, `list-ai-models`. (`get-validation-audit` exists as a resolver but has ZERO UI callers.)
- **Baseline:** Fn 3 · Distinct 3 · Motion 2 · Perf 4 · A11y 2.
- **Impact 4** — the control plane for both rule engines. **Effort 3** — dense form; AI block has many fields. **Risk 2** — config shape is stable; the Haiku clamp is enforced at three layers so UI mistakes can't over-spend.
- **Notes-risks:** PHANTOM FEATURES (Fn 3 evidence): (a) the rules engine supports `required-macro` (`rules-engine.js:39`) but `ValidationsEditor.jsx` RULE_TYPES (lines 46–53) offers only 6 types with no macro rule — unauthorable from both the steward and realm tabs; (b) token usage/audit data is invisible in the app, yet `docs/features/semantic-ai-validations.md` step 5 says "Check the monthly token usage in the space console". Same MiniSelect A11y debt as row 7. Token budget and usage audit are per space — the global tab should make that scoping legible.

## 10. My Sealed Files tab (+ edit-request inbox)
- **Does:** Any user sees their seals in the space (file, page, seal date, time remaining) with Relinquish; approves/denies incoming edit requests on their files; non-stewards get a Request Steward Access banner with cooldown messaging.
- **Lives:** `src/ui/surfaces/realm-console/index.jsx`, `src/ui/tokens/realm-console.css`; backend `sealing/actions.js:enumerate-operator-seals`, `editreq/actions.js`, `realms/actions.js`.
- **Core calls:** `enumerate-operator-seals`, `unseal-artifact`, `list-my-edit-requests`, `approve-edit-request`, `deny-edit-request`, `request-steward-access`, `check-steward-request`.
- **Baseline:** Fn 4 · Distinct 3 · Motion 3 · Perf 3 · A11y 2.
- **Impact 4** — the only cross-page "my stuff" view a regular user has. **Effort 3** — cards + inbox + banner states. **Risk 2** — reads and existing actions; low blast radius beyond the console file.
- **Notes-risks:** `enumerate-operator-seals` is a full KVS scan (≤10×100) with API enrichment and stale-seal pruning — fine today, watch at scale. Screenshot shows the reservation card meta line wrapping awkwardly at narrow width ("Jun 23, 2026 / 35h 59m" collision).

## 11. Reservation Duration tab
- **Does:** Stewards choose system default vs custom per-space seal duration (hours) — feeds the seal-duration resolution chain.
- **Lives:** `src/ui/surfaces/realm-console/index.jsx`; backend `src/server/capsules/policies/{actions,logic}.js` (`autoUnlockTimeoutHours` in `admin-settings-space-*`).
- **Core calls:** `load-realm-ruleset`, `store-realm-ruleset` (or unified `load-policy`/`store-policy`).
- **Baseline:** Fn 4 · Distinct 3 · Motion 2 · Perf 4 · A11y 2.
- **Impact 3** — one setting, but it changes every new seal in the space. **Effort 1** — small form. **Risk 1** — resolution order (space → global → 48h baseline) is established and documented.
- **Notes-risks:** Custom "select" shares the console's mouse-only dropdown pattern.

## 12. Attachment cards & grouping (expand, thumbnails, 2-phase load)
- **Does:** The panel lists page attachments grouped Sealed / Missing (trashed) / Available; cards color-coded by status (cyan = mine, amber = sealed-by-other); expanding a card lazy-loads a thumbnail plus download and properties links (the documented recovery path to version history). Instant render from KVS then Confluence enrichment.
- **Lives:** `src/ui/surfaces/inline-panel/index.jsx` (1584), `src/ui/tokens/inline-panel.css` (1410), `src/ui/kit/ThumbnailPreview.jsx`.
- **Core calls:** `enumerate-panel-artifacts`, `enumerate-page-seals`, `resolve-artifact-preview`, `identify-operator` (per owner chip), `check-seal-stamp` (5s poll).
- **Baseline:** Fn 5 · Distinct 4 · Motion 3 · Perf 2 · A11y 3.
- **Impact 5** — the flagship surface users live in. **Effort 4** — the perf fix means restructuring per-card resolver fan-out and memoization in a 1584-line component. **Risk 3** — the N+1 batching refactor touches data flow for every card action; medium confidence it can be done without regressing the two-phase fast path — verify with the harness.
- **Notes-risks:** ~30+ resolver calls after list lands on a 15-file page (`identify-operator`/`check-edit-request`/`list-edit-requests` per card). No card entrance animation (stagger keyframes exist only in overlay/controls css). Unlabeled `▾` carets; OperatorChip avatar lacks alt semantics. Old-AUI filetype icon hexes (`#36B37E`, `#FF5630`) are off-token.

## 13. Upload zone (drag-drop, 4 MB)
- **Does:** Drag-and-drop or click to upload attachments from the panel; 4 MB/file cap (base64 transport); zone hideable via macro config.
- **Lives:** `src/ui/surfaces/inline-panel/index.jsx`, `src/ui/tokens/inline-panel.css` (dashed zone + drag state); backend `src/server/capsules/panels/actions.js:upload-artifact`.
- **Core calls:** `upload-artifact` (asUser, v1, base64 ≤4MB).
- **Baseline:** Fn 4 · Distinct 4 · Motion 3 · Perf 3 · A11y 3.
- **Impact 4** — completes the on-page attachment workflow. **Effort 2** — contained UI + one resolver. **Risk 2** — base64 size limit and error surfacing are the only sharp edges.
- **Notes-risks:** 4 MB cap is a resolver-payload constraint; error message clarity matters. Keyboard/SR affordance of the drop zone unverified.

## 14. Doc ribbon (counts, alerts, status chips)
- **Does:** Persistent page banner: sealed-count summary, dismissable seal-conflict/expiry alerts addressed to the viewer, validation status chip (gate mode), "AI review: N findings" chip, Manage Attachments button opening the overlay. Hides itself when nothing to report. NOT gated by Enable Page Status Banners: `ENABLE_PAGE_BANNERS` only gates server-side alert dispatch/recording (`bulletins/logic.js:45`, `triggers.js:1048`) — `doc-ribbon/index.jsx` never loads that toggle, so the bar (counts, chips, Manage Attachments) renders regardless; the toggle only starves it of alert content.
- **Lives:** `src/ui/surfaces/doc-ribbon/index.jsx` (239), `src/ui/tokens/doc-ribbon.css` (377); opens overlay via `new Modal({ resource:"overlay", size:"max" })`.
- **Core calls:** init burst of 4 invokes + `check-seal-stamp` 5s poll, `recent-dispatches`, `acknowledge-dispatch`, `get-validation-state`, `get-ai-findings`.
- **Baseline:** Fn 4 · Distinct 4 · Motion 2 · Perf 4 · A11y 3.
- **Impact 4** — the always-visible trust signal of the app. **Effort 2** — small component. **Risk 2** — polling contract and dismiss semantics are simple; chip states must track backend truth.
- **Notes-risks:** Alerts capped to first item with "+N more" and no way to view the rest (Fn gap). Off-token hardcodes: `#7C3AED` AI chip, `#F59E0B/#1F2937` awaiting chip. No reduced-motion guard in its sheet; status chips have no live region (SR-invisible updates); shield SVG lacks aria-hidden.

## 15. Sealed-section macro surface (config card + view frame)
- **Does:** On insert: explainer + "Insert section" button. In view mode: a frame with a static "Sealed by Sentinel Vault" badge (`section-setup/index.jsx:83` — no owner name, no expiry) rendering the protected body via ADF-renderer iframe (text fallback states edits auto-revert). The "Sealed by … until …" meta and the Request Edit affordance for others' sections live in the inline panel's SectionRow (rows 1/32), NOT in this macro frame.
- **Lives:** `src/ui/surfaces/section-setup/index.jsx` (97), `src/ui/tokens/section-setup.css` (124, own `--sec-*` namespace); manifest bodied macro `sentinel-vault-sealed-section` (same resource for view and config).
- **Core calls:** context read; ADF renderer iframe (`createAdfRendererIframeProps` best-effort).
- **Baseline:** Fn 3 · Distinct 4 · Motion 1 · Perf 5 · A11y 4.
- **Impact 4** — it is the visible face of content sealing on every sealed page. **Effort 2** — 97-line component; headroom is presentation. **Risk 2** — must not disturb the wrapper node shape the trigger depends on (sectionId in guestParams); render-only changes are safe.
- **Notes-risks:** Zero motion (only surface at Motion 1). Standalone-harness placeholder body is expected outside Confluence. Only surface that aria-hides its decorative glyph — keep.

## 16. General tab (10 policy settings)
- **Does:** Tenant policy: default seal duration, steward force-unseal allowance, seal expiry notifications, delete/restore/purge allowances, page-body protection, auto-insert macro + nested replace-attachments toggle, reminder frequency (visible only when expiry notifications off).
- **Lives:** `src/ui/surfaces/steward-console/index.jsx` (543), `src/ui/tokens/steward-console.css`; backend `src/server/capsules/policies/actions.js` (`admin-settings-global`, pause/resume timer-extension logic).
- **Core calls:** `load-policy`, `store-policy` (or `load-global-ruleset`/`store-global-ruleset`).
- **Baseline:** Fn 4 · Distinct 3 · Motion 2 · Perf 4 · A11y 4.
- **Impact 4** — every protection behavior hangs off these toggles. **Effort 2** — form work. **Risk 2** — the auto-unlock pause/resume extension logic (disabling stamps `autoUnlockPausedAt`, re-enabling extends every seal) lives behind the save button; don't bypass `store-policy`.
- **Notes-risks:** Visible defect in screenshot: sticky "Apply Configuration" bar overlaps/clips the last settings row. Save reuses `loading` and blanks the whole form; generic error string. Conditional visibility of nested settings is documented behavior worth harness coverage.

## 17. Alerts tab (7 notification toggles)
- **Does:** Global notification channel switches: flash messages, page banners, Confluence comments, native-notification master toggle + three nested sub-toggles (seal confirmation & halfway, expiry notices, recurring reminder banners).
- **Lives:** `src/ui/surfaces/steward-console/index.jsx`; backend `src/server/capsules/policies/actions.js` + `src/server/shared/bulletin-flags.js` (legacy KVS field names like `enableEmailDispatches` intentionally kept).
- **Core calls:** `load-policy`, `store-policy`, `load-bulletin-toggles` (consumer side).
- **Baseline:** Fn 4 · Distinct 3 · Motion 2 · Perf 4 · A11y 4.
- **Impact 4** — controls all user-facing communication. **Effort 2** — toggle rows. **Risk 2** — the legacy field names are load-bearing (contract-adjacent); renaming keys in a UI refactor would silently orphan settings.
- **Notes-risks:** UI label "Enable Native Notifications" vs KVS key `enableEmailDispatches` is intentional backward compat — keep labels current-truth (comments, not emails).

## 18. Labels (add/remove)
- **Does:** Add/remove Confluence labels on any attachment from the panel or overlay cards.
- **Lives:** `src/ui/surfaces/inline-panel/index.jsx`, `overlay/index.jsx`; backend `src/server/capsules/panels/actions.js` (v1 label endpoints).
- **Core calls:** `label-artifact`, `unlabel-artifact`.
- **Baseline:** Fn 4 · Distinct 3 · Motion 2 · Perf 3 · A11y 2.
- **Impact 3** — organizational nicety alongside sealing. **Effort 2** — contained chips UI. **Risk 1** — read/write of labels only; no seal-state interaction.
- **Notes-risks:** Add/remove buttons rely on `title` attributes only (A11y 2 evidence); label edit triggers the full-refresh pattern.

## 19. Realm Sealed Files tab (steward audit view)
- **Does:** Stewards see all seals in the space: column picker, sort, 3-col cards with expandable thumbnail/download/properties, Force Unseal (needs global allowance), Watch, infinite scroll + Show more. NO audit/scan button renders (see notes) — the steward-facing trigger for the realm audit does not exist in the UI.
- **Lives:** `src/ui/surfaces/realm-console/index.jsx`, `src/ui/tokens/realm-console.css`; backend `src/server/capsules/realms/actions.js`, index in `space-protection-{spaceId}-*`.
- **Core calls:** `enumerate-realm-seals` (cursor-paged), `steward-unseal`, `watch-artifact`/`check-watch`, `identify-realm`. (`launch-realm-audit`/`check-audit-status` are invoked only from the dead `onReconstructIndex` handler — see notes.)
- **Baseline:** Fn 4 · Distinct 3 · Motion 3 · Perf 2 · A11y 2.
- **Impact 4** — the steward's oversight cockpit. **Effort 3** — pickers, infinite scroll, force actions. **Risk 3** — infinite scroll is wired via body-wide MutationObservers (brittle, render-hot); replacing it touches list lifecycle; medium confidence, verify scroll behavior on long lists.
- **Notes-risks:** DEAD FRONTEND CODE: `onReconstructIndex` (realm-console/index.jsx:986) and `scanStatus`/`isScanning` (437–438) are defined but referenced by nothing in the file's JSX — no button, no status display; likewise `artifactsPageSize`/`onResultsPerPageChange` (434, 1210) have no rendered control. Do NOT "polish" this phantom UI in an iteration — either render real controls (see row 37) or delete the dead code. `check-watch` N+1 per file on every list change. Force Unseal is double-gated (toggle + steward) per contract C15 — keep both gates visible in UI state.

## 20. Delete / restore / purge actions
- **Does:** Delete sends unsealed attachments to trash (refuses files sealed by others); Restore recovers trashed attachments with seal data; Purge permanently removes leftover seal records for deleted files. Each behind its own global toggle, buttons invisible when disabled. Inline confirm bars (no native dialogs).
- **Lives:** `src/ui/surfaces/inline-panel/index.jsx`, `overlay/index.jsx`; backend `src/server/capsules/panels/actions.js:delete-artifact`, `sealing/actions.js:restore-sealed-artifact`, `purge-seal-record`, `sealing/confluence-sync.js:purgeAllSealState`.
- **Core calls:** `delete-artifact`, `restore-sealed-artifact`, `purge-seal-record`.
- **Baseline:** Fn 4 · Distinct 3 · Motion 3 · Perf 3 · A11y 3.
- **Impact 4** — the recovery/cleanup half of attachment management. **Effort 2** — actions exist; iteration is affordance and messaging. **Risk 3** — destructive paths; `trashedOnly` tracking records and toggle gating (C15) must survive any refactor.
- **Notes-risks:** Overlay sleeps 1s arbitrarily after delete. Buttons invisible (not disabled) when toggles are off — documented FAQ item; consider discoverability.

## 21. Validation group (status, re-check, violations)
- **Does:** Panel group showing gate status (Passed / Issues found / Awaiting approval), violation list, and a Re-check button; only rendered when a gate status exists. NO steward approval affordance exists in any UI (see notes).
- **Lives:** `src/ui/surfaces/inline-panel/index.jsx`, `src/ui/tokens/inline-panel.css`; backend `src/server/capsules/validations/actions.js`.
- **Core calls:** `get-validation-state`, `validate-page-now`. (`approve-page-gate` resolver registered at `validations/actions.js:214` but has ZERO UI callers.)
- **Baseline:** Fn 3 · Distinct 4 · Motion 2 · Perf 3 · A11y 3.
- **Impact 4** — where authors actually see and resolve rule failures. **Effort 3** — states + approval affordance. **Risk 2** — read-mostly; `validate-page-now` is mutation-free and fails closed.
- **Notes-risks:** PHANTOM FEATURE (Fn 3 evidence): the panel's Validation group renders only a Re-check button (`inline-panel/index.jsx:983–985`) — the "Awaiting approval" state is displayable but UNRESOLVABLE from the UI, and `docs/features/conditions-validations.md` repeats the "a steward can approve" claim. Group hidden when no gate status — advisory-mode users never see in-panel results (Fn consideration). `#B45309` medium-severity hex is off-token.

## 22. Macro tab (auto-insert + position)
- **Does:** Space stewards toggle auto-insert of the panel macro on seal and set position (top/bottom, default bottom).
- **Lives:** `src/ui/surfaces/realm-console/index.jsx`; backend `src/server/capsules/policies/actions.js` (`autoInsertMacro`, `macroInsertPosition`).
- **Core calls:** `load-realm-ruleset`, `store-realm-ruleset`.
- **Baseline:** Fn 4 · Distinct 3 · Motion 2 · Perf 4 · A11y 3.
- **Impact 3** — convenience policy; requires the global toggle too. **Effort 1** — toggle + radios. **Risk 1** — settings write only.
- **Notes-risks:** Effective behavior needs BOTH global `globalAutoInsertMacro` ON and space not-disabled — the tab should communicate the dependency.

## 23. Sealed-section tamper detection & restore engine
- **Does:** Non-owner edits to a sealed section's body, or deleting the macro entirely, are detected on page save (content hash + structural compare vs snapshot) and restored; owner edits re-baseline; approved section-grant edits are kept; expired seals are inert. Deleted wrappers re-inserted with heading-anchored positioning. Owner notified via footer comment.
- **Lives:** `src/server/triggers.js:restoreSealedSectionsPass` (~359), `src/server/infra/doc-surgery.js` (canonicalizeAdf, hashAdf FNV-1a, locateBodiedSectionNodes, replaceSectionBody, spliceSectionWrapper), snapshots in `section-snapshot-{sectionId}`.
- **Core calls:** trigger `page-content-trigger`; state visible via section macro frame + comments; harness reads `section-protection-*` via test hook.
- **Baseline:** Fn 4 · Distinct 3 · Motion 1 · Perf 4 · A11y 3 (scored via section macro + comment surface).
- **Impact 5** — the enforcement half of content sealing. **Effort 4** — ADF canonicalization/compare logic is subtle. **Risk 5** — LOW-confidence zone by nature: false reverts on no-op editor saves (volatile ADF keys) and missed tampers are both plausible failure modes; SV-M5/M7/m6 fixes show how tricky it is. Any change here needs harness verification against contract C4/C6.
- **Notes-risks:** `canonicalizeAdf` drops only `localId` today — comment says extend empirically. Hash match is trusted only after structural compare (FNV is forgeable). Top-level-only wrapper location means nested sections are out of scope by design.

## 24. Semantic AI validation engine (Forge LLM worker)
- **Does:** Async AI content review via Atlassian-hosted Claude Haiku (`@forge/llm`, no egress, no BYOK): extract page text (truncate to budgeted chars), prompt, parse JSON tolerantly, normalize ≤25 findings with stable ids, store history + latest, accrue monthly token usage per space, optionally @mention the page author above the severity threshold. Off by default; fails closed on unparseable output.
- **Lives:** `src/server/capsules/validations/ai-worker.js` (queue consumer, 120s), `src/server/infra/forge-llm.js` (Haiku-only clamp, retry ×3), `infra/json-salvage.js`, `validations/logic.js` (storeFindings, accrueTokenUsage); manifest LLM module `sentinel-vault-llm`.
- **Core calls:** `enqueue-page-validation` → `ai-validation-queue` → `aiValidationConsumer`; `get-validation-job`, `get-ai-findings`, `set-ai-finding-state`, `get-validation-audit`, `list-ai-models`.
- **Baseline:** Fn 4 · Distinct 3 · Motion 2 · Perf 3 · A11y 3 (scored via AI Review group + ribbon chip).
- **Impact 4** — the marquee AI capability and paid-tier seed. **Effort 3** — worker + prompt + normalization already solid; iteration is quality/robustness. **Risk 3** — cost/policy backstops (C14: Haiku clamp, budget guard, fail-closed, no rethrow) must hold under any change; prompt changes shift finding quality unpredictably.
- **Notes-risks:** Errors deliberately not rethrown (avoid retry double-billing). Status rows TTL 1h and are deleted once terminal — polling contract with the panel.

## 25. Roles & authorization (steward model)
- **Does:** Operators seal/unseal their own files, watch, request access; stewards (space ADMINISTER, configured user/guild, or site admin) force-unseal (if globally allowed), manage access control and policy, approve gates/requests; site admins get the steward console. Tab visibility adapts to role.
- **Lives:** `src/server/shared/steward-checks.js` (isOperatorSteward, authorizeSteward), `realms/actions.js:check-user-role`, `entitlements/actions.js`.
- **Core calls:** `check-user-role`, `load-session`, `check-license` (stub), `steward-override-enabled`; authorizeSteward gates all force actions.
- **Baseline:** Fn 4 · Distinct 3 · Motion 2 · Perf 3 · A11y 3 (scored via role-adaptive consoles).
- **Impact 4** — the security model everything trusts. **Effort 2** — logic is centralized. **Risk 4** — authorization drift = privilege escalation or lockout; contract C15 double-gating must never be weakened. Changes here warrant explicit permission-matrix testing.
- **Notes-risks:** Role visibility uses `isOperatorSteward` (ignores override toggle) while force actions use `authorizeSteward` (includes it) — intentional split; keep it.

## 26. AI Review group (run, findings, dismiss/false-positive)
- **Does:** Panel group (visible only when AI enabled for the space): Run AI review → "Reviewing…" → findings rendered as severity (HIGH/MEDIUM/LOW) + ruleRef + explanation + suggestion (`inline-panel/index.jsx:907–913` — no category or excerpt is displayed, even if the model returns them); per-finding Dismiss / False positive / restore; show-hidden; "No issues found"; collapsible group. Ribbon mirrors a findings-count chip.
- **Lives:** `src/ui/surfaces/inline-panel/index.jsx`, `src/ui/tokens/inline-panel.css` (`#7C3AED` AI purple hardcoded).
- **Core calls:** `enqueue-page-validation`, `get-validation-job` (poll), `get-ai-findings`, `set-ai-finding-state`.
- **Baseline:** Fn 5 · Distinct 3 · Motion 3 · Perf 3 · A11y 3.
- **Impact 4** — the visible payoff of the AI feature. **Effort 3** — many finding states; polish + polling UX. **Risk 2** — frontend states over a stable job API.
- **Notes-risks:** AI purple `#7C3AED` exists nowhere in the token system (also on ribbon chip) — either tokenize it as the official AI accent or replace; keep it solid per design rules.

## 27. Attachment edit auto-reversion engine
- **Does:** Non-owner uploads a new version of a sealed file → app downloads the sealed version and re-uploads it as a new version (history preserved); owner and grant-holders pass (grants re-baseline the seal). Owner + editor notified via comment @mention, banner, toast.
- **Lives:** `src/server/triggers.js:artifactEventTrigger` + `handleSealedArtifactEdit` (~597); loop-guard via `app-account-id`.
- **Core calls:** trigger on `avi:confluence:updated:attachment`; surfaced via ribbon alerts, comments, `list-breach-dispatches` toasts.
- **Baseline:** Fn 5 · Distinct 3 · Motion 2 · Perf 4 · A11y 3 (scored via notification surfaces).
- **Impact 5** — the teeth of the seal. **Effort 3** — the flow is mature; iteration is edge-cases and messaging. **Risk 5** — revert-loop and wrong-baseline bugs are the most dangerous in the app (contracts C1/C3/C7); no manifest-level ignoreSelf exists, self-suppression is code-only. LOW confidence on untested changes here — always drive with the harness.
- **Notes-risks:** Target = `sealedVersion` (fallback currentVersion-1); no-op when current == target. `infra/artifact-fetch.js:artifactEventHandler` is an older parallel handler NOT wired in the manifest — don't "fix" the wrong one.

## 28. Flash messages / toasts
- **Does:** In-app popup confirmations for seal/unseal/conflict/rollback via Forge showFlag; gated by Enable Pop-up Notifications; violation toasts drained from short-TTL KVS keys.
- **Lives:** `src/ui/kit/flash-messages.js` (146); backend toast keys `violation-alert-*` (`triggers.js:sendViolationNotifications`, drained by `list-breach-dispatches`).
- **Core calls:** `load-bulletin-toggles` (ENABLE_TOAST_DISPATCHES), `list-breach-dispatches`.
- **Baseline:** Fn 4 · Distinct 3 · Motion 3 · Perf 4 · A11y 3.
- **Impact 3** — immediate feedback channel. **Effort 1** — thin wrapper. **Risk 1** — showFlag API is stable; worst case a missing toast.
- **Notes-risks:** Toasts may not appear if the page refreshes immediately (documented). Forge-native flags limit styling — distinctiveness ceiling is platform-imposed. Not in this kit's inventory: the overlay fires its own persistent expired-reservation warning flags directly via showFlag (see row 33 notes).

## 29. Steward access request workflow
- **Does:** Non-steward requests elevation from My Sealed Files → pending-confirmation banner → stewards approve/deny in Access Control (approve appends to space adminUsers) → denial = 48h re-request cooldown.
- **Lives:** `src/ui/surfaces/realm-console/index.jsx` (both tabs); backend `src/server/capsules/realms/actions.js` (`steward-request-{spaceKey}-{accountId}`).
- **Core calls:** `request-steward-access`, `check-steward-request`, `list-steward-requests`, `approve-steward-request`, `deny-steward-request`.
- **Baseline:** Fn 4 · Distinct 3 · Motion 2 · Perf 3 · A11y 2.
- **Impact 3** — self-service onboarding to stewardship. **Effort 2** — states exist on both ends. **Risk 2** — approval mutates space policy (`adminUsers`) — keep that single write path.
- **Notes-risks:** Cooldown messaging should match the 48h backend truth; request cards share the console's A11y debt.

## 30. Seal expiry & scheduled maintenance
- **Does:** Hourly sweep posts expiry notices and one-time halfway reminders (notify-only — actual unsealing is lazy on next touch); with expiry off, seals persist as "Overdue" and a daily nudge posts banner-only reminders every N days; pausing auto-unlock extends all seals by the pause duration on resume.
- **Lives:** `src/server/triggers.js:expirySweepTask` (~846) + `recurringNudgeTask` (~1030); lazy deletion in `sealing/logic.js:computeSealStatus`/`breakSeal`; pause logic in `policies/actions.js:storePolicy`.
- **Core calls:** scheduled `expiry-sweep-task` (hourly), `recurring-nudge-task` (daily); harness can drive via test hook `invoke(expirySweep)`.
- **Baseline:** Fn 4 · Distinct 2 · Motion 2 · Perf 3 · A11y 3 (scored via Overdue badges + comments/banners).
- **Impact 4** — expiry semantics define what a seal promise means over time. **Effort 3** — timer/dedup logic across two tasks. **Risk 4** — contract C10 (notify-only sweep, lazy delete, pause extension) is easy to violate subtly; dedup keys prevent notification storms.
- **Notes-risks:** Sweep scans `protection-*` with limit 100 and NO cursor loop — silent under-notification beyond 100 seals (scale correctness gap). "Overdue" presentation (Distinct 2) is an improvable surface.

## 31. Page-body content protection engine (media surgery)
- **Does:** A page edit that removes a sealed media embed is surgically repaired: diff current vs previous ADF, find missing sealed fileIds (walking up to 5 prior versions), deep-clone the containing block, splice back at original index; all other edits preserved; one write with 409 backoff; notifications only after confirmed write.
- **Lives:** `src/server/triggers.js:pageContentTrigger` (~103) + `restoreMediaPass` (~268); `src/server/infra/doc-surgery.js` (collectMediaFileIds, extractMediaSingleNodes, spliceMediaNodes, writeDocBody).
- **Core calls:** trigger on `avi:confluence:updated|created:page`; gated by global `enableContentProtection`; probes content properties before any ADF read (C13 fast path).
- **Baseline:** Fn 4 · Distinct 3 · Motion 2 · Perf 4 · A11y 3 (scored via ribbon/comment surface).
- **Impact 5** — protects the sealed content where readers see it. **Effort 4** — ADF diff/splice code. **Risk 5** — page-clobbering potential; contracts C1/C2/C9 (fail-closed on unresolved app id, asApp writes, give-up-quietly on persistent 409) are the safety net. LOW confidence without harness runs — docs themselves disagree on position restoration (append vs original position); verify in code before asserting.
- **Notes-risks:** Media inside table/expand/layout → whole containing block restored; moved media = no violation; no prior version = protection can't activate.

## 32. Section edit requests & grants
- **Does:** Non-owner of a sealed section requests edit access; owner/steward approves/denies; approved editors' body changes are kept and the section re-baselines (hash + snapshot); grants TTL to seal expiry and are swept on unseal.
- **Lives:** `src/ui/surfaces/inline-panel/index.jsx` (per-section Request Edit); backend `src/server/capsules/editreq/{actions,logic}.js` (`section-edit-request/grant-*`), honor + re-baseline in `triggers.js:restoreSealedSectionsPass`.
- **Core calls:** `request-section-edit`, `check-section-edit`, `list-section-edit-requests`, `approve-section-edit`, `deny-section-edit`.
- **Baseline:** Fn 4 · Distinct 3 · Motion 2 · Perf 3 · A11y 3.
- **Impact 4** — makes sealed sections collaborative instead of read-only walls. **Effort 3** — parallel flow exists; UI parity + gaps. **Risk 4** — same C7 re-baseline hazards as attachments, entangled with the restore engine (row 23).
- **Notes-risks:** No section-level `revoke`/`list-grants` resolvers exist (parity gap with attachments) — a real functional hole to consider designing in.

## 33. Overlay management modal
- **Does:** Full-screen management from the ribbon: all page attachments in Sealed/Trash/Available card groups, sort (name/status/lapses/created), localStorage column picker, "Show more" pagination, seal/relinquish, watch, delete/purge with inline confirm, restore, inline-macro visibility toggle, refresh, Done. NO search input exists anywhere in the file — the toolbar is only column picker + SortPicker + file count + Refresh (`overlay/index.jsx:1010–1037`).
- **Lives:** `src/ui/surfaces/overlay/index.jsx` (1396), `src/ui/tokens/overlay.css` (1112), kit flash-messages + ThumbnailPreview. NOTE: `overlay` resource is not referenced by any manifest module — it is opened programmatically from the ribbon.
- **Core calls:** `enumerate-doc-artifacts` (`overlay/index.jsx:558`), `seal-artifact`/`unseal-artifact`, `check-watch` (per sealed card), `delete-artifact`, `restore-sealed-artifact`, `purge-seal-record`, `check-panel-status` (662) + `store-doc-panel-prefs` (1118) for the macro-visibility toggle, `check-seal-stamp` poll. (`inject-panel`/`extract-panel` are registered resolvers with ZERO UI callers — panel embed runs server-side via `triggerPanelEmbed`, row 38.)
- **Baseline:** Fn 4 · Distinct 3 · Motion 4 · Perf 2 · A11y 3.
- **Impact 4** — the power-user management view. **Effort 4** — 1396 lines with inline-style tech debt to unwind. **Risk 3** — effect-loop hazards (`useEffect([fileList])` re-firing watch checks and expiry flags) make refactors easy to get subtly wrong.
- **Notes-risks:** On open, every reservation of yours past expiry raises a PERSISTENT (`isAutoDismiss:false`) "Reservation expired" showFlag (`overlay/index.jsx:897–924`), re-fired on every fileList change — a known annoyance vector not covered by row 28's toast inventory. Missing search on a file list is a real Fn gap for large pages. Macro-visibility banner built from inline styles with hardcoded AUI hexes (`#00875A`, `#DE350B`, `#97A0AF`) and 4% rgba washes — violates the solid-colors design rule; the flagged weakest element. No upload here (panel-only). Leftover console.log noise. Sort options are div-onClick (no keyboard); no focus-visible rule in its sheet.

## 34. Conditions & Validations engine (advisory/gate/revert)
- **Does:** Post-save page rule checking (required headings/tables/macros/labels, hierarchy, min/max length in code points) with three enforcement modes: advisory footer comment, gate status stamp (steward-approvable), hard revert to last compliant version (opt-in; aborts if the page version moved).
- **Lives:** `src/server/infra/rules-engine.js` (pure), `triggers.js:runValidationPhase` (~481), `validations/logic.js`, `infra/validation-blueprints.js`.
- **Core calls:** trigger-side auto path; `validate-page-now` manual path; gate property `sentinel-vault-validation`.
- **Baseline:** Fn 4 · Distinct 3 · Motion 2 · Perf 4 · A11y 3 (scored via panel group + ribbon chip + comments).
- **Impact 4** — page-quality governance layer. **Effort 3** — engine + three modes + dedup. **Risk 4** — hard-revert can discard user work; C5/C8 (abort-on-version-move, claim-dedup-first) are the guard rails; only `current` pages, v1 falls back to advisory.
- **Notes-risks:** Forge events fire post-save — cannot block; messaging must never imply prevention. Warn-severity violations never flip `passed`. The engine's `required-macro` rule type (`rules-engine.js:39`) is UNAUTHORABLE from the shared editor (row 9) — engine-only capability with no UI path to create such a rule.

## 35. Onboarding explainer
- **Does:** First-run explanation block in the inline panel introducing the app on pages where users first meet it; dismissible (localStorage).
- **Lives:** `src/ui/surfaces/inline-panel/index.jsx`.
- **Core calls:** none (local state + localStorage).
- **Baseline:** Fn 3 · Distinct 3 · Motion 1 · Perf 5 · A11y 3.
- **Impact 2** — peripheral, but the first impression. **Effort 1** — one block. **Risk 1** — cosmetic.
- **Notes-risks:** Documented only in TESTING.md's render matrix — thin spec; content and look are wide open for a design pass.

## 36. Live status sync (5s stamp polling)
- **Does:** Ribbon, inline panel, and overlay each poll `check-seal-stamp` every 5s and refetch on change, so seal state stays fresh across surfaces without reloads (≤5s staleness is documented behavior).
- **Lives:** polling effects in `doc-ribbon/index.jsx`, `inline-panel/index.jsx`, `overlay/index.jsx`; backend `sealing/actions.js:check-seal-stamp` reading `protections-last-modified`.
- **Core calls:** `check-seal-stamp`; stamp written by `touchSealTimestamp` on every seal mutation.
- **Baseline:** Fn 4 · Distinct 3 · Motion 2 · Perf 2 · A11y 3.
- **Impact 3** — invisible when it works; staleness/refetch storms when it doesn't. **Effort 3** — consolidating three pollers touches all three surfaces. **Risk 3** — the stamp contract also gates the index cron; refactoring must keep refetch triggers equivalent.
- **Notes-risks:** Three concurrent pollers per open page today; a shared poller or jittered/backoff polling is the obvious iteration.

## 37. Realm audit & seal index maintenance
- **Does:** Backend async scan rebuilds the space seal index (status keys polled, minutes on large spaces); hourly cron re-queues scans per realm only when the seal stamp changed; backfills spaceId on legacy seals and prunes stale index rows. NO steward-facing trigger exists: the realm-console handler that would invoke it is dead code (see row 19), so today only the cron exercises this machinery.
- **Lives:** `src/server/capsules/realms/scan-worker.js` (realmScanConsumer 900s, sealIndexCron), status keys `space-scan-status-{spaceId}`; the would-be UI hook (`onReconstructIndex`) sits unreferenced in `realm-console/index.jsx:986`.
- **Core calls:** `launch-realm-audit`, `check-audit-status` (both resolvers real, both UI-unreachable); scheduled `seal-index-cron`.
- **Baseline:** Fn 3 · Distinct 2 · Motion 2 · Perf 3 · A11y 3 (backend real; the steward-facing scan control does not render).
- **Impact 3** — keeps the steward view truthful. **Effort 3** — worker + status lifecycle. **Risk 3** — index rebuild deletes stale keys; a scoping bug erases live index entries (steward view goes blind until next scan).
- **Notes-risks:** PHANTOM UI (Fn 3 evidence): rows 19/37 previously credited a scan button + status polling that nothing renders — an iteration must either wire the dead handler to a real control or remove it. Cron change-gate (`protections-last-modified` vs `protections-last-scanned`) is the cost control — preserve it.

## 38. Auto-insert / replace-attachments macro
- **Does:** Sealing on a page without the panel auto-inserts the macro (global + space toggles both required; space sets top/bottom position); optionally replaces the built-in Attachments macro; panel auto-removed when no seals remain; per-page opt-out via page property.
- **Lives:** `src/server/infra/doc-surgery.js:triggerPanelEmbed` (~462), insertPanelNode/removePanelNode/replacePanelForAttachmentsMacro (409 retries), `panels/actions.js` (extension-key caching, page prefs).
- **Core calls:** invoked from `seal-artifact`/`unseal-artifact`; `inject-panel`, `extract-panel`, `check-panel-status`, `store-doc-panel-prefs`, `register-panel-key`, `discover-panel-key`.
- **Baseline:** Fn 4 · Distinct 3 · Motion 2 · Perf 4 · A11y 3 (scored via its effect on pages + overlay toggle).
- **Impact 3** — convenience that makes the panel appear where it's needed. **Effort 2** — logic exists; edge polish. **Risk 3** — writes page ADF; must respect C9 (409 backoff, quiet give-up) and the `macroDisabled` opt-out.
- **Notes-risks:** Extension key derivation is cached (`macro-extension-key`) — environment moves can stale it; `discover-panel-key` is the recovery.

## 39. Theming, dark mode & token system
- **Does:** LeanZero identity (slate + teal/cyan, Inter) in light and dark across all seven surfaces; dark mode via Forge `view.theme.enable()` setting `data-color-mode`; custom dialogs/dropdowns everywhere (no native chrome).
- **Lives:** `src/ui/tokens/*.css` (9 files — foundation.css canonical, but EVERY surface sheet re-declares the full token block; panel-setup uses `--mc-*`, section-setup `--sec-*`), `src/ui/kit/palette-sync.js`.
- **Core calls:** `enablePaletteSync()` per iframe init.
- **Baseline:** Fn 4 · Distinct 3 · Motion 2 · Perf 4 · A11y 3.
- **Impact 3** — brand coherence and dark-mode correctness are user-visible everywhere. **Effort 3** — consolidating 9 duplicated token blocks + 3 namespaces without visual regressions. **Risk 2** — mechanical but wide blast radius (every surface's CSS); screenshot diffing makes it verifiable.
- **Notes-risks:** The single biggest frontend drift risk: palette changes need ~9 synchronized edits; dark-block coverage already varies per file. Off-token hexes to resolve: `#7C3AED`, `#F59E0B/#1F2937`, `#B45309`, AUI leftovers `#00875A/#DE350B/#97A0AF/#36B37E/#FF5630`, 4% rgba washes (design-rule violation). reduced-motion guards missing in 4 of 9 sheets; focus-visible coverage uneven.

## 40. Panel setup (macro preferences dialog)
- **Does:** Configure the inline panel per macro instance: column visibility (9 columns), rows per page (5/10/15/25), cards per row (1–3), upload-zone toggle; Apply/Discard. Stored in macro config, not KVS.
- **Lives:** `src/ui/surfaces/panel-setup/index.jsx` (273), `src/ui/tokens/panel-setup.css` (482, own `--mc-*` namespace).
- **Core calls:** macro config context read/write only.
- **Baseline:** Fn 4 · Distinct 4 · Motion 4 · Perf 5 · A11y 3.
- **Impact 3** — quality-of-life for page owners. **Effort 2** — small, already the best-feeling surface. **Risk 1** — isolated config dialog.
- **Notes-risks:** Best micro-motion language in the app (keep as reference); missing reduced-motion guard; select options are divs (no role/keyboard); toggle row is a double click-target.

## 41. Lifecycle cleanup (uninstall wipe)
- **Does:** On app uninstall, the lifecycle trigger deletes all app KVS records — complete tenant cleanup.
- **Lives:** `src/server/triggers.js:lifecycleTrigger` (avi:forge:installed|uninstalled:app).
- **Core calls:** lifecycle trigger only; no UI surface (neutral 3s where axes don't apply).
- **Baseline:** Fn 3 · Distinct 3 · Motion 3 · Perf 4 · A11y 3.
- **Impact 2** — invisible until offboarding, then it's the whole story. **Effort 1** — one handler. **Risk 2** — current wipe queries only the first 1000 keys — large tenants leak records (the Fn 3 evidence); fix needs a cursor loop.
- **Notes-risks:** Must never run on `installed`; keep the event guard explicit.

---

# Capability expansion — Document Workflow Rules (doc-workflow domain pack)

Rows 42–48 are the vetted Comala-style workflow-rules capability (owner directive 2026-07-05). Full specs — data model, resolvers, reuse map, guardrails, adversarial critique — live in [`state/CAPABILITY_EXPANSION.md`](CAPABILITY_EXPANSION.md); the blocks below are ledger summaries. These rows carry the `domain_pack_boost` (+2) baked into their Priority. **Ship order (dependency- and table-stakes-aware, NOT raw priority): 42 → 43 → 44 → 45 → 48 → 47 → 46.** F2–F7 all depend on the F1 (#42) engine, so #42 is unambiguously first.

## 42. Workflow state engine & state chip  *(foundation)*
- **Does:** A page carries a named workflow state (Draft / In Review / Approved / Expired, steward-definable); shown as a colored chip on the doc ribbon + realm console; rights-holders move states from the panel; every transition logged who/when. Attaches at scale: per-space default, label-filtered, and bulk apply (answers Comala's "3,000 manual copy-pastes" 1★ scar).
- **Lives (new):** `src/server/capsules/workflow/` (new capsule); config UI in realm/steward console; chip in doc-ribbon. Reuses `resolveEffectiveConfig()`/`writeValidationState()` patterns (`validations/logic.js`), `authorizeSteward()`, registry spread.
- **Core calls (new):** content property `sentinel-vault-workflow` (NEVER overload `sentinel-vault-validation`); Custom Entity Store `workflowState` entity + `by-state`/`by-due-date`/`by-space` indexes (from day one — hard to migrate later); `workflow-def-global|space-*` KVS config; `workflow-log-{pageId}-{ts}` (NO TTL — compliance artifact).
- **Baseline:** Fn 1 · Distinct 1 · Motion 1 · Perf 1 · A11y 1 (not built). **Impact 5 · Effort 4 · Risk 2** (+2 pack boost → Priority 23.0).
- **Guardrails:** no new scope; `contentBylineItem`(static) + storage-entities = manifest additions (minor version); no Preview API. **Confidence HIGH** — pure pattern transcription.
- **STATUS 2026-07-05 (iteration 1, branch `aql/workflow-state-engine`):** BACKEND ENGINE VERIFIED LIVE (workflow-e2e 13/13, full grade PASS). Storage built on **KVS + hand-rolled `workflow-idx-*` index** (deliberate deviation from the entity-store spec — see `iterations/01-workflow-state-engine.md`; keeps it zero-manifest-change, matches every sibling capsule; F7 queries the index prefix, entity-store migration deferred as a conscious choice). Default workflow Draft→In Review→Approved→Expired; `sentinel-vault-workflow` content property; no-TTL `workflow-log-*`.
- **STATUS 2026-07-05 (iteration 2):** CHIP + TRANSITION UI VERIFIED (`iterations/02-workflow-chip.md`). Doc-ribbon shows a solid branded state chip + a fully keyboard-accessible custom transition menu (ARIA menu pattern, roving focus, focus ring, reduced-motion guard, zero native selects — menu-a11y 13/13); custody-shift + seat motion on the house easing. Adversarial review found+fixed 9 defects incl. a null-`pageId` regression the screenshot mock had masked. Scores Distinct/Motion/A11y 1→4, Fn 3→4.
- **STATUS 2026-07-05 (iteration 3):** AT-SCALE ASSIGNMENT (auto-assign-on-create) VERIFIED (`iterations/03-workflow-autoassign.md`). Per-space `workflow-settings-{key}` (enabled/autoAssignNew) + a create-only auto-assign pass in `pageContentTrigger` → new pages in an enabled space get a workflow automatically (workflow-autoassign-e2e 8/8). 3-lens adversarial trigger-safety review (loop/ordering/concurrency, core-touching scrutiny): loop-safety clean; fixed a dedup-marker concurrency gap (T6 pattern) + a create-only gate. **Remaining sub-slice (→ iteration 4):** steward config UI (realm-console "Workflow" tab, mirror `ValidationsEditor`) + bulk retro-apply to existing pages. Then #42 → verified. #43 binds to this engine.

## 43. Multi-approver transitions & approvals inbox
- **Does:** A transition can require named approvers (users/groups) with any-of / all-of / min-N modes; mention-comment notify; "My approvals" inbox; approve/deny with reason; approvals pinned to page version, flagged stale on change.
- **Lives (new):** clones editreq lifecycle (`editreq/actions.js`,`logic.js`) re-keyed `workflow-approval-{pageId}-{stateId}-{approvalId}-{approverAccountId}` (NOT under edit-request-* — seal sweeps would delete them); notices via new `ALERT_CATEGORIES` in `notice-composer.js`/`notice-blueprints.js`; `UserPicker` from @forge/react.
- **Baseline:** all axes 1 (not built). **Impact 5 · Effort 4 · Risk 3** (+2 → Priority 22.0).
- **Guardrails:** no new scope/module in v1; group fan-out via `read:confluence-groups` (held). **Confidence MED** — proven shape, wide quorum/tie-edge surface (tie→reject).

## 44. Enforced Approved state (revert-on-tamper)  *(the differentiator)*
- **Does:** A state marked `enforce` records the exact version; later edits by non-approvers auto-revert to it (or "demote" to Draft with banner+comment). The moat: "enforced, not tracked." Claim discipline — sell "reverted within minutes + attested by structural compare," never "the badge can't lie."
- **Lives:** reuses validation revert machinery (`triggers.js:529-570`), SV-M1 version guard, SV-M2 write-then-announce, SV-M3 ignore-own-writes; NEW `workflowSweep` scheduled fn + `workflow-integrity-notified-{pageId}` dedup (backstop for dropped `updated:page` events). **Who-wins rule (specified in CAPABILITY_EXPANSION §F3):** workflow probe runs FIRST in `pageContentTrigger`; approver set privileged over sealed-section owners; SV-M5 re-baseline suppressed while enforced. Never touches `section-snapshot-*`/`protection-*` seal data.
- **Baseline:** all axes 1 (not built). **Impact 5 · Effort 4 · Risk 4** (+2 → Priority 21.0).
- **Guardrails:** no new scope; one `scheduledTrigger` module (minor; verify per-app limit — app runs 3). **Confidence LOW (flagged)** — probe-first short-circuit + SV-M5 suppression is deliberate pipeline surgery in the repo's most delicate file; needs dedicated harness scenarios (tamper-while-approved, approver edit, seal-owner-edits-own-section no-ping-pong, concurrent seal+workflow revert, integrity-sweep catches missed event) before ship.

## 45. Review dates & expiry transitions
- **Does:** Entering a state can start a review clock (`reviewAfterDays`); on expiry the page auto-transitions (e.g. Approved→Expired), chip changes, watchers get escalating reminders. "Review-date loop with teeth" (Midori only notifies).
- **Lives:** exact `expirySweepTask()` shape (`triggers.js:846`), ships as a 2nd pass inside F3's `workflowSweep`, queries `by-due-date` index; `invoke(workflowSweep)` test hook; `workflow-review-notified-{pageId}` dedup.
- **Baseline:** all axes 1 (not built). **Impact 4 · Effort 2 · Risk 2** (+2 → Priority 22.0).
- **Guardrails:** no new scope/module (sweep ships with F3); no Preview API. **Confidence HIGH** — near-transcription of proven idempotent sweep.

## 46. Transition conditions (rules + AI gate)  *(DEFERRED — ships last, on a demand signal)*
- **Does:** A transition can require conditions: instant structural rules (`evaluateRules()`) and optionally an async Semantic AI review that blocks until it lands, + AI "what changed since last approved" diff-summary. Egress-free.
- **Lives:** reuses `rules-engine.js` (pure) + `ai-validation-queue`/`ai-worker.js`/`storeFindings()`; NEW `workflow-transition-pending-{pageId}` with mandatory timeout+fallback.
- **Baseline:** all axes 1 (not built). **Impact 4 · Effort 3 · Risk 4** (+2 → Priority 19.0).
- **Guardrails:** @forge/llm (Preview, already accepted; developer-billed since 2026-06 → opt-in per space + daily cap — OPEN QUESTION for owner); **demand-evidence gate before build** (no user review asks for AI gating). **Confidence LOW (flagged)** — async block-until-job-lands has no in-repo precedent.

## 47. Native content-state mirroring  *(BUILD-GATED on a live API spike)*
- **Does:** When SV changes a page's workflow state, the native Confluence status chip updates to match (visible in editor/header/search). Default off per space. Resolves the two-chips-disagree case.
- **Lives:** transition side-effect hook in F1 engine; mirror PUT NEVER inside `pageContentTrigger` (async @forge/events job for trigger-driven transitions — single-writer discipline); v1-only `PUT /wiki/rest/api/content/{id}/state` behind an adapter.
- **Baseline:** all axes 1 (not built). **Impact 3 · Effort 3 · Risk 4** (+2 → Priority 16.0).
- **Guardrails:** no new scope/module/Preview; **mandatory pre-build spike** (suggested-status gating / per-user custom states / does an app PUT fire tenant Automation rules + burn the 100-exec/mo quota). **Confidence LOW** — feasibility asserted, not verified; version-churn interacts with `approvedVersion`. Two OPEN QUESTIONS for owner (version churn, Automation cascade).

## 48. Workflow dashboard & CSV export
- **Does:** A realm-console space tab: pages by state, entered-at/by, review-due/overdue highlighting, pending-approvals count, CSV export (also the audit-retention export path for the indefinite `workflow-log-*` history). The per-space oversight view Comala Cloud is weakest at.
- **Lives:** `confluence:spacePage` (`realm-console`, held); queries F1 `by-state`/`by-due-date` indexes directly (no migration); CQL on `sentinel-vault-workflow`; `listMyEditRequests` cursor pattern.
- **Baseline:** all axes 1 (not built). **Impact 4 · Effort 3 · Risk 2** (+2 → Priority 21.0).
- **Guardrails:** no new scope; storage-entities manifest addition (minor); no Preview API. **Confidence HIGH** — read-only surface, unbounded-scan hazard removed by F1 indexes.

---

## Ledger conventions
- Baseline scores are grounded in `frontend-surfaces.md` (2026-07-05 read of all 7 surfaces + screenshots); backend-only rows are scored via the surface that exposes them, with axes that don't apply held at neutral 3. 2026-07-05 adversarial pass corrected phantom-feature claims (rows 1, 6, 9, 14, 15, 19, 21, 26, 33, 37): resolvers with zero UI callers are now annotated as such, and Fn was re-scored where an advertised capability does not exist in the product.
- Priority = 3·impact + 3·(5 − mean(Fn,Distinct,Motion,Perf,A11y)) − effort − risk (one decimal). Risk in this ledger tracks correctness/confidence risk — the rows where confidence is explicitly LOW (23, 27, 31) touch the revert/restore contracts (C1–C10 in the backend map) and must be harness-verified regardless of where they sit in the ordering.
- Cross-cutting debts referenced by many rows: token duplication (row 39), N+1 resolver fan-out (rows 2, 6, 12, 19, 33), mouse-only custom dropdowns (rows 5, 7, 9, 10, 11, 19, 29, 33, 40), triple 5s polling (row 36).
- **Domain pack (doc-workflow):** rows 42–48 are new capability (not-yet-built, all quality axes = 1) and carry the `domain_pack_boost` (+2) baked into Priority per the tuned config. Their Priority uses the same formula (`3·impact + 3·(5−1) − effort − risk`, mean = 1) plus the +2 boost. Because these are new features, "improving" them = building them; the loop treats them as normal iterations. Ship order 42 → 43 → 44 → 45 → 48 → 47 → 46 overrides raw-priority ordering within the pack (dependencies + category table-stakes). Rows 44, 46, 47 are explicitly LOW-confidence (pipeline surgery / no in-repo precedent / unverified feasibility) and get `adversarial_rounds.core_touching_or_perf` scrutiny.
