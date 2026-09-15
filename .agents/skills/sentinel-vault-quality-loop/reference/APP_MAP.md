# Sentinel Vault — App Map

Confluence Forge content-protection app. App `ari:cloud:ecosystem::app/c30bf71e-4287-4872-954d-db49cc68f0ff`, runtime `nodejs22.x`, Custom UI everywhere, documented version v4.0.0 (Runs on Atlassian — zero egress, Forge LLM). Repo path contains a space: always quote `"/Users/mihaiperdum/Projects/Sentinel Vault"` in shell.

---

## 1. Modules → functions → surfaces (manifest ground truth)

### UI modules

| Module | Key | Resource(s) | Resolver | Surface (what the user sees) |
|---|---|---|---|---|
| `macro` (block) | `sentinel-vault-panel` | view `inline-panel-ui` (`static/inline-panel`), config `panel-setup-ui` (`static/panel-setup`) | `action-router` | Inline attachment panel: seal/unseal, upload, labels, delete/restore/purge, Sealed Sections group, Validation group, AI Review group, Edit Requests inbox, onboarding explainer |
| `macro` (**bodied**) | `sentinel-vault-sealed-section` | `section-setup-ui` (`static/section-setup`) — view AND config, openOnInsert: true | `action-router` | Sealed page section wrapping user content; carries stable app-issued `sectionId` in guestParams used for tamper detection + restore |
| `confluence:pageBanner` | `sentinel-vault-ribbon` | `doc-ribbon` (`static/doc-ribbon`) | `action-router` | Page ribbon: seal counts, violation/expiry alerts, validation + AI status chips, "Manage Attachments" (opens overlay modal) |
| `confluence:globalSettings` | `steward-console` | `steward-console` (`static/steward-console`) | `action-router` | Global admin: General / Alerts / Validations (incl. Semantic AI config) tabs |
| `confluence:spacePage` | `realm-console` | `realm-console` (`static/realm-console`), route `realm-console` | `action-router` | Space admin: My Sealed Files (all users, incl. Edit Requests inbox), Realm Sealed Files, Access Control, Reservation Duration, Macro, Validations. Steward-only tabs enforced app-side, not by manifest condition |
| `llm` | `sentinel-vault-llm` | model `claude` | — | Forge LLM for Semantic AI Validations (adding it forced a major-version bump + admin re-consent) |

The `overlay` resource (`static/overlay`) is NOT referenced by any manifest module — it is opened at runtime via `new Modal({ resource: "overlay" })` from ribbon/panel. Not orphaned; just invisible in the manifest.

### Event / scheduled / queue functions (manifest key → boot export → real module)

| Kind | Key | Function → implementation | Events / cadence |
|---|---|---|---|
| trigger | `attachment-events` | `artifact-trigger` → `boot.artifactEventTrigger` → `src/server/triggers.js` | `avi:confluence:updated/trashed/deleted:attachment` |
| trigger | `page-content-events` | `page-content-trigger` → `boot.pageContentTrigger` → `src/server/triggers.js` | `avi:confluence:updated/created:page` |
| trigger | `app-lifecycle-events` | `lifecycle-trigger` → `boot.lifecycleTrigger` → `src/server/triggers.js` | `avi:forge:installed/uninstalled:app` (uninstall wipes all KVS) |
| scheduled | `expiry-sweep-scheduled` | `expiry-sweep-task` → `boot.expirySweepTask` → `triggers.js` | hourly — notify-only expiry/halfway sweep |
| scheduled | `recurring-nudge-scheduled` | `recurring-nudge-task` → `boot.recurringNudgeTask` → `triggers.js` | daily — banner-only periodic reminders (auto-unlock OFF mode) |
| scheduled | `seal-index-cron` | `seal-index-cron-fn` → `boot.sealIndexCron` → `capsules/realms/scan-worker.js` | hourly — queues realm index scans, skips if stamp unchanged |
| queue consumer | `realm-audit-queue` | `realm-scan-consumer-fn` → `boot.realmScanConsumer` → `capsules/realms/scan-worker.js` | 900 s — rebuild `space-protection-*` index per space |
| queue consumer | `ai-validation-queue` | `ai-validation-fn` → `boot.aiValidationConsumer` → `capsules/validations/ai-worker.js` | 120 s — Semantic AI LLM run (exceeds 25 s resolver limit) |
| webtrigger | `harness-test-state` | `testStateFn` → `boot.testStateTrigger` → `src/test-hook.js` | DEV-ONLY, gated by `HARNESS_SECRET` (404 in prod) |
| (orphan) | — | `halfway-check-task` → `boot.halfwayCheckTask` → `triggers.js:1151` | declared function, wired to NO trigger; kept-for-manifest no-op (merged into expiry sweep) |

