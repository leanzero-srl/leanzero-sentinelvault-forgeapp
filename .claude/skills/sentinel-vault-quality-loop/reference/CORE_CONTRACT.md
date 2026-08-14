# Sentinel Vault — Core Contract

This is the guardrail for every future diff. These invariants are the load-bearing walls of the app: **change around them, never through them.** If a proposed change requires weakening one of these, that is a design conversation (and possibly a major-version event), not a refactor. Each invariant below is one sentence of WHAT, a WHY, and the implementing file(s).

Source of truth verified against `manifest.yml`, `src/boot.js`, `src/server/triggers.js`, `src/server/registry.js`, `src/server/infra/*`, and all 10 capsules under `src/server/capsules/`.

---

## 1. Trigger hygiene — loop safety

**T1. The app never reacts to its own writes: both product-event triggers compare the event actor to the cached `app-account-id` and return immediately on match.**
WHY: every restore (attachment re-upload, page-body write, section restore) re-fires the same Confluence event; without this guard the app reverts its own reverts forever. The manifest declares NO `filter`/`ignoreSelf` — suppression lives entirely in code, so removing this check has no safety net.
Files: `src/server/triggers.js` (`artifactEventTrigger`, `pageContentTrigger`, `resolveAppAccountId`), `src/server/infra/artifact-fetch.js` (`shouldIgnoreEvent`), KVS key `app-account-id`.

**T2. If the app's own account id cannot be resolved, `pageContentTrigger` fails CLOSED — it skips all body-mutating work rather than risking a revert loop.**
WHY: a mutating pass without a working loop guard is worse than doing nothing (SV-M3).
Files: `src/server/triggers.js:118`.
KNOWN GAP: `artifactEventTrigger` fails OPEN on the same condition — `if (systemAccountId && ...)` (triggers.js:~69) proceeds when `resolveAppAccountId()` returns nothing, so the app's own asApp re-upload can re-fire `updated:attachment` and self-revert. Fail-closed is only pinned for pages today; closing the attachment side to match is a semantics-preserving fix, not a contract change.

**T3. All restorative writes are `asApp()` with a distinctive version/comment message (currently "(Sentinel Vault restored protected content)", "(Sentinel Vault automatically reversed modifications)"), and the resulting re-fire is absorbed by T1.**
WHY: asApp attribution is what makes T1 work, and users/the harness identify app writes by these messages. The invariant is the MECHANISM (asApp + a distinctive message + T1 absorption), not the literal strings — copy may be reworded, but only together with the harness assertions that grep for it, in the same diff.
Files: `src/server/triggers.js`, `src/server/infra/doc-surgery.js` (`writeDocBody`).

**T4. Fast paths are contractual FOR THE SEAL PASSES: `pageContentTrigger` reads NO page body for the section/media restore passes unless a content-property probe (`protection-` / `section-protection-`) says there is work; `artifactEventTrigger` bails on one KVS get for unsealed attachments; `getActiveEditGrant` is O(1); `sealIndexCron` skips when `protections-last-modified <= protections-last-scanned`.**
WHY: these triggers fire on EVERY page save / attachment event on the instance — unrelated pages must cost ~2 property GETs, not an ADF read or KVS scan.
Files: `src/server/triggers.js:103–225`, `src/server/capsules/editreq/logic.js`, `src/server/capsules/realms/scan-worker.js` (`sealIndexCron`).
SCOPE NOTE: `runValidationPhase` is NOT covered by this fast path — once `validation-config-global.enabled` is true it calls `readDocBody` on every saved page, with the (pageId, version) dedup checked only AFTER the body read. Adding a probe or moving dedup before the read is a semantics-preserving optimization, not a contract change; conversely, config-gated body-reading features are not forbidden by this invariant.

**T5. Every multi-writer page mutation is read→modify→PUT(version+1) inside a 409 exponential-backoff loop (max 3, 2^n×500ms); on persistent conflict it stops WITHOUT claiming success — no false "restored" claims (SV-M2).**
WHY: concurrent human saves are normal; losing the conflict beats clobbering a human edit or lying in a notification. The invariant is "never claim a restore that didn't land" — truthfully SURFACING the failure (e.g. a "could not restore after repeated conflicts" notice) is allowed; only false success messaging is forbidden.
Files: `src/server/triggers.js` (shared pipeline loop), `src/server/infra/doc-surgery.js` (panel insert/remove retries), `src/server/capsules/section-seals/actions.js` (`seal-section` retry).

