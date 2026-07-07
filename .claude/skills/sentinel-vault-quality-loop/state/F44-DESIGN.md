# F44 (F3) — Enforced Approved State: IMPLEMENTABLE DESIGN (v2, post-critique)

Synthesized from pipeline.md, engine.md, seal-revert.md, contract-risk.md + verified against shipped
source (`triggers.js`, `workflow/logic.js`, `workflow/actions.js`, `workflow/approvals.js`,
`shared/steward-checks.js`, `manifest.yml`). Build from this with no further discovery. File:function and
key names are exact; line numbers are from the 2026-07-08 read and may drift — anchor on function names.

**This is v2.** Three adversarial critics (content-destruction, ordering/loop, authority/correctness)
found 17 real gaps in v1. Every one is resolved below; §9 is the resolution ledger (objection → fix →
where). The through-line of the dangerous ones is the same: **`approvedVersion` was anchored at the wrong
point** (a pre-pass guess, or a value read once and frozen, or the live version at completion). v2 fixes
this with ONE rule (§0.A): `approvedVersion` is only ever established from an *observed, post-write* version
or the *quorum-reviewed* version — never guessed pre-pass, never frozen across retries.

## 0. Decisions locked (read first)

- **A. THE ANCHOR RULE (root fix for Defects 1/3/4, Gaps A/F, CL-2/CL-4).** `approvedVersion` is set ONLY
  in two ways, never any other: (1) **at approval completion** = the version the quorum actually reviewed
  (`pinnedVersion`), and completion **fails closed** if the live page drifted from it; (2) **post-write
  reconciliation** = the version an app write or a privileged edit *actually produced*, observed after the
  fact (`currentVersion+1` for an app write; the editor's live version for a privileged edit). It is NEVER
  stamped in the probe/pre-pass, and the revert pass NEVER trusts a frozen copy — it re-reads
  `approvedVersion` strongly-consistent inside its retry loop.
- **B. Default mode = DEMOTE.** REVERT is a per-space opt-in. Justification in §2.0. Confidence-driven, not
  effort-driven: demote writes no body and reads no ADF, so it cannot destroy content, cannot fight the
  seal passes, and is naturally idempotent (SV-M1 class avoided entirely). Whole-page revert is destructive
  (discards the whole save, recoverable only via version history) and is the low-confidence pipeline
  surgery flagged in the spec (Risk 4) — it ships gated and must pass every scenario in §6.
- **C. Fail closed, everywhere.** A null/unfetchable `approvedVersion` must never leave a page showing
  "Approved + enforce:true" while silently allowing all edits. Capture fails the transition on a null
  version (§1.5); the sweep *self-heals* a null baseline instead of skipping it (§4.2).
- **D. Privileged set = snapshot ∩ live config.** Privileged iff `atlassianId ∈ record.approvers` (snapshot,
  because the approval records are deleted by `clearPageApprovals` the instant the transition completes)
  **AND** `atlassianId` is still in the space's *currently configured* approver set — OR is a live steward.
  The `∩ live config` clause honors approver *revocation* immediately (Gap E); snapshot semantics still
  correctly deny *newly-added* approvers on old approvals.
- **E. Steward check uses `isOperatorSteward(atlassianId, record.spaceKey)`** — realmKey ≡ spaceKey in this
  repo (every existing caller passes spaceKey directly; there is NO `realmKeyFor` helper — it was a phantom,
  Gap G). Use `isOperatorSteward`, NOT `authorizeSteward`, so `allowAdminOverride` can't strip a steward's
  authority over a page they govern.
- **F. `ctx.enforcedRevert`** is the one short-circuit flag: set by Pass 0, checked at the TOP of Pass A and
  Pass B (both `return` immediately). It (a) enforces who-wins and (b) suppresses ALL three SV-M5
  snapshot-writing branches in the section pass. **Exception (Defect 2):** a seal created *after* approval
  is kept valid by re-stamping `approvedVersion` on seal creation (§2.7), so the approved baseline always
  ⊇ current seals and the whole-body revert can never strip a newer seal.

---

## 1. `approvedVersion` capture (engine side)

### 1.1 Function to change: `transitionPageWorkflow` — `src/server/capsules/workflow/logic.js` (~:267)

Add optional `approvers` + `approvedVersion` parameters and enforce-aware record fields. **The caller
supplies `approvedVersion`** (approval path passes the quorum-reviewed `pinnedVersion`; steward path passes
the live version) — capture is a caller responsibility so the two paths can apply their different anchor
+ fail-closed rules (§1.5). `transitionPageWorkflow` only *writes* what it is given.

New signature:
```
transitionPageWorkflow({ pageId, spaceKey, toStateId, actorAccountId, actorName, reason, approvers, approvedVersion })
```
Inside, after `const target = findState(def, toStateId)` and before building `record`:
```js
let enforceFields;
if (target.enforce) {
  enforceFields = {
    enforce: true,
    approvedVersion: (typeof approvedVersion === "number" && approvedVersion >= 1) ? approvedVersion : null,
    approvers: Array.isArray(approvers) ? [...new Set(approvers)] : [],
    approvedAt: enteredAt,
    approvedBy: actorAccountId || null,
  };
} else {
  // LEAVING (or never entering) an enforce state — stop enforcing immediately.
  enforceFields = { enforce: false, approvedVersion: null, approvers: [] };
}
const record = { ...current, workflowId: def.id, stateId: toStateId, enteredAt,
  enteredBy: actorAccountId || null, enteredByName: actorName || null,
  spaceKey: current.spaceKey || spaceKey || null, reviewDueAt: computeReviewDueAt(target),
  ...enforceFields };
```
`persistState(pageId, record, current.stateId)` is unchanged as the single writer.

### 1.2 New helper in logic.js (mirror `actions.js:fetchPageVersion`, avoids a circular import)
```js
export async function fetchLivePageVersion(pageId) {
  try {
    const res = await asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}`);
    if (res.ok) return (await res.json())?.version?.number ?? null;
  } catch (_) {}
  return null;
}
```
Exported so the sweep (§4) and the trigger reconciliation (§2.5) reuse it. Returns `null` on any failure —
callers treat `null` as **fail-closed** (see §1.5, §4.2), never as "no drift."

### 1.3 New helper: `restampApprovedVersion(pageId, n)` in logic.js — the ONLY re-stamp primitive
```js
export async function restampApprovedVersion(pageId, n) {
  if (!(typeof n === "number" && n >= 1)) return false;
  const record = await readPageWorkflow(pageId);
  if (!record?.enforce) return false;
  if (record.approvedVersion != null && n <= record.approvedVersion) return false; // forward-only
  record.approvedVersion = n;
  await persistState(pageId, record, record.stateId);
  return true;
}
```
Forward-only (`n > approvedVersion`) so a late/re-delivered event can never drag the baseline backward.
Every re-stamp in the system goes through this one function.

### 1.4 Storage — where each datum lives

| Datum | Location | Key/field | Source of truth? |
|---|---|---|---|
| `approvedVersion` | KVS `workflow-state-{pageId}` record | `.approvedVersion` (number\|null) | YES |
| `enforce` | same record | `.enforce` (bool) | YES |
| approver snapshot | same record | `.approvers` (accountId[]) | YES |
| `approvedAt`/`approvedBy` | same record | audit | YES (also in `workflow-log-{pageId}-{ts}`) |
| cheap probe mirror | content property `sentinel-vault-workflow` | `.enforce`, `.approvedVersion` | NO (best-effort hint) |
| enforcement mode | KVS `workflow-settings-{spaceKey}` | `.enforceMode` ("demote"\|"revert", default "demote") | YES |
| integrity dedup | KVS `workflow-integrity-notified-{pageId}` | presence flag | — |

All under `workflow-*`, enumerated by `lifecycleTrigger` uninstall wipe (K4). No manifest change for KVS keys.

### 1.5 Callers — capture the RIGHT version and FAIL CLOSED (fixes Gap A + Gap B)

- **Approval path** — `decideApproval` (approvals.js:~142). On `outcome === "approved"`, BEFORE calling
  `transitionPageWorkflow`:
  1. `const live = await fetchLivePageVersion(pageId);`
  2. **Fail closed on null:** if `live == null` → do NOT complete; leave the approval pending, notify
     "could not verify page version, approval not applied — retry." (A transient GET 500 must not enter a
     half-enforced state.)
  3. **Fail closed on drift (Gap A):** if `live !== pending.pinnedVersion` → the page was edited during the
     approval window, so the recorded votes are **stale** — do NOT launder the tamper into the baseline.
     Clear this round (`clearPageApprovals`), notify approvers "page changed since review — re-approval
     required," and return `{ success:true, outcome:"stale", transitioned:false }`. (Comala "approval
     expires on edit" model.)
  4. Otherwise pass `approvers: pending.approvers, approvedVersion: pending.pinnedVersion` into
     `transitionPageWorkflow`. The enforced baseline is now provably the exact bytes the quorum reviewed.
- **Wire the `stale` read model (approvals.js:167).** Replace the hardcoded `const stale = false;` in
  `getPageApprovalStatus` with `const stale = pending.pinnedVersion != null && current?.stateId &&
  (await fetchLivePageVersion(pageId)) !== pending.pinnedVersion;` so the inbox/panel shows staleness and a
  decideApproval on a stale page is blocked at completion by step 3. (Belt-and-braces: `decideApproval` may
  also reject a *vote* when live ≠ pinnedVersion, prompting re-request — optional, step 3 is the hard gate.)
- **Direct steward path** — `requestTransition` (actions.js:~164), the no-approvers branch: the steward IS
  the reviewing authority and is acting on what they see *now*, so `approvedVersion = await
  fetchLivePageVersion(pageId)` at completion. Fail closed on null (don't transition into enforce). Resolve
  the current approver snapshot via `resolveApproverIds(settings.approval)` (§0.D) and pass the flat id list
  (or `[]` — semantics in §2.4).
- **Harness** — `test-hook.js:transitionWorkflow`: accept optional `approvers` + `approvedVersion`
  passthrough so scenarios seed the privileged set and baseline deterministically.
- **Lift `resolveApproverIds` into `approvals.js`** (it currently lives in actions.js and does group
  expansion via REST). Both the steward path AND the trigger's live-config intersection (§0.D / §2.1) import
  it from there. Pure move, no behavior change.

### 1.6 Mirror enforce onto the content property — `writeStateContentProp` (logic.js:~105)
```js
const value = { workflowId: record.workflowId, stateId: record.stateId, enteredAt: record.enteredAt,
                enforce: record.enforce === true, approvedVersion: record.approvedVersion ?? null };