**No manifest `filter`/`ignoreSelf` on any trigger** — self-event suppression is entirely in code (see CORE_CONTRACT T1/T2). **No `permissions.external` block** — zero egress. 31 scopes incl. content/attachment read-write, props, restrictions read, comments write, `storage:app`.

### Frontend surfaces (files under `src/ui/`)

| Surface | Entry / CSS (approx size) | Notes |
|---|---|---|
| doc-ribbon | `surfaces/doc-ribbon/index.jsx` (239) / `tokens/doc-ribbon.css` | Polls `check-seal-stamp` every 5 s; opens overlay Modal size max |
| inline-panel | `surfaces/inline-panel/index.jsx` (1584) / `tokens/inline-panel.css` | Flagship surface; two-phase load (KVS fast-path then API enrich); known N+1 resolver fan-out per card |
| overlay | `surfaces/overlay/index.jsx` (1396) / `tokens/overlay.css` | Full management modal; column picker in localStorage; macro visibility toggle |
| panel-setup | `surfaces/panel-setup/index.jsx` (273) / `tokens/panel-setup.css` | Macro config; own `--mc-*` token namespace |
| realm-console | `surfaces/realm-console/index.jsx` (2264) / `tokens/realm-console.css` | Biggest surface; role-gated tabs; known latent bug: `setError` ReferenceError at index.jsx:1136 (operator-search failure path) |
| section-setup | `surfaces/section-setup/index.jsx` (97) / `tokens/section-setup.css` | Bodied-macro view+config; own `--sec-*` namespace |
| steward-console | `surfaces/steward-console/index.jsx` (543) / `tokens/steward-console.css` | Global settings; shares `ValidationsEditor` with realm-console |

Shared kit: `kit/ValidationsEditor.jsx` (global+space rules & AI config), `kit/ThumbnailPreview.jsx` (data-URI previews), `kit/flash-messages.js` (toasts, toggle-gated), `kit/palette-sync.js` (dark mode via `view.theme.enable()`). Design-system caveat: every surface CSS re-declares the full token block (3 namespaces `--sv-*`/`--mc-*`/`--sec-*` across ~9 files) — a palette change is a ~9-file edit.

---

## 2. Backend capsule map

One shared `@forge/resolver` (`action-router`, `src/server/registry.js`) serves ALL UI surfaces; it aggregates action arrays from 10 capsules + built-in `heartbeat`.

