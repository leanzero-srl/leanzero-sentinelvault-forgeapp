# UX critique briefing — common part (2026-09-19)

Owner's ask, verbatim: *"how do we tie this UI/UX together for classifications? how do we make it a
feature that users can use? first it needs to be toggled on or off. Second it needs to have a
reason to be there … spawn agents that can criticize the UI/UX … and come up with backlog items …
second the comala feature … third is the section sealing how do we tie that up easier to the
comala?"*

You are a critic, not a builder. You produce a BACKLOG of fix-ready items, not code. Assume the
feature is confusing until you have proven otherwise by looking at it.

## What the app is

Sentinel Vault, a Forge Confluence Cloud app: a content-integrity ENFORCEMENT layer. One sentence
from docs/PRODUCT-DEFINITION.md: a person declares "this must not change without me" about a file,
a section of a page, or a whole approved page, and the app physically undoes any change that breaks
that declaration, tells everyone, keeps a record. Read docs/PRODUCT-DEFINITION.md §1–§3 first.
The "comala feature" the owner means is BC-4: the document workflow (Draft → In Review → Approved
→ Expired) in `src/server/capsules/workflow/` with the enforced Approved state.

Surfaces (src/ui/surfaces/): `doc-ribbon` (page banner: level block + one pill + one sentence),
`page-details` (byline chip under the title → details modal, tabs), `inline-panel` (macro on a
page), `overlay` (full attachments table), `section-setup` (the sealed-section bodied macro),
`panel-setup`, `my-work` (global page /wiki/apps/…/my-work), `realm-console` (space page: tabs
incl. workflow settings, approvals inbox, dashboard), `steward-console` (site admin: Settings /
Validations / Classification / API access). Design tokens in src/ui/tokens/*.css. Copy and menu
rules already decided in docs/UX-REVIEW-2026-09-14.md (read §0, §2, §3.4, §5) — do not re-litigate
those; build on them.

## What the market does (researched 2026-09-19 — cite these when you compare)

- **Atlassian Guard data classification (native):** org admin creates levels (name, colour,
  description) as drafts, publishes them; org default level; classification RULES auto-apply a
  level from detected data (PII, card numbers); users see a classification badge on the page and
  can change it if the admin allows; levels drive data-security policies (public sharing, export
  blocking). Confluence Automation can act on the level. (support.atlassian.com "What is data
  classification", "Publish a classification level", "Configure data classification rules";
  community article "Guard Data Classification now supported in Automation".)
- **AppFox Compliance for Confluence (DLP, classification & detection):** the control is a lozenge
  at the top of the page ("Pending level" until set); clicking it picks the level; page refreshes
  to apply restrictions when "Restrict pages automatically" is on (per level: users/groups/roles);
  "Classification history" in the ⋯ menu; admin: Settings → Compliance configuration →
  Classification levels (name, colour, description, ≤ 10 levels); FORCE classification on
  create/edit; DEFAULT level per site/space; AI classification from title/content/space; detection
  scanning for PII with alerts; site-admin-only or delegated to space admins. Sister apps: Page
  Classification Assistant (permission sets per class), Classification for Confluence (Public …
  Top Secret status), Data Classification for Confluence ("auditable, no third-party processing").
- **Comala Document Management Cloud (Appfire; 6k installs; Forge since Jun 2026):** workflow
  applied per space or per page; states with approvals (users/groups, outcome criteria, quorum);
  e-signature on approve; READ CONFIRMATION (HR policies, mandatory reading); expiry dates;
  "remove page restrictions on final state"; page byline shows the workflow status; a workflow
  popup with Approve/Reject (community complaint: no avatars of who can review); Space Document
  Report (filter by assigned/pending reviewer, creator, owner; columns; CSV) and Document Activity
  Report per page (every edit/approval/who/when); workflow builder; labels driving state; "editing
  an Approved page returns it to review" (their only protection — advisory). Warsaw Dynamics'
  comparison notes Comala has NO central cross-instance approvals dashboard.
- **Approvals for Confluence — Section Approval macro (AppFox, 2026):** a macro marks PART of a
  page for approval; approvers = users or an Approval Team; minimum approvals; expiry (date or
  "2 weeks after approval"); "Expire on edit" invalidates the approval when the content changes;
  "lock the decision"; owner notifications toggle; audit trail of decisions inside the macro.
- **Community needs (Atlassian Community threads):** restrict/lock a page WHILE it is being
  approved (unapproved work must not be visible/editable); lock editing at the END of a workflow
  without hiding the state; lock a section of a page; "page approvals, let's make it
  complicated" automation recipes — people are hand-building what these apps do.

## How to look at the live app (allowed, wolfaenpak is a test site — no permission needed)

- Harness: `~/Projects/forge-live-harness`, Playwright, shared logged-in profile as Mihai.
  Read `scenarios/sentinel-vault/_door.ts`, `realm-console-deep.spec.ts`,
  `steward-console*.spec.ts`, `tester-batch-ui-2026-09-19.spec.ts`, `classification-assets.spec.ts`
  for how to open each surface. Run one spec with
  `cd ~/Projects/forge-live-harness && RUN_ID=<yours> npx playwright test scenarios/sentinel-vault/<spec> --project=chromium --reporter=line`
  and READ the PNGs it writes (`test-results/*.png`, `evidence/<RUN_ID>/…`). Write a throwaway
  spec of your own under `scenarios/sentinel-vault/critique-<area>.spec.ts` that walks the flow
  as a NAIVE USER would and screenshots every step — that is your primary evidence. Existing
  screenshots: `test-results/classification-assets-*.png`, `evidence/sv-ux1`, `evidence/sv-verify*`.
- Do NOT deploy, do NOT change app source, do NOT commit. Test content on wolfaenpak is fine.
- The steward console is at the Confluence admin → Apps → "Sentinel Vault — Site settings
  (Development)"; the space console is a space page "Sentinel Vault" in space WFH (key WFH is the
  fixture space; SVSEC1P is private); My work at /wiki/apps/c30bf71e-4287-4872-954d-db49cc68f0ff/<env>/my-work.

## What a backlog item looks like (write to docs/ux-critique/BACKLOG-<area>.md)

For each item: `### <id> <title>` then **Who** (persona: reader / editor / page owner / approver /
space admin / site admin / compliance officer), **Observed** (what you saw, with the screenshot
path and the copy string quoted), **Why it fails the user** (the job they were doing, what the
market does instead — cite), **Proposal** (concrete: surface, control, copy, default, setting),
**Confidence** (high/medium/low that this is the right fix, and why), **Blast radius** (files /
surfaces touched — descriptive only, never a priority axis). Order items by how badly the user is
misled or blocked, never by effort. End with a "Questions only the owner can answer" list.
Owner's UI rules you must respect in proposals: no left accent rails, no faded/washed tints (solid
saturated colour), no native alert/confirm/select — the app's own Dialog/ActionMenu/mini-select.
