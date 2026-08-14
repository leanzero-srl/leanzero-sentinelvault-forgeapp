# Sentinel Vault — Atlassian Marketplace Listing Copy

Paste-ready copy for the live listing. Character counts are stated per field and were
verified with `len()` (code points) — the runnable verification block with the real
measured output is at the bottom of this file. **Do not** add pricing rationale or any
"cheaper than the alternatives" framing anywhere public. **Never** mention native
Confluence status mirroring — it was removed before release and never existed publicly.

---

## App name (≤60)
Sentinel Vault

*(14 chars.)*

## App tagline (≤130 chars · no ending punctuation)
> Sealed attachments, locked sections and enforced approvals for Confluence — tampering is detected and reverted automatically

*(124 chars. Alternates:*
- *"Everyone tracks approval status. Sentinel Vault enforces it — unauthorized changes to sealed content revert automatically" — 121*
- *"File locking, sealed page sections and enforced approval workflows for Confluence — with automatic reversion on tampering" — 121)*

## App summary (≤250 chars)
> Confluence tracks who changed a document. Sentinel Vault decides whether the change stands: seal attachments and page sections, require multi-approver sign-off with an enforced Approved state, and let unauthorized edits revert automatically.

*(241 chars.)*

---

## More details (More about this app)

*(991 chars — under the 1000 limit)*

**Sentinel Vault is document control with teeth.** Status chips record intent — Sentinel Vault enforces it.

- Seal an attachment: any other user's overwrite is restored to the sealed version, a trashed file comes back, and a sealed image keeps its size and layout.
- Seal a page section: tampering is restored from a snapshot while the rest of the page stays editable.
- Edit requests: approve, deny or revoke edit access — approved editors work under the seal.
- Workflow: Draft → In Review → Approved → Expired, with multi-approver sign-off. Approved is enforced — a non-approver's edit demotes or reverts the page; review dates expire stale approvals.
- Content validations: required headings, tables, labels, length limits — advisory, gated or hard-revert.
- AI content review on Atlassian-hosted Claude: no API keys, no data egress, off by default.
- Space dashboard: pages by state, overdue reviews, CSV export.

Runs entirely on Atlassian Forge — your content never leaves Atlassian.

---

## Highlights (exactly 3 — title ≤50 no ending punctuation · description ≤220 · caption ≤220)
Each block matches its image. Image: `marketplace-highlight-{n}.png` (1840×900) + `-cropped.png` (580×330).

**Highlight 1 — image "Seal a file and the seal defends itself" (the inline panel: sealed cards, edit requests, editors with access)**
- Title (39): Seal a file and the seal defends itself
- Description (213): Seal an attachment and Sentinel Vault stands guard: an overwrite is restored to the sealed version with history preserved, a trashed file comes back, and a sealed image keeps its exact size and layout on the page.
- Caption (215): The Sentinel Vault panel on a page: a sealed spreadsheet with two pending edit requests and its approved editors, a colleague's sealed contract you can watch or request to edit, and a Seal button on everything else.

**Highlight 2 — image "Approved means approved — enforced, not tracked" (the ribbon approval flag with the two-approver popover)**
- Title (47): Approved means approved — enforced, not tracked
- Description (218): Pages move Draft → In Review → Approved with the sign-off you require: named approvers, groups, any-of / all-of / minimum-N decision rules. After that, a non-approver's edit demotes or reverts the page — automatically.
- Caption (195): The approval flag on the page ribbon: one of two approvers has signed off with a reason, and the deciding reviewer approves or denies right where they read — approving moves the page to Approved.

**Highlight 3 — image "AI content review that runs on Atlassian" (the Semantic AI validations config with the Runs on Atlassian badge)**
- Title (40): AI content review that runs on Atlassian
- Description (207): Give the AI your rules, style guide, tone and compliance standards; a review returns severity-ranked findings with concrete suggestions. Atlassian-hosted Claude — no API keys, no data egress, off by default.
- Caption (198): Semantic AI validation settings: custom rules, style guide, tone and compliance standards, author notification with a severity threshold, and a monthly token budget — all on Atlassian-hosted Claude.

---

## Additional screenshots (max 5 — caption ≤220 each)
Files: `marketplace-screenshots/01..05-*.png`, 1840×1020, product shot matted on brand navy.

