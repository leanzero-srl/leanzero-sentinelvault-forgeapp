# Tier B — design contracts (owner said "do the Tier B items too now", 2026-09-05)

Order: B4 label sync → B2 read confirmations → B3 e-signature (TOTP) → B1 definition editor +
label-scoped workflows. **B5 (outbound webhook) is NOT built**: it needs an egress permission,
which is a major version, a re-consent on every install, and the end of "Runs on Atlassian" —
the app's headline compliance property. That trade is the owner's to make explicitly; it is not
inside "do the Tier B items". Everything below adds NO scope (minor version, like it61–it66).

## B4 — label sync (ledger #57)
- Space setting `syncLabels` (default off). Label `sv-state-{stateId}` (lowercase `[a-z0-9-]`).
- `workflow/label-sync.js`: `syncStateLabel(pageId, stateId)` — v1 `POST /content/{id}/label`
  as the app (`write:confluence-content`, the scope `label-artifact` already uses), then removes
  every other `sv-state-*` label (`DELETE /content/{id}/label?name=`). Best-effort, never throws,
  stamps `record.labelState` so the sweep does not re-fetch labels hourly.
- Called after `persistState` in `transitionPageWorkflow` and `assignPageWorkflow` when on.
- `workflowSweep`: on → rows whose `labelState !== stateId` get synced (backfill after enabling);
  off → rows with a `labelState` get their `sv-state-*` labels removed and the stamp cleared.
- Why labels: content-property CQL does not parse on Forge (probed 2026-09-05); a label is what
  Content by Label / Page Properties Report / CQL `label = "sv-state-approved"` can filter on.
  Comala does the same. Loop safety: the label write is the app's own account, which the page
  trigger already ignores.

## B2 — read confirmations (ledger #58)
- Space setting `readConfirmation: { enabled, audience: [{type:"user"|"group", id, name}] }`.
  Required while a page is in an ENFORCE state (Approved): "I have read version N".
- `read-ack-{pageId}-{accountId}` = `{ version, at, name }` (no TTL: evidence). Written by
  `confirm-read` (caller = context account, canReadPage; version = the page's approvedVersion).
  A new approved version needs a new ack (the ack carries the version it was for).
- `get-read-status` (page): `{ required, myAck, version, audienceCount, ackedCount }` — counts for
  everyone (canReadPage), names only for a steward (`get-read-report`: who has / has not, per
  member, group members expanded via the approvals module's `fetchGroupMembers`).
- Ribbon: "Confirm I've read v{N}" button → chip "Read v{N} ✓"; steward sees "Read by 3 of 7"
  with a dialog listing names. Activity row `workflow.read-confirmed`.
- Dashboard: an "Unread" count column is NOT added (report per page is enough for v1).

## B3 — e-signature, TOTP (ledger #59)
- Forge has no re-authentication API, so the honest signature is a TOTP the app enrols itself:
  `shared/totp.js` (pure: base32, HOTP/TOTP RFC 6238, ±1 step, node `crypto`), unit-tested with
  the RFC test vectors.
- `sig-secret-{accountId}` (enrolled), `sig-enroll-{accountId}` (pending, 15-min TTL),
  `sig-last-{accountId}` (last accepted time-step → replay refused).
- Resolvers: `signature-status`, `enroll-signature` (secret + otpauth URI; QR drawn client-side
  from the URI with the `qrcode` package, no egress), `confirm-signature-enrollment` {code},
  `revoke-signature`.
- Space setting `requireSignature` (default off). When on, `decide-approval` REQUIRES `code`;
  the decision record gets `signature: { method:"totp", verifiedAt }`; the approval record's
  decisions carry `signed: true`; the ribbon dialog shows a code field and the record dialog
  shows "signed". Enrolment lives on the My-work page (per-user).
- Not Part 11 — no claim of that. It is "the approver proved possession of an enrolled device".

## B1 — definition editor + label-scoped workflows (ledger #60)
- Editor on the space console Workflow tab: states (name, colour, initial, enforce,
  reviewAfterDays), transitions (per-state checkboxes), dead-end warning (existing
  `findDeadEndStates`), save via existing `store-workflow-config` (space scope). Renaming a
  state id is refused while pages sit in it (index count).
- Label-scoped workflows: `workflow-def-space-{key}-{workflowId}` for additional definitions;
  `settings.labelWorkflows = [{ workflowId, labels: [...], priority }]`. Auto-assign picks the
  highest-priority workflow whose labels intersect the page's labels, else the space default.
  `resolveWorkflowDef(spaceKey, workflowId?)` — the page record's `workflowId` is honoured at
  every call site (transition, sweep, dashboard, read model).
