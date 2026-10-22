# Sentinel Vault

**Attachment and page-section sealing, approvals and page classification for Confluence, plus sealed files on Jira issues.** Production release: 8.6.0.

Part of the [LeanZero](https://leanzero.net) ecosystem.

Sentinel Vault is an Atlassian Forge app that brings **file locking, violation detection, and automatic reversion** to Confluence Cloud attachments. When a user seals an attachment, a new version from anyone without their go-ahead is undone: Sentinel Vault restores the previous version and notifies everyone involved. On an Approved page the approval decides who may change it (see Page Workflow).

> **Why this exists:** Confluence has no native file locking. Teams working on shared documents -- contracts, design files, spreadsheets -- routinely overwrite each other's work. Sentinel Vault puts a seal on the file and undoes the overwrite.

---

## Why Sentinel Vault Exists

Confluence attachments are a free-for-all. Any user with edit access can upload a new version of any attachment at any time, with no coordination mechanism. This creates real problems:

- **Concurrent edits** -- Two people download a spreadsheet, edit it offline, and upload their versions. One person's work is silently lost.
- **Accidental overwrites** -- Someone uploads the wrong file version, replacing hours of work.
- **No audit trail for intent** -- Confluence tracks *who* changed a file but has no concept of *who was supposed to be editing it*.

Sentinel Vault answers all three by adding a **seal (lock) layer** on top of Confluence attachments. Seal a file before editing, and changes by anyone you have not let in are undone until you're done.

---

## What It Does

### Core Protection

- **Attachment Sealing** -- Lock any attachment before editing. Other users see the seal status and who holds it. Seals are enforced by the app, not just shown: Confluence still accepts the upload, and Sentinel Vault then undoes it.
- **Automatic Reversion** -- If someone other than the seal's owner or an editor they approved uploads a new version of a sealed attachment, Sentinel Vault detects the change when Confluence reports it, downloads the previous version, re-uploads it, and restores the file to its pre-violation state. The unauthorized edit is undone automatically.
- **Content Protection** -- When a sealed attachment is embedded in a page body (e.g., an inline image or file preview), Sentinel Vault monitors page edits. If someone removes the sealed embed, the system detects the missing media reference, retrieves it from the previous page version, and re-inserts it at its original position -- without reverting any other page changes.
- **Delete and Trash Protection** -- If someone other than the seal's owner trashes a sealed attachment, Sentinel Vault automatically restores it from the trash; the owner trashing their own file ends the seal. On an Approved page the approval holds its seals instead (see Page Workflow). If a sealed file is permanently deleted from the trash on its own, all associated seal records, content properties, and space indexes are cleaned up, and the seal owner is notified. If the file goes with its page instead (the page is permanently deleted from the space's trash), Confluence sends no event for the file and no notice goes out: the seal record stays, and the file stays listed under **Files you hold sealed** in My work and under **My Sealed Files** in space settings, marked unavailable or missing, until its owner releases the seal or a space admin force-releases it (a seal held by an Approved page can only be force-released).
- **Infinite Loop Prevention** -- The system's own restoration uploads are filtered out (via a cached app account ID) so reversion doesn't trigger itself.

### Attachment Management

Files are sealed from the page's **⋯ → Seal attachments…** action, from the **Sentinel Vault** chip under the page title (the page-details modal, whose Attachments tab replaces the old "Manage Attachments" overlay), or from the optional inline panel macro. The panel groups files into Sealed and Available; each group shows 5 cards by default and pages on its own ("Show N more files"). Management actions:

- **Upload** -- Drag-and-drop or click to upload new attachments directly from the Sentinel Vault panel (up to 4 MB per file, base64 encoded).
- **Labels** -- Add and remove labels on any attachment for organization and filtering.
- **Delete / Restore / Purge** -- Delete unsealed attachments (moves to trash), restore trashed attachments that still have seal data, or purge leftover seal records for permanently deleted files. Each action is gated by a separate admin toggle.
- **Thumbnail Previews** -- Expandable card rows show lazy-loaded image thumbnails for visual file identification.
- **Configurable Layout** -- Choose which columns to display (name, status, owner, labels, comment, actions, file size, file type, expiry), set items per group (5/10/15/25, default 5), cards per row (1/2/3), and toggle the upload zone.

