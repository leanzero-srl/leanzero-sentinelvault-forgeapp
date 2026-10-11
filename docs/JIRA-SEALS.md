# Sealing Jira attachments (8.0)

Sentinel Vault protects Confluence attachments by sealing them: the file is held by its sealer, and if
someone else deletes it the app puts it back. 8.0 extends the same protection to the attachments of
Jira issues. This page is the design record: what was measured, what was decided and why, and what
was deliberately left out.

## What Jira does differently, measured on wolfaenpak (2026-10-11)

| Fact | Measured | Consequence |
|---|---|---|
| One app across both products | `app.compatibility` with Confluence required and Jira optional; `forge install list` shows ONE installation, `Confluence (Required), Jira` | One installation id, one storage, one set of settings. Billing follows Confluence seats. |
| Storage is shared | a key written by the Jira-side trigger was read by the Confluence-side web trigger | Jira seals live in the same KVS as Confluence seals, under their own prefix. |
| Jira has no trash and no attachment versions | REST v3 has no restore; a deleted attachment's bytes are gone | The app keeps its own copy of every sealed file, in the Forge Object Store. |
| `avi:jira:deleted:attachment` payload | `atlassianId` (the person who deleted), `attachment.{id, issueId, projectId, fileName, size, mimeType, author.accountId}`, `selfGenerated`; delivered in about a second | The trigger knows who deleted and on which issue, with no changelog read. |
| `avi:jira:created:attachment` for the app's own upload | `selfGenerated: true`, author = the app's account | A restore can never loop on its own event. |
| Download from a backend | `GET /rest/api/3/attachment/content/{id}?redirect=false` → 200 with the bytes | |
| Object Store from a backend | `createUploadUrl` → host `tdp-os.services.atlassian.com`; global `fetch` PUT → 201; download identical byte for byte; no egress entry needed | |
| Upload from a backend | a hand-built `multipart/form-data` body (field `file`) on `POST /rest/api/3/issue/{key}/attachments` with `X-Atlassian-Token: no-check` → 200, author = the app | A restored file gets a NEW attachment id. The seal follows it. |
| `requestConfluence` from a Jira-side invocation | 200 | Shared helpers (user names, activity) work from either side. |
| `POST /rest/api/3/permissions/check` as the app | 403 "Only Jira administrators and Connect apps can perform this operation" | The app cannot check another person's Jira permissions. Resolvers ask Jira AS THE CALLER (`GET /rest/api/3/mypermissions?issueId=…`). |
| Runs on Atlassian | `forge eligibility` lists only the dev-only harness web trigger | The Object Store, the Jira scopes and the Jira modules keep the badge. |

## The rules

1. **Who may seal.** Anyone who may EDIT the issue (`EDIT_ISSUES`) and can see it. The bar is the
   caller's own permission, asked of Jira as the caller — the app never lends its reach.
2. **What a seal is.** `jira-protection-{attachmentId}`: owner, issue, project, file name, size,
   SHA-256, the Object Store key of the copy, expiry, note. The copy is taken when the seal is set; a
   file that cannot be copied is not sealed (a seal that cannot restore would be a promise the app
   cannot keep). Files above 25 MB are refused for the same reason: the copy must finish inside one
   resolver call.
