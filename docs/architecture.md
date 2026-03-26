# Architecture

Sentinel Vault is built on Atlassian Forge and follows a two-layer architecture: **server capsules** handle business logic and data, while **UI surfaces** provide React-based interfaces. The two layers communicate through the Forge resolver bridge.

## Project Structure

```
src/
  boot.js                                   # Entry point, exports all handlers
  server/
    registry.js                             # Action router (Forge Resolver, 57 actions)
    triggers.js                             # Event and scheduled trigger handlers
    capsules/                               # Domain modules (7 capsules)
      sealing/        actions.js, logic.js, confluence-sync.js
      bulletins/      actions.js, logic.js
      entitlements/   actions.js, logic.js
      operators/      actions.js, logic.js
      panels/         actions.js, logic.js
      policies/       actions.js, logic.js
      realms/         actions.js, logic.js, scan-worker.js
    infra/                                  # Cross-cutting infrastructure
      mail-composer.js                      # Email orchestration (8 types)
      mail-blueprints.js                    # HTML email templates
      outbound-mail.js                      # Resend API integration
      artifact-fetch.js                     # Attachment download URL generation
      doc-surgery.js                        # ADF manipulation (panel embed/remove, media protection)
    shared/                                 # Shared utilities and constants
      baseline.js                           # Feature flag defaults, seal duration
      bulletin-flags.js                     # Notification toggle resolution
      steward-checks.js                     # Authorization checks
  ui/
    surfaces/                               # Independent React apps (6 surfaces)
      inline-panel/     index.jsx           # Macro: attachment grid with seal controls
      overlay/          index.jsx           # Full-featured modal dialog
      doc-ribbon/       index.jsx           # Page banner notifications
      steward-console/  index.jsx           # Global admin settings
      realm-console/    index.jsx           # Space-level admin
      panel-setup/      index.jsx           # Macro configuration
    kit/                                    # Shared UI utilities
      flash-messages.js                     # Toast notification helper
      palette-sync.js                       # Dark mode theme sync
      ThumbnailPreview.jsx                  # Lazy-loaded image preview component
    tokens/                                 # CSS design tokens per surface
      foundation.css                        # Shared base variables and dark mode
      controls.css                          # Shared form element styles
      doc-ribbon.css                        # Ribbon-specific styles
      inline-panel.css                      # Panel-specific styles
      overlay.css                           # Overlay-specific styles
      panel-setup.css                       # Setup-specific styles
      realm-console.css                     # Realm console styles
      steward-console.css                   # Steward console styles
    assets/                                 # Icons and branding

manifest.yml                                # Forge app definition
webpack.config.js                           # Builds each surface into static/
static/                                     # Webpack output (one bundle per surface)
```

## Capsules

Each capsule encapsulates a domain. Files follow a consistent pattern: `actions.js` defines resolver functions (called from UI), `logic.js` contains data operations and business rules. Cross-capsule imports should reference `logic.js`, not `actions.js`.

| Capsule | Actions | Domain | Key Responsibilities |
|---------|---------|--------|---------------------|
| **sealing** | 8 | Lock management | Seal/unseal artifacts, version tracking, Confluence content property sync, realm index management, restore from trash, purge orphaned seals |
| **bulletins** | 9 | Notifications | Record dispatch events, post Confluence comments, watch/unwatch artifacts, notify watchers on release, dispatch acknowledgement |
| **entitlements** | 3 | Permissions | Session loading, license checks, steward override status |
| **operators** | 5 | Users | User lookup, profile resolution, CQL-based search, team enumeration |
| **panels** | 12 | Macro resolvers | Enumerate page artifacts, upload, delete, label/unlabel, panel inject/extract, panel status, thumbnail preview |
| **policies** | 8 | Settings | Load/store global and realm-level configuration, ruleset CRUD |
| **realms** | 11 | Space admin | List sealed artifacts per space, force-unseal, steward access requests (request/check/list/approve/deny), background scan worker, role checking |

All capsule actions are aggregated in `src/server/registry.js`, which creates a single Forge Resolver that routes incoming requests by action key. A `heartbeat` action provides health checking.

### Action Key Reference

**Sealing:** `seal-artifact`, `unseal-artifact`, `enumerate-doc-artifacts`, `enumerate-operator-seals`, `enumerate-page-seals`, `check-seal-stamp`, `restore-sealed-artifact`, `purge-seal-record`

