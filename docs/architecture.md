# Architecture

Current as of production 6.5.0 (tag `v6.5.0`).

Sentinel Vault is an Atlassian Forge app with two layers: **server capsules** (business logic, storage, Confluence calls) and **UI surfaces** (Custom UI React apps). They talk through one Forge resolver (`action-router`).

## Project structure

```
src/
  boot.js                 # exports every Forge handler
  test-hook.js            # dev-only harness webtrigger (stripped from production deploys)
  server/
    registry.js           # the one resolver: 150 capsule actions + heartbeat
    triggers.js           # attachment/page/lifecycle triggers, expiry sweep, nudge, workflow + page-guard sweeps
    capsules/             # 15 feature domains (below)
    infra/                # comment notices, ADF surgery, rules engine, Forge LLM, activity log, attachment I/O
    shared/               # pure rules and constants (baseline defaults, authorization, cooldown, signing, TOTP, ...)
  ui/
    surfaces/             # 9 Custom UI apps (below)
    kit/                  # shared components and pure UI rules
    tokens/               # CSS design tokens per surface
static/                   # webpack output, one bundle per surface
```

## Capsules

`actions.js` in each capsule exports `[key, handler]` pairs; `registry.js` concatenates them into one resolver. Counts are the entries in each `actions` array at v6.5.0.

| Capsule | Actions | Responsibility |
|---|---|---|
| sealing | 10 | Seal, release and extend attachment seals; page/ribbon summaries; restore from trash; purge orphaned seal records |
| section-seals | 10 | Seal, release and extend page sections (bodied macro), snapshots, heading list, adopting inserted wrappers |
| editreq | 21 | Edit requests and direct grants for files and sections; My work request lists and counts |
| workflow | 32 | Page workflow states, approvals, read confirmations, authenticator signatures (enrol/confirm/revoke), sweeps |
| classification | 14 | Levels, space defaults, page levels, JSM Assets import |
| validations | 12 | Rule config, page checks, Re-check, Approve anyway (gate), AI review jobs and findings |
| config-api | 7 | REST API tokens, job receipts, config export (the endpoint itself is a web trigger + queue consumer) |
| realms | 12 | Space console: sealed files per space, force release (`steward-unseal`), role check, space admin access requests, space audit |
| bulletins | 9 | Pop-up/ribbon dispatches, watch/unwatch |
| panels | 9 | Inline panel data, upload, labels, delete, panel prefs, previews |
| operators | 5 | User lookup and search |
| policies | 3 | Load/store site and space settings (`settings-schema.js` is the one list of keys, labels and defaults) |
| entitlements | 3 | Session, licence check, force-release availability |
| activity | 2 | Activity feed per page and report per space |
| page-details | 1 | The page-details modal summary (byline chip click) |

Every action is callable by any logged-in user with any payload; authorization is done inside each action (see the repo `CLAUDE.md` and `src/server/shared/content-access.js`). Seal actions listed in `shared/seal-signature.js` are wrapped in `registry.js` so that, with the site setting `signSealActions` on, they run only after the caller's authenticator code verifies.

## Surfaces

| Surface | Forge module | Purpose |
|---|---|---|
| page-details | `confluence:contentBylineItem` (chip under the title) and `confluence:contentAction` ("Seal attachments…" in the page ⋯ menu) | Page hub: classification level, seals on this page, sealing files and sections, requests |
| doc-ribbon | `confluence:pageBanner` | Banner at the top of the page: classification level (when on), seals, workflow, validation and alerts. Polls every 5 s |
| inline-panel | `macro` (Sentinel Vault) | Optional in-page panel: Sealed / Available groups paged per group, upload, labels, sections, AI review |
| panel-setup | macro `config` | Panel columns, rows per page (5 default; 5/10/15/25), cards per row, upload zone |
| section-setup | bodied `macro` (Sentinel Vault Sealed Section) and its config | Wraps a sealed page section |
| overlay | Forge Modal opened from the page-details modal | Full attachment list with search, sort and column picker |
| my-work | `confluence:globalPage` | Approvals and edit requests waiting on you, your requests, your seals, authenticator setup |
| steward-console | `confluence:globalSettings` | Site settings: Settings, Validations, Classification, API access tabs |
| realm-console | `confluence:spacePage` | Space console: My Sealed Files (non-admins); Sealed Files, Access Control, Seal Duration, Macro, Validations, Workflow, Activity (space admins) |

## Triggers, schedules and queues (manifest.yml)