**T6. Idempotency/dedup markers are claimed and honored: validation runs at most once per (pageId, version) with the dedup key claimed BEFORE side effects (SV-m1); expiry notice and halfway reminder fire at most once per seal; pipeline notifications dedup by `type:targetId` across retries and are dispatched ONLY after a confirmed OK write (SV-M2).**
WHY: triggers and retries can re-enter; double comments/reverts destroy user trust, and notifying about a write that never landed is a lie.
COROLLARY: because the validation dedup key is claimed BEFORE evaluation, validation is at-most-once and fail-OPEN — if evaluation throws after the claim, that (pageId, version) is never enforced. Any code inserted between claim and evaluate inherits this silently; keep that window minimal.
Files: `src/server/triggers.js` (`runValidationPhase`, pipeline, `expirySweepTask`), keys `validation-checked-*`, `expiry-notified-*`, `fifty-percent-reminder-sent-*`.

---

## 2. Seal / restore guarantees (attachments)

**S1. Revert target is `sealedVersion` captured at seal time (fallback `currentVersion-1` for legacy seals); if current already equals target, no write.**
WHY: "restore to the sealed baseline" is the product promise; the fallback keeps pre-`sealedVersion` seals working; the equality check prevents pointless version churn.
Files: `src/server/triggers.js:597–648` (`handleSealedArtifactEdit`).

**S2. Revert is download-the-sealed-binary + re-upload as a NEW version — attachment history is never destroyed, and notifications point users at version history as the recovery path.**
WHY: the editor's rejected work must remain recoverable ("your changes are preserved in the attachment version history" is documented behavior).
Files: `src/server/triggers.js` (`handleSealedArtifactEdit`), `src/server/infra/notice-blueprints.js`.

**S3. Trash of a sealed attachment is auto-restored (PUT status "current", version+1) with the seal kept — via the shared `infra/attachment-status.js` restore used by BOTH the artifact trash handler and the page media pass (Fix 1, incident 2026-07-22: the page pass must never re-splice an ADF node whose attachment sits in trash — it un-trashes first; a version-less/container-less trash event is completed by a v2 probe, never silently abandoned). On restore FAILURE the seal is KEPT (attachment still recoverable from trash — audit C4) and the owner notified honestly (`revert-failed`); on permanent delete, seal state is cleaned and the owner notified that the file cannot be restored (`permanently-deleted`). Expired seals are inert on the trash and media paths (§6 parity).**
WHY: a seal must never dangle against a file that no longer exists — dangling records poison listings and prefix scans.
Files: `src/server/triggers.js:704–766+` (`handleSealedArtifactTrash`, `handleSealedArtifactDeleted`), `src/server/capsules/editreq/logic.js` (`sweepEditAccess`).
KNOWN GAP: only permanent delete (`handleSealedArtifactDeleted`) sweeps grants/requests via `sweepEditAccess`; the trash-restore-FAILURE path cleans record + space index + content prop but leaves grants behind (triggers.js:~742–753). The full invariant ("ALL seal state including grants") is the target; adding the missing sweep is a semantics-preserving fix.

**S4. Owner edits always pass; an expired-but-unswept seal never blocks a re-seal by another user (SV-M8) and expired records are lazily deleted on touch.**
WHY: expiry deletion is lazy by design (see §6) — treating a stale record as an active lock would let dead seals deny service.
Files: `src/server/capsules/sealing/actions.js` (`sealArtifact` re-seal path), `src/server/capsules/sealing/logic.js` (`computeSealStatus`).
NOTE: `breakSeal` (sealing/logic.js:212) is DEAD CODE — zero callers anywhere in src/. Do not cite it as an implementing surface, and do not wire it up as-is: its expired path omits `removeSealContentProp`, which would violate K3.

