# Backlog — Classification UI/UX (critique 2026-09-19)

Critic's walk of the classification feature as a naive user, against the code in
`src/server/capsules/classification/`, `src/ui/kit/ClassificationTab.jsx`, `src/ui/surfaces/page-details/index.jsx`,
`src/ui/surfaces/doc-ribbon/index.jsx`, `src/ui/kit/ribbon-rules.js`, `src/server/capsules/page-details/byline.js`,
`src/server/capsules/policies/settings-schema.js`, and the market notes in BRIEFING-COMMON.md.

**Evidence caveat.** The throwaway spec `~/Projects/forge-live-harness/scenarios/sentinel-vault/critique-classification.spec.ts`
walks the whole path (fresh page → byline chip → modal → classify → ribbon in both modes → steward console → Assets wizard
to preview → space console → My work). It ran ONCE to the second step before the shared Chrome profile was SIGKILLed by a
concurrent harness run; four further attempts (two foreground) were refused with `PROFILE_BUSY` (a sibling session held the
profile the whole time). Live evidence is therefore `evidence/critique-classification/A01-fresh-page.png` and
`A02-byline-zoom.png` (full path `~/Projects/forge-live-harness/evidence/critique-classification/`). Every other step is
written from the code, with the copy strings quoted from source, and is marked **[screenshot missing]**. The spec is ready
to re-run when the profile is free; it restores `admin-settings-global` exactly and deletes its page.

---

## Answers to the briefing's five questions

**Q1 — As a page editor who has never heard of the app, can I find how to classify a page?**
Barely, and only by accident. The only door is the byline chip under the title (`page-details/byline.js` writes
`sentinel-byline`; the modal's `ClassificationBlock` is the only place `classification-set-page` is called — grep confirms
no other surface). On the fresh page (A01) the byline row reads, left to right: `By Mihai Perdum · Listen · Add a reaction ·
Unclassified (Staging) · RESTRICTED (Development) · Unclassified (Development) · Show less`. Three chips, two of them ours,
one from a different Forge app (a purple "RESTRICTED … IGOV-109" banner from an unrelated dev install — see Q4). Nothing
says "Sentinel Vault" or "classify"; the chip is a grey dot and the word "Unclassified". A naive user reads that as a
status, not a control. Click count once you know: 1 (chip) → modal opens on Overview → the "Classification" section →
2 (picker button `pd-level-picker`, label "Space default") → 3 (option). Three clicks, no confirmation, no explanation of
consequence. After the pick the sentence becomes `Set on this page. The space has no default. Highest sensitivity; strictly
need-to-know.` (`page-details/index.jsx:100-102`). "What happens now?" is never answered because nothing happens (Q2/Q5).
There is no Activity row for the change (`grep classification src/server/capsules/activity/` → nothing), no notice, no undo
other than picking again. **[screenshots A03–A07 missing]**

**Q2 — Does the Classification tab explain what a level DOES?** No. The tab's copy in full (`ClassificationTab.jsx:360-398`):
`Scheme in use — App` / `This site has no native classification levels, so Sentinel Vault's own scheme is in use. Levels are
stored by the app and applied as a content property on each page.` / `Levels` … `1 to 8 levels. Rank orders them low to high;
the colour is the chip shown on pages.` / `Space defaults` … `A page with no classification of its own takes its space's
default.` The words seal, workflow, approval, enforce, restrict, export, ribbon do not occur. "Scheme in use — App" is
engineering vocabulary (provider name) with no user meaning; "content property" is developer vocabulary. The Assets section
(`:206-262`) reads `Levels from JSM Assets` → `Choose an Assets object type…` → `1 · Schema` → `2 · Object type` →
`3 · Which attribute holds what (the object's name is the level's name)` → `Rank / Colour / Description` radio rows of raw
attribute names → `Preview the levels` → `4 · Preview · N objects` → `Import N levels — replaces the current list`. To someone
who did not build it: "object type", "attribute", "schema" are JSM Assets admin terms; the mapping row shows every attribute
of the type as a button (on wolfaenpak the "Classification Level" type has Rank, Colour, Handling Guidance, plus the Assets
system attributes Key/Name/Created/Updated) so "Rank: none | Key | Name | Rank | Colour | Handling Guidance | Created …" is
a wall of buttons whose right answer is guessed and pre-selected but never explained ("we guessed Rank → Rank"). The one
sentence that should be first — *why* you would want levels to come from Assets — is absent. **[screenshots B03–B10 missing]**