**Bulletins:** `load-bulletin-toggles`, `recent-dispatches`, `operator-dispatches`, `acknowledge-dispatch`, `watch-artifact`, `check-watch`, `unwatch-artifact`, `flush-operator-dispatches`, `list-breach-dispatches`

**Policies:** `load-policy`, `store-policy`, `load-global-ruleset`, `store-global-ruleset`, `load-realm-ruleset`, `store-realm-ruleset`, `enumerate-realm-rulesets`, `discard-realm-ruleset`

**Realms:** `identify-realm`, `enumerate-realm-seals`, `launch-realm-audit`, `check-audit-status`, `steward-unseal`, `check-user-role`, `request-steward-access`, `check-steward-request`, `list-steward-requests`, `approve-steward-request`, `deny-steward-request`

**Operators:** `identify-operator`, `search-operators`, `current-operator`, `enumerate-operators`, `enumerate-teams`

**Panels:** `enumerate-panel-artifacts`, `label-artifact`, `unlabel-artifact`, `delete-artifact`, `inject-panel`, `extract-panel`, `check-panel-status`, `store-doc-panel-prefs`, `upload-artifact`, `register-panel-key`, `discover-panel-key`, `resolve-artifact-preview`

**Entitlements:** `load-session`, `check-license`, `steward-override-enabled`

## Surfaces

Each surface is a standalone React application bundled by Webpack and served as a Forge static resource.

| Surface | Forge Module | Purpose |
|---------|-------------|---------|
| **inline-panel** | `macro` | Embedded panel showing seal status for page attachments, with seal/unseal, upload, labels, delete/restore/purge, expandable card rows |
| **overlay** | Modal (invoked from surfaces) | Full artifact management: search, filter, sort, column picker (localStorage), pagination, panel visibility toggle |
| **doc-ribbon** | `confluence:pageBanner` | Persistent page banner showing seal counts, conflict and expiry alerts, "Manage Attachments" button. Polls every 5 seconds via `check-seal-stamp`. |
| **steward-console** | `confluence:globalSettings` | Site-wide admin: 2 tabs (General + Alerts), 17 settings for seal behavior and notifications |
| **realm-console** | `confluence:spacePage` | Space admin: 5 tabs (My Sealed Files, Realm Sealed Files, Access Control, Reservation Duration, Macro). Role-adaptive UI (user vs. steward). |
| **panel-setup** | Macro `config` | Configure inline-panel display: column visibility, rows per page, cards per row, upload zone toggle |

## Infrastructure

The `infra/` layer provides cross-cutting services used by multiple capsules:

- **mail-composer.js** -- Centralized email orchestration. All emails flow through `composeMail(type, data)` which fetches user profiles and artifact URLs in parallel, selects the HTML template, and dispatches via Resend. Supports 8 email types defined in `ALERT_CATEGORIES`: seal violation, seal created, 50% reminder, auto-release, expiry notification, periodic reminder, release notification, steward override release.
- **mail-blueprints.js** -- HTML email templates as functions returning markup. Design includes a dark hero header with LeanZero branding, timeline layout, action pills, and color-coded status banners.
- **outbound-mail.js** -- Resend API client with retry logic (3 retries, exponential backoff starting at 600ms, capped at 5s). Sends from `noreply@leanzero.atlascrafted.com`.
- **artifact-fetch.js** -- Generates download URLs for attachment versions via the Confluence v2 API. Also provides metadata resolution for page artifacts.
- **doc-surgery.js** -- ADF (Atlassian Document Format) manipulation utilities:
  - **Panel management**: `triggerPanelEmbed()` auto-inserts the Sentinel Vault macro into page content. `removePanelNode()` removes it when no seals remain. `panelExistsInDoc()` checks for existing panel presence.
  - **Media protection**: `collectMediaFileIds()` extracts all media file IDs from a page. `extractMediaSingleNodes()` finds top-level blocks containing sealed media. `spliceMediaNodes()` re-inserts missing media blocks at their original positions.
  - **Page I/O**: `readDocBody()` / `readDocBodyAtVersion()` fetch page ADF, `writeDocBody()` updates with version conflict handling.

## Forge Modules

Defined in `manifest.yml`, these map to Forge platform capabilities:

| Module | Key | Handler |
|--------|-----|---------|
| Action router | `action-router` | `boot.actionRouter` |
| Attachment trigger | `artifact-trigger` | `boot.artifactEventTrigger` |
| Page content trigger | `page-content-trigger` | `boot.pageContentTrigger` |
| Lifecycle trigger | `lifecycle-trigger` | `boot.lifecycleTrigger` |
| Expiry sweep (hourly) | `expiry-sweep-task` | `boot.expirySweepTask` |
| Recurring nudge (daily) | `recurring-nudge-task` | `boot.recurringNudgeTask` |
| Halfway check (legacy) | `halfway-check-task` | `boot.halfwayCheckTask` |
| Realm scan consumer | `realm-scan-consumer-fn` | `boot.realmScanConsumer` |
| Seal index cron (hourly) | `seal-index-cron-fn` | `boot.sealIndexCron` |

## Triggers

### artifactEventTrigger

Listens to three attachment events:
- `avi:confluence:updated:attachment` -- Detects unauthorized edits to sealed files
- `avi:confluence:trashed:attachment` -- Detects sealed files moved to trash
- `avi:confluence:deleted:attachment` -- Handles permanent deletion cleanup

**Behavior per event:**
- **Updated**: Checks if attachment is sealed. If uploader is not the seal owner or the app itself, downloads the previous version and re-uploads it. Sends violation notifications (comment, email, banner, toast).
- **Trashed**: If sealed, attempts to restore from trash. If restoration fails (permanently deleted), cleans up all seal state (KVS record, content property, realm index).
- **Deleted**: Cleans up all seal records and notifies the seal owner.

Prevents infinite loops by comparing the event actor against a cached app account ID stored in KVS (`app-account-id`).

### pageContentTrigger

Listens to `avi:confluence:updated:page`.

Implements **content protection** -- detects when sealed media embeds are removed from page content:

1. Fetches the current page ADF and the previous version
2. Extracts all media file IDs from both versions using `collectMediaFileIds()`
3. Identifies sealed media references that were present in the previous version but missing from the current version
4. Uses `extractMediaSingleNodes()` to locate the missing blocks in the previous ADF
5. Uses `spliceMediaNodes()` to surgically re-insert them at their original positions in the current ADF
6. Writes the patched ADF back with `writeDocBody()`
7. Retries up to 3 times with exponential backoff for version conflicts
8. Sends violation notifications to the seal owner

### lifecycleTrigger

Listens to `avi:forge:installed:app` and `avi:forge:uninstalled:app`.

On uninstall: deletes all KVS records for complete cleanup.

## Scheduled Tasks

| Task | Interval | Behavior |
|------|----------|----------|
| **Expiry Sweep** | Hourly | Queries all `protection-*` keys. For expired seals: sends expiry emails (if enabled), records dispatch events, sets dedup flag `expiry-notified-{artifactId}`, auto-releases if expiry notifications are on. For non-expired seals past 50% duration: sends halfway reminder emails, sets dedup flag `fifty-percent-reminder-sent-{artifactId}`. Respects auto-unlock pause state (extends seal times by pause duration when resumed). |
| **Recurring Nudge** | Daily | Sends periodic reminder emails every N days (default 7) when expiry notifications are **disabled**. Uses dedup key `reminder-sent-{artifactId}`. Only active when `autoUnlockEnabled=false` and periodic reminder emails are enabled. |
| **Seal Index Cron** | Hourly | Rebuilds realm-seal indexes for fast space-level queries. Uses `protections-last-modified` timestamp to skip if nothing changed since last run. |
| **Halfway Check** | -- | Legacy no-op. Functionality was merged into the Expiry Sweep. Kept in manifest for compatibility. |

## Queue System

| Queue | Consumer | Timeout | Purpose |
|-------|----------|---------|---------|
| `realm-audit-queue` | `realmScanConsumer` | 900s | Background realm auditing. Scans all pages in a space using cursor pagination, fetches attachments for each page, and writes `space-protection-{realmId}-{artifactId}` index keys for every sealed attachment found. Updates `space-scan-status-{realmId}` with progress. Triggered by stewards from the realm console. |

## Data Flow

### Seal Operation

1. User clicks "Seal" in the inline-panel or overlay
2. UI invokes `seal-artifact` action via Forge Bridge
3. Sealing capsule resolves effective seal duration (realm policy → global policy → baseline)
4. Fetches attachment details (fileId, size, creator, download link)
5. Writes seal record to Forge KVS (`protection-{artifactId}`)
6. Writes space-indexed key (`space-protection-{realmId}-{artifactId}`)
7. Writes content property `protection-` on the page for CQL queryability
8. If auto-insert enabled: embeds the Sentinel Vault panel in the page ADF via `triggerPanelEmbed()`
9. Sends seal confirmation email (if enabled)
10. Updates `protections-last-modified` timestamp for cron optimization