```
Best-effort/try-catch; the record stays authoritative (property may lag a silent failure — never revert off
the property's `approvedVersion` alone; always cross-check `readPageWorkflow`).

---

## 2. The enforce pass in `pageContentTrigger` (`src/server/triggers.js`)

### 2.0 Why DEMOTE is the default (justification vs SV-M1 destructiveness)
Whole-page revert IS the SV-M1 destruction class applied to the whole body: it discards every change in the
save (including a good-faith paragraph a non-approver added), recoverable only via version history. Demote
keeps the editor's content, drops the state to Draft, posts a banner+comment. Demote (a) never destroys
content, (b) writes no body so it never fights the seal passes (dissolves the ping-pong structurally),
(c) makes the badge CORRECT (Draft) instead of lying or destroying work to make Approved true, (d) is
naturally idempotent. Cost is positioning only (closer to competitors' state-reset), not correctness.
Revert remains available per-space for teams that want byte-freeze, gated with eyes-open copy.

### 2.1 Phase 1 — the third cheap probe (fixes the `hasBodyWork` gating bug)
An enforced page with NO seals must still read its body to revert. Add, alongside the two seal probes:
```js
const enforcement = contentProtectionOn
  ? await collectWorkflowEnforcementForPage(pageId, atlassianId, content?.version?.number)  // NEW
  : null;