**Q3 — What does the ribbon show on an unclassified page in each mode?** `ribbon-rules.js:87-103`:
*exceptions* (default): nothing at all when nothing is urgent — PROVEN LIVE on A01 (note: `A01 fresh (exceptions,
unclassified): NO ribbon bar rendered`). *always*: the bar renders with the neutral grey block `Unclassified`
(`doc-ribbon/index.jsx:1092-1095`, class `rb-class--none`, title `This page has no classification`) and an EMPTY right half
(`rb-body--empty`) plus `Open` and a dismiss ✕ — on every page of every space, forever, with nothing to say. The byline chip
says `Unclassified` in BOTH modes on every page of the site (`composeByline`, `byline.js:70-76`), and the tooltip
`No classification level · No seals on this page · Open Sentinel Vault`. For a site that does not use classification this
is the app announcing a feature the site did not turn on, under every title, with a grey dot. Not acceptable; see CLS-1.

**Q4 — Conflict/duplication with Guard.** Today: the selector (`logic.js:308-313`) probes native and, because
`read:configuration:confluence` is not granted, always falls to App; so on a site WITH Guard classification the user sees
Confluence's own classification lozenge AND our `Unclassified` chip/block saying the opposite. A01 already shows the shape
on wolfaenpak with a third app: a purple `RESTRICTED` banner from another install over a page our chip calls `Unclassified`
— two "classifications" of one page in one viewport. When Guard is enabled later (scope shipped): the selector flips to
native silently; levels the admin typed in our editor vanish from the pickers; every `classification-page-{id}` KVS override
and `classification-space-{id}` default becomes unreachable (native `getPageLevel` reads Confluence, not KVS); the tab says
`Native` and hides the editor with no migration message; `manageLevels` answers `Levels are managed in Confluence's own
classification settings on this site` only when someone tries to save. Nothing tells the admin their App levels/overrides
are now dead data. See CLS-6.

**Q5 — Compliance officer.** Nothing exists: no history (no activity entry, no `changedBy/at` beyond `updatedAt` in KVS),
no "who set it", no pages-per-level report, no CSV, no CQL recipe in the UI (the property `sentinel-classification` is
written but no surface tells anyone the CQL to search it), no expiry/re-review of a classification, no forced
classification, no "level required to be Approved". The workflow dashboard exports CSV for states; classification has no
dashboard at all. See CLS-8/CLS-9.

---

## Items (ordered by how badly the user is misled or blocked)