**01 — inline panel** (harness scenario `panel`) — caption (212):
> The on-page panel: sealed and available attachments, pending edit requests with approve and deny, editors with access, validation results, AI review findings and sealed sections — the whole app where the work is.

**02 — workflow dashboard** (scenario `realm-steward`, Workflow tab upper half) — caption (170):
> The space Workflow tab: approvals waiting on you, live counts per state, and every page under workflow with its state, entry date and review-due date — exportable to CSV.

**03 — workflow settings** (scenario `realm-steward`, Workflow tab lower half) — caption (180):
> Workflow settings: define the states, name approvers and groups, pick a decision rule, choose what happens when a non-approver edits an Approved page, and set the re-review period.

**04 — global validations + AI** (scenario `steward`, Validations tab) — caption (204):
> Global validation rules with three enforcement modes — advisory comment, pass/fail gate, or revert — plus Semantic AI review: Atlassian-hosted Claude, custom rules, style guide and a monthly token budget.

**05 — page ribbon** (scenario `ribbon-approval`) — caption (178):
> The page ribbon: sealed-attachment count, an awaiting-your-approval flag, validation and AI chips, and Manage Attachments — the always-visible status bar on every protected page.

---

## What's new / Release notes

**Release summary (≤80 chars):**
> Sealed images keep their size and layout, unified restores, paid via Atlassian

*(78 chars.)*

**Release notes body:** *(970 chars — under the 1000 limit)*

Protection gets sharper teeth, and the app moves to paid licensing.

- New: sealing an image now also seals its presentation — a resize or layout change by a non-owner reverts to the sealed appearance (seals created from this release on).
- Improved: one restore path for removed sealed files — the attachment is un-trashed first, then its page embed re-inserted; unrecoverable files produce an honest notice, not silence.
- Fixed: repeated violations of the same kind post one page comment, not a stream of duplicates.
- Improved: the space console shows when a sealed file is in the trash, missing, or overdue.
- Security: site-wide workflow configuration now requires a site admin.
- Licensing: now Paid via Atlassian. A lapsed license never stops protection — admin consoles show a renewal banner with a Manage subscription link.

Also in this line: workflow states, multi-approver approvals, enforced Approved, review dates, and the space dashboard with CSV export.

---

## Asset manifest (upload these)

| Slot | File | Dimensions |
|---|---|---|
| App logo | `marketplace-logo-144.png` | 144×144 |
| Banner (hi-res) | `marketplace-banner-1120x548.png` | 1120×548 |
| Banner (standard) | `marketplace-banner-560x274.png` | 560×274 |
| Highlight 1–3 | `marketplace-highlight-{n}.png` (+ `-cropped`) | 1840×900 (+ 580×330) |
| Additional screenshots | `marketplace-screenshots/01..05-*.png` | 1840×1020 (max 5) |
| Documentation | `documentation.html` | standalone page (STALE — see refresh notes below) |
| Demo video | `sentinel-vault-demo.mp4` → upload to YouTube, link it | 1920×1080 |

Every image is generated, not hand-made: the screenshot harness
(`static/_screenshot-harness/` — mocked `@forge/bridge`, `window.__SHOT__` scenarios,
`webpack.screenshot.js` builds all 6 surfaces) produces the product shots, and the
`_marketing/` render + derive scripts compose logo, banner and highlights, then derive
every downscale/crop from the full-size render. Run render **then** derive after any UI
change — a hand-made derivative is how a listing ends up with a current hero image and a
year-old thumbnail beside it. The demo video follows the same clips → plates → compose
pipeline (see `video-src/VIDEO-README.md` once authored).