3. **What happens on delete.**
   - The owner deletes their own sealed file → the seal is released (owner intent), the copy deleted.
   - The seal has expired → nothing is restored; the seal and its copy are cleaned up.
   - Anyone else deletes it → the trigger queues the restore (`jira-restore-queue`, a 300 s consumer:
     a product trigger cannot take a custom timeout); the consumer uploads the copy back to the same
     issue under the same name, the seal moves to the new attachment id (`originalAttachmentId`
     keeps the first one, `restoreCount` counts), and a comment on the issue tells the person who
     deleted it, and the owner when comments are on (one comment per seal per ten minutes).
   - A restore is crash-safe: an intent row is written before the upload, and a retry ADOPTS the
     app's own upload (same name and size, after the intent) instead of uploading twice.
   - A restore that fails (Jira error, missing copy) is never final: the seal is kept on the dead id
     (`jira-seal-lost-<id>`), the panel shows it as "Not put back" with "Put it back", the hourly
     sweep retries (1 h, doubling to 24 h, 10 tries), and the lapse rules never release it. Only a
     person lets it go: the owner, or an admin with a reason.
   - Delete-loop breaker: a fourth restore of one seal inside an hour is not made (an Automation
     rule that deletes a file type would otherwise loop for ever); the seal is "lost / loop" and the
     owner puts it back by hand after fixing the cause.
   - The issue itself is deleted → nothing can be restored (Jira deletes the issue's attachments
     without one event each); the seals become orphans: record and copy are kept 30 days, the owner
     sees them on My work and can download the copy (a short-lived Object Store link), then the
     sweep ends them.
   - A copy whose delete fails is not forgotten: `deleteCopy` leaves `jira-seal-copy-gc-<id>` and
     the hourly sweep retries it under the seal's lock, never deleting a copy a live seal uses again.
     The sweep keeps its place in the seal list (`jira-seal-sweep-cursor`), so a site with more seals
     than one run's 100 s budget is covered over several runs instead of always from the top.
     Deleted Object Store objects stay recoverable by Atlassian for 21 days (Forge's own policy).
   - A space or project admin is NOT exempt, exactly as on Confluence's attachment path: release
     first, then delete.
   - One lock per seal (`jira-seal-restoring-<id>`) serialises restore, release, extend and the
     sweep's release; every writer re-reads under it.
4. **Release, extend, force release.** The owner releases and extends. A steward — a Jira
   administrator (`ADMINISTER`) or an administrator of the issue's project (`ADMINISTER_PROJECTS`) —
   may extend and force-release with a typed reason, only while the site setting "Allow space admins
   to force-unseal" (`allowAdminOverride`) is on. When the issue has moved since it was sealed, the
   steward must ALSO administer the project the seal was set in (moving an issue into a project
   you administer does not hand you its seals). The site setting "Signed seal actions" applies to
   the panel's actions as it does on Confluence; the REST API, as for every Confluence op, does not
   ask for a code (its tokens are site-admin only).
5. **Expiry.** The site's hold policy applies (`defaultLockDuration`, the lapse reminders
   `lapseNoticeLimit` / `lapseNoticeIntervalHours`, and the auto-release switch; turning auto-release
   back on extends Jira seals by the pause like Confluence ones). Reminders are issue comments
   mentioning the owner; a reminder Jira refuses for good (4xx) counts as given, a 5xx / 429 holds the
   countdown. After the last one the seal is released and the copy deleted. The hourly index cron
   runs the Jira sweep after the backup check, under one lock and a 100 s budget (Forge allows five
   scheduled triggers and the app uses five).
6. **Audit.** Every seal event is written to the activity log under `activity-issue-{issueId}-` (the
   project leg was dropped in review: nothing read it); the issue's panel shows the last ones.
7. **Personal data.** A seal record holds its owner's account id and display name (`lockedByName`,
   refreshed or erased by the privacy sweep); the activity log holds account ids only. The weekly privacy
   sweep reads the whole store, so Jira seals are reported and erased with the rest, and the issue
   history (`activity-issue-`) ages out with the history retention setting. The issue property names
   no one. Comments the app posted on issues are Jira's data (a closed account shows as Former user).
8. **Backup.** Seal records, the issue and owner indexes and the "not put back" rows are backed up;
   the file COPIES are in the Object Store and are not. After a restore of the backup, a seal whose
   copy is gone fails safe: a later delete is reported "not put back" (the SHA-256 check never
   uploads wrong bytes). A restore that re-keys a seal schedules a backup.

## Surfaces

- `jira:issueContext` "Sentinel Vault" on every issue: the issue's attachments, each with its seal
  state and ONE primary action (Seal / Release / sealed by someone else), extend and force release
  under ⋯, a hold-period picker and a note, and the issue's recent seal history.
- REST: config-api content ops `seal-jira-attachment`, `release-jira-attachment`,
  `extend-jira-attachment` (the caller is the token's minter, every gate applies unchanged).

## Measured after the reviews (2026-10-11)

- Restores through the queue: three real deletes put back byte-identical; the fourth inside the
  hour stopped by the breaker; Put it back restored it.
- A restore with its copy removed: kept as "Not put back", never released by the sweep, the owner
  let it go.
- An issue deleted with a sealed file: the seal became an orphan, My work listed it, the owner
  downloaded the copy byte-identical through `createPublicDownloadUrl`; someone else was refused.
- `forge lint`: a product trigger function cannot take `timeoutSeconds` (only consumers and
  scheduled triggers) — hence the restore queue.
- `GET /rest/api/3/user/permission/search` (the REST path's permission read) takes `issueKey` /
  `projectKey`, not `issueId`, and project permissions only.

## Not in 8.0, on purpose

- **Edit requests.** On Confluence a request asks for leave to upload a new VERSION of a sealed file.
  Jira attachments have no versions, so there is nothing to grant; the owner releases instead.
- **Sealing at issue creation.** Jira does not send the attachment event for files added in the
  Create dialog (a known Jira issue), so a seal can only be set once the issue exists — which is
  what the panel does anyway.

## Installing

Production admins accept the 8.0 permissions on Confluence, then connect Jira under Atlassian
Administration → Apps → Sites → the site → Connected apps → Sentinel Vault → Connections tab, where Jira is
listed as "Jira Apps" next to Confluence (Required); checked on leanzero-demo 2026-10-11. Without that step nothing
Jira-side runs and nothing else changes.