### Watch / Notify Me

Users can **watch** attachments sealed by other users. When the seal is released -- whether manually, by expiry, or by space-admin override -- all watchers are @mentioned in a page comment (Confluence's own notification engine then emails them according to their personal preferences). This needs the site's comment master switch ("Page comments that mention people"), which is off by default. This eliminates the need to repeatedly check whether a file is available.

### Multi-Channel Notifications

When a seal violation occurs (or other notable events happen), Sentinel Vault notifies through multiple channels simultaneously:

| Channel | Description |
|---------|-------------|
| **Toast Messages** | In-app popup notifications via Forge Bridge `showFlag` API |
| **Page Banners** | Persistent ribbon alerts on the affected Confluence page |
| **Comments that mention people** | Footer comments with `@mention` of the recipient (seal, violation, expiry, release, request, approval). Master switch **off by default**; the app sends no email itself |
| **Violation comments** | A comment when someone tampers with a sealed attachment or section. Off by default, and only with the master switch on |
| **Tell editors when their change is undone** | A comment addressed to the person whose edit was reverted, with a link to the version holding their text. **On** by default and independent of the master switch |
| **Watch Notifications** | A release comment @mentioning every user watching a sealed attachment (needs the master switch) |

Each channel is set in the Alerts group of the site settings. A space admin can put one space in **Quiet** mode (no comments, no mentions).

### Edit Requests

A user can request permission to edit an attachment sealed by someone else, without being granted full space-admin rights. The same works for sealed page sections. The **seal owner** answers **Approve** or **Decline** on the file's row (page-details modal, inline panel), on the page ribbon, on **My work**, or with **Approve** / **Deny** in the space console's My Sealed Files tab; a decline can carry a short reason. The owner can also give edit access directly at any time. Approved editors can replace the file while the seal holds; a new version from anyone else is undone. Grants are scoped to the attachment and are swept automatically when the seal is released, expires, or the attachment is deleted.

After a decline the same person waits before asking again. The wait is the site setting **Hours before a declined edit request can be repeated** (`editRequestCooldownHours`): default **1 hour**, 0 = ask again at once, maximum 168.

### Content Sealing (Sections)

Beyond attachments, you can lock a **section of a Confluence page** -- a heading and its content -- against unauthorized edits. Pick a heading from the page-details modal (**Seal a section…**) or the panel's *Sealed Sections* group; the app wraps it in a "Sealed Section" macro carrying a stable id. If anyone other than the owner edits the body or removes the macro, the page-update trigger restores the sealed content from a snapshot (the same detect-and-restore mechanism used for sealed attachment embeds). The owner or a space admin can release the section at any time.

### Sealed Files on Jira Issues

Since 8.0.0 the same installation can seal attachments on Jira issues. Nothing happens on Jira until a site admin connects it (Atlassian Administration → Apps → Sites → your site → Connected apps → Sentinel Vault, then on the **Connections** tab connect Jira, listed as Jira Apps). After that, every issue has a **Sentinel Vault** section in its right-hand column listing the issue's files:

- Anyone who can edit the issue can seal a file for a chosen time, with an optional note; the owner can extend or release it, and a Jira or project admin can extend it or force-release it with a typed reason.
- Sentinel Vault keeps a copy of every sealed file (up to 25 MB) in the Forge Object Store. If anyone but the owner deletes the file while its seal holds, the copy is uploaded back to the same issue under the same name and the seal moves to it. Jira gives the put-back file a new attachment id, and its author is Sentinel Vault.
- If a file cannot be put back, the section shows it as **Not put back** with a **Put it back** button, and Sentinel Vault retries on its own.
- If the issue itself is deleted, the copy is kept for 30 days; its owner can download it from **My work** under its own name, or delete it at once with **Let it go**.
- The site settings for seal duration, expiry, signing, force release and the comment switches apply to Jira too. Design notes: [docs/JIRA-SEALS.md](docs/JIRA-SEALS.md).

### Conditions & Validations

Define rules that Confluence pages are checked against on create and edit -- required headings/tables/labels, heading hierarchy, length limits, and more. Because Forge page events fire **after** a save, enforcement is applied post-save in one of three selectable modes: **advisory** (post a comment listing issues), **gate** (stamp a pass/fail status the panel and ribbon display), and **revert** (restore the last compliant version -- strict, opt-in, may discard work). Rules are authored in the site settings console's *Validations* tab (a space can have its own in the space console's Validations tab).

