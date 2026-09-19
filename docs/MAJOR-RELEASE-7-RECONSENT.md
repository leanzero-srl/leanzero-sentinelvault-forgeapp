# Sentinel Vault 7.0 — what changes for Confluence admins (re-consent note)

Status: 7.0 (production 5.0) shipped 2026-09-15. **Production 6.0 (dev 8.x, 2026-09-19) is the next
major — see "6.0 addendum" at the end**: it adds the JSM Assets scopes and needs a re-consent
AND a Jira install on every site that wants the Assets link.

## Why a new major version

Forge requires a new major version, and an admin's explicit approval, whenever an app asks for a
new permission scope or adds a module that changes where it appears. Version 7.0 does both. Until
an admin approves it under **Confluence admin → Manage apps → Sentinel Vault → Update**, the site
keeps running 4.x (the dev line jumped to 7 because two majors were cut while testing) and none of the features below activate. Minor releases (4.x) continue to
auto-update as before.

## What is new

1. **Data classification.** Sentinel Vault reads and writes Confluence's own classification
   levels when your site has them (Atlassian Guard), and provides its own levels when it does
   not. Space admins set a default level per space; page editors can override it per page.
2. **A classification chip under every page title** (a Confluence byline item). It shows the
   effective level and, when the page holds seals, a lock. Clicking it opens the page's Sentinel
   Vault details.
3. **"Seal attachments…" in the page ⋯ menu** (a Confluence content action), so protecting a
   file no longer requires inserting a macro first.

## New permissions and why each is needed

| Scope | Used for |
|---|---|
| `read:configuration:confluence` | Reading the site's classification levels (`GET /wiki/api/v2/classification-levels`). Read-only. |
| `write:space:confluence` | Setting a space's default classification level through Confluence's own API. Only space admins can trigger this through the app. |

Existing scopes are unchanged. The app still has **no external egress**: all notifications are
Confluence comments and @mentions; there is no email service, no API key, no data leaving Atlassian.
The app remains eligible for the "Runs on Atlassian" program.

## New modules

| Module | Where it appears |
|---|---|
| `confluence:contentBylineItem` | Under the page title, next to the author and date. |
| `confluence:contentAction` | In the page's ⋯ menu as "Seal attachments…". |

## What does not change

Seals, sealed sections, edit requests, workflows, the page ribbon and the space/site consoles all
keep their data and settings. No migration is required. Users who never touch classification see
one extra chip under page titles and one extra ⋯ menu entry.

## Where to click

1. Confluence → ⚙ Settings → **Manage apps**.
2. Find **Sentinel Vault**; a banner says a new version needs approval.
3. Click **Update**, review the two scopes listed above, click **Accept**.

The chip and classification tab appear within a minute of acceptance.

## 6.0 addendum — classification levels from JSM Assets (2026-09-19)

| Scope | Used for |
|---|---|
| `read:servicedesk-request` | Finding the site's Assets workspace id (`GET /rest/servicedeskapi/assets/workspace`). |
| `read:cmdb-schema:jira`, `read:cmdb-type:jira`, `read:cmdb-attribute:jira`, `read:cmdb-object:jira` | Listing object schemas, object types and attributes, and reading the objects of the ONE type a site admin picks as the source of the classification levels. Read-only; nothing is written to Assets. |

Every call runs as the site admin who is using the steward console, from that console; the app
never reads Assets in the background. No new module; no egress; "Runs on Atlassian" unchanged.

Where to click, per site: **Confluence admin → Manage apps → Sentinel Vault → Update** (accept
6.0), then install the app on the site's **Jira** as well (Marketplace → Sentinel Vault → Get it
now → Jira, or the same Manage apps page in Jira). Without the Jira install the console's "Levels
from JSM Assets" section says the app is not installed on Jira and nothing else changes. Assets
itself needs JSM Premium/Enterprise.