const needsRevert = enforcement?.action === "revert";
const hasBodyWork = sealFileMap.length > 0 || sectionSeals.length > 0 || needsRevert;
```

`collectWorkflowEnforcementForPage(pageId, atlassianId, eventVersion)` — new fn, mirrors
`collectSectionSealsForPage`'s early-bail discipline (T4, NO ADF read):
1. `GET .../properties?key=sentinel-vault-workflow`. Absent OR `value.enforce !== true` → `return null`.
   (Fast path: unrelated/non-enforced page costs the property GET only.)
2. Authoritative `readPageWorkflow(pageId)` → `record`. Re-confirm enforce via
   `findState(await resolveWorkflowDef(record.spaceKey), record.stateId).enforce === true`; if not → `return
   null`. Read `record.approvedVersion`, `record.approvers`, `record.spaceKey`.
3. **Privileged check (§0.D + §0.E).** Read `settings = await getSpaceWorkflowSettings(record.spaceKey)`
   once (also used for `enforceMode` below). `const liveApprovers = (await
   resolveApproverIds(settings.approval))?.approvers || [];`
   ```
   privileged =
     (record.approvers.includes(atlassianId) && liveApprovers.includes(atlassianId))   // snapshot ∩ live
     || await isOperatorSteward(atlassianId, record.spaceKey);                          // live steward
   ```
   **If privileged → `return { action: "privileged", record }`.** NOTE: do NOT re-stamp here (that was
   Defect 1 — a pre-pass stamp collides with a seal pass that writes a different version in the SAME event).
   Returning `action:"privileged"` (not `null`) lets the post-loop reconciliation (§2.5) advance the
   baseline to the *actually-produced* version. `needsRevert` stays false, so a privileged edit with no
   seals adds no body work.
4. **Not privileged** → read `enforceMode` from the `settings` already fetched (default `"demote"`).
   - **Empty-approver-set + revert (CL-5, engine fail-safe):** if `record.approvers.length === 0 &&
     enforceMode === "revert"` → treat as `"demote"` for this event (a misconfig must not blank-revert every
     non-steward edit; the UI warning in §2.4 is advisory, THIS is the code guard).
   - `enforceMode === "revert"` → `return { action:"revert", record, spaceKey }`.
   - else (`"demote"`) → perform the demote inline HERE (§2.6), then `return { action:"demote" }`.

Cost note: the settings read + `resolveApproverIds` + steward check are the only added cost, and only on
enforced-page saves by a non-listed actor — off the ADF-read path, honoring T4's spirit.

### 2.2 Pass 0 placement — inside the Phase-2 loop, BEFORE Pass A
```js
// Pass 0 (F44): enforced-state whole-page revert — runs FIRST, short-circuits A/B (who-wins).
if (enforcement?.action === "revert") {
  try { await enforceApprovedStatePass(ctx, enforcement); }
  catch (e) { console.error("[WORKFLOW-ENFORCE] pass error:", e); }
}
if (!ctx.enforcedRevert && sectionSeals.length > 0) restoreSealedSectionsPass(ctx, sectionSeals);
if (!ctx.enforcedRevert && sealFileMap.length > 0)  restoreMediaPass(ctx, sealFileMap);
```
Add `enforcedRevert: false` to the `ctx` initializer. Add `if (ctx.enforcedRevert) return;` as the FIRST
line of BOTH `restoreSealedSectionsPass` and `restoreMediaPass` (belt-and-braces). This covers all three
snapshot-writing branches in the section pass (owner re-baseline, grant re-baseline, restore).

**Why suppressing the seal passes does NOT strip a post-approval seal (Defect 2):** because §2.7 re-stamps
`approvedVersion` to the live version whenever a seal is created/re-baselined on an enforced page. So
`approvedVersion`'s body always ⊇ every current seal, and the whole-body revert to that version *restores*
the sealed content as a side-effect. The suppression is safe precisely because the baseline is kept
seal-complete. (Scenario 4b in §6 proves this.)

### 2.3 `enforceApprovedStatePass(ctx, enforcement)` — the revert logic
Mutates the shared `ctx.adfDoc`; the EXISTING single `writeDocBody` (triggers.js:~184) performs the one
write. **Re-reads `approvedVersion` strongly-consistent at the top (Defect 4 / CL-2):** it never trusts the
version frozen in the probe, so a concurrent approver edit that already advanced the baseline is honored.
```js
async function enforceApprovedStatePass(ctx, enf) {
  // Defect 4 / CL-2: re-read the baseline fresh every attempt — a concurrent approver edit may have
  // re-stamped approvedVersion past the value captured in the probe. Reverting to a STALE baseline would
  // wipe the approver's just-sanctioned content. Always target the freshest sanctioned version.
  const rec = await readPageWorkflow(ctx.pageId);
  if (!rec?.enforce) return;                                    // demoted/left enforce mid-flight — stop
  const av = rec.approvedVersion;
  if (!(typeof av === "number" && av >= 1)) return;            // no valid baseline — nothing to enforce
  const cur = ctx.currentVersion || 0;
  if (cur <= av) return;                                        // equality/behind guard — no-op

  const { adfDoc: approvedAdf } = await readDocBodyAtVersion(ctx.pageId, av);
  // CL-1: NEVER let an empty/absent baseline blank the page. If the old version can't be read as a
  // non-empty doc (pruned version, partial read, ADF drift), abort — do not write.
  if (!approvedAdf?.content?.length) {
    console.error(`[WORKFLOW-ENFORCE] approved v${av} body empty/unreadable for ${ctx.pageId} — aborting revert`);
    return;
  }
  // CL-7: mirror SV-M7 — a 32-bit FNV match is not proof. Only treat as an innocent round-trip when the
  // canonical structures also match. (Direction here is non-destructive, but keep it consistent.)
  if (hashAdf(ctx.adfDoc) === hashAdf(approvedAdf) &&
      JSON.stringify(canonicalizeAdf(ctx.adfDoc.content)) === JSON.stringify(canonicalizeAdf(approvedAdf.content))) {
    ctx.restampObservedFrom = "equal";                         // §2.5 will re-stamp to the observed live version
    return;                                                    // content already equal — NO body write
  }
  ctx.adfDoc.content = approvedAdf.content;                     // whole-body replace, in place
  ctx.changed = true;
  ctx.enforcedRevert = true;                                    // short-circuit A/B + suppress SV-M5
  ctx.enforceRevertTo = av;                                     // for the comment copy (§5)
  ctx.enforceMessage = "(Sentinel Vault reverted unapproved change to the approved version)"; // T3, §5
  ctx.notifications.push({ type: "workflow-enforce", targetId: ctx.pageId,
    editorId: ctx.atlassianId, spaceKey: enf.record.spaceKey, mode: "revert", approvedVersion: av });
}
```
Notes:
- `readDocBodyAtVersion` returns the OLD version's `pageData` — DISCARD it; only take `adfDoc`. The write
  uses `ctx.pageData` (head) so the PUT lands at `currentVersion + 1`.
- **No pre-write version guess.** v1 stored `ctx.restampApprovedTo = cur+1`; that mismatched reality in the
  equality/privileged paths (Defect 3). v2 re-stamps to the **observed** written version in §2.5 instead.
- Thread `ctx.enforceMessage` into the shared write: change the line-184 call to
  `writeDocBody(ctx.pageId, ctx.pageData, ctx.adfDoc, ctx.enforceMessage || "(Sentinel Vault restored
  protected content)")`. One write, distinct message, no second writer.