### Semantic AI Validations (Runs on Atlassian)

AI-powered content review using **Atlassian-hosted Claude via the Forge LLM API** -- no bring-your-own-key, no external API keys, and no data egress, so the app keeps its **"Runs on Atlassian"** badge. Admins configure custom rules, a style guide, tone/voice requirements, and compliance standards; users run a review on demand from the panel's *AI Review* group. Findings (severity, excerpt, explanation, suggestion) are reported in the panel and optionally as an @mention comment to the page author. AI is **off by default**, limited to Claude Haiku for cost control, and bounded by a per-space monthly token budget.

### Page Workflow

Each space can run a document workflow. The built-in one is Draft → In Review → Approved, with a lapsed state "Needs re-review" (Approved pages are due for re-review after 150 days unless the space sets another period). Approvers are named per space (any one, all, or a minimum number). Configure it in the space console's **Workflow** tab.

Approved pages are protected. When someone who is not an approver or a space admin edits one, the Workflow tab's choice decides what happens:

- **Move it back to an earlier state** (the default) -- their edit stays and the page goes back for a new review, to the workflow's first state (Draft in the built-in one) unless the space picks another.
- **Revert to the approved version** -- their edit is discarded and the version that was approved is restored. Stricter: their text is no longer on the page.

While a page is Approved, its seals stay in force until the approval ends: a sealed file on it replaced or trashed by anyone other than the page's approvers or a space admin is put back. Edits to Approved pages are undone or sent back only while the site setting **Protect Sealed Attachments in Page Body** is on; while it is off, the Workflow tab, the page banner and the page details say Approved pages are not protected.

### Classification

Every page can carry a sensitivity level. Classification is **off until a site admin turns it on** (Site settings → Classification, one switch; turning it off keeps every stored level). The default levels are **Public, Internal, Confidential, Restricted** (rank 1 to 4); they can be renamed, recoloured, extended, or imported from **JSM Assets** (read-only, called as the signed-in admin). A space admin sets a **space default** (space console → Access Control) or opts the space out; anyone who can edit a page can override its level from the page-details modal. The page's own level wins, then the space default, otherwise "Unclassified". Raising a level is one pick; **lowering or clearing it needs a reason** (up to 300 characters), recorded in the activity log.

### Signing actions with an authenticator code

- **Seal actions (site setting, off by default):** with **Sign seal actions with an authenticator code** on, sealing and releasing files or sections, extending a seal, force release, and approving, declining, giving or revoking edit access all ask for the current 6-digit code, and so do sealing, extending and releasing a Jira file and letting go of a deleted issue's copy on My work. People without an authenticator set up are refused until they add one. Two paths are not signed: a section sealed by inserting the Sealed Section macro in the editor and publishing, and REST API jobs (they call the actions directly, without the signing check).
- **Approvals (per space):** the Workflow tab's signature setting makes each approver sign their own decision (a space admin's direct approval too; with no named approvers only a space admin can approve, and the requester signs only when an AI review step is involved).
- Each person sets up their authenticator app once on **My work**. Codes are single-use; 5 wrong codes lock that person's signing for 15 minutes.