| Capsule (`src/server/capsules/…`) | Resolver actions (key ones) | Non-resolver entry points |
|---|---|---|
| **sealing** | `seal-artifact` (re-seals over expired records, SV-M8; duration payload → space → global → 48h baseline), `unseal-artifact`, `enumerate-doc-artifacts`, `enumerate-operator-seals` (full scan ≤10×100, prunes stale), `enumerate-page-seals` (KVS fast-path), `check-seal-stamp` (frontend polling), `restore-sealed-artifact` (gated `allowSealRestore`), `purge-seal-record` (gated `allowSealPurge`) | `logic.js`: `computeSealStatus`/`breakSeal` (lazy expiry), `touchSealTimestamp`, content-prop write/remove; `confluence-sync.js`: realm index write, `purgeAllSealState` |
| **policies** | `load-policy` / `store-policy` (global+space unified; pause/resume timer-extension lives here), `load/store-global-ruleset`, `load/store-realm-ruleset`, `enumerate-realm-rulesets`, `discard-realm-ruleset` | `logic.js` duration/auto-unseal helpers (naming: "realm" = space) |
| **realms** | `identify-realm`, `enumerate-realm-seals` (cursor-paged index read), `launch-realm-audit` / `check-audit-status`, `steward-unseal`, `check-user-role`, steward-request workflow (`request/check/list/approve/deny-steward-request`, 48h deny cooldown) | `scan-worker.js`: `realmScanConsumer` (queue), `sealIndexCron` (scheduled) |
| **operators** | `identify-operator`, `search-operators`, `current-operator`, `enumerate-operators`, `enumerate-teams` — all asUser read-only | — |
| **bulletins** | `load-bulletin-toggles`, `recent-dispatches`, `operator-dispatches`, `acknowledge-dispatch`, `watch-artifact` / `check-watch` / `unwatch-artifact`, `flush-operator-dispatches`, `list-breach-dispatches` (drain-on-read) | `logic.js`: `recordDispatch`, `notifyWatchers` |
| **entitlements** | `load-session`, `check-license` (stub true), `steward-override-enabled` | — |
| **panels** | `enumerate-panel-artifacts` (enriched table), `label-artifact`/`unlabel-artifact`, `delete-artifact` (gated `allowArtifactDelete`; refuses others' seals; writes `trashedOnly` tracking record), `inject-panel`/`extract-panel`/`check-panel-status`, `store-doc-panel-prefs`, `upload-artifact` (base64 ≤4MB), `register-panel-key`/`discover-panel-key`, `resolve-artifact-preview` (data-URI ≤5MB) | — |
| **editreq** | Attachment: `request-edit-access`, `check-edit-request`, `list-edit-requests`, `list-my-edit-requests`, `approve-edit-request` (TTL'd grant), `deny-edit-request`, `revoke-edit-grant`, `list-edit-grants`. Section: `request/check/list/approve/deny-section-edit` (no section revoke/list-grants) | `logic.js`: `getActiveEditGrant` / `getActiveSectionEditGrant` (O(1)), `sweepEditAccess` / `sweepSectionEditAccess` |
| **section-seals** | `list-page-headings`, `enumerate-section-seals`, `seal-section` (server-side heading-range wrap, 409 retry ×3, staleness checks), `unseal-section` (unwrap in place + teardown), `refresh-section-snapshot` (owner-only re-baseline) | `logic.js`: `computeSectionRange`, `refreshSectionContentProp` |
| **validations** | `load/store-validation-config` (Haiku clamp on save), `validate-page-now` (no mutation, fail-closed), `get-validation-state`, `approve-page-gate`, `list-ai-models` (Haiku-only), `enqueue-page-validation` (budget guard → taskId), `get-validation-job`, `get-ai-findings`, `set-ai-finding-state`, `get-validation-audit` | `ai-worker.js`: `aiValidationConsumer` (queue); `logic.js`: `resolveEffectiveConfig`, `normalizeFindings`, findings/usage storage |

### Infra + shared (`src/server/infra/`, `src/server/shared/`)

| Module | Role |
|---|---|
| `triggers.js` (src/server/) | THE engine: `artifactEventTrigger` (seal revert/trash-restore/delete cleanup), `pageContentTrigger` (one-read → sections pass → media pass → one-write pipeline w/ 409 backoff; then `runValidationPhase`), `lifecycleTrigger`, `expirySweepTask` (notify-only), `recurringNudgeTask`, `halfwayCheckTask` (no-op) |
| `infra/doc-surgery.js` | ADF read/write (`writeDocBody` double-stringifies the ADF value — critical), `canonicalizeAdf` (deep key sort, strips `VOLATILE_ADF_KEYS`=`localId`), `hashAdf` (FNV-1a 8-hex), section node helpers (top-level only), media extract/splice, panel insert/remove/replace + `triggerPanelEmbed` (auto-insert), `extractPlainText` (code points, SV-NEW-1/SV-M4), `collectHeadings` (keeps expand, SV-m5/SV-NEW-2), `countNodes` |
| `infra/rules-engine.js` | Pure `evaluateRules` — required-heading/table/macro (anchored)/label, heading-hierarchy, max/min-length; block vs warn severity |
| `infra/forge-llm.js` | Forge LLM wrapper — Haiku-only policy (`isForgeLlmModelAllowed`, default `claude-haiku-4-5-20251001`), retry ×3, JSON mode |
| `infra/json-salvage.js` | `parseAIJson` tolerant LLM-output parser (fences, prose, truncation) |
| `infra/notice-composer.js` / `infra/notice-blueprints.js` / `infra/outbound-notify.js` | `dispatchNotice` → 11 comment layouts (XML-escaped, `<ri:user>` mentions) → v2 footer-comment POST, retry ×3 on 429/5xx; toggle-gated |
| `infra/validation-blueprints.js` | Advisory/reverted validation comments |
| `infra/artifact-fetch.js` | `fetchArtifactMetadata`, `downloadArtifactBinary`, `resolveArtifactPreview` (live); contains a LEGACY parallel event handler (`artifactEventHandler`/`rollbackArtifact`) NOT wired in the manifest — live path is `triggers.js` |
| `shared/steward-checks.js` | `isOperatorSteward` (site/org admin OR space ADMINISTER OR configured users/groups), `authorizeSteward` (adds `allowAdminOverride` gate) |
| `shared/bulletin-flags.js` | `resolveBulletinToggles` from `admin-settings-global` (legacy field names preserved) |

---

## 3. Data model summary (KVS + content properties)

Full field lists live in the map-phase backend reader; this is the stable-key registry.

### KVS key families

| Family | Keys | Notes |
|---|---|---|
| Attachment seals | `protection-{attachmentId}` (primary; variant `trashedOnly:true` for panel-trashed unsealed files), `space-protection-{spaceId}-{attachmentId}` (realm index), `protections-last-modified` (change stamp), `protections-last-scanned` (cron stamp) | Stamp touched on EVERY seal mutation; index rebuilt by realm scan worker |
| Section seals | `section-protection-{sectionId}` (primary, incl. `contentHash`), `section-snapshot-{sectionId}` (restore source: wrapper + body ADF), `space-section-protection-{spaceId}-{sectionId}` (realm index) | Prefix layering deliberate (`triggers.js:339`) — never overlap prefixes |
| Edit requests/grants | `edit-request-{attId}-{requester}`, `edit-grant-{attId}-{editor}` (KVS TTL = seal expiry), `section-edit-request-{sectionId}-{acct}`, `section-edit-grant-{sectionId}-{acct}` (TTL'd) | Denied requests carry 48h cooldown; all swept on seal teardown |
| Validations | `validation-config-global`, `validation-config-space-{sanitizedKey}`, `validation-lastgood-{pageId}`, `validation-checked-{pageId}-{version}` (TTL 30d, claimed up-front), `ai-validation-status-{taskId}` (TTL 1h), `ai-finding-{pageId}-{ts}` (TTL 90d), `ai-latest-{pageId}`, `ai-finding-state-{pageId}`, `ai-usage-{realmKey|global}-{YYYYMM}` (TTL 120d) | |
| Notifications/watch | `recent-notifications` (TTL 1h, ≤10 events), `notification-{ts}…` (TTL 5min), `notify-request-{attId}-{acct}` (TTL 7d), `violation-alert-{owner}-{attId}-{ts}` (TTL 1h, drain-on-read), dedup flags `expiry-notified-{id}`, `fifty-percent-reminder-sent-{id}`, `reminder-sent-{id}` | |
| Policies/misc | `admin-settings-global`, `admin-settings-space-{sanitizedKey}` (sanitizer `[^a-zA-Z0-9:._\s-#] → _` EVERYWHERE), `app-account-id` (loop guard), `macro-extension-key` / `section-macro-extension-key`, `space-scan-status-{spaceId}`, `steward-request-{spaceKey}-{acct}` | Legacy field names in settings intentionally preserved |

Uninstall wipes all keys (`lifecycleTrigger`).

### Content properties (non-KVS, page-level)

| Key | Content | Role |
|---|---|---|
| `protection-` | Full seal payload (one per page, last seal wins) | CQL + trigger fast-probe for media pass |
| `section-protection-` | Compact array `[{sectionId, lockedBy, expiresAt}]` rebuilt from KVS | Trigger fast-probe for sections pass |
| `sentinel-vault-validation` | Gate state `{state: passed/failed, violations, version, checkedAt, approvedBy?}` | Panel/ribbon status, gate approval |
| `sentinel-vault-page-settings` | `{macroDisabled}` | Panel visibility preference |

---

## 4. Harness layers + commands

### Layer 1 — unit tests (pure Node, offline, seconds)

```bash
cd "/Users/mihaiperdum/Projects/Sentinel Vault" && npm test
```

Chains 4 fail-fast suites (`test/_assert.mjs` zero-dep asserts, exit 1 on any failure): `json-salvage` (parseAIJson salvage cases), `rules-engine` (all rule types + block/warn semantics), `doc-surgery` (canonicalize/hash false-revert guard, section node helpers, splice), `validations-logic` (normalizeFindings clamps, prompt build, computeSectionRange).

### Layer 2 — black-box E2E (`test-harness/`, real Confluence REST + forge logs)

Env in `test-harness/.env` (gitignored): `SV_EMAIL`, `SV_TOKEN`, `SV_BASE` (required); `SV_PAGE_ID` (required only by seal-e2e — page with an existing UI-created seal); `SV_SPACE_KEY` (optional). Prereq: app deployed+installed to development, Forge CLI authenticated.

| Command (from `test-harness/`) | What it proves |
|---|---|
| `npm run health` | Creds + connectivity (`GET /rest/api/user/current`) |
| `node scripts/live-trigger-e2e.mjs` | Creates/edits/deletes a throwaway page → fires deployed `pageContentTrigger` → probes the 3 content-property fast paths → self-cleans (~10 checks) |
| `npm run seal-e2e` | Smoke-checks a pre-existing seal on `SV_PAGE_ID` + log scan (log-unavailable only WARNS here) |
| `npm run forge-logs` | `forge logs` grep for signals: crash / http5xx / http4xx-egress / `[FORGE-LLM] error` / JSON-parse; exit 1 on unreadable logs OR any signal |

### Composite grade_cmd (deterministic, non-interactive, no seeded state)

```bash
cd "/Users/mihaiperdum/Projects/Sentinel Vault" && npm test && cd test-harness && npm run health && node scripts/live-trigger-e2e.mjs && npm run forge-logs
```

Caveats: needs network + deployed dev install + authenticated Forge CLI; `forge logs` scans recent history so triage signals against the run's timestamp window; offline-safe subset is `npm test` alone. `seal-e2e` deliberately excluded (stateful manual precondition). Screenshot harness excluded (no assertions).

### Layer 3 — dev-gated test hooks (see §5)

### Layer 4 — screenshot/clip harness (`static/_screenshot-harness/`, visual only, NO pass/fail)

```bash
npx webpack --config webpack.screenshot.js --mode production   # build shot bundles
node static/_screenshot-harness/capture.mjs                    # 8 PNGs → shots-png/ (THEME=dark for dark)
node static/_screenshot-harness/driver.mjs [nameFilter]        # 5 .webm clips → clips/
```

Real Custom UI rendered outside Forge with `@forge/bridge` fully mocked (~60 canned resolver actions); scenario via `window.__SHOT__` (`panel`, `steward`, `realm`, `realm-steward`, `section`), theme via `window.__THEME__`. Eyeball artifact only — exit code always 0 barring a script crash.

### Coverage gaps (manual matrix only)

1. Forge LLM end-to-end (Run AI review producing findings; badge check). 2. Edit-request lifecycle (request → approve → kept edit → re-baseline → revoke → revert → unseal sweep). 3. Section-seal enforcement incl. THE key risk: live-editor no-op round-trip must not false-revert. 4. Validation modes (advisory comment / gate + approve / revert w/ v1 fallback). 5. Cross-cutting save storm (one restore write, loop guard absorbs own re-save). 6. Attachment seal→revert itself (seal creation is UI-only). 7. Scheduled tiers other than expirySweep + both queue consumers. Partial mitigation: Layer-3 `set`/`delete`/`kvs` can seed and assert KVS state for 2–4 (the forge-live-harness pattern, outside this repo's `test-harness/`).

---

## 5. Dev-gated test hooks

Webtrigger `harness-test-state` → `src/test-hook.js:testStateTrigger`. Gate: 404 unless `process.env.HARNESS_SECRET` is set (development env ONLY — absent in prod) AND matches the `Authorization: Bearer <secret>` header. API via `?what=`:

| `what` | Params | Behavior |
|---|---|---|
| `kvs` (default) | `key` | Read any KVS key → `{key, value|null}` — seal records, section records (incl. stored hash), validation findings/gate, grants |
| `set` | `key`, `value` (URL-encoded JSON) | Dev-only KVS write for suite setup/teardown |
| `delete` | `key` | Dev-only KVS delete |
| `invoke` | `fn=expirySweep` | Directly runs `expirySweepTask()` so the hourly scheduled tier is assertable on demand → `{invoked, result}`. ONLY `expirySweep` is exposed; anything else → 400 |

Errors: 400 missing params / unknown `what`/`fn`; 500 `{error}` on exception. No on-demand hook exists for `recurring-nudge-task`, `seal-index-cron`, `halfway-check-task` (no-op anyway), or the two queue consumers.

---

## 6. Known quirks (do not "fix" blindly)

- `halfway-check-task`: declared function, deliberately unwired no-op (merged into expiry sweep) — kept for manifest stability.
- `infra/artifact-fetch.js` contains a legacy unwired event handler; the live attachment path is `triggers.js`. Its fetch/preview helpers ARE live.
- `overlay` static resource is manifest-orphaned by design (opened via Modal at runtime).
- Docs drift: README/user-guide still carry legacy Resend-email wording — `notifications.md`/`settings-reference.md` are the truth (native comment-with-mention, no egress); architecture's "7 capsules / 57 actions" list predates v4.0.0 (10 capsules now); README's "re-insert at original position" for media protection is optimistic — content-protection-surgery.md documents append-fallback behavior; default seal duration UI 24h vs code baseline 48h is intentional.
- Frontend known issues (pre-existing, tracked): realm-console `setError` ReferenceError (index.jsx:1136), N+1 resolver fan-out on card lists, triple 5 s stamp polling per open page, token-block duplication across ~9 CSS files.