### 2.4 Empty-approver-set footgun (UI half; engine half is §2.1 step 4)
`evaluateApproval` returns `"approved"` with zero approvers (approvals.js:~28). Rule: when `record.approvers`
is empty, ONLY stewards are privileged, AND revert-mode downgrades to demote in the engine (§2.1 step 4 —
this is the hard guard). The `WorkflowSettingsEditor` UI must additionally warn when enforce is on with no
approvers ("every non-steward edit will be demoted"). No native `<select>`/`alert` — use the app's custom
dropdown/dialog primitives (global UI rule).

### 2.5 Re-stamp `approvedVersion` from the OBSERVED written version — the single reconciliation (Defects 1/3, Gaps F, CL-4)
There is exactly ONE re-stamp site in the trigger, in Phase 3 AFTER the write loop, keyed off what actually
happened — never a pre-pass guess. Track the produced version in the loop: on `putRes.ok`, set
`writtenVersion = ctx.currentVersion + 1` (the version the PUT created). After the loop:
```js
// F44 reconciliation: keep approvedVersion == the last version the app or a privileged actor produced.
if (enforcement && enforcement.action !== "demote") {
  let newBaseline = null;
  if (anyChange && writtenVersion) {
    newBaseline = writtenVersion;                 // app wrote (revert OR a seal restore on a privileged edit)
  } else if (enforcement.action === "privileged") {
    newBaseline = (content?.version?.number) || (await fetchLivePageVersion(pageId)); // editor's live version
  } else if (enforcement.action === "revert") {
    newBaseline = (await fetchLivePageVersion(pageId)); // equality-guard hit: no write, advance to live
  }
  if (newBaseline) { try { await restampApprovedVersion(pageId, newBaseline); } catch (_) {} }
}
```
Why this closes the gaps:
- **Defect 1:** a privileged actor's edit that ALSO triggers a seal restore writes `writtenVersion`; the
  baseline is stamped to that exact written version, so `live === approvedVersion` — no sweep churn.
- **Defect 3:** the number recorded is the number written, in every branch (revert, equality, privileged).
- **CL-4:** a privileged edit with no app write falls back to `fetchLivePageVersion` when `eventVersion`
  is absent, so the baseline never lags a sanctioned edit.
- **Gap F:** any confirmed app write to an enforced page (revert or seal restore) advances the baseline.
`restampApprovedVersion` is forward-only, so a re-delivered event can't move it backward. Its KVS write is
best-effort here BUT the hourly sweep (§4) is the durable backstop with an author check, so a dropped
re-stamp degrades to "sweep notices drift, sees a privileged author, re-stamps" — never to destruction.

### 2.6 DEMOTE execution (default) — inline in the probe (§2.1 step 4), no body loop
```js
const def = await resolveWorkflowDef(record.spaceKey);
const initial = getInitialState(def);
const res = await transitionPageWorkflow({ pageId, spaceKey: record.spaceKey,
  toStateId: initial.id, actorAccountId: systemAccountId, actorName: "Sentinel Vault",
  reason: "auto-demoted: edited by non-approver while Approved" });
if (res.success) await postEnforceComment(pageId, atlassianId, "demote");   // §5, after success (SV-M2)
```
Non-enforce target sets `enforce:false, approvedVersion:null, approvers:[]` (§1.1), so the next event's
probe bails at step 1/2 — F44 stops firing and the seal passes resume normally. No body write, no ADF read,
no ping-pong surface.

