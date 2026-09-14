# Sentinel Vault 5.0 — what changes for Confluence admins (re-consent note)

Status: DRAFT, written 2026-09-14 ahead of the batched major release. Nothing in this note is
deployed to production yet; the manifest changes below are staged together so admins consent once.

## Why a new major version

Forge requires a new major version, and an admin's explicit approval, whenever an app asks for a
new permission scope or adds a module that changes where it appears. Version 5.0 does both. Until
an admin approves it under **Confluence admin → Manage apps → Sentinel Vault → Update**, the site
keeps running 4.x and none of the features below activate. Minor releases (4.x) continue to
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
