# Settings Reference

Every configurable setting in Sentinel Vault production **6.5.0**. The one source of truth for keys, labels, groups and defaults is `src/server/capsules/policies/settings-schema.js` (`CONTROLS`, `GROUPS`), with engine defaults in `src/server/shared/baseline.js` (`POLICY_DEFAULTS`, `SPACE_POLICY_DEFAULTS`, `DISPATCH_DEFAULTS`).

Settings are managed in two places: **Site settings** (global) and the **Space console** (per space).

## Site settings (global)

Opened at **Confluence administration → Apps → Sentinel Vault — Site settings** (`confluence:globalSettings`). Tabs: **Settings**, **Validations**, **Classification**, **API access**. The Settings tab saves only on **Apply**; the Validations and Classification tabs save their own state.

Stored in Forge KVS under key: `admin-settings-global`

"Opt-in" keys are read with `=== true` (absent = off); the others with `!== false` (absent = on).

### Protection

| Setting | Code key | Type | Default | Description |
|---------|----------|------|---------|-------------|
| Allow space admins to force-unseal | `allowAdminOverride` | Boolean | **On** | A space admin can release anyone's seal from the Sealed Files tab, with a recorded reason. Force release is offered only while this is on. **Despite its name it gates every space-admin override, not only Force release.** Off, space admins (and site admins, except where noted) can no longer release someone else's file or section seal, give or revoke edit access on someone else's seal, **Approve anyway** a failed validation gate, set a space's default classification level (site admins still can), or approve a workflow page directly / request approval where no approvers are named. Seal owners keep all of their own actions. |
| Protect Sealed Attachments in Page Body | `enableContentProtection` | Boolean | On | An edit that removes a sealed image or file from the page body is undone and the editor is told why. **It also switches off the rest of the page-body guard:** sealed-section restore, adoption of Sealed Section macros inserted in the editor, Approved-page workflow enforcement, and the 5-minute page-guard sweep (which also runs the validation catch-up). |
| Allow Attachment Removal from Page | `allowArtifactDelete` | Boolean (opt-in) | Off | Users can send unsealed attachments to the trash from the panel. |
| Allow Attachment Restore from Page | `allowSealRestore` | Boolean (opt-in) | Off | Trashed attachments that still carry a seal can be restored from the panel. |
| Allow Seal Cleanup from Page | `allowSealPurge` | Boolean (opt-in) | Off | Seal records left behind by permanently deleted attachments can be removed from the panel. |
| Sign seal actions with an authenticator code | `signSealActions` | Boolean (opt-in) | Off | Sealing a file or section, releasing, force release, extending, approving or declining an edit request, and giving or revoking edit access all ask for the current code from the authenticator set up on My work (`SIGNED_SEAL_ACTION_KEYS` in `shared/seal-signature.js`). A person without one set up is refused until they add one. Codes are single-use; 5 wrong codes lock that account's signatures for 15 minutes. Two paths are not signed in 6.5.0: a section sealed by inserting the Sealed Section macro in the editor and publishing, and REST API jobs (they call the actions directly, without the signing check). |
| Hours before a declined edit request can be repeated | `editRequestCooldownHours` | Integer 0–168 | 1 | After an owner declines an edit request, the same person waits this long before asking again (0 = no wait). The requester sees `Declined · ask again {time}` on the row and the ribbon, with the owner's optional word, and on My work → Your edit requests. The owner or a space admin can give edit access directly at any time ("Give edit access…" under the row's ⋯ menu). An out-of-range stored value reads as the default. |

### Expiry

| Setting | Code key | Type | Default | Description |
|---------|----------|------|---------|-------------|
| Default Seal Duration | `defaultLockDuration` | Integer (seconds, edited as hours) | 48 hours (`BASELINE_HOLD_SPAN`) | How long a new seal lasts. A space can set its own duration. |
| Seals expire | `autoUnlockEnabled` | Boolean | On | The owner gets a halfway notice, an expiry notice and the overdue reminders below, then the attachment is released. Off: seals never expire and owners see a recurring banner instead. |
| Overdue reminders before release | `lapseNoticeLimit` | Integer ≥ 0 | 3 | How many overdue reminders the owner gets before release. 0 reminds once and holds the seal. Only when seals expire. |
| Hours between overdue reminders | `lapseNoticeIntervalHours` | Integer ≥ 1 | 24 | Gap between overdue reminders. Only when seals expire. |
| Recurring reminder banner | `enablePeriodicReminderEmail` | Boolean | On | Owners of never-expiring seals see a banner every few days (banner only, no comment). Only when seals do not expire. The key name is historical. |
| Reminder Frequency | `reminderIntervalDays` | Integer (days) ≥ 1 | 7 | Days between recurring reminder banners. |

### Alerts