### Unauthorized Edit Detection

1. Forge trigger fires on `avi:confluence:updated:attachment`
2. `artifactEventTrigger` checks if the attachment has an active seal
3. If the editor is the seal owner or the app itself, the edit is allowed
4. Otherwise, the system fetches the previous attachment version via download URL
5. Re-uploads the previous version to restore the file
6. Posts Confluence comment with @mentions (seal owner + editor)
7. Sends violation alert email to seal owner and editor
8. Records dispatch event for page banner display
9. Dispatches toast notification

### Content Protection Flow

1. Forge trigger fires on `avi:confluence:updated:page`
2. `pageContentTrigger` fetches the current and previous page ADF
3. Extracts media file IDs from both versions
4. Cross-references with active seals to find sealed media removed from the page
5. Retrieves the missing media blocks from the previous ADF at their original positions
6. Splices the missing blocks back into the current ADF
7. Writes the patched ADF with version conflict handling (up to 3 retries)
8. Sends violation notifications

### Trash Protection Flow

1. Forge trigger fires on `avi:confluence:trashed:attachment`
2. `artifactEventTrigger` checks if the trashed attachment has an active seal
3. If sealed: attempts to restore the attachment from trash via Confluence API
4. If restoration succeeds: seal remains active, notifications sent
5. If restoration fails (permanently deleted): calls `purgeAllSealState()` to clean up KVS record, content property, and realm index

## Storage Model

All persistent data uses Forge KVS with key prefixes:

| Key Pattern | Content | TTL |
|------------|---------|-----|
| `protection-{artifactId}` | Seal record (lockedBy, expiresAt, contentId, version, downloadLink, etc.) | Persistent |
| `space-protection-{realmId}-{artifactId}` | Space-indexed seal for realm queries | Persistent |
| `admin-settings-global` | Global policy configuration | Persistent |
| `admin-settings-space-{realmKey}` | Space-level policy overrides | Persistent |
| `app-account-id` | Cached app account ID (loop prevention) | Persistent |
| `protections-last-modified` | Timestamp for seal index cron optimization | Persistent |
| `macro-extension-key` | Cached panel macro extension key | Persistent |
| `confluence-webhook-id` | Stored Confluence webhook ID | Persistent |
| `space-scan-status-{realmId}` | Realm scan job progress and status | Persistent |
| `expiry-notified-{artifactId}` | Deduplication flag for expiry emails | Persistent |
| `fifty-percent-reminder-sent-{artifactId}` | Deduplication flag for halfway reminder emails | Persistent |
| `reminder-sent-{artifactId}` | Deduplication flag for periodic nudge emails | Persistent |
| `notification-{ts}-{rand}` | Toast dispatch event | 5 minutes |
| `recent-notifications` | Page banner dispatch events list | 1 hour |
| `violation-alert-{owner}-{artifact}-{ts}` | Violation toast for seal owner | 1 hour |
| `notify-request-{artifactId}-*` | Watch/notify-me requests per artifact | Configurable |
| `protection-` (content property) | CQL-searchable seal marker on page | Persistent (Confluence) |

## Performance Patterns

- **Two-phase loading** -- The inline panel loads instantly with seal data from KVS (`enumerate-page-seals`), then enriches with full attachment metadata from the Confluence API (`enumerate-panel-artifacts`). This provides a fast initial render while complete data loads in the background.
- **Polling** -- The doc-ribbon polls every 5 seconds using `check-seal-stamp` (which reads `protections-last-modified`) to detect changes made in other surfaces (overlay, inline panel) without a full page refresh.
- **CQL queryability** -- Content properties (`protection-`) on pages enable CQL-based discovery of sealed attachments without scanning KVS.
- **Lazy thumbnails** -- The `ThumbnailPreview` component loads image previews on demand via `resolve-artifact-preview` and caches the result in parent component state to avoid repeated fetches.
- **Realm index optimization** -- The `sealIndexCron` only rebuilds indexes when `protections-last-modified` indicates changes since the last run, avoiding unnecessary KVS scans.
- **Deduplication keys** -- Email notifications use per-artifact flags (`expiry-notified-*`, `fifty-percent-reminder-sent-*`, `reminder-sent-*`) to prevent duplicate emails across scheduled task runs.
