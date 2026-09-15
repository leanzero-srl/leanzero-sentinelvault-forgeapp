# Sentinel Vault

**Attachment protection and concurrent edit prevention for Confluence.**

Part of the [LeanZero](https://leanzero.net) ecosystem.

Sentinel Vault is an Atlassian Forge app that brings **file locking, real-time violation detection, and automatic reversion** to Confluence Cloud attachments. When a user seals an attachment, nobody else can modify it -- and if they try, Sentinel Vault automatically restores the previous version and notifies everyone involved.

> **Why this exists:** Confluence has no native file locking. Teams working on shared documents -- contracts, design files, spreadsheets -- routinely overwrite each other's work. Sentinel Vault eliminates this class of problem entirely.

---

## Why Sentinel Vault Exists

Confluence attachments are a free-for-all. Any user with edit access can upload a new version of any attachment at any time, with no coordination mechanism. This creates real problems:

- **Concurrent edits** -- Two people download a spreadsheet, edit it offline, and upload their versions. One person's work is silently lost.
- **Accidental overwrites** -- Someone uploads the wrong file version, replacing hours of work.
- **No audit trail for intent** -- Confluence tracks *who* changed a file but has no concept of *who was supposed to be editing it*.

Sentinel Vault solves all three by adding a **seal (lock) layer** on top of Confluence attachments. Seal a file before editing, and the system enforces exclusive access until you're done.

---

## What It Does

### Core Protection

- **Attachment Sealing** -- Lock any attachment before editing. Other users see the seal status and who holds it. Seals are enforced at the platform level -- not just a visual indicator.
- **Automatic Reversion** -- If someone modifies a sealed attachment, Sentinel Vault detects the change in real time, downloads the previous version, re-uploads it, and restores the file to its pre-violation state. The unauthorized edit is undone automatically.
- **Content Protection** -- When a sealed attachment is embedded in a page body (e.g., an inline image or file preview), Sentinel Vault monitors page edits. If someone removes the sealed embed, the system detects the missing media reference, retrieves it from the previous page version, and surgically re-inserts it at its original position -- without reverting any other page changes. Up to 3 retries with exponential backoff handle version conflicts.
- **Delete and Trash Protection** -- If someone trashes a sealed attachment, Sentinel Vault automatically restores it from the trash. If an attachment is permanently deleted, all associated seal records, content properties, and space indexes are cleaned up, and the seal owner is notified.
- **Infinite Loop Prevention** -- The system's own restoration uploads are filtered out (via a cached app account ID) so reversion doesn't trigger itself.

### Attachment Management

The inline panel and overlay provide full attachment management beyond just sealing:

- **Upload** -- Drag-and-drop or click to upload new attachments directly from the Sentinel Vault panel (up to 4 MB per file, base64 encoded).
- **Labels** -- Add and remove labels on any attachment for organization and filtering.
- **Delete / Restore / Purge** -- Delete unsealed attachments (moves to trash), restore trashed attachments that still have seal data, or purge leftover seal records for permanently deleted files. Each action is gated by a separate admin toggle.
- **Thumbnail Previews** -- Expandable card rows show lazy-loaded image thumbnails for visual file identification.
- **Configurable Layout** -- Choose which columns to display (name, status, owner, labels, comment, actions, file size, file type, expiry), set rows per page (5/10/15/25), cards per row (1/2/3), and toggle the upload zone.

### Watch / Notify Me

Users can **watch** attachments sealed by other users. When the seal is released -- whether manually, by expiry, or by space-admin override -- all watchers are @mentioned in a page comment (Confluence's own notification engine then emails them according to their personal preferences). This eliminates the need to repeatedly check whether a file is available.

### Multi-Channel Notifications

When a seal violation occurs (or other notable events happen), Sentinel Vault notifies through multiple channels simultaneously:

| Channel | Description |
|---------|-------------|
| **Toast Messages** | In-app popup notifications via Forge Bridge `showFlag` API |
| **Page Banners** | Persistent ribbon alerts on the affected Confluence page |
| **Confluence Comments** | Automated footer comments on the page with @mentions |
| **Comment Alerts** | Confluence footer comments with `@mention` of the recipient (seal, violation, expiry, release, request, approval); no external email service |
| **Watch Notifications** | A release comment @mentioning every user watching a sealed attachment |

Each channel can be independently enabled or disabled at the global level through the site settings console.

### Edit Requests

A user can request permission to edit an attachment sealed by someone else, without being granted full space-admin rights. The **seal owner** approves or denies the request from the Sentinel Vault space console (My Sealed Files → Edit Requests). Approved editors can replace the file until the seal expires; everyone else stays blocked. Grants are scoped to the attachment and are swept automatically when the seal is released, expires, or the attachment is deleted.

### Content Sealing (Sections)

Beyond attachments, you can lock a **section of a Confluence page** -- a heading and its content -- against unauthorized edits. Pick a section from the Sentinel Vault panel's *Sealed Sections* group; the app wraps it in a "Sealed Section" macro carrying a stable id. If anyone other than the owner edits the body or removes the macro, the page-update trigger restores the sealed content from a snapshot (the same detect-and-restore mechanism used for sealed attachment embeds). The owner or a space admin can release the section at any time.

### Conditions & Validations

Define rules that Confluence pages are checked against on create and edit -- required headings/tables/labels, heading hierarchy, length limits, and more. Because Forge page events fire **after** a save, enforcement is applied post-save in one of three selectable modes: **advisory** (post a comment listing issues), **gate** (stamp a pass/fail status the panel and ribbon display), and **revert** (restore the last compliant version -- strict, opt-in, may discard work). Rules are authored in the site settings console's *Validations* tab.

### Semantic AI Validations (Runs on Atlassian)

AI-powered content review using **Atlassian-hosted Claude via the Forge LLM API** -- no bring-your-own-key, no external API keys, and no data egress, so the app keeps its **"Runs on Atlassian"** badge. Admins configure custom rules, a style guide, tone/voice requirements, and compliance standards; users run a review on demand from the panel's *AI Review* group. Findings (severity, excerpt, explanation, suggestion) are reported in the panel and optionally as an @mention comment to the page author. AI is **off by default**, limited to Claude Haiku for cost control, and bounded by a per-space monthly token budget.

### Administration

#### Site settings (global)

Site-wide administration panel accessible under **Confluence administration > Apps > Sentinel Vault Admin**. Two tabs:

**General tab:**
- Default seal duration (hours, minimum 1)
- Allow space admin force-unseal
- Enable seal expiry notifications (auto-unseal behavior)
- Allow attachment removal from page (delete)
- Allow attachment restore from page
- Allow seal cleanup from page (purge)
- Protect sealed attachments in page body (content protection)
- Auto-insert macro on seal
- Replace Attachments macro (nested, only when auto-insert is on)
- Reminder frequency in days (only when expiry notifications are off)

**Alerts tab:**
- Enable pop-up notifications (toasts)
- Enable page status banners
- Enable page comments
- Enable comment notifications (master toggle; off by default — in-app toast and ribbon are always on)
- Seal confirmation comments (nested under the master toggle)
- Seal expiry reminder comments (nested)
- Recurring reminder comments (nested)
- Per-space quiet mode (no comments or @mentions in that space)

#### Space console (space settings)

Space-level administration accessible under **Space settings > Apps > Sentinel Vault**. Tabs vary by role:

**Regular users see:**
- **My Sealed Files** -- All attachments sealed by the current user in this space, with unseal controls

**Space admins additionally see:**
- **Sealed Files** -- All sealed attachments across the space with column picker, sort, force-unseal, and watch controls
- **Access Control** -- Space activation toggle (active/disabled), manage individual space admin users, manage space-admin groups (Confluence groups), and review pending space admin access requests (approve/deny)
- **Seal Duration** -- Use system default or set a custom per-space seal duration
- **Macro** -- Auto-insert macro toggle and macro position (top/bottom of page)

#### Admin access requests

Users without admin access can request space admin access from the **My Sealed Files** tab. Space admins review and approve or deny requests from the **Access Control** tab. Denied users may re-request after 48 hours.

#### Configurable Seal Duration

Default is 24 hours (configurable in the site settings console). Individual spaces can override the global default in the space console. The baseline constant in code is 48 hours (`BASELINE_HOLD_SPAN`), but the site settings console initializes the UI default to 24 hours. Seals expire automatically when expiry notifications are enabled.

### Automated Maintenance

Sentinel Vault runs several scheduled tasks and event triggers to keep the system healthy:

| Task | Frequency | Purpose |
|------|-----------|---------|
| **Expiry Sweep** | Hourly | Releases expired seals (when expiry notifications enabled), posts halfway reminder comments at 50% duration, posts expiry notification comments |
| **Seal Index Cron** | Hourly | Rebuilds performance indexes for space seal lookups using `protections-last-modified` timestamp optimization |
| **Recurring Nudge** | Daily | Posts periodic reminder comments about active seals (only when expiry notifications are disabled) |
| **Space Scan Consumer** | On demand | Async queue processor (900s timeout) for space-level seal index auditing |
| **Attachment Event Trigger** | Real-time | Fires on attachment updated/trashed/deleted -- detects violations, restores files, cleans up seals |
| **Page Content Trigger** | Real-time | Fires on page updated -- detects removed sealed media embeds and surgically re-inserts them |
| **Lifecycle Trigger** | On install/uninstall | Cleans up all KVS records on app uninstall |

### Role-Based Access

| Role | Capabilities |
|------|-------------|
| **Users** | Regular users who can seal and unseal their own attachments, watch others' seals, request space admin access |
| **Space admins** | Space administrators and delegated users with force-unseal, access control, space policy, and audit capabilities |
| **Admin groups** | Confluence groups configured as space admin teams -- all members receive space admin privileges |
| **Site Administrators** | Full access to global settings via the site settings console, plus space admin capabilities in all spaces |

Space admin status is determined by any of: Confluence space ADMINISTER permission, membership in configured space-admin groups/users, or site/org admin status.

---

## How It Works

```
User seals an attachment via the Sentinel Vault panel or overlay
  → Seal record written to Forge KVS (user, timestamp, expiry, attachment ID, version)
  → Content property set on the page for CQL queryability
  → Realm-seal index written for space-level queries
  → If auto-insert enabled: panel macro embedded in page ADF
  → Seal confirmation comment posted (if enabled)
  → Page banner and macro panel update to show sealed status

Another user uploads a new version of the sealed attachment
  → Forge event trigger fires (avi:confluence:updated:attachment)
  → Sentinel Vault checks if the attachment is sealed
  → Compares uploader account ID against seal holder and app account ID
  → If sealed and uploader is not the seal holder or the app itself:
    → Previous version downloaded via Confluence REST API
    → Previous version re-uploaded, restoring the original
    → Confluence comment posted with @mentions (seal owner + editor)
    → Violation alert comment posted, @mentioning seal owner and editor (if enabled)
    → Page banner alert stored for next page view
    → Toast notification dispatched

Another user trashes a sealed attachment
  → Forge event trigger fires (avi:confluence:trashed:attachment)
  → Sentinel Vault detects the sealed attachment was trashed
  → Attachment automatically restored from trash
  → If restoration fails (permanently deleted): seal records cleaned up
  → Notifications sent to seal owner

Another user edits a page and removes a sealed media embed
  → Forge event trigger fires (avi:confluence:updated:page)
  → Sentinel Vault compares current page ADF against previous version
  → Identifies missing sealed media blocks by file ID
  → Surgically re-inserts missing blocks at their original positions
  → Up to 3 retries with exponential backoff for version conflicts
  → Notifications sent to seal owner

Seal expires (or user manually releases)
  → Seal record removed from KVS
  → Content property cleared
  → Realm-seal index cleaned up
  → Watcher notification comment posted
  → Panel removed from page if no other seals remain
  → UI updated to show unsealed status
```

---

## Architecture

```
sentinel-vault/
├── manifest.yml                    # Forge app definition (modules, triggers, permissions)
├── src/
│   ├── boot.js                     # Entry point: exports all resolvers and triggers
│   ├── server/
│   │   ├── registry.js             # Action router (Forge Resolver, 115 action keys)
│   │   ├── triggers.js             # Event and scheduled trigger handlers
│   │   ├── capsules/               # 13 modular feature domains (sealing, section-seals, editreq, workflow, activity, classification, validations, bulletins, policies, realms, operators, panels, entitlements)
│   │   │   ├── sealing/            # Core file locking logic (8 actions)
│   │   │   ├── bulletins/          # Multi-channel notification dispatch (9 actions)
│   │   │   ├── policies/           # Global and realm-level configuration (8 actions)
│   │   │   ├── realms/             # Space administration and auditing (11 actions)
│   │   │   ├── operators/          # User management and profiles (5 actions)
│   │   │   ├── panels/             # Frontend panel rendering logic (12 actions)
│   │   │   └── entitlements/       # Permission and authorization checks (3 actions)
│   │   ├── infra/                  # Comment notices, attachment, document utilities
│   │   └── shared/                 # Authorization, configuration, defaults
│   └── ui/
│       ├── surfaces/               # 8 independent React applications
│       │   ├── inline-panel/       # Macro: attachment grid with seal controls
│       │   ├── overlay/            # Modal: full attachment management
│       │   ├── doc-ribbon/         # Page banner: status bar and alerts
│       │   ├── steward-console/    # Global admin settings
│       │   ├── realm-console/      # Space-level admin settings
│       │   └── panel-setup/        # Macro configuration (columns, layout)
│       ├── kit/                    # Shared UI utilities
│       └── tokens/                 # CSS design tokens per surface
├── static/                         # Webpack-bundled frontend modules
├── docs/                           # Documentation
└── webpack.config.js               # Frontend build configuration
```

### Capsule System

The backend is organized into **capsules** -- autonomous feature modules that encapsulate their own resolvers, services, and utilities:

| Capsule | Actions | Responsibility |
|---------|---------|---------------|
| **Sealing** | 8 | Seal/unseal operations, seal state queries, expiry logic, version tracking, restore from trash, purge |
| **Bulletins** | 9 | Toast, banner and comment notification dispatch, watch/unwatch, dispatch acknowledgement |
| **Policies** | 8 | Settings storage and retrieval at global and space level, ruleset management |
| **Realms** (`realms/`) | 11 | Space-level administration, force-unseal, space admin access requests, async scanning, audit queues |
| **Operators** (`operators/`) | 5 | User identity resolution, profile lookups, group membership, CQL-based search |
| **Panels** | 12 | Data aggregation for frontend rendering, upload, delete, label, panel inject/extract, thumbnail preview |
| **Entitlements** | 3 | Permission checks, license verification, space-admin override status |

All capsule actions are aggregated in `src/server/registry.js`, which creates a single Forge Resolver that routes incoming requests by action key. A `heartbeat` action provides health checking.

### Frontend (6 Custom UI Surfaces)

| Surface | Forge Module | Purpose |
|---------|-------------|---------|
| **Inline Panel** | `macro` | Embedded panel on Confluence pages showing seal status, seal/unseal controls, upload, labels, delete/restore/purge |
| **Overlay** | Modal (invoked from other surfaces) | Full-featured attachment management with column picker, sort, pagination, panel visibility toggle |
| **Doc Ribbon** | `confluence:pageBanner` | Persistent notification bar showing seal counts, alerts, and a "Manage Attachments" button |
| **Site Console** (site settings console) | `confluence:globalSettings` | Site-wide admin dashboard for policies and notification config (4 tabs: General, Alerts, Validations, Classification) |
| **Space Console** (space console) | `confluence:spacePage` | Per-space admin panel with 8 tabs: My Sealed Files, Sealed Files, Access Control, Seal Duration, Macro, Validations, Workflow, Activity |
| **Panel Setup** | Macro `config` | Configure inline-panel display: column visibility, rows per page, cards per row, upload zone toggle |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Platform** | Atlassian Forge |
| **Runtime** | Node.js 22.x |
| **Frontend** | React 19, Webpack 5 |
| **Storage** | Forge KVS (with query indexes) |
| **Build** | Babel 7, ESLint 8, Webpack 5 |
| **Theming** | CSS custom properties (`--sv-` prefix), dark mode support |

---

## Prerequisites

- **Node.js 22+** (Forge runtime is `nodejs22.x`)
- **Atlassian Forge CLI** (`npm install -g @forge/cli`)
- **An Atlassian Cloud developer site** ([get one free](https://developer.atlassian.com/platform/forge/getting-started/))

---

## Setup

### 1. Clone and install

```bash
git clone <repository-url>
cd sentinel-vault
npm install
```

### 2. Register a new Forge app

```bash
forge register
```

This updates the `app.id` in `manifest.yml` with your own app ID.

### 3. Build the frontends

```bash
npm run build
```

This builds all 6 UI surfaces via Webpack into `static/`.

### 4. Deploy and install

```bash
forge deploy
forge install    # Select your Confluence site when prompted
```

### 5. Use it

1. Navigate to any Confluence page with attachments
2. Insert the **Sentinel Vault** macro from the editor
3. Click **Seal** on any attachment you want to protect
4. Edit the file with confidence -- no one else can overwrite it
5. Release the seal when you're done

---

## Development

```bash
# Authenticate with Forge
forge login

# Run Forge tunnel for live backend reloading
forge tunnel

# Watch mode for frontend changes
npm run dev

# Lint
npm run lint
```

**Important:** After making frontend or CSS changes, always run `npm run build` before `forge deploy` to ensure the static bundles are up to date.

---

## Permissions

The app requests the following Forge permissions:

| Scope | Purpose |
|-------|---------|
| `read:confluence-content.all` | Read page and attachment data |
| `read:confluence-content.summary` | Read content summaries |
| `write:confluence-content` | Write comments, update attachments (for reversion) |
| `write:confluence-file` | Upload attachment files (for reversion and user uploads) |
| `readonly:content.attachment:confluence` | Read-only attachment access |
| `read:confluence-space.summary` | Resolve space context for space-level settings |
| `read:space:confluence` | Read space metadata |
| `read:confluence-props` | Read content properties (seal status) |
| `write:confluence-props` | Write content properties (seal markers) |
| `read:confluence-content.permission` | Check content permissions |
| `read:confluence-user` | Resolve user identity for seal ownership |
| `read:confluence-groups` | Resolve group membership for space-admin groups |
| `search:confluence` | CQL queries for sealed attachment discovery |
| `read:content:confluence` | Read content via v2 API |
| `read:content-details:confluence` | Read content details via v2 API |
| `read:page:confluence` | Read pages via v2 API |
| `write:page:confluence` | Write pages via v2 API (content protection restoration) |
| `write:content:confluence` | Write content via v2 API |
| `read:attachment:confluence` | Read attachments via v2 API |
| `write:attachment:confluence` | Write attachments via v2 API |
| `delete:attachment:confluence` | Delete attachments (trash management) |
| `read:comment:confluence` | Read comments via v2 API |
| `write:comment:confluence` | Write comments via v2 API (violation notifications) |
| `read:content.property:confluence` | Read content properties via v2 API |
| `write:content.property:confluence` | Write content properties via v2 API |
| `read:content.restriction:confluence` | Read content restrictions |
| `write:content.restriction:confluence` | Write content restrictions |
| `read:content.metadata:confluence` | Read content metadata |
| `read:content.permission:confluence` | Read content permissions |
| `read:label:confluence` | Read page labels (label-scoped workflows, state mirroring) |
| `storage:app` | Persist seal records, settings, and audit logs |

There are **no external fetch permissions** (`permissions.external` is absent from the manifest). The app has no external dependencies and is eligible for the **"Runs on Atlassian"** Marketplace badge. All notifications are posted as Confluence footer comments with `@mention` of the recipient; Confluence's own notification engine emails the user according to their personal preferences.

---

## Documentation

Start at the **[docs index](docs/README.md)**.

**Feature guides** (each with step-by-step testing, embedded screenshots, and a walkthrough video):

| Feature | Guide | Demo |
|---------|-------|------|
| Edit Requests | [docs/features/edit-requests.md](docs/features/edit-requests.md) | [video](docs/media/videos/03-space-edit-requests.mp4) |
| Content Sealing (sections) | [docs/features/content-sealing.md](docs/features/content-sealing.md) | [video](docs/media/videos/01-inline-panel-features.mp4) |
| Conditions & Validations | [docs/features/conditions-validations.md](docs/features/conditions-validations.md) | [video](docs/media/videos/02-space admin-validations-ai.mp4) |
| Semantic AI Validations | [docs/features/semantic-ai-validations.md](docs/features/semantic-ai-validations.md) | [video](docs/media/videos/01-inline-panel-features.mp4) |

**Testing:** [docs/TESTING.md](docs/TESTING.md) — unit results (65/65), `forge lint`, build, deploy/install (v4.0.0, Runs on Atlassian), frontend render verification, and the per-feature proof matrix. Plus the black-box E2E harness in [test-harness/](test-harness/README.md).

**Reference:**

| Document | Description |
|----------|-------------|
| [Architecture](docs/architecture.md) | Project structure, capsule system, data flow, storage model, and performance patterns |
| [Deployment](docs/deployment.md) | Setup, building, deploying, and local development |
| [User Guide](docs/user-guide.md) | End-user and administrator feature guide |
| [Notifications](docs/notifications.md) | Notification channels, comment types, feature flags, quiet mode, and scheduled tasks |
| [Contributing](docs/contributing.md) | Development workflow, conventions, and testing |
| [Settings Reference](docs/settings-reference.md) | Complete reference for all site settings console and space console settings |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and solutions |

The `docs/api/` directory contains Confluence Cloud event specifications and OpenAPI specifications (v1 and v2) for development reference.

---

## Contributing

Contributions are welcome and encouraged.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `npm run lint` and `npm run build`
5. Submit a pull request

See [Contributing](docs/contributing.md) for detailed conventions and testing guidance.

---

## LeanZero Ecosystem

Sentinel Vault is part of the **[LeanZero](https://leanzero.net)** family of Atlassian Forge apps:

| App | Platform | Purpose |
|-----|----------|---------|
| **[CogniRunner](https://github.com/leanzero-srl/leanzero-cognirunner-forgeapp)** | Jira | AI-powered semantic workflow validation |
| **Sentinel Vault** | Confluence | Attachment protection and concurrent edit prevention |

Built by [LeanZero](https://leanzero.net) -- intelligent tooling for Atlassian Cloud.

---

## License

MIT

---

Part of [LeanZero](https://leanzero.net) by Mihai Perdum.