| Setting | Code key | Type | Default | Description |
|---------|----------|------|---------|-------------|
| Pop-up messages | `enableFlashMessages` | Boolean | On | A brief message when you seal or release, or when an action is refused. |
| Page ribbon | `enableDocRibbons` | Boolean | On | Gates recording the alert rows (with pop-ups) and the recurring reminder. The banner itself does not read this key; with classification on, the level shows on every page view regardless. |
| Tell editors when their change is undone | `notifyEditorOnRevert` | Boolean | On | The person whose edit to sealed content was reverted gets a page comment with a link to the version that holds their text. Independent of the comments master switch; a Quiet space stays quiet. |
| Page comments that mention people | `enableEmailDispatches` | Boolean (opt-in) | **Off** | Master switch: seal events, edit requests, approvals and violations post a page comment @mentioning the people involved; Confluence then notifies them. The app sends no email; the key name is historical. |
| Violation comments | `enableConfluenceDispatches` | Boolean (opt-in) | **Off** | A comment when someone tampers with a sealed attachment or section. Needs the master switch. |
| Seal confirmation and halfway notice | `enableSealExpiryReminderEmail` | Boolean | On | The owner is mentioned when a seal is created and at its midpoint. Needs the master switch. |
| Expiry and release notices | `enableAutoUnsealDispatchEmail` | Boolean | On | The owner is mentioned at expiry, at each overdue reminder and at release. Needs the master switch. |
| ~~Ribbon mode / threshold~~ | `ribbonMode`, `ribbonThresholdLevel`, `ribbonThresholdRank` | — | — | Removed. Stored values and API bundles that still send them are accepted when well-formed and read by nothing. |

### Classification

| Setting | Code key | Type | Default | Description |
|---------|----------|------|---------|-------------|
| Classification levels | `classificationEnabled` | Boolean (opt-in) | **Off** | Master switch. On: every page shows its level under the title and in the banner — `Unclassified` when neither page nor space sets one — and levels can be set. Off: nothing is shown or enforced, level writes answer `Classification is off on this site`, and stored levels, space defaults and page overrides are kept. Installs that never saved the key stay off. Also flipped by the switch at the top of the Classification tab (on saves at once, off asks one confirmation). Confluence's own classification is untouched. |

The Classification tab also holds the levels themselves (KVS `classification-levels`; defaults Public 1, Internal 2, Confidential 3, Restricted 4 — rank 1 is least sensitive), the optional import from a JSM Assets object type (run as the signed-in admin, read-only), and a default level per space. Lowering or clearing a level needs a reason (≤ 300 characters), recorded as `classification.page-set` / `classification.space-default-set` in the activity log.

### Privacy and retention

| Setting | Code key | Type | Default | Description |
|---------|----------|------|---------|-------------|
| Delete old history | `historyRetentionEnabled` | Boolean | `false` | Off: nothing is deleted for age; history is kept while the app is installed (the customer is the data controller). On: the weekly privacy sweep enforces "Keep history for". |
| Keep history for | `historyRetentionDays` | Integer (days) 30–3650 | 730 | Only while Delete old history is on. Activity history (`activity-page-`, `activity-space-`, `activity-site-`), workflow history (`workflow-log-`) and read confirmations (`read-ack-`) older than this are deleted by the weekly privacy sweep, including records stored before the setting existed. A reader whose confirmation is deleted is asked to confirm again. Backup generations taken before the sweep keep their copy until they age out of the 10 kept generations. |

The group also shows the last sweep and a "Run the check now" button (resolver `privacy-run-now`, site admins; REST op `privacy-sweep`). The sweep runs weekly, queued by the daily recurring-nudge trigger. Besides retention it reports every stored account id to Atlassian's Personal Data Reporting API (each at most once per 7 days). For a `closed` account it deletes that person's own rows (signature, read confirmations, requests, inbox entries), replaces the id with `former-user` and the name with "Former user" everywhere else, removes them from steward rosters and read audiences (approver lists keep a `former-user` entry, so a request waiting on them stays pending for a space admin rather than completing with nobody deciding), leaves page-content baselines untouched, rewrites the `protection-` / `section-protection-` page properties and API receipts, takes a fresh backup and drops every older backup generation that still names them. For an `updated` account it refreshes the stored display names. The report needs the `report:personal-data` scope, which the app declares from 7.0.0 (site admins approve it when they accept the update); 6.x versions did not hold it, Atlassian answered 401 (measured on wolfaenpak 2026-10-04) and those sweeps recorded `reporting: "not-permitted"`. If Atlassian still refuses a report, the sweep records `not-permitted`, does everything else, leaves every account due and is retried the next day instead of a week later; that is also how an upgraded site reports its accounts within a day of approving 7.0.0.

### Advanced

| Setting | Code key | Type | Default | Description |
|---------|----------|------|---------|-------------|
| Auto-Insert Macro on Seal | `globalAutoInsertMacro` | Boolean (opt-in) | Off | The first seal on a page adds the Sentinel Vault panel. Off: no space can auto-insert. |
| Replace Attachments Macro | `replaceAttachmentsMacro` | Boolean (opt-in) | Off | The panel takes the place of Confluence's Attachments macro when the page has one. Only with auto-insert on. |

