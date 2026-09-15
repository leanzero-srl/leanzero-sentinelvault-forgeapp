# Sentinel Vault — #47 & #46 Solution Synthesis

Synthesized from the five research files in this directory (content-status-api.md,
app-scopes.md, validation-engine.md, comala-behavior.md, llm-precedent.md). Everything
below is web-verified in those files (not training). All paths absolute; repo path has a
space — quote it.

---

## #47 — Native content-state mirroring

### VERDICT: BUILDABLE. Native content status IS writable by a Forge app. **Confidence: HIGH** on writability.

Two independent research passes (content-status-api.md and comala-behavior.md) landed on
the same answer, citing Atlassian's own REST v1 docs, an Atlassian-staff confirmation on
the developer community, and the Forge `requestConfluence` reference. The colored status
pill Confluence renders in the page header (editor, above the title, and top of published
pages) is the **"content state"** feature, and it has a dedicated, writable v1 endpoint
that Forge fully supports. This is the real native indicator #47 targets — no macro, no
GraphQL hack, no content-property byline fallback needed as the primary path.

**Bonus differentiator (feasibility-independent, flag before external copy):** the
research (comala-behavior.md) says Comala does NOT mirror its workflow status onto the
native content-status badge — it keeps status in its own bar / content property, exactly
like Sentinel Vault does today. If true, "your workflow state shows up in native
Confluence, not just our app" is an honest differentiator. **UNVERIFIED-IN-THIS-PASS:** this
is a marketing/competitor claim sourced only to one research file; it was NOT independently
re-confirmed against a live Comala instance or Comala's docs. It does NOT gate buildability
(the native write stands on its own). Re-verify against a current Comala release before it
goes into any external/marketing copy.

### The endpoint

`PUT /wiki/rest/api/content/{id}/state?status=current`

- **v1 only** (`/wiki/rest/api/...`). There is no `/api/v2` equivalent — do not look for one.
- `status=current` sets the state on the published page and **auto-publishes a new version**
  (body unchanged). `status=draft` sets it on the draft only.
- Body: `{ "name": "In Review", "color": "<token>", "id": <optional existing id> }`.
  Resolution rule: `id` wins if present; else Confluence best-matches an existing custom
  state by `name`+`color`; else creates a new one **if the space allows custom states**.
- **Color format is the one live-probe item.** content-status-api.md reports UI palette
  tokens `B200`(blue)/`G200`(green)/`Y200`(yellow)/`R200`(red)/`P200`(purple);
  comala-behavior.md's GET/PUT examples show hex (`#57d9a3`). Probe the target site once to
  confirm which the PUT accepts, then pin it. This is the only unresolved detail and it is
  cosmetic, not gating.

### Scope cost: ZERO new scopes, no re-consent

The write rides `write:confluence-content`, which the app **already holds**
(app-scopes.md §1, used today for attachment labels). Read companion endpoints ride
`read:confluence-content.summary` (also already held). No manifest scope change → no major
version bump, no admin re-consent. This is a genuinely cheap feature to ship.

### Companion endpoints (for a clean, idempotent mirror)

| Method | Path | Purpose |
|---|---|---|
| GET | `/wiki/rest/api/content/{id}/state?status=current` | Read current native state (idempotency check) |
| PUT | `/wiki/rest/api/content/{id}/state?status=current` | **Set state** |
| DELETE | `/wiki/rest/api/content/{id}/state` | Clear state (on workflow clear) |
| GET | `/wiki/rest/api/space/{spaceKey}/state/settings` | Detect if custom states are disabled in the space |
| GET | `/wiki/rest/api/space/{spaceKey}/state` | Space-suggested states (consistent palette) |