### Activity Log

Seals, releases, forced releases, reverts and restores, edit requests, workflow moves and approvals, validation outcomes and classification changes are recorded per page and per space. Space admins read it in the space console's **Activity** tab, filter it, and export it as CSV. History is kept unless a site admin turns on **Delete old history** (Site settings → Privacy and retention; off by default). With it on, activity history, workflow history and read confirmations older than **Keep history for** (730 days unless changed) are deleted by a weekly check; a Jira file's seal history follows the same setting.

### Backup and Restore

Sentinel Vault backs up its settings, seals, sealed sections, workflows, validation rules, classification and history after each change and once a day, to a Confluence page restricted to the app. After a reinstall, Site settings offer to restore the setup from a backup, with a preview; anything that acts on its own comes back paused until you turn it on. The whole setup can also be downloaded as one JSON file and imported later. REST API tokens and authenticator codes are never backed up. See [docs/BACKUP-AND-RESTORE.md](docs/BACKUP-AND-RESTORE.md).

### Privacy and Personal Data

A weekly check reports the account ids Sentinel Vault stores to Atlassian's personal data reporting API. When Atlassian answers that an account was closed, the app erases that person everywhere it keeps them, including the backup; sealed section content is the record of what was sealed and is not rewritten. The check can also be run at once from **Site settings → Privacy and retention**, which holds the **Delete old history** setting too.

### REST API

Site admins mint named tokens in **Site settings → API access** with a role of **Admin** (site and space configuration plus content operations), **Editor** (content operations, including giving, revoking and declining edit access) or **Viewer** (no writes). The plaintext (`svt_…`) is shown once; only its SHA-256 hash is stored. A token acts as the admin who minted it, so it can do nothing that person cannot, and it stops working if they are no longer a site admin. One `POST` endpoint accepts configuration bundles and content operations (Jira file seals included) and answers with a status only; results are read back from Confluence properties. Admin tokens can also run backup, restore, export and import, and the weekly privacy check. See [docs/REST-CONFIG-API.md](docs/REST-CONFIG-API.md).

### Administration

#### Site settings (global)

Under **Confluence administration > Apps > Sentinel Vault — Site settings**. Five tabs:

- **Settings** -- grouped as *Protection* (force-unseal for space admins, content protection, delete / restore / cleanup from the page, signed seal actions, edit-request cooldown), *Expiry* (default seal duration, whether seals expire, overdue reminders, recurring reminder banner), *Alerts* (pop-ups, page ribbon, comment channels), *Classification*, *Privacy and retention* (Delete old history, Keep history for, the weekly personal-data check) and *Advanced* (auto-insert and replace-Attachments macro)
- **Validations** -- content rules and the optional AI review
- **Classification** -- the on/off switch, the levels, JSM Assets import, and space defaults
- **API access** -- the endpoint, tokens and recent jobs
- **Backup and restore** -- the latest backup, Back up now, restore, export and import

Settings reference: [docs/settings-reference.md](docs/settings-reference.md).

#### Space console

A space page named **Sentinel Vault** in each space. Tabs vary by role:

**Regular users see:**
- **My Sealed Files** -- Attachments sealed by the current user in this space, with release controls and their edit requests

**Space admins see:**
- **Sealed Files** -- All sealed attachments across the space with column picker, sort, watch controls and **Force release** (with a recorded reason). Force release is offered only when the site setting **Allow space admins to force-unseal** is on (it is on by default)
- **Access Control** -- Space admin users and groups, pending space admin access requests, quiet mode, classification in this space and its default level
- **Seal Duration** -- Site default or a custom per-space seal duration
- **Macro** -- Auto-insert macro toggle and macro position (top/bottom of page)
- **Validations**, **Workflow**, **Activity**

#### My work

A Confluence app page (**Sentinel Vault — My work**) listing, across every space, what is waiting on you (approvals, edit requests on your seals), your own edit and approval requests, the files you hold sealed (on Confluence and on Jira issues), the copies of sealed files whose Jira issue was deleted, and your authenticator setup.

