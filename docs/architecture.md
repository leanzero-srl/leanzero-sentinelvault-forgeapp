# Architecture

Sentinel Vault is built on Atlassian Forge and follows a two-layer architecture: **server capsules** handle business logic and data, while **UI surfaces** provide React-based interfaces. The two layers communicate through the Forge resolver bridge.

## Project Structure

```
src/
  boot.js                                   # Entry point, exports all handlers
  server/
    registry.js                             # Action router (Forge Resolver)
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
      mail-composer.js                      # Email orchestration
      mail-blueprints.js                    # HTML email templates
      outbound-mail.js                      # Resend API integration
      artifact-fetch.js                     # Attachment download URL generation
      doc-surgery.js                        # ADF manipulation (panel embed/remove)
    shared/                                 # Shared utilities and constants
      baseline.js                           # Feature flag defaults, seal duration
      bulletin-flags.js                     # Notification toggle resolution
      steward-checks.js                     # Authorization checks
  ui/
    surfaces/                               # Independent React apps (6 surfaces)
      doc-ribbon/       index.jsx           # Page banner notifications
      inline-panel/     index.jsx           # Macro panel for page content
      overlay/          index.jsx           # Full-featured modal dialog
      panel-setup/      index.jsx           # Macro configuration
      realm-console/    index.jsx           # Space-level admin
      steward-console/  index.jsx           # Global admin settings
    kit/                                    # Shared UI utilities
      flash-messages.js                     # Toast notification helper
      palette-sync.js                       # Dark mode theme sync
    tokens/                                 # CSS design tokens per surface
    assets/                                 # Icons and branding

manifest.yml                                # Forge app definition
webpack.config.js                           # Builds each surface into static/
static/                                     # Webpack output (one bundle per surface)
```

## Capsules

Each capsule encapsulates a domain. Files follow a consistent pattern: `actions.js` defines resolver functions (called from UI), `logic.js` contains data operations and business rules.

| Capsule | Domain | Key Responsibilities |
|---|---|---|
| **sealing** | Lock management | Seal/unseal artifacts, version tracking, Confluence panel sync |
| **bulletins** | Notifications | Record dispatch events, post Confluence comments, notify watchers |
| **entitlements** | Permissions | Permission and entitlement checks |
| **operators** | Users | User lookup, profile resolution, CQL-based search |
| **panels** | Macro resolvers | Enumerate page artifacts, upload, label, delete, watch/unwatch |
| **policies** | Settings | Load/store global and realm-level configuration |
| **realms** | Space admin | List sealed artifacts per space, background scan worker |

All capsule actions are aggregated in `src/server/registry.js`, which creates a single Forge Resolver that routes incoming requests by action key.

## Surfaces

Each surface is a standalone React application bundled by Webpack and served as a Forge static resource.

| Surface | Forge Module | Purpose |
|---|---|---|
| **inline-panel** | `macro` | Embedded panel showing seal status for page attachments |
| **overlay** | Modal (invoked from surfaces) | Full artifact management: search, filter, seal, upload, label |
| **doc-ribbon** | `confluence:pageBanner` | Persistent page banner for seal alerts and quick actions |
| **steward-console** | `confluence:globalSettings` | Site-wide admin: seal duration, auto-unseal, notifications |
| **realm-console** | `confluence:spaceSettings` | Space admin: sealed artifacts, force-release, delegation |
| **panel-setup** | Macro `config` | Configure inline-panel display (columns, rows per page) |

## Infrastructure

The `infra/` layer provides cross-cutting services used by multiple capsules:

- **mail-composer.js** -- Orchestrates email sending (fetches user profiles, selects template, dispatches)
- **mail-blueprints.js** -- HTML email templates as functions returning markup
- **outbound-mail.js** -- Resend API client
- **artifact-fetch.js** -- Generates download URLs for attachment versions
- **doc-surgery.js** -- Injects or removes the Sentinel Vault panel node from page ADF content

## Forge Modules

Defined in `manifest.yml`, these map to Forge platform capabilities:

| Module | Key | Handler |
|---|---|---|
| Action router | `action-router` | `boot.actionRouter` |
| Attachment trigger | `artifact-trigger` | `boot.artifactEventTrigger` |
| Lifecycle trigger | `lifecycle-trigger` | `boot.lifecycleTrigger` |
| Expiry sweep (hourly) | `expiry-sweep-task` | `boot.expirySweepTask` |
| Periodic reminders (daily) | `recurring-nudge-task` | `boot.recurringNudgeTask` |
| Halfway check | `halfway-check-task` | `boot.halfwayCheckTask` |
| Realm scan consumer | `realm-scan-consumer-fn` | `boot.realmScanConsumer` |
| Seal index cron (hourly) | `seal-index-cron-fn` | `boot.sealIndexCron` |

**Event triggers** listen for `avi:confluence:updated:attachment` (unauthorized edit detection) and `avi:forge:installed:app` / `avi:forge:uninstalled:app` (lifecycle cleanup).

**Queue:** `realm-audit-queue` processes background realm scan jobs asynchronously.

## Data Flow

### Seal Operation

1. User clicks "Seal" in the inline-panel or overlay
2. UI invokes `seal-artifact` action via Forge Bridge
3. Sealing capsule writes a seal record to Forge KVS (`protection-{artifactId}`)
4. Optionally writes a space-indexed key (`space-protection-{realmId}-{artifactId}`)
5. Confluence sync embeds the Sentinel Vault panel in the page ADF
6. Confirmation toast and/or email sent based on bulletin flags

### Unauthorized Edit Detection

1. Forge trigger fires on `avi:confluence:updated:attachment`
2. `artifactEventTrigger` checks if the attachment has an active seal
3. If the editor is the seal owner or the app itself, the edit is allowed
4. Otherwise, the system fetches the previous attachment version
5. Re-uploads the previous version to restore the file
6. Sends notifications (comment, email, banner alert) based on bulletin flags
7. Stores a violation record for the page banner to display

## Storage Model

All persistent data uses Forge KVS with key prefixes:

| Key Pattern | Content |
|---|---|
| `protection-{artifactId}` | Seal record (lockedBy, expiresAt, contentId, version) |
| `space-protection-{realmId}-{artifactId}` | Space-indexed seal for realm queries |
| `admin-settings-global` | Global policy configuration |
| `admin-settings-space-{realmKey}` | Space-level policy overrides |
| `app-account-id` | Cached app account ID (loop prevention) |
| `violation-alert-{contentId}-{artifactId}` | Temporary violation notifications |
| `reminder-sent-{artifactId}` | Email deduplication flag |
| `fifty-percent-reminder-sent-{artifactId}` | Halfway reminder deduplication flag |