### 2.7 Seal-created-on-an-enforced-page re-stamp (Defect 2 fix — keeps the baseline seal-complete)
When a media seal or section seal is CREATED or re-baselined on a page whose workflow record has
`enforce:true`, re-stamp `approvedVersion` to the current live version. Seal creation writes properties +
snapshots, NOT the page body, so the live version is stable and the approved baseline's body already
contains the just-sealed content — re-stamping makes `approvedVersion` point at a version whose body ⊇ the
seal. Then Pass 0's whole-body revert-to-baseline restores the seal instead of stripping it, and the blanket
seal-pass suppression (§2.2) stays safe. Implementation: in the seal-create and section-seal-create actions,
after the seal is written:
```js
const wf = await readPageWorkflow(pageId);
if (wf?.enforce) { const v = await fetchLivePageVersion(pageId); if (v) await restampApprovedVersion(pageId, v); }
```
Residual (named, low): a seal created and a non-approver edit landing within the same instant have a
one-event window before the re-stamp commits; the sweep + author check (§4) reconciles it next tick. Chosen
over the alternative (Pass 0 selectively runs seal passes for seals newer than the baseline) because
selective merge re-introduces exactly the section-owner ping-pong the suppression exists to kill —
re-stamping is the simpler, structurally-safe option.

---

## 3. Loop safety — why the revert write does not loop (unbounded)

Two independent stops, either alone sufficient:
1. **T1 self-write guard (primary).** The revert is an `asApp()` `writeDocBody`; its PUT re-fires
   `avi:confluence:updated:page` with `event.atlassianId === systemAccountId`, and `pageContentTrigger`
   returns at the `atlassianId === systemAccountId` check (triggers.js:~123) BEFORE any probe. T2
   fail-closed (`!systemAccountId → return`, ~:119) runs even earlier.
2. **Content equality + re-stamp (backstop).** Even if a self-write reached Pass 0, after the revert
   `hashAdf(head) === hashAdf(approvedAdf)` (and canonical compare) is true → equality guard no-ops; and the
   §2.5 reconciliation set `approvedVersion` to the written version, so `cur <= av` also no-ops. Fixed point
   after one revert.
The DEMOTE path writes no page body, so it produces no `updated:page` event — trivially loop-free.

---

## 4. Integrity sweep — new `workflowSweep` scheduled function (the durable backstop)

