# Data classification — UX design record (2026-09-30)

## Gap table (written before the change, from the code on `main` at d08f201)

| Principle | Today | Change |
|---|---|---|
| P1 always visible | Banner opens only in `ribbonMode:"always"` or at/above the threshold rank (default 4 = Restricted), or when a seal / workflow / alert / validation state exists (`ribbon-rules.js decideRibbon`). An attachments-listing error drops the level entirely (`ribbonSummary` returns before `ribbonViewerHalf`). × hides the whole row for the session. Byline is written only on seal / section / page-classification writes, saves and the details modal, so a site switch or space default change leaves chips stale or showing the manifest title "Sentinel Vault". | Classification active ⇒ `show:true` on every page, level block always drawn. Classification is read even when the attachments read fails. × never closes the level block; it hides the urgent right half only. `ribbon-summary` rewrites the byline (stamp-checked) on every view; a space default change, the site switch and a space opt-out queue a bounded per-space byline refresh on the existing `realm-audit-queue` consumer. |
| P2 text first | Name always rendered; chips white-on-colour at ≥ 4.5:1 with the default palette. | Unchanged (verified). |
| P3 say where it comes from | Byline "space default", ribbon "space default", modal "Space default." | One phrase everywhere: "from space default" / "set on this page"; the modal also says when a page override is below the space default. |
| P4 raise = one action | Modal: one pick (already). Steward tab row: one pick (already). Bulk bar: select → pick → **Apply → confirm dialog**. Space console: no default picker at all. Turning it on: Settings tab → toggle → Apply Configuration. | Single-space change stays one pick, now with an inline "Saved". Bulk: pick → ONE confirm dialog (Apply button removed); a bulk of one space is a single-space change (no dialog). |
| P5 lowering = one reason | Nothing distinguishes lower from higher; no reason anywhere; server accepts any change. | `isDowngrade(from, to, levels)` in `classification/logic.js` (pure, tested), used by the resolvers and all three UIs. Server refuses a lower / clear / "use space default"-that-lowers without a reason. Reason recorded in the activity log. |
| P6 container default + override | Precedence already right (`decideEffective`). Pages inheriting a changed default do not update their chip until something else touches them. | Eager fan-out + lazy refresh (above). No push-up of lower page overrides (see "Where we differ"). |
| P7 authz | `set-page` = `canEditPage`; `set-space-default` = site admin or steward of the space the SPACE ID resolves to. | Unchanged. New read resolver `classification-space-default` uses the same space-id-derived bar. |
| P8 one switch | Tab says "Turn it on in Settings" and sends you to Settings + Apply Configuration. | The tab always opens with the state line and ONE two-way switch (owner feedback mid-change: "after i enable it i am not able to see the hide button"). It saves `classificationEnabled` through `store-policy` (same path, same mirror) and stays on the tab; off asks one confirmation. The console's Settings snapshot is patched so a later Apply cannot write the old value back. |
| P9 space admin sets own default | Only the site console could set a space default. | Space console Classification card gets a level picker (save on pick, reason on lowering). "As the site / Off" stays on the Apply bar. |
| H audit trail | No `classification.*` activity types. | `classification.page-set`, `classification.space-default-set` (from/to, reason when lowered), new "Classification" activity category. |

## What classification is here

