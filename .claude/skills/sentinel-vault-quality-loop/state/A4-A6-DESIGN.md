# A4 + A6 — Approval evidence on the page, and a link to the approved version (ledger #50, #51)

Design-first, 2026-09-05. Comala parity: their Document Approvals macro shows reviewer, decision,
date and the page version at decision; their dialog links "View Approved Version". Ours already
pins the version and records each decision — and then DELETES the per-approver records at finalize
(`clearPageApprovals`), so the evidence is gone the moment the approval succeeds. A4 keeps it.

Verified live 2026-09-05: `/wiki/pages/viewpage.action?pageId={id}&pageVersion={n}` renders the
historical version (200, "Version n"); the classic `viewpageversion.action` is a 404 on this site.

## Server (workflow capsule)

1. **Snapshot before clearing.** In `finalizeApprovedTransition` (approved) and in `decideApproval`'s
   denial branch, read the approval records (strong per-key, `readApprovalRecords`) and build
   ```
   approvalRecord = { outcome: "approved"|"denied", mode, min, requestedBy, requestedByName, requestedAt,
                      pinnedVersion, completedAt, completedBy, completedByName,
                      aiGate: { status, reason } | null,
                      decisions: [{ accountId, name, decision, decidedAt, reason, versionAtDecision }] }
   ```
   `versionAtDecision` = the record's `pinnedVersion` (the version the approver reviewed).
2. **Persist it.** `transitionPageWorkflow` gains an optional `approvalRecord` argument; when given it
   is stored on the state record as `record.approvalRecord` and put in the log entry's
   `details.approvalRecord`. Leaving an enforce state clears it (same as the enforce fields). A
   direct steward approval (no approvers) stores `{ outcome:"approved", decisions:[], completedBy,
   pinnedVersion: approvedVersion }` so the page always has an evidence block once approved.
3. **Denial is logged.** A denied approval writes a `workflow-log-*` entry `{ kind: "approval-denied",
   approvalRecord }` (today the denial leaves no durable trace once the records are deleted).
4. `get-page-workflow` returns the record unchanged (it already returns the whole record — verify);
   `get-workflow-log` entries carry `details.approvalRecord` where present.
5. The A1 activity entry `workflow.approval-decided` stays as is (one per decision); the transition
   entry gains `details.approvalRecord` for free through `transitionPageWorkflow`.

## Ribbon (doc-ribbon/index.jsx)

- When `workflow.record.enforce && workflow.record.approvedVersion`, render an **evidence chip** next
  to the state chip: label "Approved v{approvedVersion}", solid success tone, `aria-haspopup="dialog"`.
  It opens a panel (reuse the `.wf-appr-panel` dialog pattern: role=dialog, focus-on-open, Escape,
  outside-click, focus return) titled **Approval record** with:
  - "Approved for version {pinnedVersion} on {date} · {mode label}" (mode label: "any approver" /
    "all approvers" / "at least N approvers"; omitted for a direct steward approval, which reads
    "Approved by {name} on {date}").
  - one row per decision: name · **Approved** / **Denied** (solid tone) · date · quoted reason.
  - the AI review line when `aiGate` exists: "AI content review: passed/failed — {reason}".
  - **A6 link:** "View approved version (v{n})" → `${siteUrl}/wiki/pages/viewpage.action?pageId=${pageId}&pageVersion=${n}`,
    `target="_top"` (the ribbon is an iframe). `siteUrl` comes from `view.getContext()`.
  - **Stale line** when the live page version (from the workflow read, `record.liveVersion` if the
    server adds it cheaply; otherwise from `get-page-approvals`' `stale`) is above `approvedVersion`
    and the state is still enforced: "This page has changed since approval (now v{live}). Sentinel
    Vault will {revert|demote} unsanctioned edits." — using the space's enforce mode.
- The existing approval dialog (awaiting state) gets the same "View version {pinned}" link under the
  progress line, so an approver can open exactly what they are approving.
- Copy stays Confluence-native. No new colours: reuse the existing wf-chip success tone.

## Harness

- REST `approval-evidence.spec.ts`: throwaway page → assign → in_review → requestApproval (Mihai,
  any) → decideApproval approved → `getWorkflow` shows `record.approvalRecord.decisions[0]` =
  { Mihai, approved, versionAtDecision = pinned } and `completedBy`; the log's last entry carries it;
  a second page denied → the log has an `approval-denied` entry with the reason; leaving the state
  clears `approvalRecord`.
- Browser: extend `ribbon-approval-dialog.spec.ts` — after Approve, the "Approved v{n}" chip renders,
  opens, lists Mihai's decision with the reason typed in the dialog, and the "View approved version"
  link's href carries `pageVersion={n}`; navigating to it shows a page whose body says "Version {n}".