### CLS-1 The feature cannot be turned off, and it announces itself on every page
**Who** site admin; every reader.
**Observed** A01-fresh-page.png / A02-byline-zoom.png: a page nobody classified in a site that never set up classification
shows `Unclassified (Development)` (and `Unclassified (Staging)` from the second install) in the byline of every page.
Tooltip: `No classification level · No seals on this page · Open Sentinel Vault`. With `ribbonMode: "always"` the banner
also renders a grey `Unclassified` block with an empty right half on every page (`ribbon-rules.js:97-100`,
`doc-ribbon/index.jsx:1092`). There is no setting anywhere: `settings-schema.js` has `ribbonMode` and
`ribbonThresholdRank` only; `classification-provider` always answers levels (`DEFAULT_LEVELS` when KVS is empty,
`logic.js:244`); the space console has no classification control at all (`grep -i classif realm-console/index.jsx` →
none). The owner's own words: "first it needs to be toggled on or off".
**Why it fails the user** A site that bought the app for sealing gets a compliance vocabulary ("Unclassified") stamped on
its whole wiki. Guard and AppFox both start OFF and are enabled by an admin; AppFox shows "Pending level" only after the
feature is on. Ours cannot be silenced except by disabling the whole ribbon (`enableDocRibbons`), which also kills seal
alerts — and the byline chip cannot be silenced at all.
**Proposal (end-to-end spec of the toggle)**
- Setting `classificationEnabled` — **global**, `admin-settings-global`, kind toggle, group "Classification" (new group in
  `settings-schema.js`; the Classification tab keeps the editor). Label `Classification levels`. Text: `Pages carry a
  classification level (Public, Internal, Confidential, Restricted…) shown on the page, used by the workflow and the rules
  below. Off: nothing is shown and nothing is enforced; stored levels are kept.` **Default OFF** for never-saved tenants
  (the P1-4 rule: `policies/actions.js:148` merge never overwrites, so existing tenants keep ON — write `true` into their
  record on upgrade so behaviour does not change under them).
- Per-space override `classification: "inherit" | "off"` on `admin-settings-space-{key}` with a single control on the space
  console's Access Control tab: `Use classification in this space` (inherit / off). A space cannot turn it ON when the site
  is OFF (same AND rule as the auto-insert macro, `doc-surgery.js:497`).
- Resolution function `classificationActive(spaceKey)` in `classification/logic.js` (pure; unit-tested) used by:
  `page-details-summary` (omit the `classification` block → modal hides the section), `ribbon-summary`
  (`sealing/actions.js:1445-1458`: send `classification: null` and `ribbonMode` forced to `exceptions` semantics for the
  block → the left block is not rendered at all, the ribbon row is seal/workflow only), `composeByline` (title becomes the
  seal count: `2 seals on this page` / `Sentinel Vault`; never "Unclassified"), `classification-get-page` (answers
  `{ enabled:false }`), config API `classify-page` (refused with `Classification is off on this site`), the steward tab
  (everything below the toggle is dimmed with `Turn on classification to use levels` — the `.nested-control` pattern).
- Stored levels/overrides/defaults are **kept** when OFF (turning it back on restores the exact state); the toggle text says
  so. The Assets link is kept.
- The native scheme: when Guard levels exist, the toggle still governs OUR surfaces only; copy under the toggle: `Confluence's
  own classification stays as Confluence shows it.` (We cannot turn Guard off and must not pretend to.)
- What "off" shows per surface: byline chip = seal state only; ribbon = no level block (row is 2 columns); modal = no
  Classification section; realm console = nothing; steward tab = toggle + dimmed sections; My work = unchanged (never showed
  it); REST `site` bundle = `classification: { enabled:false, levels:[…] }`.
