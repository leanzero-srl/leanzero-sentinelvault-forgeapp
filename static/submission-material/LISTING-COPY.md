# Sentinel Vault — Atlassian Marketplace Listing Copy (production 6.4.0)

Paste-ready copy for the live listing, refreshed 2026-09-30 for production 6.4.0 (tag `v6.4.0`).
Every limited field sits between `<!-- block:name -->` markers; `python3 count-blocks.py` (next to
this file) checks each one in code points and fails on an over-limit field or trailing punctuation
where the Marketplace forbids it. Run it before every paste. **Do not** add pricing rationale or any
"cheaper than the alternatives" framing anywhere public. **Never** mention native Confluence status
mirroring — it was removed before release and never existed publicly.

Everything claimed below was checked against the `v6.4.0` source (production is deployed from that
tag via `scripts/deploy-prod.sh`, which strips only the dynamic harness webtrigger; the static
`config-api` webtrigger ships). See "Verified against 6.4.0" at the bottom.

---

## App name (≤60)
Sentinel Vault

## App tagline (≤130 · no ending punctuation)
<!-- block:tagline -->
Seal files and page sections, enforce approvals and classify every Confluence page — tampering is reverted automatically
<!-- /block -->

## App summary (≤250)
<!-- block:summary -->
Confluence tracks who changed a document. Sentinel Vault decides whether the change stands: seal files and page sections, enforce multi-approver sign-off, classify pages Public to Restricted, and revert unauthorized edits automatically.
<!-- /block -->

---

## More details (≤1000)
<!-- block:more -->
Sentinel Vault is document control with teeth. Status chips record intent — Sentinel Vault enforces it.

- Seal an attachment: another user's overwrite is restored to the sealed version, a trashed file comes back, a sealed image keeps its size and layout.
- Seal a page section: tampering is reverted from a snapshot while the rest of the page stays editable.
- Edit requests: approve, deny or revoke edit access; a declined request can be retried after a cooldown.
- Workflow: Draft → In Review → Approved → Expired with multi-approver sign-off. A non-approver's edit demotes or reverts an Approved page.
- Classification: Public, Internal, Confidential, Restricted (or your own levels), space defaults, and a reason to lower a level.
- Optional 6-digit authenticator code on seal actions and approvals.
- Content validations, AI review on Atlassian-hosted Claude (off by default), REST API tokens, and a space dashboard with CSV export.

Runs on Atlassian — your content never leaves Atlassian.
<!-- /block -->

---

## Highlights (exactly 3 — title ≤50 no ending punctuation · description ≤220 · caption ≤220)
Image: `marketplace-highlight-{n}.png` (1840×900) + `marketplace-highlight-{n}-cropped.png` (580×330).

### Highlight 1 — "Seal it. It stays sealed" (the sealed-files panel)
<!-- block:h1_title -->
Seal a file and the seal defends itself
<!-- /block -->
<!-- block:h1_desc -->
Seal an attachment or a page section and Sentinel Vault stands guard: an overwrite is restored to the sealed version, a trashed file comes back, and a tampered section is reverted from its snapshot.
<!-- /block -->
<!-- block:h1_cap -->
The Sentinel Vault panel on a page: your sealed file with Release, every other attachment one Seal click away, and a short explainer of what the app protects on this page.
<!-- /block -->

### Highlight 2 — "Every page classified" (Classification tab + page banner)
<!-- block:h2_title -->
Classify every page, Public to Restricted
<!-- /block -->
<!-- block:h2_desc -->
Turn classification on and every page shows its level under the title and in the page banner. Set space defaults, override per page, and lowering a level asks for a reason that lands in the activity log.
<!-- /block -->
<!-- block:h2_cap -->
The Classification tab in site settings: four levels with rank and description, levels from JSM Assets, space defaults. In front, a page banner showing Confidential from the space default.
<!-- /block -->