#### Admin access requests

Users without admin access can request space admin access from the **My Sealed Files** tab. Space admins review and approve or deny requests from the **Access Control** tab. Denied users may re-request after 48 hours.

#### Configurable Seal Duration

Default is 48 hours (`BASELINE_HOLD_SPAN`), configurable in the site settings. Individual spaces can override the site default in the space console. Seals expire automatically when **Seals expire** is on (the default).

### Automated Maintenance

Sentinel Vault runs several scheduled tasks and event triggers to keep the system healthy:

| Task | Frequency | Purpose |
|------|-----------|---------|
| **Expiry Sweep** | Hourly | Halfway and expiry notices, overdue reminders, then release of expired seals (when seals expire) |
| **Seal Index Cron** | Hourly | Rebuilds performance indexes for space seal lookups, queues a backup when one is due, and runs the Jira seal sweep (reminders, releases, retries of files not put back, clean-up of kept copies) |
| **Workflow Sweep** | Hourly | Workflow upkeep: marks Approved pages whose re-review date has passed and catches up on enforcement for tampered Approved pages |
| **Page Guard Sweep** | Every 5 minutes | Judges pages with live seals (and pages edited in the last 20 minutes when the site has validation rules; skipped while content protection is off) ahead of a late page event |
| **Recurring Nudge** | Daily | Records the recurring reminder banner for long-held seals (only when seals do not expire), then starts the weekly privacy check when it is due |
| **Queues** | On demand | Space scan (900 s), AI validation (120 s), REST API job (900 s), backup (900 s), privacy check (900 s) and Jira put-back (300 s) consumers |
| **Attachment Event Trigger** | On each event | Fires on attachment updated/trashed/deleted -- detects violations, restores files, cleans up seals |
| **Page Content Trigger** | On each event | Fires on page created/updated -- sealed embeds and sections, workflow enforcement and validations |
| **Jira Attachment Trigger** | On each event | Fires on Jira attachment deleted and issue deleted -- puts a sealed file back, or keeps its copy when the issue is gone |
| **Lifecycle Trigger** | On install/uninstall | Logs only. Uninstall no longer erases stored records: Forge keeps them 28 days (re-link path) and the setup survives in the backup page (docs/BACKUP-AND-RESTORE.md) |

### Role-Based Access

| Role | Capabilities |
|------|-------------|
| **Users** | Regular users who can seal and release their own attachments and sections, request edit access, watch others' seals, request space admin access; on Jira, anyone who can edit an issue can seal its files |
| **Space admins** | Space administrators and delegated users with force release (when the site allows it), access control, space policy, workflow, and activity capabilities |
| **Admin groups** | Confluence groups configured as space admin teams -- all members receive space admin privileges |
| **Jira and project admins** | Extend or force-release a sealed Jira file (force release follows **Allow space admins to force-unseal**) |
| **Site Administrators** | Full access to global settings via the site settings console, plus space admin capabilities in all spaces |

Space admin status is determined by any of: Confluence space ADMINISTER permission, membership in configured space-admin groups/users, or site/org admin status.

---

## How It Works