**S5. Every seal mutation touches `protections-last-modified` and keeps the triad in sync: KVS record `protection-{id}`, realm index `space-protection-{spaceId}-{id}`, and the page content property `protection-`.**
WHY: frontend 5s polling (`check-seal-stamp`), the cron change-gate, steward listings, and the trigger fast-path all read different legs of this triad; a mutation that updates only one leg desyncs the product.
Files: `src/server/capsules/sealing/logic.js` (`touchSealTimestamp`, `writeSealContentProp`), `src/server/capsules/sealing/confluence-sync.js`, `src/server/capsules/realms/scan-worker.js`.
KNOWN GAPS: (a) the grant re-baseline in `handleSealedArtifactEdit` (triggers.js:~619) rewrites only the KVS record + stamp — the `protection-` content property and the space index keep the stale `sealedVersion`/`sealedFileId` until the next full mutation; (b) `sealArtifact` writes the realm-index leg only when a space id resolves from context (sealing/actions.js:~319) — a seal made without space context has no index leg and is invisible to steward listings until a realm audit backfills it. Closing either gap is a semantics-preserving fix.

**S6. Sealed-media page-body restoration is SURGICAL: the pipeline is one read → ordered in-memory passes (sections, then media) → ONE write; only the missing sealed blocks are re-inserted (walking back up to 5 prior versions to find them, SV-M6; descending-index splice to avoid position drift) — every other edit in the same save is preserved.**
WHY: restoring the whole prior page would destroy legitimate concurrent edits made in the same save; "your other edits are kept" is the core promise of page-body protection.
Files: `src/server/triggers.js:268+` (`restoreMediaPass`, pipeline at 103–225), `src/server/infra/doc-surgery.js` (`extractMediaSingleNodes`, `spliceMediaNodes`).

**S7. `trashedOnly` tracking records are NOT seals and must be inert everywhere except trash listing and restore.**
WHY: `delete-artifact` writes `protection-{id}` records with `lockedBy` set and `trashedOnly: true` (panels/actions.js:~270) purely so trashed files stay discoverable. Only `restoreSealedArtifact` checks the flag today.
KNOWN GAP (currently UNENFORCED — the sharpest unwritten invariant in the codebase): no trigger code checks `trashedOnly`, so an attachment restored via Confluence's NATIVE trash UI is treated by `artifactEventTrigger` as a live seal — reverting other users' edits and un-trashing deletions for a file nobody sealed; `loadSealForOwnerAction` (editreq/actions.js) also accepts these records, enabling permanent no-TTL grants (see G1). Any iteration touching triggers or editreq must not deepen this; the target invariant is that `trashedOnly` records never authorize or trigger enforcement.
Files: `src/server/capsules/panels/actions.js` (`delete-artifact`), `src/server/capsules/sealing/actions.js` (`restoreSealedArtifact`), `src/server/triggers.js` (`artifactEventTrigger` — missing check), `src/server/capsules/editreq/actions.js` (`loadSealForOwnerAction` — missing check).

---

## 3. Section-seal tamper handling

**X1. A tampered sealed section is restored from `section-snapshot-{sectionId}` (the wrapper node + body ADF captured at seal/re-baseline time) whenever the snapshot exists.**
WHY: the snapshot IS the guarantee — anything else is a guess about what the owner sealed.
Files: `src/server/triggers.js:359+` (`restoreSealedSectionsPass`), `src/server/infra/doc-surgery.js` (`replaceSectionBody`, `spliceSectionWrapper`).
KNOWN FALLBACK: for a deleted wrapper with NO snapshot, the code restores the wrapper from version N−1's content (`const finalNode = restoreNode || prevNode`, triggers.js:~421) — that is a heuristic reconstruction, not the sealed baseline, and may itself be tampered. Treat the prevNode fallback as best-effort, never as satisfying this invariant.

**X2. A deleted/cut wrapper is re-inserted positioned by heading-anchor from version N-1, not by the frozen seal-time index (SV-m6).**
WHY: pages are edited above/below the section; a frozen index re-inserts into the wrong spot on any structural edit.
Files: `src/server/triggers.js` (`restoreSealedSectionsPass`).

