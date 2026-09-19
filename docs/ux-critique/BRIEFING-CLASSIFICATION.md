# Briefing — Classification UI/UX critique (2026-09-19)

Read BRIEFING-COMMON.md first.

## What exists today (code truth — verify it, then judge it)

- `src/server/capsules/classification/` — provider seam (`native` = Confluence's own levels via
  `/wiki/api/v2/classification-levels` when the site has them, else `app` = levels in KVS
  `classification-levels`, ≤ 8, name/colour/rank/description); per-space default
  (`classification-space-default-*`), per-page override stored as a content property; the JSM
  Assets import shipped today (`AssetsLink` in `src/ui/kit/ClassificationTab.jsx`: schema →
  object type → attribute mapping → preview → Import; Re-import / Change source / Unlink).
- Where a user SEES a level: the page banner (`doc-ribbon`) shows a solid level block (colour +
  name, "Unclassified" grey when none) with `ribbonMode` exceptions|always and
  `ribbonThresholdRank`; the byline chip (`page-details/byline.js`, `composeByline`) may carry it;
  the page-details modal; CQL-visible property. Where a user SETS a level: find it — the
  page-details modal / realm console? Prove where, and how many clicks from the page.
- Settings: steward console → Classification tab (scheme badge Native/App, Levels editor, Space
  defaults table with bulk change, Assets link). Space console may have a default-level control.
  REST: config-api site key `classification.levels`, `classification.assetsLink`,
  `classificationDefault` per space (docs/REST-CONFIG-API.md).
- The owner's two explicit requirements: (1) **an on/off toggle** — today there is no way to turn
  classification OFF; the ribbon shows "Unclassified" on every page of every site as soon as the app
  is installed. Decide what "off" must mean at site and space level, what the ribbon/byline/modal
  show when off, what happens to stored levels, and how the toggle relates to the native scheme
  (Guard) which the app cannot turn off. (2) **a reason to be there** — a level that is only a
  coloured word is decoration. What does a level DO in this app? Candidates to examine against the
  code and the market: a level as an ENTRY CONDITION of the workflow (Restricted pages must go
  through review; classification/re-classification requires approval); a level that AUTO-SEALS
  (Restricted → attachments and sections sealed to the owner by default); a level that changes
  the notice policy / signature requirement; a level that blocks export/sharing (the app cannot —
  Guard can; say so honestly); a level enforced by validation rules (a page with a PII detection
  must be ≥ Confidential — the validations capsule has rule types, check whether "requires level"
  exists); forced classification on create/edit (AppFox "Force classification"); default per space
  (exists); classification history (who changed the level, when — Comala/AppFox both have it);
  a site report of pages per level with CSV (compliance officer persona); the JSM Assets link as
  the SOURCE of truth also for "which asset does this page describe" (Information Asset object
  type exists on wolfaenpak with 16 objects — is linking a page to an asset the real feature?).

## Questions to answer with evidence

1. As a page editor who has never heard of the app: can I find how to classify a page, and do I
   understand what happens after? Count clicks, quote copy, screenshot.
2. As a site admin: does the Classification tab explain what a level DOES anywhere? Does "Scheme
   in use — App" mean anything to me? Is the Assets section understandable to someone who did not
   build it (the three numbered steps, "Which attribute holds what")?
3. What does the ribbon show on an unclassified page in each mode, and is that acceptable for a
   site that does not use classification at all?
4. Where does classification conflict or duplicate with Confluence's own native classification
   (Guard) on a site that has both? What must the app do when Guard is enabled later?
5. What is missing for the compliance-officer persona (evidence, reports, history, export)?

Deliverable: docs/ux-critique/BACKLOG-CLASSIFICATION.md, including one item that specifies the
on/off toggle end to end (setting name, default, every surface's behaviour when off) and one that
specifies the first "reason to be there" you would ship, with the alternatives you rejected.
