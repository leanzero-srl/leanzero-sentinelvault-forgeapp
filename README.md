# Sentinel Vault

**Attachment protection and concurrent edit prevention for Confluence.**

Part of the [LeanZero](https://leanzero.atlascrafted.com) ecosystem.

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
- **Delete and Trash Protection** -- If someone trashes a sealed attachment, Sentinel Vault automatically restores it from the trash. If an attachment is permanently deleted, all associated seal records, content properties, and realm indexes are cleaned up, and the seal owner is notified.
- **Infinite Loop Prevention** -- The system's own restoration uploads are filtered out (via a cached app account ID) so reversion doesn't trigger itself.

### Attachment Management

The inline panel and overlay provide full attachment management beyond just sealing:

- **Upload** -- Drag-and-drop or click to upload new attachments directly from the Sentinel Vault panel (up to 4 MB per file, base64 encoded).
- **Labels** -- Add and remove labels on any attachment for organization and filtering.
- **Delete / Restore / Purge** -- Delete unsealed attachments (moves to trash), restore trashed attachments that still have seal data, or purge leftover seal records for permanently deleted files. Each action is gated by a separate admin toggle.
- **Thumbnail Previews** -- Expandable card rows show lazy-loaded image thumbnails for visual file identification.
- **Configurable Layout** -- Choose which columns to display (name, status, owner, labels, comment, actions, file size, file type, expiry), set rows per page (5/10/15/25), cards per row (1/2/3), and toggle the upload zone.

### Watch / Notify Me

Users can **watch** attachments sealed by other users. When the seal is released -- whether manually, by expiry, or by steward override -- all watchers receive a notification email. This eliminates the need to repeatedly check whether a file is available.

### Multi-Channel Notifications

When a seal violation occurs (or other notable events happen), Sentinel Vault notifies through multiple channels simultaneously:

| Channel | Description |
|---------|-------------|
| **Toast Messages** | In-app popup notifications via Forge Bridge `showFlag` API |
| **Page Banners** | Persistent ribbon alerts on the affected Confluence page |
| **Confluence Comments** | Automated footer comments on the page with @mentions |
| **Email Alerts** | Templated HTML emails via Resend API (8 email types) |
| **Watch Notifications** | Release emails sent to users watching a sealed attachment |

Each channel can be independently enabled or disabled at the global level through the steward console.

### Administration

#### Steward Console (Global Settings)

Site-wide administration panel accessible under **Confluence administration > Apps > Sentinel Vault Admin**. Two tabs:

**General tab:**
- Default seal duration (hours, minimum 1)
- Allow steward force-unseal
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
- Enable email notifications (master toggle)
- Seal confirmation emails (nested under email master toggle)
- Seal expiry reminder emails (nested)
- Recurring reminder emails (nested)

#### Realm Console (Space Settings)

Space-level administration accessible under **Space settings > Apps > Sentinel Vault**. Tabs vary by role:

**Regular users see:**
- **My Sealed Files** -- All attachments sealed by the current user in this space, with unseal controls

**Stewards additionally see:**
- **Realm Sealed Files** -- All sealed attachments across the space with column picker, sort, force-unseal, and watch controls
- **Access Control** -- Realm activation toggle (active/disabled), manage individual steward users, manage steward guilds (Confluence groups), and review pending steward access requests (approve/deny)
- **Reservation Duration** -- Use system default or set a custom per-space seal duration
- **Macro** -- Auto-insert macro toggle and macro position (top/bottom of page)

#### Steward Access Requests

Non-steward users can request steward access from the **My Sealed Files** tab. Stewards review and approve or deny requests from the **Access Control** tab. Denied users may re-request after 48 hours.

#### Configurable Seal Duration

Default is 24 hours (configurable in the steward console). Individual spaces can override the global default in the realm console. The baseline constant in code is 48 hours (`BASELINE_HOLD_SPAN`), but the steward console initializes the UI default to 24 hours. Seals expire automatically when expiry notifications are enabled.

### Automated Maintenance

Sentinel Vault runs several scheduled tasks and event triggers to keep the system healthy:

| Task | Frequency | Purpose |
|------|-----------|---------|
| **Expiry Sweep** | Hourly | Releases expired seals (when expiry notifications enabled), sends halfway reminder emails at 50% duration, sends expiry notification emails |
| **Seal Index Cron** | Hourly | Rebuilds performance indexes for realm seal lookups using `protections-last-modified` timestamp optimization |
| **Recurring Nudge** | Daily | Sends periodic reminder emails about active seals (only when expiry notifications are disabled) |
| **Realm Scan Consumer** | On demand | Async queue processor (900s timeout) for space-level seal index auditing |
| **Attachment Event Trigger** | Real-time | Fires on attachment updated/trashed/deleted -- detects violations, restores files, cleans up seals |
| **Page Content Trigger** | Real-time | Fires on page updated -- detects removed sealed media embeds and surgically re-inserts them |
| **Lifecycle Trigger** | On install/uninstall | Cleans up all KVS records on app uninstall |

### Role-Based Access

| Role | Capabilities |
|------|-------------|
| **Operators** | Regular users who can seal and unseal their own attachments, watch others' seals, request steward access |
| **Realm Stewards** | Space administrators and delegated users with force-unseal, access control, realm policy, and audit capabilities |
| **Steward Guilds** | Confluence groups configured as steward teams -- all members receive steward privileges |
| **Site Administrators** | Full access to global settings via the steward console, plus steward capabilities in all spaces |

Steward status is determined by any of: Confluence space ADMINISTER permission, membership in configured steward guilds/users, or site/org admin status.

---

## How It Works

```
User seals an attachment via the Sentinel Vault panel or overlay
  → Seal record written to Forge KVS (operator, timestamp, expiry, artifact ID, version)
  → Content property set on the page for CQL queryability
  → Realm-seal index written for space-level queries
  → If auto-insert enabled: panel macro embedded in page ADF
  → Seal confirmation email sent (if enabled)
  → Page banner and macro panel update to show sealed status

Another user uploads a new version of the sealed attachment
  → Forge event trigger fires (avi:confluence:updated:attachment)
  → Sentinel Vault checks if the attachment is sealed
  → Compares uploader account ID against seal holder and app account ID
  → If sealed and uploader is not the seal holder or the app itself:
    → Previous version downloaded via Confluence REST API
    → Previous version re-uploaded, restoring the original
    → Confluence comment posted with @mentions (seal owner + editor)
    → Violation alert email sent to seal owner and editor
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
  → Watcher notification emails sent
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
│   │   ├── registry.js             # Action router (Forge Resolver, 57 action keys)
│   │   ├── triggers.js             # Event and scheduled trigger handlers
│   │   ├── capsules/               # 7 modular feature domains
│   │   │   ├── sealing/            # Core file locking logic (8 actions)
│   │   │   ├── bulletins/          # Multi-channel notification dispatch (9 actions)
│   │   │   ├── policies/           # Global and realm-level configuration (8 actions)
│   │   │   ├── realms/             # Space administration and auditing (11 actions)
│   │   │   ├── operators/          # User management and profiles (5 actions)
│   │   │   ├── panels/             # Frontend panel rendering logic (12 actions)
│   │   │   └── entitlements/       # Permission and authorization checks (3 actions)
│   │   ├── infra/                  # Email, artifact, document utilities
│   │   └── shared/                 # Authorization, configuration, defaults
│   └── ui/
│       ├── surfaces/               # 6 independent React applications
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
| **Bulletins** | 9 | Toast, banner, comment, and email notification dispatch, watch/unwatch, dispatch acknowledgement |
| **Policies** | 8 | Settings storage and retrieval at global and realm level, ruleset management |
| **Realms** | 11 | Space-level administration, force-unseal, steward access requests, async scanning, audit queues |
| **Operators** | 5 | User identity resolution, profile lookups, group membership, CQL-based search |
| **Panels** | 12 | Data aggregation for frontend rendering, upload, delete, label, panel inject/extract, thumbnail preview |
| **Entitlements** | 3 | Permission checks, license verification, steward override status |

All capsule actions are aggregated in `src/server/registry.js`, which creates a single Forge Resolver that routes incoming requests by action key. A `heartbeat` action provides health checking.

### Frontend (6 Custom UI Surfaces)

| Surface | Forge Module | Purpose |
|---------|-------------|---------|
| **Inline Panel** | `macro` | Embedded panel on Confluence pages showing seal status, seal/unseal controls, upload, labels, delete/restore/purge |
| **Overlay** | Modal (invoked from other surfaces) | Full-featured attachment management with column picker, sort, pagination, panel visibility toggle |
| **Doc Ribbon** | `confluence:pageBanner` | Persistent notification bar showing seal counts, alerts, and a "Manage Attachments" button |
| **Steward Console** | `confluence:globalSettings` | Site-wide admin dashboard for policies and notification config (2 tabs, 17 settings) |
| **Realm Console** | `confluence:spacePage` | Per-space admin panel with 5 tabs: My Sealed Files, Realm Sealed Files, Access Control, Reservation Duration, Macro |
| **Panel Setup** | Macro `config` | Configure inline-panel display: column visibility, rows per page, cards per row, upload zone toggle |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Platform** | Atlassian Forge |
| **Runtime** | Node.js 20.x |
| **Frontend** | React 19, Webpack 5 |
| **Storage** | Forge KVS (with query indexes) |
| **Email** | Resend API |
| **Build** | Babel 7, ESLint 8, Webpack 5 |
| **Theming** | CSS custom properties (`--sv-` prefix), dark mode support |

---

## Prerequisites

- **Node.js 20+** (Forge runtime is `nodejs20.x`)
- **Atlassian Forge CLI** (`npm install -g @forge/cli`)
- **An Atlassian Cloud developer site** ([get one free](https://developer.atlassian.com/platform/forge/getting-started/))
- **A Resend API key** (for email notifications -- optional but recommended)

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

### 3. Set environment variables

```bash
forge variables set RESEND_API_KEY your-resend-api-key    # optional, for email notifications
```

### 4. Build the frontends

```bash
npm run build
```

This builds all 6 UI surfaces via Webpack into `static/`.

### 5. Deploy and install

```bash
forge deploy
forge install    # Select your Confluence site when prompted
```

### 6. Use it

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
| `read:confluence-space.summary` | Resolve space context for realm-level settings |
| `read:space:confluence` | Read space metadata |
| `write:confluence-space` | Write space-level data |
| `read:confluence-props` | Read content properties (seal status) |
| `write:confluence-props` | Write content properties (seal markers) |
| `read:confluence-content.permission` | Check content permissions |
| `read:confluence-user` | Resolve user identity for seal ownership |
| `read:email-address:confluence` | Fetch user email addresses for notifications |
| `read:confluence-groups` | Resolve group membership for steward guilds |
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
| `storage:app` | Persist seal records, settings, and audit logs |

External fetch permissions:
- `api.atlassian.com` -- Confluence Cloud REST API
- `api.resend.com` -- Email delivery service

---

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/architecture.md) | Project structure, capsule system, data flow, storage model, and performance patterns |
| [Deployment](docs/deployment.md) | Setup, building, deploying, and local development |
| [User Guide](docs/user-guide.md) | End-user and administrator feature guide |
| [Notifications](docs/notifications.md) | Notification channels, email types, feature flags, and scheduled tasks |
| [Contributing](docs/contributing.md) | Development workflow, conventions, and testing |
| [Settings Reference](docs/settings-reference.md) | Complete reference for all steward console and realm console settings |
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

Sentinel Vault is part of the **[LeanZero](https://leanzero.atlascrafted.com)** family of Atlassian Forge apps:

| App | Platform | Purpose |
|-----|----------|---------|
| **[CogniRunner](https://github.com/leanzero-srl/leanzero-cognirunner-forgeapp)** | Jira | AI-powered semantic workflow validation |
| **Sentinel Vault** | Confluence | Attachment protection and concurrent edit prevention |

Built by [LeanZero](https://leanzero.atlascrafted.com) -- intelligent tooling for Atlassian Cloud.

---

## License

MIT

---

Part of [LeanZero](https://leanzero.atlascrafted.com) by Mihai Perdum.