**X3. A content-hash match is trusted ONLY after a structural comparison of the canonicalized body against the snapshot (SV-M7) — the FNV-1a hash alone is forgeable.**
WHY: FNV-1a 32-bit is not collision-resistant; hash-equal-but-different content must still be treated as tampering.
Files: `src/server/triggers.js`, `src/server/infra/doc-surgery.js` (`hashAdf`, `canonicalizeAdf`).
KNOWN GAP: when the snapshot is MISSING (`!snapshot?.bodyContent`, triggers.js:~441) a hash match is trusted alone — slightly weaker than the stated invariant; there is nothing to compare against, but a forged-collision edit on a snapshot-less seal would pass.

**X4. A no-op editor round-trip must NEVER false-revert: hashing operates on `canonicalizeAdf` output (deep-sorted keys, `VOLATILE_ADF_KEYS` — currently `localId` — stripped at any depth); new volatile keys get ADDED to that list, the canonicalization is never bypassed.**
WHY: the live editor rewrites volatile ADF attrs on every save; without canonicalization every innocent save of a page with a sealed section triggers a revert storm. This is the documented KEY risk of the whole feature.
Files: `src/server/infra/doc-surgery.js:704–721`.

**X5. Owner edits of their own sealed section RE-BASELINE hash + snapshot in the trigger (SV-M5); expired section seals are inert (no revert).**
WHY: the seal protects the owner's content FROM OTHERS — reverting the owner, or enforcing a dead seal, inverts the product.
Files: `src/server/triggers.js` (`restoreSealedSectionsPass`, expired check ~line 389), `src/server/capsules/section-seals/actions.js` (`refresh-section-snapshot`).

**X6. The `sectionId` is a stable app-issued identity carried in the bodied macro's `guestParams` (fallback chain guestParams → parameters → localId), and only TOP-LEVEL bodiedExtension nodes are treated as sealed sections.**
WHY: every KVS record, snapshot, grant, content-property entry, and trigger lookup keys off `sectionId`; changing where it lives orphans all existing seals.
Files: `src/server/infra/doc-surgery.js` (`buildSealedSectionNode`, `getSectionId`, `locateBodiedSectionNodes`).

---

## 4. Edit-request grant lifecycle

**G1. The lifecycle is fixed: request (pending, reason ≤300, one per file per requester) → owner/steward approve → grant written WITH KVS TTL = seal `expiresAt` (self-expiring) and request deleted → trigger honors grant AND re-baselines → revoke deletes grant; deny sets a 48h cooldown lazily cleaned on next check.**
WHY: every stage has a consumer (panel button states cycle Request→Requested→Can Edit/Declined off these exact keys); the TTL guarantees no grant outlives its seal even if sweeps are missed.
Files: `src/server/capsules/editreq/actions.js`, `src/server/capsules/editreq/logic.js`.
KNOWN GAPS: (a) when `seal.expiresAt` is missing or already past, `approveEditRequest`/`approveSectionEdit` write the grant WITHOUT a TTL (editreq/actions.js:~198, ~367) — a permanent grant until swept; combined with S7's unenforced `trashedOnly` records this permits no-TTL grants on phantom seals. (b) Pause/resume (E2) extends seal `expiresAt` but NOT the KVS TTL on existing `edit-grant-*` keys — approved editors silently lose access mid-seal after any pause cycle; "no grant outlives its seal" holds, the implied symmetry does not.

**G2. An active grant makes the editor's change AUTHORITATIVE: attachment seals re-baseline `sealedVersion`/`sealedFileId`, section seals re-baseline `contentHash` + snapshot — so later non-grantee edits revert to the APPROVED content, not the original.**
WHY: approving an edit and then reverting to pre-approval content on the next event would silently discard the sanctioned change.
Files: `src/server/triggers.js` (`handleSealedArtifactEdit`, `restoreSealedSectionsPass`), `src/server/capsules/editreq/logic.js` (`getActiveEditGrant`, `getActiveSectionEditGrant`).

**G3. Every seal teardown (unseal, steward unseal, delete, purge, section unseal) sweeps ALL grants and requests for that artifact/section, so a re-seal starts clean.**
WHY: a stale grant surviving into a new seal would give an old requester silent edit rights on a seal they were never approved for.
Files: `src/server/capsules/editreq/logic.js` (`sweepEditAccess`, `sweepSectionEditAccess`) and its callers in sealing/realms/section-seals actions.
KNOWN GAPS: two teardown paths skip the sweep today — the SV-M8 re-seal-over-expired path (`sealArtifact` deletes the stale record inline, sealing/actions.js:~190) and the trash-restore-failure path (see S3). Old pending REQUESTS (which carry no TTL) survive into the new seal on the re-seal path. Adding the missing sweeps is a semantics-preserving fix.