### Highlight 3 — "Signed with a code" (the Sign this action dialog)
<!-- block:h3_title -->
Sign seal actions and approvals with a code
<!-- /block -->
<!-- block:h3_desc -->
Require a 6-digit code from an authenticator app before a seal is released or extended, an edit request is decided, or a page is approved. Off until an admin turns it on for the site or a space.
<!-- /block -->
<!-- block:h3_cap -->
The Sign this action dialog on the sealed-files panel: the decision runs only after the current authenticator code verifies. Each person sets up their authenticator once on My work.
<!-- /block -->

---

## Additional screenshots (5 — caption ≤220 each)
Files: `marketplace-screenshots/0N-*.png`, 1840×1020, real frames matted on brand sky-navy #0C4A6E.

**01 — `01-sealed-files-panel.png`**
<!-- block:s1_cap -->
Sealed files, sealed by you or by others, and available files, each with one clear action: Release, Request edit or Seal. Counts match the cards, and long lists page separately.
<!-- /block -->

**02 — `02-classification-levels.png`**
<!-- block:s2_cap -->
Site settings, Classification: one switch turns it on, the four default levels are yours to rename, recolour or extend, or import from JSM Assets, and every space can get a default level.
<!-- /block -->

**03 — `03-signed-action.png`**
<!-- block:s3_cap -->
With signing on, releasing a seal or deciding an edit request asks for the current 6-digit code from the user's authenticator app before anything changes.
<!-- /block -->

**04 — `04-auto-restored-attachment.png`**
<!-- block:s4_cap -->
A sealed file was overwritten by someone else: Sentinel Vault put the sealed version back and says so in the attachment history — "Sentinel Vault automatically reversed modifications".
<!-- /block -->

**05 — `05-rest-api-access.png`**
<!-- block:s5_cap -->
API access: one POST endpoint for configuration bundles and content operations, with named tokens scoped to Admin, Editor or Viewer. Only a hash of each token is stored.
<!-- /block -->

---

## What's new / Release notes (6.4.0 — production 2026-09-30)

**Release summary (≤80):**
<!-- block:rel_summary -->
Always-visible classification, honest Force release, clearer sealed-files panel
<!-- /block -->

**Release notes body (≤1000):**
<!-- block:rel_notes -->
Classification and day-to-day sealing get clearer.

- New: every page shows its classification level. Raising it is one action; lowering it asks for a reason and shows an amber callout. The level menu opens where it can be seen.
- Improved: Force release is offered only to space admins when "Allow space admins to force-unseal" is on, so the menu never offers an action the server will refuse.
- Improved: Sealed and Available files page separately, counts match the cards, and a file you just sealed or released moves to the top of its new group.
- A declined edit request can be retried after a site-configurable cooldown (default 1 hour).
- Seal actions can require a 6-digit authenticator code (site setting).

Also in this line: sealed page sections, image presentation seals, unified restores and per-user authorization on every action.
<!-- /block -->

---

## Asset manifest — which file goes in which Marketplace field

All paths relative to `static/submission-material/`. Regenerate with
`node _marketing/render-v3.mjs` (never run the old `derive.mjs` after it — it would overwrite these
from the 4.x masters).

