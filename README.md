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
- **Infinite Loop Prevention** -- The system's own restoration uploads are filtered out so reversion doesn't trigger itself.

### Multi-Channel Notifications

When a seal violation occurs (or other notable events happen), Sentinel Vault notifies through multiple channels simultaneously:

| Channel | Description |
|---------|-------------|
| **Toast Messages** | In-app popup notifications via Forge bridge |
| **Page Banners** | Persistent ribbon alerts on the affected Confluence page |
| **Confluence Comments** | Automated bulletin comments on the page footer |
| **Email Alerts** | Templated emails via Resend API to the seal holder and administrators |

Each channel can be independently enabled or disabled at both the global and space level.

### Administration

- **Global Settings (Steward Console)** -- Site-wide administration panel for configuring default seal duration, notification preferences, and steward cohort groups.
- **Space Settings (Realm Console)** -- Space-level administration (visible only to space admins) for per-space policy overrides.
- **Steward Override** -- Administrators can force-release seals held by other users when needed (e.g., someone seals a file and goes on vacation).
- **Configurable Seal Duration** -- Default 48 hours, adjustable per policy. Seals expire automatically after the configured period.

### Automated Maintenance

Sentinel Vault runs several scheduled tasks to keep the system healthy:

| Task | Frequency | Purpose |
|------|-----------|---------|
| **Expiry Sweep** | Hourly | Automatically releases expired seals |
| **Seal Index Cron** | Hourly | Maintains performance indexes for seal lookups |
| **Recurring Nudge** | Daily | Sends reminder emails about active seals nearing expiry |
| **Halfway Check** | Custom interval | Sends a 50%-duration reminder to seal holders |
| **Realm Scan Consumer** | On demand | Async queue processor for space-level auditing |

### Role-Based Access

- **Operators** -- Regular users who can seal and unseal their own attachments
- **Realm Stewards** -- Space administrators with override capabilities
- **Steward Cohort Groups** -- Configurable admin groups with elevated permissions
- **Site Administrators** -- Full access to global settings and all overrides

---

## How It Works

```
User seals an attachment via the Sentinel Vault macro panel
  → Seal record written to Forge KVS (operator, timestamp, expiry, artifact ID)
  → Content property set on the page for CQL queryability
  → Page banner and macro panel update to show sealed status

Another user uploads a new version of the sealed attachment
  → Forge event trigger fires (avi:confluence:updated:attachment)
  → Sentinel Vault checks if the attachment is sealed
  → If sealed and the uploader is not the seal holder:
    → Previous version downloaded via Confluence API
    → Previous version re-uploaded, restoring the original
    → Notifications dispatched (toast, banner, comment, email)
    → Violation logged

Seal expires (or user manually releases)
  → Seal record removed from KVS
  → Content property cleared
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
│   │   ├── capsules/               # 7 modular feature domains
│   │   │   ├── sealing/            # Core file locking logic
│   │   │   ├── bulletins/          # Multi-channel notification dispatch
│   │   │   ├── policies/           # Global and realm-level configuration
│   │   │   ├── realms/             # Space administration and auditing
│   │   │   ├── operators/          # User management and profiles
│   │   │   ├── panels/             # Frontend panel rendering logic
│   │   │   └── entitlements/       # Permission and authorization checks
│   │   ├── infra/                  # Email, artifact, document utilities
│   │   └── shared/                 # Authorization, configuration, defaults
│   └── ui/                         # React frontend utilities
├── static/                         # Webpack-bundled frontend modules
│   ├── sentinel-vault-panel/       # Macro: inline seal status panel
│   ├── sentinel-vault-ribbon/      # Page banner: violation alerts
│   ├── steward-console/            # Global admin settings
│   └── realm-console/              # Space-level admin settings
├── docs/                           # Documentation
└── webpack.config.js               # Frontend build configuration
```

### Capsule System

The backend is organized into **capsules** -- autonomous feature modules that encapsulate their own resolvers, services, and utilities:

| Capsule | Responsibility |
|---------|---------------|
| **Sealing** | Seal/unseal operations, seal state queries, expiry logic |
| **Bulletins** | Toast, banner, comment, and email notification dispatch |
| **Policies** | Settings storage and retrieval at global and realm level |
| **Realms** | Space-level administration, async scanning, audit queues |
| **Operators** | User identity resolution, profile lookups, group membership |
| **Panels** | Data aggregation for frontend macro and banner rendering |
| **Entitlements** | Permission checks, role resolution, access control |

### Frontend (4 Custom UI Modules)

| Module | Purpose |
|--------|---------|
| **Sentinel Vault Panel** (Macro) | Inline panel on Confluence pages showing seal status, seal/unseal controls |
| **Sentinel Vault Ribbon** (Page Banner) | Persistent notification bar for violation alerts and seal reminders |
| **Steward Console** (Global Settings) | Site-wide admin dashboard for policies and notification config |
| **Realm Console** (Space Settings) | Per-space admin panel for local policy overrides |

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
npm run start

# Lint
npm run lint
```

---

## Permissions

The app requests the following Forge permissions:

| Scope | Purpose |
|-------|---------|
| `read:confluence-content.all` | Read page and attachment data |
| `write:confluence-content` | Write comments, update attachments (for reversion) |
| `read:confluence-space.summary` | Resolve space context for realm-level settings |
| `read:confluence-props` | Read content properties (seal status) |
| `write:confluence-props` | Write content properties (seal markers) |
| `read:confluence-user` | Resolve user identity for seal ownership |
| `search:confluence` | CQL queries for sealed attachment discovery |
| `storage:app` | Persist seal records, settings, and audit logs |

External fetch permissions:
- `api.atlassian.com` -- Confluence Cloud REST API
- `api.resend.com` -- Email delivery service

---

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/architecture.md) | Project structure, capsule system, data flow, and storage model |
| [Deployment](docs/deployment.md) | Setup, building, deploying, and local development |
| [User Guide](docs/user-guide.md) | End-user and administrator feature guide |
| [Notifications](docs/notifications.md) | Notification channels, feature flags, and email configuration |
| [Contributing](docs/contributing.md) | Development workflow, conventions, and testing |

The `docs/api/` directory contains Confluence Cloud OpenAPI specifications (v1 and v2) for development reference.

---

## Contributing

Contributions are welcome and encouraged.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

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