---

## 5. Validations engine behavior

**V1. `evaluateRules` is a PURE function (no I/O) and `passed === false` only when a `severity:"block"` rule is violated — warn-level violations are recorded but never block.**
WHY: purity is what makes the engine unit-testable and reusable by both the auto and manual paths; the block/warn split is the documented enforcement semantics.
Files: `src/server/infra/rules-engine.js`, tests `test/rules-engine.test.mjs`.

**V2. Auto-validation revert MUST re-read the page and abort if the version moved between evaluate and write (SV-M1), targets the `validation-lastgood-{pageId}` version, reconciles gate state to "passed" after reverting (SV-m2), and pages with no last-good (e.g. v1) fall back to flag-only.**
WHY: reverting a version you didn't evaluate clobbers a concurrent human save — the single worst failure mode of revert mode.
Files: `src/server/triggers.js:481+` (`runValidationPhase`), `src/server/capsules/validations/logic.js`.

**V3. The manual check (`validate-page-now`) never mutates and fails CLOSED on read errors (SV-m3); config resolution is global master switch + space rules/modes/ai overriding when present; only `status==="current"` pages are enforced.**
WHY: a "check now" button that writes, or that reports "passed" on a failed read, is untrustworthy; drafts must never be policed.
Files: `src/server/capsules/validations/actions.js`, `src/server/capsules/validations/logic.js` (`resolveEffectiveConfig`).

**V4. Text metrics count Unicode CODE POINTS, not UTF-16 units (SV-NEW-1); length rules exclude embedded-media placeholders (SV-M4); heading collection excludes table/panel/bodiedExtension containers but KEEPS expand (SV-m5/SV-NEW-2); required-macro matching is anchored key match (SV-m4).**
WHY: each of these was a shipped bug found by the harness; regressing any of them re-opens a fixed defect class (emoji miscounts, phantom length, headings inside sealed sections counted, substring macro-key false positives).
Files: `src/server/infra/doc-surgery.js` (`extractPlainText`, `collectHeadings`), `src/server/infra/rules-engine.js`.

**V5. AI validation is fail-closed and cost-bounded: Haiku-only enforced at list, save, AND chat-time clamp; monthly token budget checked before enqueue; unparseable model output produces an audit record and NO findings/comment; the queue consumer never rethrows (no retry double-billing); findings are schema-clamped (≤25, 200-char fields, stable FNV ids).**
WHY: fabricated findings destroy trust, rethrows re-bill tokens, and the Haiku clamp is the pricing/roadmap policy (Sonnet/Opus reserved for a paid tier).
Files: `src/server/infra/forge-llm.js` (`isForgeLlmModelAllowed`), `src/server/capsules/validations/ai-worker.js`, `src/server/capsules/validations/logic.js` (`normalizeFindings`), `src/server/infra/json-salvage.js`.

---

## 6. Expiry semantics

**E1. The hourly sweep ONLY notifies (expiry notice, halfway reminder, each once) — it never deletes seals; actual unsealing on expiry is lazy, performed on read/interaction (`computeSealStatus` via panel/overlay/console reads, `stewardUnseal`, the SV-M8 re-seal path).**
WHY: notify-only + lazy deletion is the deliberate design; code that "fixes" the sweep to delete changes user-visible semantics ("Overdue" seals, watcher notifications on release) everywhere.
Files: `src/server/triggers.js:846+` (`expirySweepTask`), `src/server/capsules/sealing/logic.js`.
KNOWN GAPS: (a) the ATTACHMENT trigger handlers (`handleSealedArtifactEdit`, `handleSealedArtifactTrash`) never read `expiresAt` — an expired-but-unswept attachment seal keeps reverting non-owner edits and un-trashing the file until some UI read hits `computeSealStatus`; sections got the inert-when-expired check (X5), attachments have no equivalent. `breakSeal` is dead code (see S4) — neither it nor "the artifact handler" is a real lazy-unseal site. (b) The sweep's ≤100-record no-cursor scan is a SCALE LIMITATION, not a design commitment — instances with >100 `protection-` keys never get expiry notices for the tail; adding cursor pagination is a semantics-preserving fix. What is contractual is NOTIFY-ONLY.