| Marketplace field | File | Size | Status |
|---|---|---|---|
| App logo | `marketplace-logo-144.png` | 144×144 | unchanged, still accurate |
| Hero banner (hi-res) | `marketplace-banner-1120x548.png` | 1120×548 | NEW 2026-09-30 |
| Hero banner (standard) | `marketplace-banner-560x274.png` | 560×274 | NEW 2026-09-30 |
| Highlight 1 screenshot / cropped | `marketplace-highlight-1.png` / `marketplace-highlight-1-cropped.png` | 1840×900 / 580×330 | NEW |
| Highlight 2 screenshot / cropped | `marketplace-highlight-2.png` / `marketplace-highlight-2-cropped.png` | 1840×900 / 580×330 | NEW (was approvals; now classification) |
| Highlight 3 screenshot / cropped | `marketplace-highlight-3.png` / `marketplace-highlight-3-cropped.png` | 1840×900 / 580×330 | NEW (was AI review; now signing) |
| Additional screenshot 1 | `marketplace-screenshots/01-sealed-files-panel.png` | 1840×1020 | NEW, caption s1 |
| Additional screenshot 2 | `marketplace-screenshots/02-classification-levels.png` | 1840×1020 | NEW, caption s2 |
| Additional screenshot 3 | `marketplace-screenshots/03-signed-action.png` | 1840×1020 | NEW, caption s3 |
| Additional screenshot 4 | `marketplace-screenshots/04-auto-restored-attachment.png` | 1840×1020 | NEW, caption s4 |
| Additional screenshot 5 | `marketplace-screenshots/05-rest-api-access.png` | 1840×1020 | NEW, caption s5 |
| Demo video (YouTube URL) | https://youtu.be/IGCvPP9RxZo (the 8-feature compilation, public) | — | NEW 2026-09-30 |
| Tagline / Summary / More details | blocks `tagline`, `summary`, `more` above | — | tagline + summary on the live listing are still the pre-August text |
| Highlight title / description / caption ×3 | blocks `h{n}_title`, `h{n}_desc`, `h{n}_cap` | — | replace all three |
| Version 6.4.0 release summary / notes | blocks `rel_summary`, `rel_notes` | — | live shows "Minor version update" |
| Promo video | owned by the video agent (`sentinel-vault-promo-6.4.mp4` → YouTube) | — | live listing youtubeId `E8jAX58xcII` |

Image sources: real frames from the owner's 2026-09-30 recordings
(`~/Downloads/wetransfer_sentinel_2026-09-30_1318/*.mov`), cut to `_marketing/src-6.4/`. They were
recorded on the wolfaenpak DEV install, so every crop excludes the "(Development)" suffix and the API
endpoint URL is blurred. The old harness-mock screenshots (01-sentinel-panel … 05-global-preferences)
were removed: they showed the 4.x panel layout on a near-black mat.

Marketplace metadata: app key `com.leanzero.confluence.sentinelvault`, Forge app
`c30bf71e-4287-4872-954d-db49cc68f0ff`; keywords *Locking · Approvals · Classification · Compliance*.

## Live listing as of 2026-09-30 (from `rest/2/addons/com.leanzero.confluence.sentinelvault`)

Version 6.4.0 is published. Tagline "Attachment protection and concurrent-edit prevention for
Confluence Cloud" and the summary ("Seal any Confluence attachment before editing…") are the
pre-August text; More details and the three highlight titles match the August (4.x) copy; the five
additional screenshots have empty captions; release summary/notes read "Minor version update".

---

**Accuracy guardrails for final edits:**

- **Never mention native Confluence status mirroring.** It was shipped internally and
  removed before release (owner decision C6). It never existed publicly; the workflow chip
  on the Sentinel Vault ribbon is the app's own.
- **Detection is post-save, not pre-save.** Forge events fire after Confluence saves.
  Say "detected and reverted automatically" — never "blocks the save" or "prevents
  publishing". Validations gate or revert after the fact; they cannot stop a save.
- **AI:** Atlassian-hosted Claude via the Forge LLM — no BYOK, no external API keys, no
  data egress, **off by default**, limited to Claude Haiku with a per-space monthly token
  budget. Never say "AI-powered protection" — the enforcement engines are deterministic.
- **No email claims, no Resend.** Notifications are toasts, page banners and Confluence
  comments with @mentions; Confluence's own notification engine emails users per their
  personal settings. The app sends no email of its own and has zero egress.
- **Presentation (resize/layout) protection applies to seals created from this release**
  — earlier seals carry no baseline. Do not claim retroactivity.
- **Enforced Approved:** sell "reverted automatically" / "within minutes", never "the
  badge can't lie". The revert-vs-demote behavior is a per-space admin choice.