### 4.1 Manifest additions (`manifest.yml`)
```yaml
    - key: workflow-sweep-fn
      handler: boot.workflowSweep
```
```yaml
    - key: workflow-sweep-scheduled
      function: workflow-sweep-fn
      interval: hour
```
`src/boot.js`: add `workflowSweep` to the `export { ... } from "./server/triggers.js"` list. (Fourth
scheduled trigger — verify Forge's per-app limit at build; peers already coexist, expected fine.)

### 4.2 `workflowSweep()` in triggers.js — cursor-paginated, author-aware, self-healing
Fixes Gap D (cursor-paginate to completion, iteration-capped, skip non-enforce early — the security backstop
must not silently cover a truncated random subset), Gap B (self-heal a null baseline instead of `continue`),
and Gap C / CL-3 (author check before any revert):
```js
export async function workflowSweep() {
  const systemAccountId = await resolveAppAccountId();
  if (!systemAccountId) return okBody({ swept: 0 });           // fail-closed; the sweep also writes asApp
  let reverted = 0, demoted = 0, healed = 0;
  let query = kvs.query().where("key", WhereConditions.beginsWith("workflow-idx-")).limit(100);
  let iterations = 0;
  do {
    const { results, nextCursor } = await query.getMany();
    for (const { value: idx } of (results || [])) {
      try {
        const record = await readPageWorkflow(idx.pageId);
        if (!record?.enforce) continue;                        // skip non-enforce fast (Gap D cost)
        const def = await resolveWorkflowDef(record.spaceKey);
        if (!findState(def, record.stateId)?.enforce) continue; // stale index guard
        const live = await fetchLivePageVersion(idx.pageId);
        if (live == null) continue;                            // transient — retry next tick
        // Gap B: a null baseline on an enforced page is a half-enforced hole — SELF-HEAL, don't skip.
        if (record.approvedVersion == null) {
          if (await restampApprovedVersion(idx.pageId, live)) healed++;
          continue;
        }
        if (live === record.approvedVersion) {                 // no drift → clear dedup, done
          await kvs.delete(`workflow-integrity-notified-${idx.pageId}`).catch(() => {});
          continue;
        }
        // DRIFT. Gap C / CL-3: a dropped event may have dropped an AUTHORIZED edit. Check the author of
        // the live version and run the SAME privileged test as the event path before destroying anything.
        const author = await fetchLiveVersionAuthor(idx.pageId);   // §4.4
        const settings = await getSpaceWorkflowSettings(record.spaceKey);
        const liveApprovers = (await resolveApproverIds(settings.approval))?.approvers || [];
        const authorized = author && (
          (record.approvers.includes(author) && liveApprovers.includes(author)) ||
          await isOperatorSteward(author, record.spaceKey));
        if (authorized) {                                      // sanctioned edit whose event was lost → adopt it
          if (await restampApprovedVersion(idx.pageId, live)) healed++;
          await kvs.delete(`workflow-integrity-notified-${idx.pageId}`).catch(() => {});
          continue;
        }
        const mode = settings?.enforceMode || "demote";
        const alreadyNotified = await kvs.get(`workflow-integrity-notified-${idx.pageId}`);
        if (mode === "revert" && record.approvers.length > 0) { // CL-5: never blank-revert an empty approver set
          const ok = await sweepRevertToApproved(idx.pageId, record);  // §4.3
          if (ok) { reverted++; await kvs.delete(`workflow-integrity-notified-${idx.pageId}`).catch(()=>{}); }
          else if (!alreadyNotified) { await postEnforceComment(idx.pageId, record.enteredBy, "revert-failed");
            await kvs.set(`workflow-integrity-notified-${idx.pageId}`, { at: new Date().toISOString() }); }
        } else {
          const initial = getInitialState(def);
          const res = await transitionPageWorkflow({ pageId: idx.pageId, spaceKey: record.spaceKey,
            toStateId: initial.id, actorAccountId: systemAccountId, actorName: "Sentinel Vault",
            reason: "auto-demoted by integrity sweep (unauthorized drift)" });
          if (res.success && !alreadyNotified) { demoted++;
            await postEnforceComment(idx.pageId, record.enteredBy, "demote");
            await kvs.set(`workflow-integrity-notified-${idx.pageId}`, { at: new Date().toISOString() }); }
        }
      } catch (e) { console.error("[WORKFLOW-SWEEP]", e); }
    }
    if (!nextCursor || ++iterations >= 20) break;              // bounded like getWorkflowLog
    query = kvs.query().where("key", WhereConditions.beginsWith("workflow-idx-")).limit(100).cursor(nextCursor);
  } while (true);
  return okBody({ reverted, demoted, healed });
}
```

### 4.3 `sweepRevertToApproved(pageId, record)` — standalone revert (not inside the ctx loop)
Self-contained read→PUT with the SAME 3× 409 backoff and the SV-M1 guard. Re-reads `approvedVersion` fresh,
applies the CL-1 empty-baseline guard (abort, never blank), writes `asApp()` (re-fire lands on T1). On ok:
`restampApprovedVersion(pageId, newVersion)` then return true. On persistent 409 / non-ok: return false
(SV-M2 — do not claim success; the dedup flag + next tick retry). Structurally non-looping: acts only on
unauthorized `live !== approvedVersion`, re-stamps on success.

### 4.4 `fetchLiveVersionAuthor(pageId)` — new helper (author of the current top version)
```js
async function fetchLiveVersionAuthor(pageId) {
  try {
    const res = await asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}/versions?limit=1`);
    if (res.ok) return (await res.json())?.results?.[0]?.authorId ?? null;
  } catch (_) {}
  return null;
}
```
Returns `null` on failure → the sweep treats an unknown author as NOT authorized (fail-closed toward
enforcement) but still respects the CL-1 empty-baseline guard, so it can never blank a page.

### 4.5 Dedup flag `workflow-integrity-notified-{pageId}`
Claim-BEFORE-notify: check before posting, set right after, DELETE the moment drift resolves (live ==
approvedVersion, a successful revert, or an authorized-drift adoption). Stops hourly duplicate notices while
a revert keeps failing, without suppressing the eventual success notice.

---

## 5. The notice (claim discipline + a real recovery path, CL-6)

Single helper `postEnforceComment(pageId, editorId, kind, opts)` — native Confluence footer comment (no
egress, R1), @mentioning the editor. Routed for the event-path revert through `ctx.notifications` →
`notifyMap` (dedup key `workflow-enforce:{pageId}`) → Phase-3 dispatch, which fires ONLY after `anyChange`.
**Every revert notice includes the history link** (CL-6 — the exact pattern `runValidationPhase` uses at
triggers.js:526): build `historyUrl = ${base}/pages/viewpreviousversions.action?pageId=${pageId}` from
`pageData._links.base` and render it as a clickable link, so the reverted editor reaches their content in one
click, not a scavenger hunt. Copy:

- **revert** (event or sweep): "This page is in an enforced Approved state. Your change was reverted to the
  approved version (v{approvedVersion}), verified by structural compare. Your edit is preserved in the page
  history → [view previous versions]({historyUrl}). To edit an approved page, first request a transition out
  of Approved."
- **demote**: "This page was edited after approval, so Sentinel Vault moved it back to Draft. Re-submit it
  for approval when the changes are ready." (State prop drives the Draft ribbon automatically.)
- **revert-failed** (sweep only): steward-facing note that enforcement could not reapply and will retry —
  includes `historyUrl`; never tells the editor "restored" on a failed write.

Never emit "the Approved badge can never be wrong" — between tamper and enforcement the badge is briefly
wrong by design; the honest claim is "tampering is reverted within minutes and attested by structural
compare."

---

## 6. EXACT harness scenarios (`test-harness/scripts/`, driven via `test-hook.js`)

Add/extend `workflow-enforce-e2e.mjs`. `test-hook.js:transitionWorkflow` gains `approvers` + `approvedVersion`
passthrough. Each scenario asserts on real page state (version number + `hashAdf` of body) and posted
comments. **Scenarios 7–11 are the critic-mandated ones and are release gates for REVERT.**

1. **tamper-while-approved (revert).** Approve with `approvers=[APPROVER]`, `approvedVersion==V0`. Edit as
   NON-approver → V1. Assert: body reverts to V0 (`hashAdf` equals approved body), revert comment mentions
   the editor AND contains a `viewpreviousversions.action?pageId=` link, `approvedVersion` re-stamped to the
   written version. Exactly one app `writeDocBody`.
2. **approver edit passes + baseline tracks it.** Edit the Approved page as APPROVER → V_n. Assert: NO
   revert, NO comment, `approvedVersion` re-stamped to V_n (post-write reconciliation, §2.5). Repeat as
   STEWARD.
3. **seal-owner edits own section on Approved page → NO ping-pong across 2 events (revert).** Seal a section
   owned by OWNER (not an approver). Approve. Event 1: OWNER edits their sealed section → whole page reverts
   to `approvedVersion`; `section-snapshot-*` and `section-protection-*.contentHash` UNCHANGED (SV-M5
   suppressed — diff before/after). Event 2: fire another save → FIXED POINT (body still approved, snapshot
   unchanged, ≤1 further write). Core who-wins/ping-pong proof.
4. **concurrent seal-restore + workflow-revert on one event.** Approved page with a media seal; NON-approver
   save violates the media seal AND edits body. Assert: Pass 0 sets `enforcedRevert`, both seal passes
   skipped, EXACTLY ONE `writeDocBody`, body == approved.
   **4b. seal created AFTER approval is NOT stripped (Defect 2).** Approve (V0, no seal). Add + seal media on
   the page → §2.7 re-stamps `approvedVersion` to the sealed version. NON-approver edits → whole-page revert.
   Assert the sealed media is PRESENT after the revert (baseline was seal-complete), not stripped.
5. **integrity sweep — dedup + failed-revert.** Approve (V0). Simulate a DROPPED event: bump body to V1 via
   a direct write without trigger processing. Run `workflowSweep()`. Assert it reverts (revert) or demotes
   (demote), posts exactly one notice, sets the dedup flag; a SECOND run posts NO duplicate; once resolved,
   the flag is deleted. Force a persistent 409 → assert the sweep does NOT claim success and retries.
6. **demote default path.** `enforceMode="demote"`. NON-approver edits an Approved page. Assert: body
   UNCHANGED, state drops to initial/Draft, demote comment posted, NEXT event is a no-op (probe bails,
   `enforce:false`).
7. **empty-baseline never blanks the page (CL-1).** Force `readDocBodyAtVersion(pageId, av)` to return an
   empty/`content:[]` doc (stub). NON-approver edit in revert mode. Assert: NO write, page body UNCHANGED
   (the tampered content stays rather than being blanked), an error is logged. Blanking is the one
   whole-page destruction path — it must be impossible.
8. **stale-approval fail-closed (Gap A).** Multi-approver (`mode:"all"`). Approvers review V5. A NON-approver
   edits body → V6. Last approval vote lands. Assert: the transition does NOT complete (outcome `"stale"`),
   `approvedVersion` is NOT set to V6, approvals are cleared/re-opened, and the read model reports `stale`.
   A later tamper laundering is impossible because V6 never became the baseline.
9. **capture fail-closed on null version (Gap B).** Stub `fetchLivePageVersion` to return `null` at
   completion. Assert: the transition does NOT enter enforce (no `enforce:true, approvedVersion:null`
   record). Separately: seed a record with `enforce:true, approvedVersion:null` and run `workflowSweep()` →
   assert it SELF-HEALS (stamps the live version, `healed++`), does not skip.
10. **dropped-event AUTHORIZED edit is NOT reverted by the sweep (Gap C / CL-3).** Approve (V0). Simulate a
    dropped event for an APPROVER's edit → live V1 authored by APPROVER, `approvedVersion` still V0. Run
    `workflowSweep()`. Assert: it does NOT revert; it re-stamps `approvedVersion` to V1 (adopts the
    authorized edit), posts no "reverted your change" notice. Repeat with a NON-approver author → asserts it
    DOES revert/demote. Proves the author check.
11. **concurrency: stale-baseline revert avoided (Defect 4 / CL-2).** Approve (V0). Approver edits → V1 and
    its reconciliation re-stamps `approvedVersion=V1`. A near-simultaneous non-approver event whose probe
    captured the OLD baseline runs `enforceApprovedStatePass`. Assert: because the pass RE-READS
    `approvedVersion` fresh, it reverts to V1 (approver's sanctioned content), never back to V0. (Drive by
    ordering the KVS writes so the re-stamp commits before the pass's re-read.)
12. **revoked approver loses edit privilege (Gap E).** Approve with `approvers=[X]`. Remove X from the
    space's configured approvers. X edits the Approved page. Assert: X is treated as NON-privileged (snapshot
    ∩ live config fails) → revert/demote fires. Confirms revocation is honored immediately.
13. **sweep coverage past 100 mixed-state indices (Gap D).** Seed >100 `workflow-idx-*` across draft/
    in_review/approved, only a few enforced past the first 100 rows. Run `workflowSweep()`. Assert every
    ENFORCED drifting page is still processed (cursor pagination reached it), not a truncated subset.

---

## 7. Manifest changes + scope confirmation

- `manifest.yml`: +1 `function` (`workflow-sweep-fn` → `boot.workflowSweep`), +1 `scheduledTrigger`
  (`workflow-sweep-scheduled`, `interval: hour`). Four scheduled triggers now — verify Forge's per-app limit
  at build.
- `src/boot.js`: add `workflowSweep` to the triggers.js export line.
- No new `permissions`/`scopes`. Approver group expansion reuses `read:confluence-groups` (already held by
  #43); the versions-author read reuses existing `read:confluence-content` scopes; all body/property/comment
  writes are `asApp()` within already-consented write scopes; steward check reuses existing reads. No `llm`
  module change, no Preview API, no egress (R1). ⇒ **minor version bump only, no new consent.**
- New/changed record fields only: `approvedVersion`/`enforce`/`approvers`/`approvedAt`/`approvedBy` on
  `workflow-state-*` (+ property mirror), `enforceMode` on `workflow-settings-*`,
  `workflow-integrity-notified-*` dedup, one scheduled function. F44 NEVER writes `section-snapshot-*`,
  `section-protection-*.contentHash`, or `protection-*.sealedVersion` — it only *re-stamps* `approvedVersion`
  (§2.7) and *suppresses* SV-M5 re-baselining while enforced.

---

## 8. Confidence flag (mandatory honesty)

- **HIGH confidence:** demote default; the anchor rule (§0.A) and its post-write reconciliation (§2.5); the
  cheap probe + `hasBodyWork` extension; loop safety (two independent stops); the sweep as a
  cursor-paginated, author-aware, self-healing backstop; the `isOperatorSteward(spaceKey)` fix (Gap G, a
  verified phantom removed); fail-closed capture (Gap B); empty-baseline guard (CL-1); history-link recovery
  (CL-6).
- **MEDIUM-HIGH confidence:** stale-approval fail-closed (Gap A / §1.5) — correct model (Comala-style), but
  it changes approval-completion behavior and needs scenario 8 to confirm no legitimate completion is
  wrongly rejected; seal-after-approval re-stamp (Defect 2 / §2.7) — the re-stamp-on-seal-creation approach
  is simpler and safer than selective merge, but the temporal invariant (baseline ⊇ all seals) rests on the
  re-stamp firing on every seal write, proven only by scenario 4b.
- **LOWER confidence, flagged bluntly:** the REVERT-mode Pass-0 short-circuit is still the deepest surgery
  in the repo's most delicate file. The fragile joints: (a) `ctx.enforcedRevert` must suppress ALL three
  section-pass snapshot branches; (b) the §2.5 reconciliation must re-stamp on EVERY sanctioned outcome or
  the sweep churns; (c) the concurrency re-read in §2.3 must actually see a just-committed approver re-stamp
  (KVS strong consistency on a keyed `get` — verified the codebase relies on this same guarantee in
  `readApprovalRecords`). These are why REVERT ships opt-in and MUST pass scenarios 1–5 and 7–13 before it is
  ever considered as a default. Pattern-following is not proof here.

---

## 9. Critic-objection resolution ledger (objection → resolution → where)

| # | Objection | Resolution | Location |
|---|---|---|---|
| CL-1 | Empty/missing `approvedAdf` blanks the whole page | Guard `!approvedAdf?.content?.length → abort, no write`; same guard in sweep revert | §2.3, §4.3, scen 7 |
| CL-2 | Concurrent approver edit reverted by in-flight tamper (stale baseline) | Revert pass re-reads `approvedVersion` strongly-consistent each attempt | §2.3, scen 11 |
| CL-3 | Sweep blindly shreds a legit edit on a dropped re-stamp | Sweep fetches live-version author, runs privileged check, adopts (re-stamps) authorized drift | §4.2, §4.4, scen 10 |
| CL-4 | Missing `eventVersion` leaves baseline behind a sanctioned edit | Privileged path re-stamps post-write to observed live (fallback `fetchLivePageVersion`) | §2.5, scen 2 |
| CL-5 | Empty approver set + revert shreds every edit (engine, not just UI) | Engine downgrades revert→demote when `approvers` empty; sweep guards too | §2.1 step 4, §4.2, §2.4 |
| CL-6 | No one-click recovery for reverted editor | Revert comment includes `viewpreviousversions.action?pageId=` link (triggers.js:526 pattern) | §5, scen 1 |
| CL-7 | Forgeable 32-bit FNV equality guard | Confirm structurally with `canonicalizeAdf` before trusting hash equality (mirror SV-M7) | §2.3 |
| D1 | Pre-pass re-stamp collides with a same-event seal write → sweep ping-pong | NEVER stamp in probe; `action:"privileged"` + post-write reconciliation to observed version | §2.1 step 3, §2.5, scen 2 |
| D2 | Seal created after approval stripped by revert + suppression (deadlock) | Re-stamp `approvedVersion` to live on seal creation on an enforced page → baseline ⊇ seals | §2.7, §0.F, scen 4b |
| D3 | `restampApprovedTo` pre-write guess mismatches actual written version | Re-stamp from OBSERVED `writtenVersion`/live in every branch; drop the guess | §2.5 |
| D4 | Concurrency lost-update reverts a sanctioned edit | Same as CL-2 — fresh re-read of the baseline in the revert pass | §2.3, scen 11 |
| A | `approvedVersion` freezes a version nobody approved (edit during window) | Approval path anchors to quorum-reviewed `pinnedVersion`; completion fails closed on drift; wire `stale` | §1.5, scen 8 |
| B | Null `approvedVersion` fails OPEN, never self-heals | Capture fails the transition on null; sweep self-heals a null baseline instead of skipping | §1.5, §4.2, scen 9 |
| C | Sweep reverts an authorized edit whose event was dropped | Author check in the sweep (same as CL-3) | §4.2, scen 10 |
| D(Gap) | Sweep truncated at 100 rows across mixed states | Cursor-paginate to completion (iteration-capped), skip non-enforce early | §4.2, scen 13 |
| E | Revoked approver keeps edit privilege | Privileged = snapshot ∩ current configured approvers (or steward) | §0.D, §2.1 step 3, scen 12 |
| F | App self-write on a privileged edit drifts, sweep reverts it | Reconciliation re-stamps on ANY confirmed app write to an enforced page | §2.5 |
| G | `realmKeyFor(record.spaceKey)` is a phantom (ReferenceError) | Use `isOperatorSteward(atlassianId, record.spaceKey)` (realmKey ≡ spaceKey) | §0.E, §2.1 step 3 |

---

## 10. FINAL DECISIONS (decisive summary)

1. **Safest default: DEMOTE.** REVERT is per-space opt-in, gated behind scenarios 1–5 and 7–13. (Demote is
   provably non-destructive — no body write, verified.)
2. **Anchor rule (the root fix):** `approvedVersion` is set ONLY from (a) the quorum-reviewed `pinnedVersion`
   at completion, fail-closed on drift, or (b) an observed post-write / live version in the single §2.5
   reconciliation. Never a pre-pass guess, never a frozen copy — the revert pass re-reads it strongly-
   consistent inside its retry loop.
3. **Pipeline placement:** Pass 0 (`enforceApprovedStatePass`) runs FIRST inside the existing Phase-2
   single-read→passes→single-write loop; `ctx.enforcedRevert` short-circuits Pass A/B and suppresses all
   three SV-M5 branches; one `writeDocBody`, one message.
4. **Seal-safety:** post-approval seals are kept valid by re-stamping the baseline on seal creation (§2.7),
   so the blanket suppression can never strip a newer seal.
5. **Loop safety:** T1 self-write guard (primary) + content-equality/re-stamp fixed point (backstop); demote
   writes no body.
6. **Backstop:** hourly `workflowSweep` — cursor-paginated, author-aware (never reverts an authorized
   dropped-event edit), self-healing (repairs a null baseline), dedup-guarded, empty-baseline-safe.
7. **Steward check:** `isOperatorSteward(atlassianId, record.spaceKey)` — `realmKeyFor` deleted (phantom).
8. **Harness gates for REVERT:** scenarios 1–13; 7–13 are the critic-mandated destruction/authority proofs.