**Confidence** high that a global master toggle with a per-space "off" is right (both competitors are opt-in; it is the
owner's stated requirement; the resolution shape already exists for the macro). Medium on "default OFF for new tenants" —
it hides the feature from evaluators, which the owner may not want; the alternative is default ON with first-run question 3
(UX-REVIEW §3.4) asking it explicitly.
**Blast radius** `settings-schema.js`, `policies/actions.js` (defaults + upgrade write), `classification/logic.js`
(+test), `sealing/actions.js` ribbon-summary, `page-details/actions.js` + `byline.js` (+ `test/byline.test.mjs`),
`page-details/index.jsx`, `doc-ribbon/index.jsx` (2-column layout when no block), `realm-console/index.jsx`,
`ClassificationTab.jsx`, `config-api/bundle.js`, docs/settings-reference.md, docs/REST-CONFIG-API.md.

**Status (2026-09-20):** done in the CLS-1 commit (dev 8.14.0; 8.15.0 carries WF-6 on the same chip), evidence `scenarios/sentinel-vault/cls1-classification-off.spec.ts` (server: byline / page-details-summary / ribbon-summary / classification-get-page / set-page / set-space-default all read the ONE rule `classificationActive`; on → off → space-off → inherit round-trip keeps the stored level; browser: ribbon brand block, chip without a level, modal without the section, the site switch + hidden ribbon rows, the tab's off banner, the space console's override, light + dark PNGs). Default OFF for never-saved tenants: Gabriela's leanzero-demo loses the chip's level until Settings → Classification is switched on — the owner's decision. Setup question 3 is now the switch. REST: `site.classification.enabled`, `spaces.<KEY>.classification`.

### CLS-2 A level does nothing — it is a coloured word (the "reason to be there")
**Who** page owner, space admin, compliance officer.
**Observed** Grep of every consumer of a level: `triggers.js` 0, `workflow/` 0, `validations/` 0 (rule types are
`required-heading / required-table / required-label / heading-hierarchy / max-length / min-length`,
`ValidationsEditor.jsx:46-53`), `sealing/` 0, `activity/` 0, notice blueprints 0. The only readers are the byline title,
the ribbon block and `meetsThreshold` (opens the ribbon at rank ≥ 4 to show the level's description sentence,
`doc-ribbon/index.jsx:1080`). Modal copy after classifying: `Set on this page. The space has no default. Highest
sensitivity; strictly need-to-know.` — and then nothing is different about the page. **[A06 missing]**
**Why it fails the user** Guard levels drive data-security policies (public links, export); AppFox levels restrict page
access per level; Comala's workflow is what a status *does*. The app's own definition (PRODUCT-DEFINITION §1) is
"enforce"; a level that only decorates contradicts the product's one sentence and the owner's ask ("it needs to have a
reason to be there").
**Proposal — the first reason to ship: a level is an ENTRY CONDITION and a PROTECTION POLICY of the workflow (BC-4).**
Concretely, one new per-space workflow setting block "Classification" in `WorkflowSettingsEditor`:
1. `Pages at or above <level picker> must be Approved before they count as published` → `entryConditions.approved.minLevelRank`
   is the wrong direction; instead `workflow.classification.requireWorkflowFrom: <rank>`: a page whose effective level ≥ rank
   is auto-assigned to the workflow on save if it is not in one (reuses `autoAssignNew`'s path), so a Restricted page can
   never sit outside review. Ribbon sentence on such a page: `Restricted pages in this space go through review.`
2. `Changing a page's level to <rank or higher> needs an approver's decision` → `classification-set-page` on a page in a
   workflow with this on writes a PENDING reclassification (`classification-page-{id}.pending`) and creates an approval item
   via the existing `workflow/approvals.js` path (kind `reclassify`); approvers see it in My work; the effective level stays
   the old one until approved. This is the "classification/re-classification requires approval" candidate and it reuses
   every approval surface that exists.
3. `Editing an Approved page classified <rank or higher> by a non-approver is` `reverted` (forces `enforceMode: revert` for
   those pages regardless of the space's demote default) — the level raises the protection.
Each writes a `workflow.classification.*` activity entry (also fixes CLS-8's "no history" for the workflow-relevant part).
**Alternatives rejected** *Auto-seal on Restricted* (all attachments/sections sealed to the owner): rejected because a seal
has an owner and an expiry and the app's release valves assume a human chose to seal — an implicit seal creates lapse
notices, halfway reminders and edit-request traffic nobody asked for, and "who is the owner of an auto-seal?" has no good
answer (last editor? page creator?). *Block export/sharing*: the app cannot (no Forge API for page restrictions of that
kind; Guard can) — say so in the tab copy rather than imply it. *Validation rule "requires level ≥ X when PII detected"*:
good second step but depends on the AI review (budgeted, async, Haiku) and is advisory by design; it does not make a level
DO anything by itself. *Forced classification on create/edit (AppFox)*: the app cannot block a save; it could only
revert or comment — a revert of an unclassified page is hostile. Keep as a soft rule: `A page with no level in this space
gets a ribbon prompt` (see CLS-3).
**Confidence** medium-high on the direction (it is the only place in the app with approvers, decisions, an inbox and
enforcement already built — the level becomes the knob that turns them on); medium on item 2's details (pending-level
storage and the approval kind need a design pass; the approval blueprint mentions "every approver", noise must be checked
against P1-4).
**Blast radius** `workflow/logic.js` (+settings sanitizer), `workflow/actions.js`, `workflow/approvals.js`,
`WorkflowSettingsEditor.jsx`, `classification/actions.js` (`setPage` pending path), `triggers.js` (assign-on-save gate,
enforce-mode override), activity format, `doc-ribbon/index.jsx` (sentence), My work (approval kind label), docs.

### CLS-3 The page editor cannot discover the control, and gets no answer to "what now"
**Who** editor.
**Observed** A01/A02: the only affordance is a grey-dot byline chip whose text is the *state* (`Unclassified`), sitting
among Listen / Add a reaction and two other apps' chips; 3 clicks to a level; the modal opens on the seals Overview with the
Classification section as one `pd-sec` among seals/attachments/activity (`page-details/index.jsx:640`) **[A03/A04 missing]**;
after choosing, the description flips to `Set on this page. The space has no default. <level description>` with no toast,
no activity row, no "this means …". In *exceptions* mode a page set to Internal shows NO ribbon (rank 2 < 4) — the user
classified the page and the page looks exactly as before **[A09 missing]**.
**Why it fails the user** AppFox puts a lozenge at the top of the page reading "Pending level" — a visible prompt to act.
Guard renders the level as a page badge with "change" behind it. Ours hides the control inside a modal reached from a chip
that does not look like a control and whose label denies the feature is in use.
**Proposal** (a) Byline title when enabled and unset: `Classify this page` for editors (the chip is per-page, not per-viewer
— so use the neutral `Not classified · set it` and let the modal gate the picker as today); when set: `Internal · space
default` as now. (b) The modal opens on the Classification section when the chip's level is unset (scroll target), with a
one-line consequence sentence per level pulled from the space's workflow rules (`Restricted pages in this space go through
review and are reverted when edited by non-approvers`) — the description field alone is policy prose, not consequence.
(c) A confirmation line after the change (`Classified as Restricted. Approvers will be asked to confirm.` / `Classified as
Internal.`) and an Activity entry `classification.changed` (who, from → to, source). (d) Optional space setting `Ask editors
to classify new pages` → the ribbon opens in exceptions mode on an unclassified page with sentence `This page has no
classification` and an inline level picker in the right half (the ribbon already hosts an inline ask input, `rb-ask`).
**Confidence** high on (a)(c), medium on (b)(d) (copy depends on CLS-2 shipping; (d) is a new ribbon control).
**Blast radius** `byline.js` + test, `page-details/index.jsx`, `activity-format.js`, `classification/actions.js`,
`doc-ribbon/index.jsx`, `ribbon-rules.js` + test.

### CLS-4 The steward tab explains the implementation, not the feature
**Who** site admin.
**Observed** Copy quoted in Q2: `Scheme in use — App`; `Levels are stored by the app and applied as a content property on
each page`; `the colour is the chip shown on pages`. Provider name badge `App`/`Native` (`ClassificationTab.jsx:361-363`).
**[B03 missing]**
**Why it fails the user** "App" vs "Native" is the code's provider seam; the admin's question is "where do I manage levels
and what do they do". Guard's admin page opens with what a level is for and how it is applied.
**Proposal** Replace the "Scheme in use" section with a lead paragraph in user terms: `Where levels come from: Sentinel
Vault (edit below) | Confluence data classification (managed in Atlassian Administration → Security → Data classification;
shown here read-only) | JSM Assets (linked to <type>, re-import below)` — one line with the active source in bold, the
other two greyed with a "why not" hint (`this site has no published Confluence levels`). Then a "What a level does" card
listing the live rules (CLS-2) with links to the space workflow settings, and the CQL recipe for finding pages by level
(`content.property[sentinel-classification].levelId = "restricted"` — verify the exact CQL form live before shipping it).
Drop "content property" from the copy.
**Confidence** high.
**Blast radius** `ClassificationTab.jsx`, `steward-console.css`, docs/settings-reference.md.

### CLS-5 The Assets wizard is a JSM admin's screen dropped into a Confluence admin's tab
**Who** site admin (Confluence), who is often not the JSM Assets admin.
**Observed** Steps quoted in Q2. Specific defects from code: (1) step 3 shows every attribute of the type as a button for
each of the three rows — including Assets system attributes (Key, Name, Created, Updated) that can never be right;
(2) the guessed mapping is pre-selected but never labelled as a guess; (3) `Import 4 levels — replaces the current list`
silently deletes hand-typed levels and, if a level id disappears, every page/space assigned to it becomes `Unclassified`
(`decideEffective` treats a missing id as unset, `logic.js:64-69`) — the button warns "replaces", not "pages assigned to a
removed level lose their classification"; (4) after import the receipt says `Imported from Classification Level in
Information Governance on <date>. Re-import after the objects change in Assets.` — the admin has to remember to re-import
by hand; there is no change detection; (5) no link to the object type in JSM; (6) the section renders ABOVE the Levels
editor even before anything is linked, so the first thing an admin sees under "Scheme" is an Assets pitch. **[B06–B10 missing]**
**Why it fails the user** The comparison note itself said the app-owned list is simpler; the owner asked for Assets as
the *source of truth*, which the market has no equivalent of — so the copy must carry the whole explanation. AppFox and
Guard keep levels at ≤ 10 and edit them in place.
**Proposal** Move the section below Levels, collapsed as `Get levels from JSM Assets…`; one-sentence purpose on top (`Keep
the level list identical to the classification objects your governance team maintains in JSM Assets`); step 3 hides
system attributes and shows the guess as `Rank ← Rank (guessed — change if wrong)`; the import button reads `Replace the 4
levels with these N` and the dialog (the tab's own `Dialog`) lists which existing level ids will vanish and how many
spaces/pages currently use them (count `classification-space-*` and page overrides — a KVS query, the tab already lists
spaces); the receipt links to the object type (`/jira/servicedesk/assets/object-schema/<id>?typeId=<id>`) and shows
`Last imported <date> by <name>`; a `Check for changes` action that previews and says `No differences` or `2 changed`.
**Confidence** high on copy/ordering/dialog; medium on the usage count (needs a KVS scan of page overrides — bounded by
`WhereConditions` on the `classification-page-` prefix, already used elsewhere).
**Blast radius** `ClassificationTab.jsx`, `classification/actions.js` (usage count, diff preview), `logic.js` (+test).

### CLS-6 Guard coexistence is silent and destructive
**Who** site admin, compliance officer.
**Observed** Q4. A01 shows the visual shape: a foreign `RESTRICTED` banner and our `Unclassified` chip on the same page.
Selector `logic.js:308-313`; native provider reads Confluence only (`:160`); the tab hides the editor and says nothing about
the App levels and overrides that still sit in KVS; `manageLevels` refuses after the fact.
**Why it fails the user** When an org admin publishes Guard levels, every Sentinel Vault classification on the site
disappears from every page without a word, and a page Confluence says is Restricted may sit under our `Unclassified`
until the lazy byline rewrite runs (`page-details/actions.js` on open). Two badges disagreeing is worse than one.
**Proposal** (a) Never show two classifications: when native is active, our chip/block show the native level (already the
case via the provider) — but also when native is *present and ours is active by fallback* (scope granted, `[]` levels),
we must not render `Unclassified` next to a Guard badge: treat "Guard feature enabled on the site" (page endpoint answers
2xx/`null` rather than 404 "Feature is disabled") as "native owns it" and hide ours unless the toggle says otherwise.
(b) Migration notice in the tab when native takes over: `Confluence classification is now active. 3 site levels and 14 page
levels set in Sentinel Vault are no longer shown. [Export them as CSV] [Map to Confluence levels…]` — the map action writes
native page levels via `setPageLevel` for each KVS override (needs `write:space:confluence`/page write; the provider already
has the calls). (c) State the rule in the toggle copy (CLS-1).
**Confidence** medium — the exact Guard signals (404 vs `[]` vs a level object) are documented only from the two test sites;
the "feature enabled but no published levels" state needs a live probe on a Guard-enabled site before (a) can be written.
**Blast radius** `classification/logic.js` selector (+tests), `provider.js`, `ClassificationTab.jsx`, `byline.js`,
`ribbon-summary`, docs/MAJOR-RELEASE-7-RECONSENT.md.

### CLS-7 Space admins have no home for classification
**Who** space admin.
**Observed** `realm-console/index.jsx` has no classification tab or control (grep: 0). The only place a space default can be
set is the SITE admin console's Classification tab, which a non-site-admin steward can open only if they find the global
Apps settings page; there the table shows "the spaces you administer" (`ClassificationTab.jsx:398`). UX-REVIEW §3.4 already
proposed the first-run question 3 for the space console; it has no control to point at. **[C01 missing]**
**Why it fails the user** Comala and AppFox both scope classification/workflow per space in the space's own settings; a
space admin should never need the site console.
**Proposal** A "Classification" card on the space console (Access Control or the Workflow tab, next to the rules of CLS-2):
`Default level for new pages: <LevelPicker>`, the space "off" override (CLS-1), and the CLS-2 rules. Reuse `LevelPicker`
from `ClassificationTab.jsx` (move to kit) and `classification-set-space-default` (already steward-gated per space).
**Confidence** high.
**Blast radius** `realm-console/index.jsx`, `ClassificationTab.jsx` (extract picker), `realm-console.css`.

### CLS-8 No history: who classified what, when, and from what
**Who** compliance officer, page owner.
**Observed** KVS `classification-page-{id}` holds `{ levelId, updatedAt }` only (`logic.js:280`); no account id; no activity
entry (`activity/` has no classification kind); the page's Activity tab therefore shows seals and workflow but never a
level change **[A07 missing]**; the content property mirror carries `{ levelId }` only.
**Why it fails the user** AppFox has "Classification history" in the ⋯ menu; Comala's Document Activity Report lists every
change with who/when. An auditor asking "who downgraded this from Restricted" gets nothing.
**Proposal** Write `classification.changed { pageId, from, to, source, by }` through the existing activity writer on every
`setPage`/`resetPage` and `classification.space-default { spaceId, from, to, by }` on space changes; store `by` in the KVS
record; show the rows in the modal's Activity tab (the feed already renders by category — add a category) and in the space
Activity tab.
**Confidence** high.
**Blast radius** `classification/actions.js`, `activity/actions.js` + `activity-format.js`, `ActivityFeed.jsx` copy.

### CLS-9 No report: pages per level, CSV, search recipe
**Who** compliance officer, site admin.
**Observed** The workflow dashboard has per-state counts and CSV (`WorkflowDashboard.jsx`); classification has no
dashboard; the `sentinel-classification` property is written "for CQL" (`logic.js:30`) but no UI, doc or copy tells anyone
the CQL; `docs/user-guide.md` and `docs/settings-reference.md` do not contain the word "classification".
**Why it fails the user** Guard has a data-classification report per level; AppFox has a compliance dashboard. Without a
list, "we classified our wiki" cannot be evidenced.
**Proposal** A "Classification" section on the workflow dashboard (space) and a site-wide one on the steward tab: counts per
level (space default vs page-set), `Unclassified` count, a table of page-set pages (title, level, set by, when) with CSV
(reuse the dashboard's CSV path), and the CQL string with a copy button. Server: a lister over `classification-page-*`
(WhereConditions prefix) joined to page titles via v2 (paged, capped), space-scoped for stewards, site-wide for site admins
(SV-SEC-1 shape: the space is derived from each page, never from the payload).
**Confidence** medium-high (the lister must be cheap: KVS prefix query + one v2 bulk read per 250 pages).
**Blast radius** `classification/actions.js`, `WorkflowDashboard.jsx` or a new `ClassificationReport.jsx`,
`ClassificationTab.jsx`, `realm-console/index.jsx`, docs.

### CLS-10 The ribbon settings describe the mechanism, not the choice
**Who** site admin.
**Observed** `settings-schema.js:100-107`: label `Ribbon`, text `What opens the ribbon: only exceptions, or the
classification block on every page.`; `Ribbon classification threshold` — `In "Exceptions only", a page classified at this
rank or higher opens the ribbon on its own (default scheme: Public 1 · Internal 2 · Confidential 3 · Restricted 4).`
The threshold is a NUMBER input (rank) while everywhere else the admin picks a level chip; renaming/reranking levels
silently changes what the threshold means. **[B02 missing]**
**Why it fails the user** The admin thinks in levels ("show the banner from Confidential up"), not ranks.
**Proposal** Replace the rank count with a `LevelPicker` (`Show the banner from <Confidential> up`), store the level id and
resolve the rank at read time (`normalizeRibbonSettings` gets the levels), keep the rank as the stored fallback for the
config API; move both controls under the classification toggle (CLS-1) — they are meaningless when it is off.
**Confidence** high.
**Blast radius** `settings-schema.js`, `ribbon-rules.js` + test, `steward-console/index.jsx`, `sealing/actions.js`.

### CLS-11 The byline row on a dev/staging site shows three "Sentinel Vault" chips
**Who** everyone on wolfaenpak (evidence hygiene, but also a real production shape when a customer has two installs of any
byline app).
**Observed** A01/A02: `Unclassified (Staging)`, `RESTRICTED (Development)` (another app), `Unclassified (Development)`.
The first run's note shows the fresh-page chip text as `Sentinel Vault (Development) (Development)` — the manifest's static
title plus the environment suffix, duplicated.
**Why it fails the user** The critique itself was misdirected by it (the spec clicked the wrong app's chip); a user will be
too. The static title `Sentinel Vault` + "(Development)" appears twice because the manifest title already carries the
suffix on dev.
**Proposal** Manifest byline title without an environment word (the host adds it); keep only the dev install of the byline
module on the test site (uninstall staging's byline or scope it to another space).
**Confidence** high on the title; this is a test-site hygiene item otherwise.
**Blast radius** `manifest.yml` byline title; harness `_door.ts` (already handles it).

---

## Questions only the owner can answer

1. **Default for the toggle on NEW tenants: OFF (opt-in like Guard/AppFox) or ON with the first-run question?** OFF hides
   the feature from Marketplace evaluators; ON keeps today's behaviour. Existing tenants keep ON either way.
2. **Is the "reason to be there" the workflow (CLS-2) — or is the JSM Assets link meant to become "this page describes
   asset X" (an Information Asset object per page)?** The Assets design doc says levels only; the briefing hints at page ↔
   asset linking. Those are two different features and the second needs write scopes to Assets that the owner declined so
   far.
3. **May a level force `enforceMode: revert` on Approved pages (CLS-2 rule 3), overriding the space's demote setting?** It
   is the strongest "a level does something" and the most surprising to a space admin who chose demote.
4. **When Guard takes over (CLS-6), should the app offer to WRITE its stored page levels into Confluence's classification
   (needs the write scopes and a major), or only export them?**
5. **Should classification stay a site-admin-only scheme, or may space admins add levels for their space?** Everything
   above assumes one site-wide level list (as Guard and AppFox do).
6. **Threshold semantics after CLS-10: is "show the banner from Confidential up" still wanted at all once a level triggers
   workflow rules, or does the ribbon simply follow those rules?**