```
User seals an attachment (page ⋯ menu, page-details modal, or inline panel)
  → Seal record written to Forge KVS (user, timestamp, expiry, attachment ID, version)
  → Content property set on the page for CQL queryability
  → Realm-seal index written for space-level queries
  → If auto-insert enabled: panel macro embedded in page ADF
  → Seal confirmation comment posted (if enabled)
  → Page banner and macro panel update to show sealed status

Another user uploads a new version of the sealed attachment
  → Forge event trigger fires (avi:confluence:updated:attachment)
  → Sentinel Vault checks if the attachment is sealed
  → Compares uploader account ID against seal holder, approved editors and app account ID
  → If sealed and uploader is none of them:
    → Previous version downloaded via Confluence REST API
    → Previous version re-uploaded, restoring the original
    → Editor told in a page comment that their change was undone (on by default)
    → Violation comment @mentioning seal owner and editor (only if the comment switches are on)
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
  → Re-inserts missing blocks at their original positions
  → Notifications sent to seal owner

Seal expires (or user manually releases)
  → Seal record removed from KVS
  → Content property cleared
  → Realm-seal index cleaned up
  → Watcher notification comment posted (if comments are on)
  → UI updated to show unsealed status

Someone other than the owner deletes a sealed file on a Jira issue
  → Forge event trigger fires (avi:jira:deleted:attachment)
  → The app's copy is uploaded back to the issue under the same name
  → The seal moves to the new attachment id
  → Editor told in an issue comment that their change was undone (on by default)
  → If the upload fails: the file shows as Not put back and the hourly sweep retries
```

---

## Architecture

```
sentinel-vault/
├── manifest.yml                    # Forge app definition (modules, triggers, permissions)
├── src/
│   ├── boot.js                     # Entry point: exports all resolvers and triggers
│   ├── server/
│   │   ├── registry.js             # Action router (one Forge Resolver, 176 action keys + heartbeat)
│   │   ├── triggers.js             # Event and scheduled trigger handlers
│   │   ├── capsules/               # 18 feature domains (see table below)
│   │   ├── infra/                  # Comment notices, attachment, document utilities
│   │   └── shared/                 # Authorization, configuration, defaults
│   └── ui/
│       ├── surfaces/               # 10 Custom UI apps
│       │   ├── page-details/       # Byline chip modal + "Seal attachments…" action
│       │   ├── inline-panel/       # Macro: sealed / available files
│       │   ├── section-setup/      # Sealed Section bodied macro
│       │   ├── overlay/            # Full-size attachments modal
│       │   ├── doc-ribbon/         # Page banner: level, seals, requests, alerts
│       │   ├── my-work/            # Global page: what is waiting on you
│       │   ├── steward-console/    # Site settings
│       │   ├── realm-console/      # Space console
│       │   ├── panel-setup/        # Macro configuration (columns, layout)
│       │   └── jira-issue/         # Jira issue panel: the issue's files and their seals
│       ├── kit/                    # Shared UI components
│       └── tokens/                 # CSS design tokens per surface
├── static/                         # Webpack-bundled frontend modules
├── docs/                           # Documentation
└── webpack.config.js               # Frontend build configuration
```

### Capsule System

The backend is organized into **capsules** -- autonomous feature modules that encapsulate their own resolvers, services, and utilities:

| Capsule | Actions | Responsibility |
|---------|---------|---------------|
| **sealing** | 10 | Seal/release/extend attachments, seal state, restore from trash, purge, ribbon summary |
| **section-seals** | 10 | Sealed page sections |
| **editreq** | 21 | Edit requests, direct grants and revokes for files and sections |
| **workflow** | 32 | Workflow states, approvals, signatures, read acknowledgements |
| **classification** | 14 | Levels, space defaults, page levels, JSM Assets import |
| **validations** | 12 | Content rules and AI review |
| **realms** | 12 | Space administration, force release, space admin access requests, scanning |
| **bulletins** | 9 | Toast, ribbon and comment notices, watch/unwatch |
| **panels** | 9 | Panel data, upload, delete, labels, panel insert |
| **backup** | 15 | Backup, restore, export, import, backup location |
| **jira-seals** | 9 | Seals on Jira issue files, put back, kept copies of deleted issues |
| **config-api** | 7 | REST API tokens, jobs and export |
| **operators** | 5 | User identity, profiles, groups |
| **policies** | 3 | Site and space settings storage |
| **entitlements** | 3 | Permission checks, licence |
| **activity** | 2 | Activity log reads |
| **privacy** | 2 | Weekly personal-data check: status and run now |
| **page-details** | 1 | Page-details modal data |