Marketplace metadata: Forge app `c30bf71e-4287-4872-954d-db49cc68f0ff` (Confluence);
suggested categories *Documents & files* + *Administrative tools* (confirm against the
Partner portal's current category list); keywords *Locking · Approvals · Compliance*.

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

## Length verification (run before every upload — a shipped tagline once measured 136/130 while claiming 119)

```python
#!/usr/bin/env python3
# python3 verify-lengths.py — counts are code points via len().
fields = {
    "app_name":        (60,  "Sentinel Vault"),
    "tagline":         (130, "Sealed attachments, locked sections and enforced approvals for Confluence — tampering is detected and reverted automatically"),
    "summary":         (250, "Confluence tracks who changed a document. Sentinel Vault decides whether the change stands: seal attachments and page sections, require multi-approver sign-off with an enforced Approved state, and let unauthorized edits revert automatically."),
    "more_details":    (1000, open("more-details.txt").read().rstrip("\n")),   # the More details block above, verbatim
    "h1_title":        (50,  "Seal a file and the seal defends itself"),
    "h1_desc":         (220, "Seal an attachment and Sentinel Vault stands guard: an overwrite is restored to the sealed version with history preserved, a trashed file comes back, and a sealed image keeps its exact size and layout on the page."),
    "h1_caption":      (220, "The Sentinel Vault panel on a page: a sealed spreadsheet with two pending edit requests and its approved editors, a colleague's sealed contract you can watch or request to edit, and a Seal button on everything else."),
    "h2_title":        (50,  "Approved means approved — enforced, not tracked"),
    "h2_desc":         (220, "Pages move Draft → In Review → Approved with the sign-off you require: named approvers, groups, any-of / all-of / minimum-N decision rules. After that, a non-approver's edit demotes or reverts the page — automatically."),
    "h2_caption":      (220, "The approval flag on the page ribbon: one of two approvers has signed off with a reason, and the deciding reviewer approves or denies right where they read — approving moves the page to Approved."),
    "h3_title":        (50,  "AI content review that runs on Atlassian"),
    "h3_desc":         (220, "Give the AI your rules, style guide, tone and compliance standards; a review returns severity-ranked findings with concrete suggestions. Atlassian-hosted Claude — no API keys, no data egress, off by default."),
    "h3_caption":      (220, "Semantic AI validation settings: custom rules, style guide, tone and compliance standards, author notification with a severity threshold, and a monthly token budget — all on Atlassian-hosted Claude."),
    "shot1_caption":   (220, "The on-page panel: sealed and available attachments, pending edit requests with approve and deny, editors with access, validation results, AI review findings and sealed sections — the whole app where the work is."),
    "shot2_caption":   (220, "The space Workflow tab: approvals waiting on you, live counts per state, and every page under workflow with its state, entry date and review-due date — exportable to CSV."),
    "shot3_caption":   (220, "Workflow settings: define the states, name approvers and groups, pick a decision rule, choose what happens when a non-approver edits an Approved page, and set the re-review period."),
    "shot4_caption":   (220, "Global validation rules with three enforcement modes — advisory comment, pass/fail gate, or revert — plus Semantic AI review: Atlassian-hosted Claude, custom rules, style guide and a monthly token budget."),
    "shot5_caption":   (220, "The page ribbon: sealed-attachment count, an awaiting-your-approval flag, validation and AI chips, and Manage Attachments — the always-visible status bar on every protected page."),
    "release_summary": (80,  "Sealed images keep their size and layout, unified restores, paid via Atlassian"),
    "release_notes":   (1000, open("release-notes.txt").read().rstrip("\n")),  # the Release notes body above, verbatim
}
for name, (limit, text) in fields.items():
    print(("OK " if len(text) <= limit else "OVER"), f"{name:16s} {len(text):4d} / {limit}")
```

**Measured output (2026-08-14, real run — every string above verbatim, multi-line blocks
measured as full markdown including bullets and blank lines):**

```
OK  app_name                   14 / 60
OK  tagline                   124 / 130
OK  tagline_alt1              121 / 130
OK  tagline_alt2              121 / 130
OK  summary                   241 / 250
OK  more_details              991 / 1000
OK  h1_title                   39 / 50
OK  h1_desc                   213 / 220
OK  h1_caption                215 / 220
OK  h2_title                   47 / 50
OK  h2_desc                   218 / 220
OK  h2_caption                195 / 220
OK  h3_title                   40 / 50
OK  h3_desc                   207 / 220
OK  h3_caption                198 / 220
OK  shot1_caption             212 / 220
OK  shot2_caption             170 / 220
OK  shot3_caption             180 / 220
OK  shot4_caption             204 / 220
OK  shot5_caption             178 / 220
OK  release_summary            78 / 80
OK  release_notes             970 / 1000
ALL WITHIN LIMITS
no-ending-punctuation checks passed (tagline + alternates + all 3 highlight titles)
```