- **Terminology:** space (not realm), group (not guild), seal/unseal (never
  reserve/relinquish). "Steward" is app vocabulary and stays.
- **Do not** promise Runs on Atlassian until `forge eligibility -e production` reports it
  for the submitted version (the dev harness webtrigger must be stripped from the prod
  deploy).
- No pricing rationale, and no comparison-by-name to other Marketplace apps.

---

## documentation.html refresh notes (stale claims — March build; do not paste as-is)

- §19 "Coming Soon" lists Edit Requests, Content Sealing, Conditions & Validations and
  Semantic AI Validations as roadmap — all four are shipped. The section must become real
  documentation, and a new roadmap (if any) must not promise anything unshipped.
- §19 describes Semantic AI as "using your own API keys (BYOK)" — wrong and badge-breaking.
  It is Atlassian-hosted Claude via the Forge LLM: no keys, no egress.
- All Resend/email content is stale (§10 "Email types", §17 "Email Configuration" incl.
  `RESEND_API_KEY` setup, §18 "Email delivery — Per Resend plan, Free tier: 100
  emails/day", §20 FAQ "the only external service is Resend" and "What if the Resend API
  key is not configured?"). The app has zero egress; notifications are toasts, banners and
  Confluence comments with @mentions. "Is my data stored outside of Atlassian?" becomes an
  unqualified No.
- The Watch FAQ promises "an email notification the moment the seal is released" — it is a
  comment @mention; email arrives only via Confluence's own notification settings.
- Old vocabulary throughout: "Reservation Duration" tab, "Relinquish" button, "Realm
  Console"/"realm activation", "guilds" (incl. the "What are guilds?" FAQ). Shipped UI
  says Seal/Unseal, space, groups.
- The document workflow capability is entirely absent: states + ribbon chip, multi-approver
  transitions + approvals inbox, enforced Approved (demote/revert), review dates and
  auto-expiry, dashboard + CSV export. Needs its own section.
- Missing current protection facts: presentation (resize/layout) protection for sealed
  images, the unified trash-restore path, one-comment violation dedup, stale-seal
  (Trash/Missing/Overdue) visibility in the space console.
- No licensing section: Paid via Atlassian, protection continues on a lapsed license,
  Manage subscription from the admin consoles.
- "Runs on Atlassian" appears nowhere — it is now a headline property and belongs in the
  overview and the data-residency FAQ.
- Footer says "© 2025 LeanZero SRL".

---
- **Classification is OFF by default** (site switch `classificationEnabled`, opt-in; a space may
  opt out). Say "turn classification on", never imply it is always on. Levels can come from JSM
  Assets only with the app's second (Jira) install on the site — do not headline Assets.
- **Signing** is TOTP the app enrols itself on My work; it is not a 21 CFR Part 11 claim — never
  call it a compliant e-signature.

## Verified against 6.4.0 (source at tag `v6.4.0`)

- Classification: `src/server/capsules/classification/logic.js` (default levels Public/Internal/
  Confidential/Restricted, `classificationActive` site switch + space opt-out, reason required to
  lower, `REASON_MAX` 300); activity events `classification.page-set` / `space-default-set` in
  `src/server/infra/activity-log.js`; JSM Assets import in the Classification tab.
- Signing: `shared/totp.js`, `shared/seal-signature.js`, settings-schema "Sign seal actions with an
  authenticator code" (release, extend, approve/decline/give/revoke edit access); approvals per
  space via workflow `requireSignature`.
- Edit-request cooldown: `editRequestCooldownHours` (0 disables).
- REST API: `capsules/config-api/` (static webtrigger `config-api`, kept by
  `scripts/strip-dev-modules.mjs`; tokens `svt_…`, hash-only storage, roles Admin/Editor/Viewer).
- Sealed sections, workflow, validations, AI review: unchanged since 4.x and still in the tag.