All capsule actions are aggregated in `src/server/registry.js`, which creates a single Forge Resolver that routes incoming requests by action key. A `heartbeat` action provides health checking.

### Frontend (10 Custom UI surfaces)

| Surface | Forge Module | Purpose |
|---------|-------------|---------|
| **Page details** | `confluence:contentBylineItem` + `confluence:contentAction` | The chip under the page title opens a modal with the page's level, seals, sections and attachments; the page ⋯ menu's "Seal attachments…" opens it in sealing mode |
| **Inline Panel** | `macro` | Optional panel on the page: sealed and available files, requests, AI review |
| **Section Setup** | bodied `macro` | The Sealed Section macro |
| **Overlay** | Modal (opened from other surfaces) | Full-size attachments view with column picker, sort and paging |
| **Doc Ribbon** | `confluence:pageBanner` | Banner with the classification level, seals, requests and alerts |
| **My work** | `confluence:globalPage` | Cross-space list of what is waiting on you, your sealed files (Confluence and Jira), kept copies of deleted Jira issues, and authenticator setup |
| **Site Console** | `confluence:globalSettings` | Tabs: Settings, Validations, Classification, API access, Backup and restore |
| **Space Console** | `confluence:spacePage` | My Sealed Files (users); Sealed Files, Access Control, Seal Duration, Macro, Validations, Workflow, Activity (space admins) |
| **Panel Setup** | Macro `config` | Inline-panel display: columns, items per group, cards per row, upload zone |
| **Jira issue** | `jira:issueContext` | The Sentinel Vault section on a Jira issue: its files, seal, extend, release, force release, Put it back |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Platform** | Atlassian Forge |
| **Runtime** | Node.js 22.x |
| **Frontend** | React 19, Webpack 5 |
| **Storage** | Forge KVS (with query indexes); Forge Object Store for copies of sealed Jira files |
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

This builds all 10 UI surfaces via Webpack into `static/`.

### 4. Deploy and install

```bash
forge deploy
forge install    # Select your Confluence site when prompted
```

### 5. Use it

1. Navigate to any Confluence page with attachments
2. Open the page's **⋯** menu and choose **Seal attachments…** (or insert the **Sentinel Vault** macro)
3. Seal any attachment you want to protect
4. Edit the file with confidence -- an overwrite by anyone else is undone
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

The app requests the following 30 Forge permissions. 8.0.0 added the three Jira scopes; the call-by-call audit of the 27 Confluence-era scopes is docs/SCOPES-7.0.md, and the Jira scopes are explained in docs/JIRA-SEALS.md and the 8.0.0 release notes. The Marketplace listing for the current version shows the same 30.

| Scope | Purpose |
|-------|---------|
| `read:confluence-content.all` | Read page and attachment data |
| `read:confluence-content.summary` | Receive page and attachment events (the triggers behind seal enforcement require it) |
| `write:confluence-content` | Write comments, update attachments (for reversion) |
| `write:confluence-file` | Upload attachment files (for reversion and user uploads) |
| `readonly:content.attachment:confluence` | Read-only attachment access |
| `read:space:confluence` | Read space metadata |
| `write:confluence-props` | Write content properties (seal markers) |
| `read:confluence-content.permission` | Check content permissions |
| `read:confluence-user` | Resolve user identity for seal ownership |
| `read:confluence-groups` | Resolve group membership for space-admin groups |
| `search:confluence` | CQL queries for sealed attachment discovery |
| `read:content-details:confluence` | Read content details via v2 API |
| `read:page:confluence` | Read pages via v2 API |
| `write:page:confluence` | Write pages via v2 API (content protection restoration) |
| `read:attachment:confluence` | Read attachments via v2 API |
| `delete:attachment:confluence` | Delete attachments (trash management) |
| `write:comment:confluence` | Write comments via v2 API (violation notifications) |
| `read:label:confluence` | Read page labels (label-scoped workflows, state mirroring) |
| `read:configuration:confluence` | Read Confluence's own classification levels |
| `write:space:confluence` | Set a space's default level through Confluence's classification API |
| `read:servicedesk-request` | Find the JSM Assets workspace (classification import) |
| `read:cmdb-schema:jira`, `read:cmdb-type:jira`, `read:cmdb-object:jira`, `read:cmdb-attribute:jira` | Read JSM Assets objects to import classification levels (read-only, as the signed-in admin) |
| `read:jira-work` | Read a Jira issue and its files, and check the caller's own permissions on it |
| `write:jira-work` | Put a deleted sealed file back, comment on the issue, keep the `sentinel-vault-seals` issue property up to date |
| `read:jira-user` | Read people's names for Jira seals |
| `report:personal-data` | Report stored account ids to Atlassian's personal data reporting API (weekly check; closed accounts are erased) |
| `storage:app` | Persist seal records, settings, and audit logs |

