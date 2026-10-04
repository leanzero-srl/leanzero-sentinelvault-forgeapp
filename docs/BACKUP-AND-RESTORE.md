# Backup and restore — the setup survives an uninstall (baseline pillar 12)

Built 2026-10-02 (product 6.6.0, dev 8.105.0). Owner's goal: a customer who uninstalls and reinstalls Sentinel
Vault, or loses it to a lapsed subscription, gets the whole setup back without a support ticket.

## Platform facts this rests on (measured, not assumed)

- Forge storage (KVS and KVS secrets) comes back EMPTY after a reinstall. Measured twice: on a throwaway app with
  this app's exact scopes (~/Projects/forge-uninstall-probe-confluence/RESULTS.md) and on Sentinel Vault itself
  (three dev uninstall/reinstall cycles on wolfaenpak, each fresh install held 0 keys).
- What survives: a page the app created, its attachments, content properties, label and page restrictions; the
  app's account id stays the same, so a page restricted to the app alone is still readable by the new install
  and a CQL label search finds it. A site admin gets 404 on that page.
- Forge app properties do not exist for Confluence (401); v1 space properties are gone (410); v2 space
  properties survive but every space viewer can read them, so they hold nothing private.
- Atlassian keeps an uninstalled app's storage 28 days and can re-link it within 21 days on a ticket from the
  vendor. The app used to WIPE its KVS in its own uninstall handler, which made that path restore nothing; the
  wipe is removed (Forge's own 28-day purge is the retention guarantee).

## What is backed up (src/server/capsules/backup/families.js)

Every KVS key family is classified once: `config` (backed up), `secret` (never), `runtime` (rebuilt by the app).
`test/backup-families.test.mjs` scans the source and fails the build on a key family nobody classified.

- Backed up: site and space settings, validation rules, workflow definitions and settings, classification levels
  and defaults, sealed files and sections with their section baselines, edit access and requests, page workflow
  states, open approvals and decisions, read confirmations, workflow history, activity history (page, space and
  site), AI review state and the month's AI budget, plus the lookup tables that have no rebuild path.
- Never backed up: REST API tokens, authenticator secrets and their counters. The backup lists token NAMES and
  roles and how many people had enrolled, so the restore says what to re-enter.
- Rebuilt, not backed up: caches, dedup markers, job receipts, scan status, timers' "already notified" flags.

## Where it lives (store.js)

One page per environment ("Sentinel Vault backup", "Sentinel Vault backup (development)"), created by the app in a
global space (an admin can move it), restricted (read and update) to the app's account before anything is attached,
labelled `sentinel-vault-backup`. A page is only ever treated as a backup page if the app created it, it carries
that title and it is restricted to the app alone.

## The format (snapshot.js)

A generation = a manifest attachment + content-addressed chunk attachments (`sv-chunk-<sha256>.json`). One full KVS
scan in key order, streamed into chunks of 128 KB-900 KB with content-defined boundaries, so a change re-uploads
only the chunk it lands in (measured: 1-9 of 30 files per backup after small changes). Each entry carries its KVS
expiry; a restore re-applies the remaining TTL and leaves out what has run out. The manifest lists every chunk's
sha256 and carries its own hash. An index content property holds the generations and every installation id that
wrote there. Kept: the newest 10 plus the newest generation of every earlier installation (so a reinstalled app's
own saves can never rotate the backup the admin came back for off the page).

Integrity is corruption detection: only the app can write the page, and every hash is checked before anything is
written. An imported file is trusted like a Confluence site import (site admins only).

## When it runs (hook.js, worker.js)

Every write resolver is wrapped once in the registry (`WRITE_ACTIONS`; `test/backup-hook.test.mjs` fails on an
action that is neither a write nor a read). A save raises a flag and queues ONE backup 90 s later. A REST bundle that
applied anything does the same. The hourly index cron checks once an hour (Forge allows five scheduled triggers and
the app has five) and backs up when something changed or a day passed, only in the Confluence installation (the app
is also installed in Jira for JSM Assets, and that install has its own empty store). Automatic runs record nothing
while a restore from an earlier installation is pending (14 days) and never an empty generation. One lease
serialises backup, restore, import and move.

## Restore (engine.js)

Preview from the verified manifest (counts per group, what comes back paused, which secrets to re-enter), then a
queued job: verify every chunk, take a "before restore" backup when the site is in use, write every backed-up key
back, pause the automations, record the restore. Paused on restore (they act on their own): seals expiring, validation
revert mode, AI review, workflow auto-assign, workflow review timers. "Turn back on" goes through the same resolvers
the console uses; turning seal expiry back on extends every seal by the time it was paused (from the backup's time on
a reinstalled site, from now on a site in use).

## Doors

- Site settings → Backup and restore (site admins): last backup, location, Back up now, Move, Delete, Paused after a
  restore, Restore list with preview, Download export / Import a file, what survives, the 21-day re-link path with the
  Site ID and installation ids, history. A purple banner on a reinstalled site: "Restore your setup from <date>".
- REST (config-api, admin tokens): `backup`, `rediscover`, `restore` (`preview`), `export`, `import`,
  `resume-automations`, `backup-location` — docs/REST-CONFIG-API.md.
- Audit: `backup.*` events on the site activity leg (`activity-site-`), shown in the tab's History.

## Proof on wolfaenpak dev, 2026-10-02

Representative setup: the harness fixtures (12,4xx keys across 37 families) plus custom classification levels, a page
level, an Assets link, a TTL'd edit grant and section grant, an edit request, a watch, an open approval with a decision
and inbox row, a read confirmation, a REST token, an authenticator enrolment, and every pausable automation switched on.
Three full cycles (back up → uninstall → reinstall → restore → compare every key and every field with stable JSON):

| cycle | started from | restored | identical | differ (all = paused on purpose) | expiries |
|---|---|---|---|---|---|
| 1 | dev hook seam | 12,463 of 12,463 | 12,460 | 3 records / 5 fields | identical |
| 2 | the UI's restore handler | 12,467 of 12,467 | 12,464 | 3 records / 5 fields | identical |
| 3 | real mouse clicks: banner → preview → Restore | 12,470 of 12,470 | 12,467 | 3 records / 5 fields | identical |

Cycle 3, per family (rows before the uninstall vs after the restore):

| family | rows before uninstall | identical after restore | fields compared | differ | missing | rows with TTL |
|---|---|---|---|---|---|---|
| Workflow history | 4497 | 4497 | 27050 | 0 | 0 | 0 |
| Activity history (spaces) | 3698 | 3698 | 33282 | 0 | 0 | 0 |
| Activity history (pages) | 3086 | 3086 | 27774 | 0 | 0 | 0 |
| Last passing version per page | 481 | 481 | 481 | 0 | 0 | 0 |
| Page workflow states | 227 | 227 | 1619 | 0 | 0 | 0 |
| Workflow dashboard index | 226 | 226 | 1128 | 0 | 0 | 0 |
| Sealed-section index per space | 66 | 66 | 465 | 0 | 0 | 0 |
| "My requests" index | 56 | 56 | 392 | 0 | 0 | 0 |
| "Approvals you asked for" index | 33 | 33 | 198 | 0 | 0 | 0 |
| Sealed sections | 18 | 18 | 284 | 0 | 0 | 0 |
| Sealed section baselines | 17 | 17 | 85 | 0 | 0 | 0 |
| Activity history (site) | 9 | 8 | 72 | 0 | 1 | 0 |
| Sealed files | 9 | 9 | 126 | 0 | 0 | 0 |
| Section edit-request inbox index | 7 | 7 | 21 | 0 | 0 | 0 |
| Sealed-file index per space | 7 | 7 | 82 | 0 | 0 | 0 |
| AI budget used this month | 4 | 4 | 16 | 0 | 0 | 3 |
| Space settings | 3 | 3 | 23 | 0 | 0 | 0 |
| Space classification defaults | 3 | 3 | 6 | 0 | 0 | 0 |
| Validation rules | 3 | 2 | 8 | 1 | 0 | 0 |
| Latest AI review per page | 2 | 2 | 18 | 0 | 0 | 0 |
| Workflow definitions | 2 | 2 | 8 | 0 | 0 | 0 |
| Workflow settings per space | 2 | 1 | 13 | 1 | 0 | 0 |
| Site settings | 1 | 0 | 0 | 1 | 0 | 0 |
| AI review triage decisions | 1 | 1 | 1 | 0 | 0 | 0 |
| Classification levels linked to JSM Assets | 1 | 1 | 7 | 0 | 0 | 0 |
| Classification levels | 1 | 1 | 2 | 0 | 0 | 0 |
| Page classifications | 1 | 1 | 2 | 0 | 0 | 0 |
| Edit access granted on sealed files | 1 | 1 | 2 | 0 | 0 | 1 |
| Edit requests on sealed files | 1 | 1 | 8 | 0 | 0 | 0 |
| Edit-request inbox index | 1 | 1 | 3 | 0 | 0 | 0 |
| "Tell me when it is released" watches | 1 | 1 | 3 | 0 | 0 | 0 |
| Read confirmations | 1 | 1 | 3 | 0 | 0 | 0 |
| Edit access granted on sealed sections | 1 | 1 | 2 | 0 | 0 | 1 |
| Space-admin access requests | 1 | 1 | 6 | 0 | 0 | 0 |
| Approval decisions | 1 | 1 | 5 | 0 | 0 | 0 |
| Approver inbox index | 1 | 1 | 2 | 0 | 0 | 0 |
| Open approval requests | 1 | 1 | 9 | 0 | 0 | 0 |
| **total** | 12471 | 12467 | 93206 | 3 | 1 | |

The one "missing" row is the audit entry of the backup itself (written after its own snapshot). After "Turn back on"
(clicked in the browser) every paused field was back to its original value and the seal timers were extended by
exactly the paused time (31 min 44 s). REST: rediscover, restore preview, backup, export (attached to a page the
caller can edit; refused for a page they cannot), import (registered as a generation), a malformed body → 400, no
token → 401, one job per token → 429. UI: export downloaded 30/30 parts with matching hashes and no token, import
registered and previewed. A held lease made a second run wait and refuse; released, it ran.

Evidence: ~/Projects/forge-live-harness/evidence/sentinel-vault/backup/ (1-banner … 7-import-preview), specs
`scenarios/sentinel-vault/backup-restore.spec.ts` (needs a freshly reinstalled site) and `backup-tab.spec.ts`.

## Known limits

- An uninstall before this version leaves no backup; the re-link ticket (21 days) is the only way back.
- The app's own last audit row after the final backup before an uninstall is not in that backup.
- A restore onto a site in use puts every backed-up item back as it was (section baselines, approvals included);
  items created since stay. A safety backup is taken first.
- (2026-10-04) "Delete the backup" and Move purge every backup file and the index property, then trash the emptied
  page through v1 `DELETE /content/{id}/pageTree` (write:confluence-content). The v2 page DELETE needs
  delete:page:confluence, which the manifest lacks (401 live), so the app cannot purge the page itself; a trashed
  app-restricted page answers 404 to a site admin and is not in their space-trash listing (measured), which is why
  the files are purged first. Delete runs as a queued job (it can outlast 25 s).
- The backup page outlives an uninstall (that is the point). To leave nothing behind, use "Delete the backup" before
  uninstalling.
- (Fixed the same day) Dialogs could open below the window in a content-tall frame; every dialog now fits the part
  of the frame that is on screen (IntersectionObserver band, kit/visible-placement.js). The headless clicks that
  were lost there were a harness artifact (emulated viewport; forge-live-harness RUNBOOK "Clicking inside a Forge
  frame reliably").
- (Fixed the same day) The Jira installation's empty backups and id are pruned from the index; empty generations
  are never pinned.
- Workflow automations paused by a restore are turned back on by restoring exactly the paused fields (the workflow
  settings resolver refuses everyone when "Allow space admins to override" is off).