### API access

Site admins mint and revoke REST tokens here (roles Viewer / Editor / Admin; format `svt_` + 48 hex characters, shown once, stored only as a SHA-256 hash). See [REST-CONFIG-API.md](REST-CONFIG-API.md).

## Space console

A Confluence space page named **Sentinel Vault** (`confluence:spacePage`), opened from the space's apps. Space admin tabs require the Sentinel Vault space admin role (Confluence space admin, a configured admin user or group member, or site admin).

Stored in Forge KVS under key: `admin-settings-space-{sanitizedRealmKey}`

### Access Control tab

| Setting | Code key | Type | Default | Description |
|---------|----------|------|---------|-------------|
| Admin users | `adminUsers` | Array | `[]` | Users granted space admin rights in this space. |
| Admin groups | `adminGroups` | Array | `[]` | Confluence groups whose members get space admin rights. |
| Notifications | `notificationsMode` | `"normal"` \| `"quiet"` | `"normal"` | Quiet posts no comments and mentions nobody in this space; pop-ups, the ribbon and the activity trail still work. |
| Classification in this space | `classification` | `"inherit"` \| `"off"` | `"inherit"` | `off` hides every level on this space's pages and refuses new ones (`Classification is off in this space`); stored levels are kept. A space cannot turn classification on while the site has it off. |
| Default level for this space | KVS `classification-space-{spaceId}` | Level id or none | none | Shown while classification is on. Lowering it needs a reason. |

Pending space admin access requests are handled on this tab; a denied user can ask again after 48 hours.

### Seal Duration tab

| Setting | Code key | Type | Default | Description |
|---------|----------|------|---------|-------------|
| Custom Seal Duration | `autoUnlockTimeoutHours` | Integer (hours ≥ 1) or null | `null` (site default) | Seals on attachments in this space last this long instead of the site default. |

### Macro tab

| Setting | Code key | Type | Default | Description |
|---------|----------|------|---------|-------------|
| Auto-Insert Macro | `autoInsertMacro` | Boolean | On | The first seal on a page in this space adds the panel. Effective only when the site's `globalAutoInsertMacro` is on. |
| Macro Position | `macroInsertPosition` | `"top"` \| `"bottom"` | `"bottom"` | Where the panel is inserted. Ignored when the site replaces the Attachments macro. |

### Workflow tab

The tab opens with the effective rule as one sentence (e.g. "Pages start in Draft. Mihai Perdum approves before a page is Approved. Approved pages are protected: an edit by anyone who is not an approver or a space admin moves the page back to Draft. Re-review after 150 days.") and ONE `Save workflow settings`. The states, their colours and the moves between them live on their own view (`Edit the states…`, `← Back to workflow settings` to return); each workflow there saves with its own `Save workflow`. Built-in states: Draft, In Review, Approved, and the lapsed state "Needs re-review" (id `expired`). `requireSignature` makes each approver sign their decision with an authenticator code (a space admin's direct approval too; with no named approvers, the requester signs the request).

## Setting inheritance

```
Engine defaults (src/server/shared/baseline.js)
  → Global settings (Site settings)
    → Space settings (space console, where applicable)
```

**Space level can set:** seal duration, auto-insert macro and position, notifications mode (Quiet), classification opt-out and default level, space admin users/groups, workflow.

**Global only:** every other alert toggle, content protection, delete/restore/cleanup, force-unseal, signing seal actions, edit-request cooldown, Replace Attachments Macro, expiry/reminder behaviour.

### Seal duration resolution

1. Space `autoUnlockTimeoutHours` (if set)
2. Global `defaultLockDuration`
3. `BASELINE_HOLD_SPAN` (48 hours / 172800 seconds)

### Auto-insert resolution

Auto-insertion happens only when global `globalAutoInsertMacro` is on **and** the space's `autoInsertMacro` is not off.

### Classification resolution

Active only when the site's `classificationEnabled` is `true` **and** the space's `classification` is not `"off"`. Effective level: the page's own level, else the space default, else none.

## Inline panel configuration

Stored in the macro's own config, per macro instance:

| Setting | Type | Default | Options |
|---------|------|---------|---------|
| Column visibility | Object | name, status, sealOwner, labels, comment, actions on; fileSize, fileType, expiresAt off | `name`, `status`, `sealOwner`, `labels`, `comment`, `actions`, `fileSize`, `fileType`, `expiresAt` |
| Rows per page | Integer | 5 | 5, 10, 15, 25 — each group (Sealed, Available) pages separately |
| Cards per row | Integer | 2 | 1, 2, 3 |
| Show upload zone | Boolean | On | |

## Overlay column preferences

The attachments overlay stores column visibility in the browser's `localStorage`, per browser, independent of the panel macro config.