There are **no external fetch permissions** (`permissions.external` is absent from the manifest). The REST API is a web trigger with a static response, so it returns no data. The app has no external dependencies and is eligible for the **"Runs on Atlassian"** Marketplace badge. Notifications are posted as Confluence footer comments with `@mention` of the recipient (on Jira, as a comment on the issue); Confluence's own notification engine emails the user according to their personal preferences. Seal records, settings and history are stored in Forge storage on Atlassian, and copies of sealed Jira files in the Forge Object Store.

---

## Documentation

Start at the **[docs index](docs/README.md)**.

**Feature guides** (written for 4.0; the screenshots and videos show that release's UI):

| Feature | Guide | Demo |
|---------|-------|------|
| Edit Requests | [docs/features/edit-requests.md](docs/features/edit-requests.md) | [video](docs/media/videos/03-realm-edit-requests.mp4) |
| Content Sealing (sections) | [docs/features/content-sealing.md](docs/features/content-sealing.md) | [video](docs/media/videos/04-sealed-section-macro.mp4) |
| Conditions & Validations | [docs/features/conditions-validations.md](docs/features/conditions-validations.md) | [video](docs/media/videos/02-steward-validations-ai.mp4) |
| Semantic AI Validations | [docs/features/semantic-ai-validations.md](docs/features/semantic-ai-validations.md) | [video](docs/media/videos/01-inline-panel-features.mp4) |

**Testing:** [docs/TESTING.md](docs/TESTING.md) and `npm test` (the unit suites). Plus the black-box E2E harness in [test-harness/](test-harness/README.md).

**Reference:**

| Document | Description |
|----------|-------------|
| [Architecture](docs/architecture.md) | Project structure, capsule system, data flow, storage model, and performance patterns |
| [Deployment](docs/deployment.md) | Setup, building, deploying, and local development |
| [User Guide](docs/user-guide.md) | End-user and administrator feature guide |
| [Notifications](docs/notifications.md) | Notification channels, comment types, feature flags, quiet mode, and scheduled tasks |
| [Contributing](docs/contributing.md) | Development workflow, conventions, and testing |
| [Settings Reference](docs/settings-reference.md) | Complete reference for all site settings console and space console settings |
| [REST API](docs/REST-CONFIG-API.md) | Tokens, roles, bundles and content operations |
| [Jira seals](docs/JIRA-SEALS.md) | Sealing Jira issue attachments: what was measured and decided |
| [Backup and restore](docs/BACKUP-AND-RESTORE.md) | What is backed up, restore, export and import |
| [Release notes](docs/RELEASE-NOTES.md) | Every version's changes and fixes |
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
| **Sentinel Vault** | Confluence | Sealing, approvals and classification for Confluence content |

Built by [LeanZero](https://leanzero.net) -- intelligent tooling for Atlassian Cloud.

---

## License

Apache License 2.0. See [LICENSE](./LICENSE). "Sentinel Vault" and "LeanZero" are trademarks of LeanZero SRL; the licence grants no trademark rights.

---

Part of [LeanZero](https://leanzero.net) by Mihai Perdum.