Do NOT build on `GET /wiki/rest/api/content-states` (the user's custom-state list) — it is
browser-only and does not work from backend OAuth (content-status-api.md caveat 4). The PUT
write works fine from the backend regardless.

### Implementation path

**New file:** `src/server/capsules/workflow/native-state.js` — a thin mirror module modeled
exactly on the existing content-property writer
`writeStateContentProp` in `src/server/capsules/workflow/logic.js` (lines 148–182). That
function is the proven precedent for "best-effort, try/catch-wrapped, `asApp()`
requestConfluence write fired on every state change."

1. **Fixed state→(name,color) map** for the app's four states, solid/saturated per house
   style (Draft = grey, In Review = amber or blue, Approved = green, Expired = red — no
   pastels):
   ```js
   const NATIVE_STATE_MAP = {
     draft:    { name: "Draft",     color: /*grey token*/ },
     in_review:{ name: "In Review", color: /*B200/amber*/ },
     approved: { name: "Approved",  color: /*G200*/ },
     expired:  { name: "Expired",   color: /*R200*/ },
   };
   ```
2. **`mirrorNativeState(pageId, stateId)`** — idempotent:
   - `GET .../state?status=current`. If the current native `name`+`color` already equals the
     target, **skip the PUT** (this is the critical guard — see caveat 1). Otherwise PUT.
   - Wrap in try/catch; log and swallow on failure. KVS (`workflow-state-{pageId}`) stays the
     source of truth, exactly as the content property is today — the native pill is a
     best-effort projection, never a dependency.
3. **`clearNativeState(pageId)`** — `DELETE .../state` when the workflow is removed from a page.
4. **Call site:** invoke `mirrorNativeState` from **`persistState` in
   `src/server/capsules/workflow/logic.js` (~line 198)**, right beside the existing
   `writeStateContentProp` call. That single function already runs on every assign AND every
   completed transition, so mirroring there keeps the native pill in lockstep with the KVS
   state for free — no second call site, no drift.
5. **On enable / graceful degradation:** when a space enables the workflow, optionally
   `GET /space/{spaceKey}/state/settings`. If custom states are disabled in that space, the
   PUT of a new name/color will fail — degrade to the label fallback below (or surface a
   one-time admin nudge: "enable these 4 statuses for this space"). Detect, don't crash.

### Caveats to design around (from research, honest flags)

1. **Every PUT publishes a new page version.** Mirroring on each transition churns version
   history AND interacts with #44 (revert-on-tamper / enforced Approved): a mirror write is
   itself a version bump that could trip tamper detection or a version-watching trigger. The
   idempotent GET-then-skip guard in step 2 is not optional — it prevents runaway versions and
   limits writes to genuine state changes. **This interplay with #44 is the one piece needing
   live testing on wolfaenpak — LOWER confidence here**, and it is a real correctness risk, not
   cosmetic.
2. **`asApp` vs `asUser` for the write.** content-status-api.md caveat 2 notes
   `requestConfluence().asApp()` content writes can require app-acceptance context. The
   existing `writeStateContentProp` uses `asApp()` successfully for the property write, so
   `asApp()` is the first choice for parity; if the mirror runs from a userless async trigger
   and `asApp` is rejected in the target space, fall back to `asUser` inside the request that
   caused the transition. Verify during the AQL loop. **LOWER confidence on cleanest auth
   context.**
3. **Space admins can disable custom states** → the space-settings check + label fallback
   above.

### Fallback (only for spaces that disabled custom states)

Native **page label** via `POST /wiki/rest/api/content/{id}/label` (e.g. `state-approved`),
covered by the same `write:confluence-content` scope (app-scopes.md §3 — attachment labels
already use this exact v1 endpoint). Visible/searchable natively but weaker than the header
pill. Use ONLY as degradation, never as the primary path.

### Bottom line for #47

Ship on the **content-state PUT** as primary, idempotent, fired from `persistState`, zero new
scope. Label fallback only where custom states are disabled. The single thing to verify live
before calling it done: the version-bump interaction with #44, plus the color-token format.

---

## #46 — Transition conditions + AI review (UI: "transition conditions", never "gate")

### Design in one line

#46 is the app's **existing content-rules engine reused verbatim** (`evaluateRules`) plus the
**existing LLM worker lightly modified** (a new `gate` branch) invoked at a **different point** —
a state-change *request* instead of a post-save event — with a **different config home** (on the
transition, referencing the space validation ruleset, not a second rule list). The AI is not a
side system: it rides the **existing `workflow-pending-{pageId}` approval record** as a mandatory
review axis. Reuse `evaluateRules` and the whole `approvals.js` pending machinery unchanged;
*modify* the worker (small, honest); *do not* fork the pending/inbox read models. That discipline
IS the mitigation for the ticket's stated duplication risk — see the nine-finding resolution table
in Part C.

Market alignment (comala-behavior.md): "gate the transition until conditions pass" is exactly
Comala's model, so the behavioral spec is high-confidence. Comala gates on human approvals +
role/permission conditions + required-params; it ships **no automated content-quality or AI
gate**. So our AI content-review gate is a genuine differentiator — as long as it presents as
*one more transition condition* in the same list as "required content present" and "approvals
complete," not a parallel validation system.

### The integration point (exact)

**`requestTransition` in `src/server/capsules/workflow/actions.js` (~lines 94–155).** Today it
reads `pageId`/`actorAccountId`/`toStateId` → `readPageWorkflow` (authoritative spaceKey) →
`resolveWorkflowDef` + `findState(target)`, then either opens a multi-approver pending
approval (if `target.enforce` + approvers configured → `requestApprovalTransition` in
`approvals.js`) or validates the edge (`validateTransition`) and calls `transitionPageWorkflow`
directly. `validateTransition` checks **only the state-graph edge** — no content, no AI. **That
is the hook point.** The gate step slots in *before* the existing enforce/approval branch.

### Part A — Content conditions ("required content present"). REUSE, synchronous. **Confidence: HIGH.**

Reuse `evaluateRules(adfDoc, pageLabels, rules)` from `src/server/infra/rules-engine.js`. It is
**pure, synchronous, zero-I/O**, and returns `{ passed, violations }` where each violation is
`{ ruleId, label, severity, message }`. It already supports the 7 rule types the app ships
(`required-heading`, `required-table`, `required-macro`, `required-label`, `heading-hierarchy`,
`max-length`, `min-length`). It drops straight into the resolver:

1. In `requestTransition`, after `readPageWorkflow`/`findState`, resolve the target state's
   **gate config** (see Part C). If it carries content rules:
2. `const { adfDoc } = await readDocBody(pageId)` (the same helper `runValidationPhase` uses in
   `triggers.js:805`), fetch labels, then
   `const { passed, violations } = evaluateRules(adfDoc, labels, gateRules)`.
   **Label-fetch reuse fix (Aspect 1 minor).** `readDocBody`/`evaluateRules` are already shared
   in `infra/`, but `fetchPageLabels` is **private** to `validations/actions.js:25` (and the
   trigger has its own inline copy at `triggers.js:820`). Do NOT import it across capsules or
   copy it a third time — **hoist `fetchPageLabels` into `infra/doc-surgery.js`** (or a small
   `infra/labels.js`) so the workflow gate, the validations action, and the trigger all share one
   copy. Otherwise the "reuse" claim ships a duplicated helper.
3. If `!passed`, `return { success:false, reason:"Transition blocked", violations }` **before**
   `transitionPageWorkflow` / `requestApprovalTransition`. Same violation shape → the ribbon
   renders it with the existing validation-panel UI vocabulary.

`evaluateRules` fails `passed` **only** on `severity:"block"` rules, so gate rules must be
authored `severity:"block"` — its existing `passed` semantics then mean exactly "may
transition." **Zero change to `rules-engine.js`.**

### Part B — The AI gate. ASYNC, AI-as-a-mandatory-condition ON THE EXISTING pending record. **Confidence: LOWER — flag it.**

> **Correction (adversarial review).** An earlier draft of this section proposed running
> `aiValidationConsumer` "as-is" and minting a **separate** `workflow-gate-pending-{pageId}`
> record. Both are wrong and are corrected here. Verified against source:
> the worker is **not reusable as-is for a gate** (it reads the page *live* at consume time —
> `ai-worker.js:41` `readDocBody(pageId)` — with no version pin, and it **swallows errors
> without rethrow** — `ai-worker.js:93`), and a second pending-key family would **fork** the
> ribbon/inbox read models (`getPageApprovalStatus` reads `workflow-pending-{pageId}`,
> `approvals.js:215`; `listMyApprovals` scans `workflow-approval-` prefix, `approvals.js:234`).
> The design below eliminates both.

**Do NOT run the LLM inline in the resolver.** Both llm-precedent.md and validation-engine.md
are explicit, and `manifest.yml:87` confirms it: the AI review lives on the `ai-validation-queue`
**120s consumer** precisely because a Haiku call + 429/5xx retry can exceed the **25s resolver
limit**. A hard inline `await runForgeLlmJson(...)` in `requestTransition` gambles on <25s — the
bet the codebase already refused.

**The design: the AI is a mandatory review condition carried INSIDE the existing
`workflow-pending-{pageId}` record, AND-composed with the human approval quorum.** This is the
single highest-leverage decision — it collapses the version-pin bug, the double-transition bug,
the forked-inbox duplication, and the composition-order question all at once. It is the design's
own "robot approver" idea, wired correctly. Do **not** mint a second pending key.

Concretely, extend the existing pending record (same `workflow-pending-{pageId}` key,
`approvals.js:118`) with one sub-field:

```js
// inside workflow-pending-{pageId}, alongside approvers/mode/min/pinnedVersion:
aiGate: {
  required: true,
  status: "pending",       // pending | passed | failed
  threshold: "medium",     // severity bar
  reviewedVersion: null,   // the version the worker actually scored (fail-closed if != pinnedVersion)
  reason: null,            // finding summaries on fail, or "review failed — retry"
  enqueuedAt: 1720000000000,
}
```

Flow:

1. **Open (in `requestTransition`, target has `requireAi:true`):** reuse the *existing* enforce/
   approval branch (`actions.js:112-128`). `requestApprovalTransition` already pins
   `pinnedVersion = await fetchLivePageVersion(pageId)` and opens `workflow-pending-{pageId}`.
   Add `aiGate` to that same record and enqueue the AI job **carrying the pinned version**:
   `aiQueue.push({ body:{ taskId, pageId, spaceKey, mode:"gate", pinnedVersion, threshold } })`.
   If the target has `requireAi` but **no human approvers**, still open the pending record with
   `approvers:[]` + `aiGate.required` — one code path, AI-only gate. Return
   `{ pending:true, reason:"Review in progress" }`.

2. **Worker (gate mode — this is a MODIFICATION of the worker, stated honestly, not drop-in
   reuse).** Add a `gate` branch to `aiValidationConsumer`:
   - Read the **pinned** version's body, not live: `readDocBodyAtVersion(pageId, pinnedVersion)`
     (that helper already exists — used by the revert path, `triggers.js:860`). Record
     `reviewedVersion = pinnedVersion`. This fixes the version-pin bug (Finding 1): the AI scores
     exactly the bytes the human quorum reviewed and #44 will enforce.
   - On completion, write the verdict by **strongly-consistent get→set of
     `workflow-pending-{pageId}`** — set `aiGate.status = passed|failed` (pass = no finding at/above
     `threshold`, via existing `severityRank`), NOT the `ai-validation-status-{taskId}` row. This
     avoids the delete-on-read race with the UI poller (`getValidationJob` deletes on first
     terminal read, `actions.js:167`) — Finding 2.
   - **Error / parse-fail / LLM-fail branch must be a terminal, not a swallow.** The current
     worker sets `status:"error"` and returns without touching any gate (`ai-worker.js:53-64,88-94`).
     In gate mode it must instead set `aiGate.status = "failed"`, `reason:"AI review failed —
     retry"`. Fail-closed = **surface a terminal retry state**, never leave `pending` — Finding 3.

3. **Resolve (single consume-once path).** Completion of the transition fires only when
   **`evaluateApproval(human quorum) === "approved"` AND (`!aiGate.required` OR
   `aiGate.status === "passed"`)**. Route this through the *existing* `decideApproval`
   completion block (`approvals.js:180-204`) so it reuses, unchanged: the staleness re-check
   (`live !== pinnedVersion` → clear + "re-approval required", `approvals.js:189`), the
   consume-once guard (a record already non-pending returns "already recorded",
   `approvals.js:165` — this is what makes a **duplicate at-least-once delivery idempotent**,
   Finding 4), and `clearPageApprovals` on terminal. When the AI verdict lands, its get→set is
   the trigger to re-evaluate this compound condition; when a human votes, same. Whoever satisfies
   the last axis completes it — once.

**Composition is defined and deadlock-free (Finding 7):** AI and humans review the **same pinned
version in parallel**. A slow AI does not block humans from voting and vice-versa; the transition
simply waits until both axes are satisfied. No sequential "AI-then-humans" or "humans-then-AI"
ordering, so neither can starve the other.

**Reaper backstop for fully-dropped deliveries (Finding 3, second half).** The worker's terminal-
on-error branch covers a worker that *ran*; a Forge delivery that never arrives leaves `aiGate`
pending forever with no human backstop (unlike #43, an AI gate has none). Add `enqueuedAt` to
`aiGate` and a **scheduled reaper** (reuse the same scheduled-trigger mechanism #45's review-date
expiry uses): scan `workflow-pending-` records whose `aiGate.status === "pending"` and
`enqueuedAt` older than N minutes → set `failed`, `reason:"AI review timed out — retry"`. This is
the TTL the pending record otherwise lacks.

**Budget-exhaustion policy is an explicit, admin-visible toggle (Finding 5).** `enqueuePageValidation`
hard-blocks enqueue when `monthlyTokenBudget` is spent (`actions.js:145-149`). For a gate that
would mean **no page can ever reach Approved** once the budget is gone — an invisible permanent
block. So the gate config MUST carry `onBudgetExhausted: "block" | "allow-with-warning"`
(fail-closed vs fail-open), surfaced in the steward settings UI. Never a silent permanent block.

**Reused unchanged (no fork):** `runForgeLlmJson`, `buildValidationPrompt`, `normalizeFindings`,
`severityRank`, `accrueTokenUsage`, the `ai-validation-queue`, the Haiku-only adapter
(`forge-llm.js`), and — the big one — the entire `workflow-pending-`/`workflow-approval-`
pending/staleness/consume-once/inbox machinery in `approvals.js`. **Modified (stated honestly):**
`aiValidationConsumer` gains a `gate` branch (pinned-version read + get→set verdict + terminal
error), and `evaluateApproval`'s caller gains the AND-with-aiGate compound completion condition.
These are real, small modifications — not "reuse as-is."

**Why LOWER confidence (honest flag):** the residual risk is entirely in the async wiring under
Forge **at-least-once delivery + KVS eventual consistency** — specifically the get→set of the
shared `workflow-pending-` record from two writers (the worker's verdict and a concurrent human
vote) and the reaper-vs-late-worker race (reaper marks `failed` just as a slow worker writes
`passed`). Mitigations: strongly-consistent per-key `get` then `set` (never `kvs.query()` for
resolution — `approvals.js:132` already mandates this); the consume-once record-status guard makes
a double-complete a no-op; and the reaper must compare-and-swap (only flip `pending→failed`, never
overwrite a `passed`/`failed` the worker already set). I would **not** call #46 done without
exercising, live on wolfaenpak: (a) a stale-verdict race (page edited during review →
`re-approval required`), (b) a duplicate queue delivery (→ single transition), and (c) a
reaper/late-worker collision. The pattern is a copy of a proven one, which bounds the risk — but
this wiring is where a subtle defect would hide.

### Part C — What is NEW (thin) vs REUSED

**Terminology (Finding 9 — MANDATORY).** The app already ships a `gate` mode
(`ValidationsEditor.jsx:148`, a soft indicator: `runValidationPhase` `modes.gate` only writes
the `sentinel-vault-validation` content property — `triggers.js:831-844` — it does **not**
block), an `approve-page-gate` action, and a "Validate now" button. A second, oppositely-
behaving thing also called a "gate" (hard-block) would confuse at the word level even with clean
code. **Never surface this feature as a "gate" in the UI.** Call it **"transition conditions" /
"entry requirements."** ("gate" may persist as an internal code identifier only.)

**NEW (small, additive):**
- **Per-transition condition config** on the workflow def — a block on the *target state* in
  `workflow-def-*` / `workflow-settings-{spaceKey}`, e.g.
  `entryConditions: { rulesRef:"space" | ruleIds:[…], rules:[<override list>], requireAi:true, aiThreshold:"medium", onParseFail:"block", onBudgetExhausted:"block" }`.
  It **reuses the exact rule schema** (`type`/`config`/`severity`) `evaluateRules` consumes — no
  engine change. It lives **with the transition it gates — NOT in `validation-config-*`** (that
  key is the space-wide post-save policy; conflating them is the "confusing duplication" the
  ticket warns about).
  - **One authored rule list, not two (Finding 8).** A steward must not re-author the same rule
    (e.g. "required Rollback-plan section") once for post-save advisory and again for the
    transition. **Default: the entry condition REFERENCES the space validation ruleset**
    (`rulesRef:"space"`, optionally an opt-in `ruleIds` subset) so rules are authored once in the
    validations editor. A bespoke inline `rules` list is an **override only**, for a condition
    that genuinely differs from the post-save policy. The UI must make "reuse space rules" the
    obvious default, not present a blank second rule editor.
- **A condition step in `requestTransition`** — the synchronous content check (A) runs inline;
  when `requireAi` is set, the AI axis is carried on the pending record (B). Slotted at the
  existing enforce/approval branch (`actions.js:112`).
- **The worker `gate` branch** — the pinned-version read + get→set `aiGate` verdict + terminal
  error branch (Part B, step 2). **One** branch, writing into `workflow-pending-{pageId}`. There
  is **no** second pending-key family and **no** reading of the delete-on-read
  `ai-validation-status-` row.
- **The compound completion condition** — `evaluateApproval(quorum) AND aiGate` (Part B, step 3),
  plus the scheduled reaper for dropped deliveries.
- **UI** — surface "Cannot move to Approved yet: <reasons>" and "Review in progress" **inline on
  the ribbon's transition action** with live pass/fail per condition, reusing the violation/finding
  rendering already built for the validation panel. One workflow surface, never a separate
  "validation" screen. The AI pseudo-condition shows on the page ribbon but must **not** pollute a
  human's approval inbox (`listMyApprovals` filters on `approverAccountId` — an AI axis has none,
  so it is naturally excluded; confirm the read model doesn't invent an "AI" approver row).

**REUSED unchanged (no fork):** `evaluateRules` + all 7 rule types + rule schema + `doc-surgery`
walkers; `readDocBody` + (hoisted) label fetch; the LLM internals listed in Part B;
`validateTransition` + `transitionPageWorkflow` (the actual move, unchanged); and the entire
`workflow-pending-`/`workflow-approval-` pending/staleness/consume-once/inbox machinery in
`approvals.js` — **used directly, not merely as a template** (the AI rides the same record).

### Condition semantics (block vs warn)

Transition-condition rules are **block** by definition (`severity:"block"`, so
`evaluateRules.passed` maps exactly to "may transition"). Advisory/warn behavior stays where it
already lives — the post-save `advisory`/`gate` modes in `runValidationPhase`. Keep the two
planes separate: **post-save validation** (advisory/gate/revert, space-wide, reactive) stays in
`validation-config-*`; **transition conditions** (blocking, per-target-state, requested) live on
the workflow. Same engines, same authored rules (via `rulesRef`), two invocation points. That
separation — plus the single authored rule list and the single pending record — is the whole
anti-duplication design.

### UX when a transition is blocked (match Comala, exceed on the AI reason)

A clear, specific, actionable block telling the user *why* and *what to fix*: "Required section
'Rollback plan' is missing" / "AI content review did not pass: 2 issues found (<summaries>)" /
"AI review in progress — you'll be able to move to Approved once it completes." Conditions are
AND-composable ("required content present AND AI review passes"), rendered inline on the ribbon's
transition action with live pass/fail. Per-space config via the existing workflow settings
(`workflow-settings-{spaceKey}` / `getSpaceWorkflowSettings`).

### How the nine critic findings are resolved (one line each)

1. **Version-pin broken by live-read worker** → worker `gate` branch reads
   `readDocBodyAtVersion(pageId, pinnedVersion)`, records `reviewedVersion`; resolution re-checks
   `live !== pinnedVersion` via the existing staleness guard. **Resolved.**
2. **No gate-readable verdict / delete-on-read collision** → worker writes the verdict into
   `aiGate` on `workflow-pending-{pageId}` (get→set), never the `ai-validation-status-` row.
   **Resolved.**
3. **Permanent "in progress" deadlock (no TTL, swallowed errors)** → worker error/parse/LLM-fail
   branch is terminal (`aiGate.status="failed"`, retry reason) + a scheduled reaper flips
   long-`pending` records to `failed`. **Resolved.**
4. **Double-delivery double-transition** → completion routes through `decideApproval`'s
   consume-once record-status guard (`approvals.js:165`); a duplicate is a no-op. **Resolved.**
5. **Token-budget permanent block** → explicit admin-visible `onBudgetExhausted:
   "block" | "allow-with-warning"`. **Resolved.**
6. **Forked parallel pending/inbox system** → no `workflow-gate-pending-` key; AI rides the
   existing `workflow-pending-{pageId}` as an `aiGate` field, so ribbon + inbox read models work
   unchanged. **Resolved.**
7. **Undefined gate+approval composition** → AI and humans review the same pinned version in
   parallel; completion = `evaluateApproval AND aiGate`; neither starves the other. **Resolved.**
8. **Two authored rule lists** → entry condition `rulesRef`s the space ruleset by default;
   inline rules are override-only. Author once. **Resolved.**
9. **"gate" terminology collision** → UI says "transition conditions" / "entry requirements";
   "gate" is internal-only. **Resolved.**
- **Aspect 1 minor** (private `fetchPageLabels`) → hoist to `infra/`. **Resolved.**

### Bottom line for #46

Content conditions: reuse `evaluateRules` (sync, **HIGH** confidence). AI condition: async, the
AI is a **mandatory review axis carried on the existing `workflow-pending-{pageId}` record**,
AND-composed with the human quorum on one pinned version — this is a **small honest modification**
of `aiValidationConsumer` (a `gate` branch) plus a compound completion condition, **not** a
parallel pending system and **not** drop-in worker reuse (**LOWER** confidence). New surface is
thin: an `entryConditions` block on the workflow (referencing the space ruleset), a condition step
in `requestTransition`, the worker `gate` branch, the compound completion + reaper, and ribbon UI.
The correctness risk that matters is the async wiring (verdict get→set race, reaper/late-worker
CAS, stale-verdict re-approval) — flagged, bounded by riding the proven approval pattern, and
requiring the three live races exercised on wolfaenpak before it is called done.

---

## FINAL VERDICT

**#47 — Native content-state mirroring: BUILDABLE.**
Approach: mirror the workflow state onto Confluence's native content-status pill via
`PUT /wiki/rest/api/content/{id}/state?status=current`, fired idempotently (GET-then-skip) from
`persistState` beside the existing `writeStateContentProp`, on the `write:confluence-content`
scope the app **already holds** (manifest.yml:173) — zero new scopes, no re-consent. Native write
is confirmed against live Atlassian v1 docs. Live-verify only: the color-token format
(hex vs `B200`) and the version-bump interaction with #44's tamper enforcement. Label fallback
(`POST .../label`, same scope) only where a space disabled custom states. The
Comala-doesn't-mirror differentiator is UNVERIFIED-in-this-pass — do not put it in external copy
without a fresh check; it does not gate buildability.

**#46 — Transition conditions + AI review: BUILDABLE.**
Approach: reuse `evaluateRules` verbatim for the synchronous content conditions; make the AI a
**mandatory review axis on the existing `workflow-pending-{pageId}` record** (an `aiGate` field),
AND-composed with the human approval quorum on one pinned version, resolved through the existing
`decideApproval` consume-once/staleness path — plus a small honest `gate` branch in
`aiValidationConsumer` (reads the pinned version, writes its verdict into `aiGate`, terminal on
error) and a scheduled reaper. This collapses all nine critic findings (see Part C table): no
forked pending/inbox key, version-pin correct, no permanent deadlock, idempotent under
double-delivery, explicit budget-exhaustion and parse-fail policies, one authored rule list
(`rulesRef` the space set), and UI named "transition conditions" not "gate."
**Confidence:** HIGH on the content-rule half; **LOWER on the async AI wiring** — the three live
races (stale-verdict re-approval, duplicate delivery → single transition, reaper/late-worker CAS)
must be exercised on wolfaenpak before it ships. Not blocked; flagged for extra verification.
