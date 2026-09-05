# A1 — Document Activity per page + space Activity report with CSV (ledger #49)

Design-first, 2026-09-05. Comala parity item: their "Document Activity" (per page, full-page view,
CSV) and "Document Report" (space, filters, CSV). Ours covers protection events too, which is the
point: the record shows what was *enforced*, not only what was decided.

## What is recorded

One durable entry per event, written by ONE helper, `src/server/infra/activity-log.js`
`recordActivity(entry)`. No TTL (compliance record, like `workflow-log-*`). Two keys per entry so
both readers use their own prefix (K1 index discipline — never a site-wide scan filtered client-side):

```
activity-page-{pageId}-{invTs}-{rand}      per-page feed
activity-space-{spaceKey}-{invTs}-{rand}   per-space report
invTs = String(9999999999999 - Date.now()).padStart(13, "0")   → newest sorts FIRST on a prefix query
rand  = 6 base36 chars
```

Entry value:
```
{ id, ts (ISO), type, pageId, spaceKey,
  actor:  { accountId|null, name|null },            // who did it; null = the app (sweep/trigger)
  target: { kind: "attachment"|"section"|"page", id, name },
  details: { ...small, type-specific },             // ≤ 1 KB; never page bodies
  version: number|null }                            // page version the event refers to, when known
```

Types (exact strings — the UI formatter switches on them):
```
seal.created  seal.released  seal.forced  seal.extended  seal.auto-released
seal.edit-reverted  seal.trash-restored  seal.embed-restored  seal.presentation-restored
seal.deleted  seal.revert-failed
section.sealed  section.released  section.restored  section.reverted
editreq.requested  editreq.approved  editreq.denied  editreq.revoked   (details.scope: "attachment"|"section")
workflow.transition            (details: from, to, fromName, toName, reason, approvedVersion)
workflow.approval-requested    (details: to, toName, approvers[], mode, min, pinnedVersion)
workflow.approval-decided      (details: decision, reason, versionAtDecision, outcome)
workflow.enforced              (details: mode: "revert"|"demote", editor, approvedVersion, restoredTo)
workflow.expired
validation.reverted            (details: violations[] labels, restoredTo)
validation.gate                (details: state: "passed"|"failed", violations[] labels)
```

## Where it is written (every site names the actor it already knows)

sealing/actions.js: sealArtifact, unsealArtifact, extendSeal · realms/actions.js: stewardUnseal ·
sealing/release.js: releaseSeal (auto-release path only, with `notify` caller passing the reason) ·
section-seals/actions.js: sealSection, unsealSection · editreq/actions.js: request/approve/deny/revoke
(both scopes) · triggers.js: handleSealedArtifactEdit (edit-reverted / revert-failed), trash handler
(trash-restored), deleted handler (seal.deleted), restoreMediaPass (embed-restored, presentation-restored),
restoreSealedSectionsPass (section.restored / section.reverted), postEnforceComment (workflow.enforced /
workflow.expired), runValidationPhase (validation.reverted, validation.gate on change only) ·
workflow/logic.js transitionPageWorkflow (workflow.transition) · workflow/approvals.js
requestApprovalTransition (approval-requested), decideApproval (approval-decided).

Best-effort everywhere: `recordActivity` never throws to its caller (catch + console.warn). It must
never sit between a dedup claim and its side effect (T6 corollary).

## Resolvers (registry)

- `get-page-activity` { pageId, cursor?, limit≤100 } → { entries[], nextCursor }.
  Gate: `mustVerify(payload.pageId, ctx)` → `canReadPage`. Merges nothing else: the legacy
  `workflow-log-*` stays readable through `get-workflow-log`; history before A1 shipped is not
  back-filled (documented).
- `get-space-activity` { spaceKey, cursor?, limit≤100, types?[], since?, until?, pageId?, actorAccountId? }
  → { entries[], nextCursor, scanned }. Gate: `isOperatorSteward(accountId, spaceKey)`. Filters are
  applied server-side per fetched page (a page may return fewer than `limit`; the cursor continues).
- Test-hook seams: `fn=getPageActivity` (pageId, actor) · `fn=getSpaceActivity` (spaceKey, actor, types
  csv, since, until, pageId).

## Surfaces

- Kit: `src/ui/kit/ActivityFeed.jsx` (list, "Show more", empty state, error state) +
  `src/ui/kit/activity-format.js` (type → { label sentence, glyph, tone }) — one formatter, three surfaces.
- Inline panel: new group **Activity** after Sealed Sections. Latest 10, "Show more".
- Overlay: **Activity** section under the attachments table (same kit).
- Realm console (steward): new tab **Activity**: filter row (category chips: Seals · Sections · Edit
  access · Workflow · Validation; date preset: 7d · 30d · 90d · all; page-title contains), table
  (When · Event · Page · Who · Target · Details), "Load more", **Export CSV** (walks the cursor to a
  5,000-row cap, then a client-side Blob — no egress, same as the workflow dashboard).
- Copy is Confluence-native (space, group, file, section). Brand rules: solid tones, no left rails,
  custom dropdowns only.

## Non-goals

No back-fill of pre-A1 history; no per-user activity page (A7 later); no email; no external export.

## Proof

- Unit: key builder ordering (newer → smaller invTs), formatter covers every type, filter predicate.
- REST spec `activity-log.spec.ts`: seal → extend → request → deny → unseal on the fixture via seams
  produce entries in newest-first order on the page feed AND the space feed; type filter; Gabriela
  refused on both (page she cannot read; space she is no steward of).
- Browser spec `activity-surfaces.spec.ts`: panel group renders the entries; realm Activity tab renders,
  filters, and the CSV download carries the rows.