**E2. Disabling auto-unlock pauses all timers (stamps `autoUnlockPausedAt`); re-enabling extends every seal's `expiresAt` by the pause duration and clears the stamp; with auto-unlock off, the daily nudge posts banner-only periodic reminders on the `reminderIntervalDays` cadence.**
WHY: pausing must not silently burn seal lifetime, and periodic reminders are deliberately banner-only (no comment spam).
Files: `src/server/capsules/policies/actions.js` (`storePolicy`), `src/server/triggers.js` (`recurringNudgeTask`).
KNOWN GAPS: pause is only honored by the sweep and `stewardUnseal` — the LAZY expiry paths (`computeSealStatus` on any panel/overlay/console read, and the SV-M8 re-seal path) delete "expired" seals unconditionally, so a seal whose nominal expiry passes mid-pause is permanently destroyed by any read before resume-time extension can rescue it. Also the resume extension rewrites seal `expiresAt` but not grant TTLs (see G1) and only touches the first 100 `protection-` keys (no cursor).

---

## 7. Authorization & policy backstops

**A1. Destructive/steward actions are DOUBLE-gated: the feature toggle (`allowAdminOverride`, `allowSealPurge`, `allowArtifactDelete`) AND ownership-or-steward authorization — deleting an attachment sealed by another user is refused even when deletes are enabled.**
WHY: toggles are site policy, authorization is per-actor; either alone is bypassable.
Files: `src/server/shared/steward-checks.js` (`isOperatorSteward`, `authorizeSteward`), `src/server/capsules/panels/actions.js`, `src/server/capsules/realms/actions.js`, `src/server/capsules/sealing/actions.js`.
KNOWN GAPS: (a) RESTORE is single-gated — `restoreSealedArtifact` checks only `allowSealRestore` (sealing/actions.js:~886), no ownership/steward check; any user can restore any trashed attachment when the toggle is on. (b) `allowAdminOverride`'s default POLARITY is contradictory: `authorizeSteward` treats a missing value as ON (`!== false`, steward-checks.js:~161) while `loadPolicy`'s advertised default object says `false` (policies/actions.js:~18) — on a fresh install stewards can override even though the admin UI shows the toggle off. Pinning one polarity (and matching UI + check) is required before relying on this gate.

**A2. Notifications honor the toggle hierarchy — `ENABLE_NATIVE_NOTIFICATIONS` master, then per-type flags resolved from `admin-settings-global` via `resolveBulletinToggles` (legacy KVS field names like `enableEmailDispatches` are intentionally preserved for compat).**
WHY: sub-toggles must be inert when the master is off, and renaming the legacy KVS fields breaks every existing install's saved settings.
Files: `src/server/shared/bulletin-flags.js`, `src/server/infra/outbound-notify.js`.

**A3. Seal CREATION authority is currently unstated and unenforced — treat this as an open design decision, not a license.**
WHY: `sealArtifact` and `sealSection` have no permission check of any kind — any user who can invoke the resolver can seal any attachment/section and thereby point the revert machinery at everyone else; unseal authority is defined exhaustively while seal authority is not. Additionally, when the asUser detail fetch fails during sealing (sealing/actions.js:~261) the seal proceeds anyway with `sealedVersion: null`, silently degrading S1's revert target to the legacy fallback. Any iteration adding a seal-authority model or failing sealing closed on detail-fetch errors is welcome; any iteration must NOT build features that assume sealing implies a verified right to the file.
Files: `src/server/capsules/sealing/actions.js` (`sealArtifact`), `src/server/capsules/section-seals/actions.js` (`sealSection`).

---

## 8. KVS key & content-property stability

**K1. Every key pattern is load-bearing API: `protection-{id}`, `space-protection-{spaceId}-{id}`, `section-protection-{id}`, `section-snapshot-{id}`, `space-section-protection-{spaceId}-{id}`, `edit-request-*`/`edit-grant-*` (+ section variants), `validation-*`, `ai-*`, `admin-settings-*`, `protections-last-modified`, `app-account-id`, notification/dedup keys — prefixes may never be repurposed or overlapped ambiguously (the `section-protection-` vs `space-section-protection-`/`section-snapshot-` prefix layering is deliberate, see comment at `triggers.js:339`).**
WHY: prefix QUERIES (not just gets) span capsules, uninstall cleanup enumerates them, the harness asserts on them by name, and a prefix collision silently corrupts scans.
Files: all capsules; canonical inventory in this skill's APP_MAP.md §Data model.

