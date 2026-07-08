# Sentinel Vault — Adversarial Audit Synthesis (SYNTHESIZER)

> **REMEDIATION STATUS (2026-07-08, branch `aql/workflow-state-engine`).**
> **FIXED + verified (full grade PASS):** A1 (policies authz + merge), A2 (webtrigger split → `scripts/deploy-prod.sh`), A3 (3 phantom fail-open toggles), A4 (nested-media duplication — 10 unit assertions), A5 (real seal→revert E2E, wired into the grade), B1+B2 (attachment revert retry + loud failure), B3 (uninstall cursor), B4 (collector cursor-paginate), B5 (AI prompt-injection fence), B6 (approvePageGate/enqueuePageValidation IDOR), C1 (expiry-sweep + nudge cursor), **C2 (enumerateOperatorSeals offset-vs-cursor — page 2 no longer empty), C3 (expired attachment seal now stops enforcing), C4 (transient trash-restore retries + keeps the seal, no false "deleted"), C5 (dedup flags TTL'd to the seal lifetime).**
> **C7 (LLM output-truncation now fails the gate CLOSED — detected defensively across `finish_reason`/`stop_reason`).**
> **REMAINING:** C6 (space rules REPLACE global — a PRODUCT-INTENT decision, not a clear bug: merging would change behavior for every existing tenant, so it needs an owner call, not a guess), D1–D8 (low-impact hardening: token-budget TOCTOU, normalizeFindings drop, the edit-grant revoke/list UI gap, recent-notifications CAS, unsanitized steward-request key on `~`-spaces, an unused `write:confluence-space` scope). The proper O(1) per-page seal INDEX (the durable B4/C1 perf fix) is the next design task. Honest limitation: A1/A3/B6 authz can't be positively driven from the harness (asUser has no webtrigger context — same as #44); verified by inspection (mirror the proven gate) + no legit-flow regression.



Six lenses, 33 raw findings, deduped to 26 distinct defects. Ranked by **IMPACT × CONFIDENCE**, not effort. Where my confidence in the *diagnosis* or the *fix* is lower, it is flagged inline.

Legend: **Impact** = blast radius on the app's trust promise. **Conf** = how sure I am the defect is real and the fix is safe. Confidence is HIGH unless flagged.

---

## 1. Ranked, deduped findings

### TIER A — Trust-breaking, high confidence (fix before any "production-ready" claim)

**A1. `policies` capsule writes admin/steward settings with ZERO authorization → any reader becomes steward or site-admin of any space.**
`src/server/capsules/policies/actions.js` — `storePolicy:59`, `storeGlobalRuleset:151`, `storeRealmRuleset:175`, `discardRealmRuleset:212`. None check `req.context.accountId`. I confirmed live: all four `kvs.set` straight from payload; `admin-settings-{global,space-*}` is exactly what `steward-checks.js` reads for steward/override status. Any authenticated user who can open the inline panel or page ribbon (every reader on any page) calls `invoke("store-policy",{scope:"space",key:"<any>",data:{adminUsers:[{accountId:"<self>"}]}})` and gains force-unseal / edit-grant-approval / validation-gate authority; `scope:"global"` flips `allowAdminOverride` and seeds site-wide admins. **Contrast `realms/actions.js:443` (`approveStewardRequest`) which DOES gate the identical write with `isOperatorSteward` — proof the gate helper exists and the pattern is known; policies just skips it.** Impact HIGH, Conf HIGH. **← THE PICK (plan in §2).**

**A2. Dev harness webtrigger ships in the production manifest.** `manifest.yml:55-63` → `test-hook.js`. Two harms: (a) its mere presence blocks *Runs-on-Atlassian* eligibility (only egress-capable module in the app — every other lens confirmed egress is otherwise clean); (b) latent full-state backdoor — if `HARNESS_SECRET` is ever set in prod, `what=set/delete` do arbitrary `kvs.set/delete` on any key (forge/delete seals, escalate via `admin-settings-global`) and `what=invoke` drives real mutating engine fns. Non-constant-time compare. Impact HIGH (eligibility is a stated product goal), Conf HIGH. Reported by two lenses (security HIGH-2, prod #7).

**A3. Three security/behavior toggles are PHANTOM (UI writes key X, engine reads key Y) — and all fail OPEN.** `src/ui/surfaces/steward-console/index.jsx`:
- `:127` `allowStewardOverride` vs engine `allowAdminOverride` (`steward-checks.js:211`, `entitlements/actions.js:23`) → **"disable steward override" is impossible; any steward can always force-unseal.** Security control that cannot be turned off.
- `:128` `autoUnsealEnabled` vs engine `autoUnlockEnabled` (~10 sites incl `triggers.js:1189,1372`) → **"hold seals indefinitely" is impossible; seals always auto-release on expiry.** Also breaks the pause/resume timer-extension branch (`policies/actions.js:65`).
- `:126` `defaultSealDuration` vs engine `defaultLockDuration` (`sealing/actions.js:226`) → configured default seal duration is inert; every seal uses the hardcoded `BASELINE_HOLD_SPAN`.
Root cause: a UI-only Lock→Seal/Admin→Steward rename never applied to the engine, plus `store-policy`'s whole-object overwrite dropping the real keys. Impact HIGH (two are security/core-promise), Conf HIGH — key mismatch is mechanically verifiable. Realm console (`realm-console/index.jsx:540`) reads the same dead `autoUnlockEnabled` and so always disagrees with the toggle.

**A4. Sealed media nested in a container (table/list/layout/expand) is DUPLICATED on a legit edit — direct S6 violation, silent page corruption.** `triggers.js:342` (`restoreMediaPass` flags missing purely on `!presentFileIds.has`), `doc-surgery.js:212` (`extractMediaSingleNodes` clones the whole top-level block), `:234` (`spliceMediaNodes` is insert-only, no replace/dedup). Non-owner edits a table containing a sealed image and removes just the image → version N−1's entire table is re-inserted alongside the user's edited one; every other cell they changed is duplicated. App re-save absorbed by T1 → silent, persistent. Impact HIGH, Conf HIGH (design is correct only for bare top-level `mediaSingle`).

**A5. Green grade is a FALSE signal — the flagship attachment seal→revert path has ZERO automated assertion.** `test-harness/scripts/seal-lifecycle-e2e.mjs` only smoke-checks a pre-existing seal (property exists, no log errors); never creates a seal, edits, or asserts a revert. `live-trigger-e2e.mjs:7` self-declares it does not test seal/revert. So `handleSealedArtifactEdit/Trash/Deleted` (S1/S2/S3), section false-revert-on-noop (X4), AI worker (V5), uninstall wipe (K4), edit-grant lifecycle — all unproven. A green grade certifies "workflow + doesn't crash," not the core promise. Impact HIGH (this is why the other bugs survived), Conf HIGH.

### TIER B — Real fail-open / correctness gaps, high confidence

**B1. Attachment revert fails SILENTLY and fails OPEN — owner believes the file is protected when it is not.** `triggers.js:993/1006/1030` every failure branch is `console.error; return`; only success notifies the owner (`:1039`). No steward-visible signal (the workflow path posts a `revert-failed` comment; this path posts nothing). Impact HIGH, Conf HIGH.

**B2. Attachment revert has NO retry — a single transient 429/5xx on download or re-upload permanently bypasses the seal.** `triggers.js:1030`. No backoff, and no attachment-side sweep backstop anywhere (unlike the page 3× loop and hourly `workflowSweep`). One API blip = silent seal bypass until the next edit event that may never come. Impact HIGH, Conf HIGH. (B1+B2 are the same code region; fix together.)

**B3. Uninstall wipe deletes only the first 1000 KVS keys (no cursor loop).** `triggers.js:1174`. Orphans everything past 1000 — including never-TTL'd `workflow-log-*` compliance history and page snapshots — a data-retention/compliance leak on a mature tenant. Impact HIGH, Conf HIGH. (data #1 = prod #4.)

**B4. Enforcement fast-path collectors miss seals above 100 records instance-wide.** `triggers.js:311` (`collectMediaSealsForPage`) and `:414` (`collectSectionSealsForPage`) probe correctly then fetch with a single `.limit(100)` and filter by pageId. Once >100 seal records exist, a page's seal can sort outside the window → probe says "work exists," fetch drops it → **tamper silently not reverted, no error.** Same class corrupts the panel-removal decision (`sealing/actions.js:513`, strips the indicator from a page that still has seals) and under-reports `enumeratePageSeals`/`enumerateOperatorSeals` (`sealing/actions.js:786/560`). Impact HIGH, Conf HIGH.

**B5. Prompt injection via page body yields a false AI "pass" in gate mode.** `validations/logic.js:188` concatenates raw page text after `---\n` with no delimiter/defense. Body text instructing the model to emit `{"findings":[]}` clears `handleGateReview` → `applyAiVerdict("passed")`. Impact HIGH *if AI gate mode is enabled*, Conf HIGH on the mechanism. Flag: impact is conditional on gate mode being turned on, so real-world blast radius depends on adoption.

**B6. `approvePageGate` IDOR — steward check bound to caller-supplied `spaceKey`, write targets an independent caller-supplied `pageId`.** `validations/actions.js:87-100`. A steward of space A passes `spaceKey=A` + `pageId=<page in space B>` and force-marks B's validation gate "passed." Same split lets `enqueuePageValidation` (`:119`, no authz at all) burn any space's AI budget. Impact MED-HIGH, Conf HIGH.

### TIER C — Scale / integrity, high confidence, narrower blast radius

**C1. `expirySweepTask` (`triggers.js:1205`) and `recurringNudgeTask` (`:1399`) process only the first 100 seals forever (no cursor).** Permanent blind spot for expiry/50% notices beyond 100 active seals. `workflowSweep` already paginates — the pattern exists in-repo. Impact MED, Conf HIGH.

**C2. `enumerateOperatorSeals` crosses a numeric offset with the KVS opaque cursor (`sealing/actions.js:564,750`).** `query.cursor("10")` throws → caught → page 2 of "my sealed files" returns empty for any operator with >10 seals. Impact MED, Conf HIGH.

**C3. Expired-but-unswept attachment seal keeps reverting other users' edits.** `handleSealedArtifactEdit` (`triggers.js:975`) never reads `expiresAt`; sections got the X5 inert-when-expired guard, attachments did not. Dead seal denies service. Impact MED, Conf HIGH.

**C4. Trashing a sealed attachment: a TRANSIENT restore failure permanently deletes the seal and falsely tells the owner "deleted."** `triggers.js:1078`, single PUT, any non-ok → hard-delete all seal state + permanent-loss email even though the file is still restorable in trash. Impact MED, Conf HIGH.

**C5. `expiry-notified-*` / `fifty-percent-reminder-sent-*` dedup flags have no TTL and are never swept.** `triggers.js:1273,1326`. Accumulate forever; a stale flag suppresses the expiry notice when the same attachment is re-sealed. Impact MED, Conf HIGH.

**C6. Space validation rules REPLACE global rules instead of merging.** `validations/logic.js:64`, `actions.js:33`. Adding one space rule silently drops all global block-severity rules for that space — and this feeds both revert enforcement and the workflow gate. Empty array = inherit-all (opposite of intuition). Impact MED, Conf HIGH but flag: this may be *intended* precedence semantics — verify with product intent before "fixing," since a merge changes behavior for existing tenants.

**C7. LLM output truncation (`max_completion_tokens` 4096) is undetected → salvaged JSON drops findings → false gate pass.** `forge-llm.js:96`, never reads `finish_reason`. Impact MED, Conf MED — flag: requires a large finding count to trigger; the `finish_reason` field name/shape for the Forge LLM adapter should be verified against the actual response before coding the fix.

### TIER D — Lower impact / hardening

- **D1.** Global AI token budget enforced per-space not globally (`validations/actions.js:136`) → N× overspend across spaces. Conf HIGH. Flag: fix requires deciding the intended accounting unit (global vs realm) — a product call.
- **D2.** Steward group-membership check unpaginated (`steward-checks.js:30`) — may revert a legitimate group-based steward if their group falls outside the bounded `?expand=groups` page. **Conf LOWER — this is where confidence in current behavior is lowest; the REST group-completeness must be verified live before trusting or "fixing" it.**
- **D3.** Token-budget guard is TOCTOU (`validations/actions.js:135`) — concurrent enqueues all pass. Conf HIGH, low blast radius.
- **D4.** `normalizeFindings` drops findings lacking both excerpt and explanation (`logic.js:219`). Conf HIGH, low probability.
- **D5.** Edit-grant `revoke`/`list` resolvers implemented + registered (`editreq/actions.js:402`) but NO UI calls them — approved edit access is a black hole with no revoke surface. Conf HIGH.
- **D6.** `recent-notifications` read-modify-write, no CAS (`bulletins/logic.js:62`) — concurrent dispatches drop feed events. Conf HIGH, low blast radius (1h TTL cache).
- **D7.** `steward-request-*` keys use raw unsanitized spaceKey (`realms/actions.js:361`) → throws on personal `~`-spaces; `listStewardRequests` unpaginated. Conf HIGH, edge case.
- **D8.** `write:confluence-space` scope granted but never exercised (`manifest.yml:177`) — widens consent surface. Conf HIGH.

**Dedup note:** raw findings collapsed — uninstall-wipe (data#1 ≡ prod#4→B3), recordDispatch CAS (data#7 ≡ prod#6→D6), dev-webtrigger (sec-HIGH2 ≡ prod#7→A2), expiry-sweep-cursor (data#6 ≡ prod#4→C1), and the four "global capped scan" findings (core-M3, data#2/#3/#6) unified under B4/C1.

---

## 2. THE single highest-value solid solution to execute now

### Gate every write in the `policies` capsule (fix A1)

This is the pick because it is the app's **worst trust failure** (a total authorization bypass that hands any page reader steward/site-admin power, which then defeats *every other* protection the app sells — force-unseal, edit-grant approval, validation-gate clearing), the **diagnosis is maximally confident** (an identical write two files over already gates correctly), and it is **cleanly buildable** with the exact helper the codebase already uses. Fixing it converts "any reader owns the instance" into "only stewards/admins mutate policy," which is the precondition for calling anything else here trustworthy.

**File:** `src/server/capsules/policies/actions.js`

**Change — add a guard at the top of each mutating resolver, mirroring `realms/actions.js:443`:**

1. Import the existing helpers (both already exported from `src/server/shared/steward-checks.js`, confirmed):
   `import { isOperatorSteward, isOperatorSiteAdmin } from "../../shared/steward-checks.js";`

2. `storePolicy` (`:59`): before any `kvs.set`, read `const caller = req.context.accountId;`
   - `scope === "global"` branch → require `await isOperatorSiteAdmin(caller)`; else `return { success:false, reason:"Not authorized" }`.
   - `scope === "space"` branch → require `await isOperatorSteward(caller, key)`; else deny.

3. `storeGlobalRuleset` (`:151`) → require `isOperatorSiteAdmin(caller)`.

4. `storeRealmRuleset` (`:175`) and `discardRealmRuleset` (`:212`) → require `isOperatorSteward(caller, spaceKey)`.

   (`loadPolicy`/`loadGlobalRuleset`/`loadRealmRuleset`/`enumerateRealmRulesets` are reads — leave them, or restrict `enumerateRealmRulesets` to site-admin separately; not required for the escalation fix.)

**Bootstrapping caveat to handle deliberately (this is the one subtle spot):** on a space with an empty `adminUsers`, `isOperatorSteward` may return false for everyone, which could lock out the *first* legitimate steward configuring a brand-new space. Verify how a space's first steward is meant to be seeded — the realms flow uses `approveStewardRequest` (an existing steward approves), and site-admins pass `isOperatorSiteAdmin` unconditionally. So the correct gate for space writes is `isOperatorSteward(caller,key) || isOperatorSiteAdmin(caller)`, letting a Confluence site-admin bootstrap the first steward while blocking ordinary readers. Confirm `isOperatorSiteAdmin` semantics (it checks Confluence admin perms) before shipping.

**How to verify:**
1. Unit/log check: call each resolver with `req.context.accountId` = a non-steward and assert `{success:false}` and no `kvs.set` occurred (spy/mocked kvs).
2. Live (dev tenant, via the harness webtrigger `what=invoke`): as a non-privileged account, `invoke("store-policy",{scope:"space",key:"<test space>",data:{adminUsers:[{accountId:"<self>"}]}})` → expect denial; confirm `admin-settings-space-*` is unchanged. Repeat `scope:"global"` → denied. Then as a site-admin → allowed. Then as the seeded steward → space write allowed.
3. Regression: existing steward-console save flow (a real steward saving settings) still succeeds — run the steward-console save path in the dev tenant and confirm the settings persist.
4. Add a permanent guard: a harness E2E asserting a non-steward `store-policy` is rejected, wired into `grade.sh` so this can never silently regress (ties into A5).

Confidence: **HIGH** on the vulnerability and the fix shape; the *only* judgment call is the bootstrap gate (site-admin OR steward), which the plan resolves explicitly.

---

## 3. Next 3–5 (ranked by impact × confidence)

1. **A2 — Split the dev webtrigger out of the prod manifest** (`manifest.yml:55-63` + `boot.js`). Unblocks Runs-on-Atlassian eligibility (a stated goal) and removes the only latent state-mutation backdoor. Maintain a `manifest.dev.yml` overlay for the dev deploy. High confidence.

2. **A3 — Reconcile the three phantom toggle keys** (`steward-console/index.jsx:126-128`). Persist/read the engine's real keys (`allowAdminOverride`, `autoUnlockEnabled`, `defaultLockDuration`), or map them inside `store-policy`. Two of the three are security/core-promise controls that currently cannot be enforced. High confidence; mechanically verifiable. (Fix the realm-console read `:540` in the same pass.)

3. **B1+B2 — Make attachment revert loud and durable** (`triggers.js:993-1035`). Wrap download+reupload in bounded 429/5xx backoff; on definitive failure, dispatch a `revert-failed` violation notice to owner+stewards (reuse `sendViolationNotifications`), matching the workflow path. Turns a silent fail-open on the headline feature into a truthful, retried enforcement. High confidence.

4. **A5 — Add a real seal→edit→assert-revert E2E and wire it into `grade.sh`.** Without this the grade will keep certifying green while A4/B1/B4 rot. This is the meta-fix that makes every other fix stick. High confidence on need; moderate effort to author a faithful two-user revert assertion.

5. **B3 + C1 — Cursor-paginate the uninstall wipe, expiry sweep, and nudge task** (`triggers.js:1174,1205,1399`). Copy the in-repo `workflowSweep` `do/while nextCursor` pattern. Fixes a compliance-data retention leak and a permanent notification blind spot in one consistent change. High confidence.

(Honorable mention: **B4** — the >100-record enforcement miss — is arguably co-#1 in impact because it silently defeats *enforcement itself* at scale, but the correct fix needs a per-page/per-owner index that doesn't exist yet, so confidence in a clean fix is lower than the five above. Flag it as the next design task after the index question is settled.)

---

## 4. Verdict — brutally honest one paragraph

Sentinel Vault is a **feature-rich demo wearing a production costume**: the workflow engine (#42–#48) is recent, adversarially reviewed, and genuinely the sturdiest part — but the *older core that the whole product is named for* is where the rot is. The headline attachment-seal→revert path fails **open and silent** (no retry, no owner signal), corrupts pages when sealed media is nested in a table/layout (A4), silently stops enforcing above 100 seals per instance (B4), and — most damning — is **certified green by tests that never once assert a revert happens** (A5), so nobody would notice. On top of that sits a **critical authorization hole** (A1: any reader can make themselves a steward or site-admin) and a **phantom security console** (A3) where the two most important controls — "disable steward override" and "hold seals indefinitely" — are wired to dead keys and cannot actually be turned on, both failing open. The egress story is clean and Runs-on-Atlassian is within reach once the dev webtrigger is split out (A2). Net: the workflow layer is solid; the content-protection core is fragile and partly phantom, and it is currently **not trustworthy to defend content against a motivated editor or a curious reader.** The single most valuable move is to gate the policies capsule (§2) — everything else the app enforces is meaningless while any reader can grant themselves the keys.