A **persistent sensitivity marking**, not an alert. Levels are defined once per site (ours by
default: Public 1 · Internal 2 · Confidential 3 · Restricted 4, where **1 is the least sensitive**; or JSM
Assets, or Confluence's native scheme when the site has one). A space has a default and a page may
override it. When classification is on for a page's space, every view of the page shows the level
under the title (byline chip) and in the banner at the top. That includes "Unclassified" in neutral grey.

## Principles (as shipped, 2026-09-30, dev 8.93.0)

1. **Always visible (P1).** `decideRibbon` shows the row whenever `classification.enabled === true`
   (`src/ui/kit/ribbon-rules.js`). `ribbon-summary` reads the level even when the attachments listing
   fails, and the row then says "Sentinel Vault could not check the seals on this page · Retry".
   The × hides the right half only, and it is not drawn at all when there is nothing beside the level.
   The byline converges on the first view (`ribbon-summary` → stamp-checked `writeBylineFor`), and
   eagerly after a space default change, a space opt-out or the site switch (`byline-fanout.js` on
   the existing `realm-audit-queue` consumer: 250 pages per hop, 20 hops per space, pages then blogposts;
   a newer job supersedes an older one).
2. **Text first (P2).** The level name is always rendered and the colour only decorates it. The default
   palette keeps white ink at ≥ 4.5:1.
3. **Where it comes from (P3).** `sourcePhrase()` gives "set on this page" / "from space default" for
   the byline, the banner and its tooltip. The modal says "From the space default." or "Set on this
   page. The space default is X." / "…— lower than the space default (X)."
4. **Raise = one action (P4).** Picking a level saves it, and the UI shows "Saved" (plus Undo in the
   modal when undoing needs no reason). A bulk change across several spaces keeps ONE confirmation
   dialog, and the bar says so. A bulk of one space is a single change.
5. **Lower = one reason (P5).** `isDowngrade(from, to, levels)` (pure, `classification/logic.js`) is
   the rule. Clearing a level and "use space default" onto a lower default both count. The server
   refuses without `reason`; the three UIs ask inline first. The reason goes into
   `classification.page-set` / `classification.space-default-set`.
6. **Container default + override (P6).** Precedence is unchanged: the page wins, then the space, then none.
7. **Authorisation (P7).** Page writes need `canEditPage`. Space defaults need a site admin or an admin of
   the space **derived from the space ID** (both the write and the new `classification-space-default` read).
8. **One switch (P8).** The Classification tab always opens with the state and ONE two-way switch.
   On saves at once. Off asks once and says the levels are kept. Both write `classificationEnabled`
   through `store-policy`, and the console patches its Settings snapshot so the Settings toggle agrees.
9. **Space admin sets their own default (P9).** The space console's Classification card has the level
   picker (save on pick, reason on lowering). "As the site / Off" stays on the Apply bar.

## Where we deliberately differ from native Confluence (Guard)

- **No push-up of page overrides when the space default rises.** Native raises a page that was set
  lower by hand when its space default becomes more sensitive. We don't. Purview (the reference UX)
  never lets a default override a manual label. Our lower override is often a deliberate carve-out
  ("Public · set on this page" in a Confidential space). A background job would also rewrite
  explicit, audited decisions on many pages with no undo. The modal shows the case instead:
  "Set on this page — lower than the space default (X)."
- **Justification on downgrade only** (Purview's rule). Native asks for nothing.
- **The banner is ours.** Where native draws its badge is unverified, and we don't try to mirror it.
- **Rank order is ours:** 1 is the least sensitive (native `order` maps onto `rank` unchanged).

## Decisions the owner should know

- `enableDocRibbons` ("Page ribbon") was never read by the banner surface. It gates recording alert
  rows (together with pop-ups) and the recurring reminder. The classification marking therefore
  already showed regardless, and it still does. The setting's label overpromises. That is noted in
  `docs/settings-reference.md` and left for the owner.
- The `ribbonMode` / `ribbonThresholdLevel` / `ribbonThresholdRank` rows are removed. Stored values and
  API bundles are accepted when well-formed and read by nothing (`docs/REST-CONFIG-API.md`).
- A partial `store-policy` global write (e.g. the switch) no longer reads an omitted `autoUnlockEnabled`
  as "on". Before, it would have "resumed" every seal timer on a site with auto-unseal off.

## Not verified live

This machine has no browser harness and no `test-harness/.env`. Everything above is unit-tested and
built, but not clicked through in Confluence. The owner's manual checks are in the iteration report.