**K2. The space-key sanitization regex (`[^a-zA-Z0-9:._\s-#] → _`) is identical at every callsite that builds an `admin-settings-space-*` or `validation-config-space-*` key.**
WHY: two sanitizers = two keys for the same space = settings that randomly apply or don't.
Files: `src/server/capsules/policies/actions.js`, `src/server/capsules/validations/logic.js`.

**K3. Content-property keys are external API surface: `protection-`, `section-protection-` (the trigger fast-path probes — must exist iff seals exist), `sentinel-vault-validation` (gate state), `sentinel-vault-page-settings` (macroDisabled).**
WHY: T4's fast path, CQL discoverability, the doc ribbon, and the E2E harness (`live-trigger-e2e.mjs`, `seal-e2e`) all read these by exact name.
Files: `src/server/capsules/sealing/logic.js`, `src/server/capsules/section-seals/logic.js` (`refreshSectionContentProp`), `src/server/capsules/validations/logic.js`.

**K4. App uninstall wipes ALL KVS keys (lifecycle trigger enumerates and deletes) — any new key family must remain reachable by that cleanup enumeration.**
WHY: complete cleanup on uninstall is documented behavior; a key that escapes the wipe leaks tenant state across reinstalls.
Files: `src/server/triggers.js` (`lifecycleTrigger`).
KNOWN GAP: the wipe is a single `kvs.query().limit(1000).getMany()` with NO cursor loop (triggers.js:~832) — installs with more keys than one query page returns leak the tail across reinstalls. "Wipes ALL keys" is the target; adding cursor pagination is a semantics-preserving fix (ledger row 41 tracks it).

---

## 9. Runs on Atlassian — the egress constraint

**R1. The manifest has NO `permissions.external` block and must stay that way: zero egress — no fetch domains, no external images/scripts/styles/fonts; all AI goes through the Forge `llm` module (`sentinel-vault-llm`, model `claude`); all outbound notification is native Confluence footer comments with `<ac:link><ri:user>` mentions (Confluence's own engine sends the emails).**
WHY: "Runs on Atlassian" eligibility is a marketplace-level product commitment; a single external URL anywhere (including a CDN link in Custom UI) forfeits it.
Files: `manifest.yml`, `src/server/infra/forge-llm.js`, `src/server/infra/outbound-notify.js`, `src/server/infra/notice-blueprints.js`.

**R2. Any change to the `llm` module or its declared model triggers a MAJOR version bump and admin re-consent on every install — treat llm/model edits as breaking-change events, planned and announced, never slipped into a patch.**
WHY: adding the module already forced this once; Forge policy re-prompts every site admin, which is an operational event for customers.
Files: `manifest.yml` (`modules.llm`), `src/server/infra/forge-llm.js` (the Haiku clamp keeps runtime model choice inside the declared consent).

**R3. Frontend previews that would need cross-origin fetches go through the resolver as base64 data-URIs instead (`resolve-artifact-preview`, ≤5MB) — the sanctioned CSP workaround, never a direct external URL.**
WHY: the Custom-UI CSP blocks external requests; a direct image/file URL both fails to render and reintroduces an egress-shaped dependency.
Files: `src/server/capsules/panels/actions.js` (`resolve-artifact-preview`), `src/server/infra/artifact-fetch.js` (`resolveArtifactPreview`).

---

## How to use this contract

Before merging any diff, walk the sections it touches: triggers → §1/§2/§3, editreq → §4, validations → §5, policies/scheduled → §6/§7, anything writing KVS or content properties → §8, manifest or anything network-shaped → §9. A diff that needs an invariant relaxed goes back to design. The harness (`APP_MAP.md` §Harness) is how you prove an invariant still holds — `npm test` covers §3 canonicalization and §5 engine semantics offline; the live tiers cover §1/§2 against a real deploy.
