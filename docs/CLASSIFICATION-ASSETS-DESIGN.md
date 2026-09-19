# Classification levels from JSM Assets — design and what it costs (2026-09-19)

Owner ask (2026-09-19): "hook up data classifications with actual assets we have in the JSM".
This supersedes the 2026-09-14 recommendation (docs/CLASSIFICATION-ASSETS-COMPARISON.md, which
argued for the app-owned list). What follows is what it takes, with the platform facts that decide
the shape, so the go/no-go on the manifest change is an informed one.

## What "hooked up" means here

The classification LEVELS (name, colour, rank, description) come from an object type in a JSM
Assets object schema — for example an "Information classification" object type whose objects
are Public / Internal / Confidential / Restricted with attributes for colour and rank. The app
reads that object type, mirrors it into its level list, and keeps doing what it does today with
the levels: space default, page override, ribbon block, byline pill, CQL-visible properties.
Assets has no notion of "this Confluence page's level", so per-page and per-space storage stays
in the app (as the comparison note already said).

The `ClassificationProvider` interface (classification/logic.js, six methods) is the seam: an
`AssetsProvider` replaces `listLevels()` and nothing else. The UI does not change for readers.

## Platform facts that decide the shape (verified 2026-09-19)

1. **Scopes.** Reading an object type and its objects needs `read:cmdb-schema:jira`,
   `read:cmdb-type:jira`, `read:cmdb-object:jira`, `read:cmdb-attribute:jira` (Atlassian's
   Assets scope page for Forge). Any of them is a NEW scope → a MAJOR version → an admin must
   re-consent on every install (leanzero-demo, test-easy-apps, leanzero-apps-demo, and every
   customer). See docs/MAJOR-RELEASE-7-RECONSENT.md for the note that goes with a major.
2. **Background calls do not work.** Two developer-community threads (May 2026, and an older one
   with Atlassian staff answering) report that `asApp().requestJira("/jsm/assets/workspace/…")`
   answers **401 even with the scopes declared and the install upgraded**; staff said the CMDB
   scopes work with a USER context and not without one, and pointed at the `assetsImportType`
   module instead. So there can be no scheduled sync, no queue consumer, no trigger reading
   Assets. The read has to happen inside a steward's own session (`asUser()` from the console).
3. **Runs on Atlassian is kept** only if the app never fetches api.atlassian.com itself. The
   Basic-auth `fetch()` workaround the threads mention needs egress plus a stored API token; it
   is out.
4. **Jira install.** `requestJira` from an app that only has Confluence modules is not enough; the
   app must be installable on the site's Jira. That means at least one Jira module in the manifest
   (a `jira:adminPage` "Sentinel Vault — Assets link" is the natural one) and a second install step
   for the admin (Jira, then Confluence — or the reverse). Assets itself is JSM Premium/Enterprise.

## The shape that fits those facts

- **Steward-driven import, not a sync.** In the steward console's Classification tab: "Link to
  Assets" → the steward picks the object schema and object type (asUser calls, in their session),
  maps two attributes (colour, rank — name and description default to the object's name and a
  text attribute), previews the resulting level list, and clicks Import. The app writes the
  levels into the existing app-owned list (`classification-levels`) with `source: "assets"`, the
  schema/type ids and the import time. A "Re-import now" button repeats it. Nothing runs in the
  background; the console shows "Imported from Assets · <type> · <date>".
- **Native still wins.** If the site defines Confluence native classification levels, the Native
  provider is selected as today and the Assets link is shown as unavailable (the levels are the
  org's, Guard-managed).
- **Failure modes named in the UI:** Assets not licensed on the site (the workspace call answers
  404/403), the app not installed on Jira, the object type deleted since the import (the last
  import stays in force; the console says the link is stale).
- **REST route in the same tick (skill rule):** `config-api` gets a `classification.assetsLink`
  site key that stores the schema/type/attribute mapping; the import itself cannot be driven over
  the config API because it needs a user session — the receipt says so.

## What it costs

- Manifest: four `read:cmdb-*:jira` scopes + one `jira:adminPage` module → major (8.0 on dev,
  6.0 on production), re-consent everywhere, a Jira install per site.
- Build: ~2 days — steward console tab section (schema/type/attribute pickers, preview, import),
  `AssetsProvider` behind `listLevels`, the config mirror key, unit tests on the pure mapping,
  a live spec on wolfaenpak (Assets answers 200 there, comparison note) driven asUser from the
  browser (no hook seam can do it — no user context).
- Risk (medium): the asUser path is reported to work by staff but has not been run by us; the
  first thing to build is a 30-minute spike in the steward console that lists object schemas
  asUser. If that 401s, the feature is not possible on Forge today and the answer is the
  `assetsImportType` direction Atlassian points at (which is Assets pulling FROM the app, i.e.
  the app exporting its levels/pages into Assets — the opposite of what was asked).

## Decision needed

The manifest scope change is the owner's call (it re-consents every install and adds a Jira
install step). With a go, the order is: spike (asUser schema list on wolfaenpak) → if 200, build
the import as above and ship as the next major together with anything else waiting on a major
(the comment reaper needs `delete:comment:confluence` — same major).

## Result (2026-09-19, same day)

The spike answered 200: the steward console listed six real object schemas on wolfaenpak from
Mihai's session (`asUser().requestJira`), so the import was built as designed and shipped as dev
**8.x** (production **6.0**).

- No Jira module was needed after all: with the five scopes declared, `forge install -p Jira`
  installs the app on the site's Jira and `asUser().requestJira("/jsm/assets/workspace/…")`
  answers. Each site still needs that second install (Confluence + Jira) — the console says so
  when the workspace call is refused.
- Scopes: `read:servicedesk-request` (the workspace id, `GET /rest/servicedeskapi/assets/workspace`)
  plus the four `read:cmdb-*:jira`.
- Resolvers (site-admin gated, all asUser): `classification-assets-schemas`, `-object-types`,
  `-attributes` (answers a guessed mapping from the attribute names: Rank / Colour|Color /
  Description|Guidance), `-preview`, `-import` (the same `setLevels` the editor uses, then the link
  record `classification-assets-link` in KVS), `-link`, `-set-link`.
- Pure mapper `levelsFromAssetsObjects` in classification/logic.js (unit: test/classification-assets.test.mjs):
  colour words map onto the solid palette, an unknown colour or a non-numeric rank gets a
  position and a note rather than a refusal, the hand-typed rules (≤ 8, unique names/ranks) still apply.
- Live proof: `forge-live-harness/scenarios/sentinel-vault/classification-assets.spec.ts` —
  schema "Information Governance" → type "Classification Level" → guessed mapping → preview
  PUBLIC/INTERNAL/CONFIDENTIAL/RESTRICTED → Import → the Levels editor shows the four without a
  reload → Re-import → Unlink; the site's levels restored afterwards.
- Trap found live: after the import the tab used to reload itself; the reload unmounted the
  Assets section (losing the receipt) and read KVS before the write was visible, so the list still
  showed the old levels. The import resolver answers with the levels it wrote and the tab takes
  those directly.