| Kind | Key | Handler | When |
|---|---|---|---|
| trigger | attachment-events | `artifactEventTrigger` | attachment updated / trashed / deleted |
| trigger | page-content-events | `pageContentTrigger` | page created / updated |
| trigger | app-lifecycle-events | `lifecycleTrigger` | installed / uninstalled (logs only since 6.6.0 — the KVS wipe broke Atlassian's re-link path; see BACKUP-AND-RESTORE.md) |
| scheduled | expiry-sweep-scheduled | `expirySweepTask` | hourly |
| scheduled | recurring-nudge-scheduled | `recurringNudgeTask` | daily |
| scheduled | seal-index-cron | `sealIndexCron` | hourly |
| scheduled | workflow-sweep-scheduled | `workflowSweep` | hourly |
| scheduled | page-guard-sweep-scheduled | `pageGuardSweep` | every 5 minutes |
| queue | realm-audit-queue | `realmScanConsumer` (900 s) | space audits and byline refresh fan-out |
| queue | ai-validation-queue | `aiValidationConsumer` (120 s) | AI review jobs |
| queue | config-api-queue | `configApiConsumer` (300 s) | REST API bundles |
| webtrigger | config-api | `configApiTrigger` | REST API endpoint, static responses only |
| llm | sentinel-vault-llm | — | Atlassian-hosted Claude for AI review |

The dev-only `harness-test-state` webtrigger is removed by `scripts/deploy-prod.sh` before a production deploy.

### Page content pipeline

`pageContentTrigger` ignores the app's own edits, then does one read, runs its passes and does one write (with 409 backoff):

1. Workflow enforcement: an edit to an Approved page by someone who is not an approver or space admin demotes or reverts it, per the space's workflow.
2. Sealed sections: tampered section bodies are restored from their snapshot.
3. Sealed media: a removed sealed image or file embed is re-inserted at its position; the rest of the edit stays.
4. Validations and workflow auto-assign run after the protection passes.

`pageGuardSweep` re-judges pages with live seals (and pages edited in the last 20 minutes, when the site validation switch is on and at least one site-level rule exists (spaces with only space rules are not swept), up to 50 pages per run; the whole sweep is skipped while content protection is off) because page events can arrive late.

### Attachment events

- **Updated** by someone other than the owner, an approved editor or the app: the sealed version is put back.
- **Trashed**: a sealed file is restored from the trash.
- **Deleted** permanently: seal state is cleaned up.

## Storage (Forge KVS, main keys)

| Key | Content |
|---|---|
| `protection-{attachmentId}` | Attachment seal record |
| `section-protection-{sectionId}`, `section-snapshot-{…}` | Section seal and its snapshot |
| `space-protection-{spaceId}-{attachmentId}` | Space index of seals |
| `edit-request-…`, `edit-grant-…`, `section-edit-request-…`, `section-edit-grant-…` | Edit requests and grants |
| `admin-settings-global` | Site settings |
| `admin-settings-space-{spaceKey}` | Space settings |
| `workflow-…` (`workflow-state-`, `workflow-pending-`, `workflow-settings-`, `workflow-def-space-`, `workflow-log-`, …) | Workflow state, approvals, definitions and legacy log |
| `activity-page-…`, `activity-space-…` | Activity log |
| `classification-levels`, `classification-space-{spaceId}`, `classification-page-{pageId}` | Classification |
| `validation-config-global`, `validation-config-space-…`, `validation-checked-…`, `validation-lastgood-…`, `ai-…` | Validations and AI review |
| `sig-secret-…`, `sig-enroll-…` | Authenticator enrolment |
| `api-tokens` | REST API token hashes |
| `notify-request-{attachmentId}-{accountId}` | Watchers (7-day TTL) |
| `steward-request-…` | Space admin access requests |
| `app-account-id`, `protections-last-modified`, `macro-extension-key`, `space-scan-status-{spaceId}` | Caches and job state |
| `expiry-notified-…`, `fifty-percent-reminder-sent-…`, `reminder-sent-…` | Notice dedup |
| `notification-…` (5 min), `recent-notifications` (1 h), `violation-alert-…` (1 h) | Pop-up and ribbon dispatches |

Confluence content properties: `sentinel-byline` (the byline chip), `protection-…` and `section-protection-…` (seal markers for CQL), `sentinel-classification` (space default and page level mirrors, best-effort), and `sentinel-vault-config` (config export mirror read over Confluence REST).
