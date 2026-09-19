# Backlog — Sealed sections × document workflow (UX critique, 2026-09-19)

Critic's walk on wolfaenpak (dev env), space WFH, as a naive user. Spec:
`~/Projects/forge-live-harness/scenarios/sentinel-vault/critique-sections.spec.ts` (throwaway; runs
editor → collaborator → workflow → approver; restores seals, workflow keys, `workflow-settings-WFH`
(was null), `admin-settings-global`, and deletes the page). Evidence:
`~/Projects/forge-live-harness/evidence/critique-sections/*.png` + `run.log`, `run-b.log` (copy
strings) — runs A/B. **Missing screenshots:** the panel-side request loop (Request edit → reason
bar → Waiting → Edit now → Declined, steps 21/27/30) has no PNG: in both runs the panel macro had
vanished by then (SEC-1 — Gabriela's seal on the last heading swallowed it), and the third attempt
with a non-last heading was blocked by another session holding the harness's shared Chrome
profile. Those states are described from `SealRowParts.jsx` / `row-state.js` and are marked
"(code)" below. The ribbon, details modal and My work equivalents were captured live.
Restoration note: the spec's `finally` aborted part-way in runs A/B (pages, section records and
`workflow-settings-WFH` were left behind); a follow-up script unsealed and purged them, deleted the
workflow keys and the settings, and removed both pages. `admin-settings-global` keeps
`enableContentProtection/enableDocRibbons/enableFlashMessages = true`, which are the app defaults.
Code read: `src/server/capsules/section-seals/*`, `src/server/capsules/editreq/*`,
`src/server/capsules/workflow/{logic,actions,approvals}.js`, `src/server/triggers.js` (enforcement
ordering), `src/ui/surfaces/{section-setup,inline-panel,page-details,my-work,doc-ribbon}/index.jsx`,
`src/ui/kit/{seal-row.js,SealRowParts.jsx,ribbon-rules.js}`, `src/server/capsules/page-details/row-state.js`,
`src/server/infra/notice-blueprints.js`, `manifest.yml`.

Test-site caveat: the page byline carries three environment chips ("Unclassified (Staging)",
"RESTRICTED (Development)", "Unclassified (Development)") and a purple RESTRICTED banner from the
staging install. That is install noise, not a finding — every screenshot below has it; ignore it.

## 0. The five briefing questions, answered with evidence

**Q1 Editor — seal a section from scratch.** A fresh page shows nothing of the app except the byline
chip "Sentinel Vault (Development)" (run A log; `01-fresh-page.png`). In the editor there is no
affordance on a heading (hover `03`, selection toolbar `04-editor-heading-selected-toolbar.png`:
Ask Rovo / Improve writing / Remix / Comment). The slash menu does list "Sentinel Vault Sealed
Section — Locks the content inside this section against unauthorized edits"
(`05-editor-slash-seal.png`), but choosing it opens a mostly-empty dialog whose only instruction is
*"Place the content you want to protect inside this section. To seal it against unauthorized
edits, open the Sentinel Vault panel on this page and use Sealed Sections → Seal a section."*
(`06-editor-macro-inserted-or-dialog.png`) — i.e. the macro tells you to go somewhere else. The
byline chip → details modal has no seal-a-section control either: "SEALS ON THIS PAGE · 0 —
Nothing on this page is sealed." (`08-details-overview.png`). The only working path is the inline
**panel macro** (which itself must be on the page; the harness had to insert it with the
`ensurePanel` hook): group "SEALED SECTIONS — Locks a heading's content on the page — no files
involved" → "Seal a section" → picker rows "H2 Scope / H2 Risks / H2 Decisions · Seal"
(`10`, `12-panel-picker.png`) → row "Risks · until Sep 22, 2026, 10:57 PM · **Release** ⋯"
(`13-panel-sealed-row-mine.png`). No duration, no note, no confirmation: one click and a 3-day seal
exists, and Confluence pops "New version published — Sentinel Vault published a new version of
this page · Reload" because the app rewrote the page. Clicks from page view to a sealed section,
given the panel is already on the page: 3 (scroll to panel, Seal a section, pick heading); given it
is not: the user must first edit the page and insert the "Sentinel Vault" panel macro.
After sealing, the view shows a cyan-bordered box with a "Sealed by Mihai Perdum" pill
(`15-macro-view-sealed-by-me.png`); the ribbon does NOT appear ("ribbon after my own seal: (no
ribbon frame)"), and the byline chip still reads "Unclassified" — only its tooltip says
"1 seal on this page". **In the editor** the section is a plain bordered box captioned "Sentinel
Vault Sealed Section" with a normal editable body (`16-editor-placeholder.png`); selecting it gives
the generic macro toolbar (edit / Centered / copy / delete, `17`); Edit opens the same dialog with
a green "✓ You can edit this section" line (`18-editor-config-dialog.png`). Would I dare edit around
it? Yes, nothing warns me not to — and I can also drag it, delete it or type inside it; the
placeholder never says "locked", never names an owner, never says what happens on publish.

**Q2 Collaborator — edit inside someone's sealed section.** Mihai appended a paragraph to Gabriela's
sealed "Decisions" over REST and opened the page: the guard put it back while he watched (v5→v6),
the macro showed the amber notice *"Your edit to this section was undone — it is sealed by Gabriela
Perdum. Your text is not lost: it is kept in the page history. [Open my version] [Reload the page]
To edit it, use Request edit in the Sentinel Vault panel, or ask the owner to give you access."*
(`35-ribbon-in-review.png` bottom, `42-…png`), and the ribbon opened with a red "Restored" pill:
*"Your edit to the sealed section Decisions was reverted. See my version (v5)"* + "Open"
(`20-ribbon-restored.png`). Do I understand what happened? Yes — this is the best copy in the flow.
What to do next? The notice sends me to "the Sentinel Vault panel", which on this page **had
vanished** (see SEC-1: sealing the last heading swallowed the panel macro into the sealed body).
The ribbon has its own "Request edit" button only when the pill is "Locked", and "Restored" wins
over "Locked" (`ribbon-rules.js pickUrgent`), so from the ribbon the collaborator can read but not
act. Request → waiting → approved → declined, as seen from the surfaces that still worked:
ribbon while pending would be "Waiting for Gabriela · Your edit request on Decisions was sent"
(code; masked by "Restored" in run A; run B showed "Locked · Decisions is sealed by Gabriela Perdum
until Tue 23:13 · Request edit" once no alert existed, `27-ribbon-edit-now.png` — note the file is
misnamed: the approve failed because the request had been swallowed with the panel); after a
decline the ribbon still says "Locked … Request edit", and pressing it answers *"A previous request
was declined; you can ask again after 2026-09-19 20:19 UTC, or ask the owner to give you access
directly"* (`31-ribbon-declined-error.png`) — an ISO-UTC timestamp for a human. Details modal
row: "Section "Decisions" — Sealed by Gabriela Perdum · until Tue 10:59 PM · [Request edit] ⋯"
(`37-details-in-review.png`); nothing there says the request was declined (row-state gives the
disabled button a tooltip only). Panel-side strings (from code, `SealRowParts.jsx`/`row-state.js`):
"Request edit" → reason bar "Why do you need to edit this section? (optional) · Send request ·
Cancel" → "Waiting for Gabriela Perdum" (a non-clickable status span) → "Edit now until Sep 22,
11:13 PM" → declined: "Request edit" **disabled**, with the reason only in a `title` tooltip:
"Your last request was declined; you can ask again after …. The owner can also give you access
directly." The requester's My work page shows nothing about their own request in any state
(`39-my-work-approver.png` has no "your requests" card; code confirms).

**Q3 Same page under the workflow.** WFH workflow enabled, page assigned, moved to In Review,
approval requested with Mihai as sole approver, while Gabriela's section is still sealed and
Mihai's own request on it is declined. Ribbon (`35-ribbon-in-review.png`): "Unclassified · **Restored**
Your edit to the sealed section Decisions was reverted. See my version (v5) · **Awaiting your
approval 0 of 1 ▾** · Open". So the ribbon shows THREE things at once — the classification block,
one seal pill, and the workflow chip — and the seal pill is the stale violation alert, not the
lock. `pickUrgent` order is alert > waiting-for-you > edit-now > waiting-for-owner > locked;
workflow approvals count into "Waiting for you" only when no alert exists. The workflow chip is
rendered separately (`WorkflowControl`), so both "waits" are reachable, but they sit in two visual
languages: a red pill with a sentence vs an amber chip with a "0 of 1" counter and a caret. The
byline chip says "Unclassified (Development)" — no workflow state, no seal, no waiting count
(`byline.js` composes classification + seal count only). Labels: none on the page (label-sync is
opt-in). Details modal (`37-details-in-review.png`): no workflow state anywhere — only the two
seal rows and the activity feed, which does say "Harness asked for approval to move the page to
Approved" and "Harness moved the page from Draft to In Review". My work (`39-my-work-approver.png`):
"2 waiting on you · Approvals waiting on you 2 · CRITIQUE sections … Move to Approved · requested
by Harness · [Approve] [Deny]"; "Edit requests on your sealed sections 0 — Nobody is waiting on you
to unlock a section."; "Files you hold sealed 4" — sections you hold sealed are not listed. The
approval dialog (`36-ribbon-approval-dialog.png`) is good: "Approval to move to Approved · Requested
by Harness · Any one approver can approve · 0 of 1 approved · View the version you are approving
(v6) · Pending Approver (you) · You're the deciding approval — approving moves this page to
Approved. Denying keeps it In Review." It says nothing about the two sealed sections on the page
it is about to freeze.

**Q4 Approver — approve the page.** Approve → ribbon: "Restored … · **Approved ▾** · **Approved v6 ·
review due Feb 16 ▾** · Open" (`40-ribbon-approved.png`) — the word "Approved" twice in two chips.
KVS: `workflow-state` = approved, approvedVersion 6, enforce true; both `section-protection-*`
records **byte-identical before and after** (log: "section records unchanged by approval:
mine=true gabi=true"). Nothing happens to the sections. Should it? Two proofs that the two models
fight: (a) the approver (privileged for the workflow) appended a paragraph inside Gabriela's
sealed section on the Approved page → the SECTION guard reverted him (v7→v8), the ribbon went
"**2 Restored** · Your edit to the sealed section Decisions was reverted" (`42-…png`), Confluence
toasted "Sentinel Vault commented just now", and the workflow silently re-stamped approvedVersion
6→8 (reconciliation) while the chip kept saying "Approved v6". (b) The approver then edited
outside any section → kept, approvedVersion 9, chip still "Approved v6" (`43-approved-page-final.png`).
So on an Approved page the *approver* is the one person the workflow trusts and the one person a
personal section seal still throws out; and the version the chip names is not the version being
enforced.

**Q5 Copy audit** — the strings a user would not understand, by surface:
- section-setup (macro): badge "Sentinel Vault" while pending, then "Sealed by {name}" / "Expired
  seal" / "Not sealed yet — seal it from the Sentinel Vault panel"; fallback body "This section is
  sealed. Unauthorized edits are automatically reverted." (reads as if the body is hidden); "The
  content of this section could not be displayed here. It is still on the page — reload to try
  again." + "Reload the page" (seen twice, `20`, `40`; caused by SEC-1's nested panel); "Loading
  the section…" (`35`, `43`); config dialog: "Place the content you want to protect inside this
  section…" + button "Insert section" / "Done"; lock line "Locked by {name} until {date} — edits you
  publish here are reverted automatically. Ask to edit from the Sentinel Vault panel." (only ever
  shown inside the config dialog, never in the editor body).
- panel SectionRow / SealRowParts: group note "Locks a heading's content on the page — no files
  involved" (defined by what it is not); "Seal a section"; primary "**Release**" in the red danger
  style on your own seal; "Request edit"; status spans "Waiting for {owner}", "Edit now until
  {time}", "Expired"; owner inbox "Edit requests (N)" with "Approve / Decline", grants "Editors
  with access (N) · since {date} · Revoke"; ⋯ "Give edit access…", "Copy link", "Force release…";
  force bar "Why are you releasing a seal you do not own? (required, 3–300 characters)".
- page-details rows: "Section "Risks" — Sealed by you · until Tue 10:57 PM"; footer "One primary
  action per row; everything else under ⋯ (Extend, Watch, Copy link, Force release — space admins,
  reason required)." — Extend and Watch do not exist for sections.
- My work: "Edit requests on your sealed sections — Nobody is waiting on you to unlock a section."
  ("unlock" here, "release" in the panel, "unseal" in the resolver, "seal" everywhere else).
- ribbon: "Restored", "Waiting for you N", "Edit now", "Waiting for {owner}", "Locked"; workflow
  chip "Awaiting your approval 0 of 1", "Approved", "Approved v6 · review due Feb 16"; "See my
  version (v5)".
- server refusals reaching the UI: "This section's seal has lapsed — extend it first, then grant
  edit access" (there is no Extend for sections — `menuActionsFor` only offers `extend` on
  attachments); "A previous request was declined; you can ask again after 2026-09-19 20:19 UTC…";
  "This section already contains a sealed section — unseal that one first"; "Page changed —
  refresh and try again".
- notices (page comments, `notice-blueprints.js`): the section request/approve/deny go through the
  attachment layouts — the owner reads "**is requesting permission to edit your sealed file**
  "Decisions"" and the requester "You can edit this **file** until the seal expires; other users
  remain blocked."

---

## 1. Backlog (ordered by how badly the user is misled or blocked)

### SEC-1 Sealing the last heading swallows everything below it — including the app's own panel
**Who** editor (owner), every reader of that page, the collaborator sent to "the panel".
**Observed** `computeSectionRange` (`section-seals/logic.js:20-33`) takes the heading plus every block
until the next heading of the same or higher level; for the last heading that is the end of the
page. Proven live (scratch script, page "CRITIQUE swallow"): top-level before =
`[heading, paragraph, extension:sentinel-vault-panel]`; after sealing "Last" the whole page is one
`bodiedExtension:sentinel-vault-sealed-section` whose body is
`[heading, paragraph, extension:sentinel-vault-panel]`. Consequences seen in the walk: after
Gabriela sealed "Decisions" the panel macro disappeared from the page for the rest of the session
(run A steps 21/27/30, run B: "panel not found"); Gabriela's section body never rendered ("The
content of this section could not be displayed here…", `20-ribbon-restored.png`; "Loading the
section…", `35`, `43`; empty box, `40`) because the ADF renderer iframe cannot render a nested Forge
macro; the undone notice tells the collaborator to "use Request edit in the Sentinel Vault panel"
— a panel that is now inside the section he is locked out of. The seal-time guard (F5) only refuses
a nested *sealed section*; any other macro, table of contents, footer, "related pages" or the
panel itself is captured silently.
**Why it fails the user** The owner asked to lock "Decisions"; the app locked "Decisions and the
rest of the page". AppFox's Section Approval macro and Confluence's own expand/panel are explicit
containers the author draws; a range inferred from headings must at least stop at a non-text
block and must never eat the app's own surfaces.
**Proposal** (1) In `sealSection` stop the range at the first top-level `extension`/`bodiedExtension`
(any app) and at the first block after the last paragraph/list/table that follows the heading; if
the picker's range would include a Sentinel Vault macro, refuse with "This heading runs to the end
of the page and would include the Sentinel Vault panel — add a heading below it, or seal a shorter
heading" (name the fix, like "Page changed — refresh and try again" does). (2) Show the range in the
picker before sealing: each picker row expands to "Seals: heading + 2 paragraphs (ends before
'Decisions')" so the user sees what will be frozen. (3) The macro's fallback copy must distinguish
"cannot render" from "sealed": today "could not be displayed here" reads as if the seal hides the
text.
**Confidence** high that the range rule is the cause (proven), high for the refusal and the preview;
medium for "stop at any extension" — a page whose section legitimately contains a status macro or
an expand would then be un-sealable, so the rule may need to be "stop at *Sentinel Vault*
extensions; warn on others".
**Blast radius** `section-seals/logic.js` (range), `section-seals/actions.js` (refusal), the panel
picker in `inline-panel/index.jsx`, `section-setup/index.jsx` fallback copy, `test/doc-surgery.test.mjs`.
**Status (2026-09-19):** fixed in the SEC-1 commit (dev 8.5.0), evidence
`~/Projects/forge-live-harness/scenarios/sentinel-vault/sec1-last-heading-range.spec.ts` (+ `evidence/sec1-last-heading/*.png`).
Shipped: the range stops at the first top-level Sentinel Vault macro (`describeSectionRange`, one home for the
rule; other apps' macros stay inside the range on purpose); the picker row says "Seals heading + N blocks · ends
before “X” / the Sentinel Vault panel / a sealed section"; the macro's cannot-render copy now says it is a
display problem, not the seal. Unit: `test/section-range.test.mjs` (20). Pre-fix run: top-level after sealing =
`paragraph | heading | paragraph | bodiedExtension:sealed-section` (panel swallowed); post-fix the panel stays
after the wrapper and the body is heading + 1 paragraph.

### SEC-2 THE unification to ship first: the workflow owns the seals on an Approved page
**Who** approver, page owner, collaborator, compliance officer.
**Observed** Two enforcers run on one page and do not know each other: approving the page changed
nothing on the two sections (records byte-identical); the approver was reverted inside a sealed
section on the page he had just approved (v7→v8, `42-ribbon-after-approver-edit-in-section.png`);
the personal seal's revert silently advanced the workflow baseline 6→8→9 while the chip stayed
"Approved v6" (`43-approved-page-final.png`); the approval dialog (`36`) never mentions the seals it
is about to freeze; the ribbon ends the walk with three states in one bar — "2 Restored",
"Approved ▾", "Approved v6 · review due Feb 16" (`40`). Code: `sealSection` calls
`restampIfEnforced` (a one-way courtesy from seal → workflow); nothing goes the other way;
`collectWorkflowEnforcementForPage` treats the approver snapshot as privileged for the *page* while
the section pass in the same trigger treats only `lockedBy`/grantees as privileged for the
*section*.
**Why it fails the user** The product definition promises "this must not change without me" about a
section OR an approved page; on the same page the two "me"s disagree, and the reader has no idea
which one wins. Comala buyers assign a workflow to a space and expect "Approved" to be THE lock;
community asks are "lock the page during approval" and "lock at the end without hiding the state"
— both are workflow-owned locks. Nobody asks for two lock owners on one page.
**Proposal — ship this:** *An enforced workflow state owns every seal on the page.* Concretely:
(a) entering Approved (or any `enforce: true` state) re-parents every sealed section and sealed
attachment on the page to the workflow: `lockedBy` stays for the trail, but the privileged set
becomes the approver snapshot ∪ space admins (the same set the page uses), grants and requests are
frozen ("This page is Approved — changes go through the workflow"), and the section badge reads
"Approved v6 · with the page"; (b) the approver's own edits re-baseline sections exactly as they
re-baseline the page (one privileged set, one restamp); (c) leaving Approved (Draft / In Review /
Expired) hands the seals back to their owners, unchanged; (d) the approval dialog lists what will
be frozen: "Approving freezes this page at v6, including 2 sealed sections (Risks — Mihai;
Decisions — Gabriela) and 0 sealed files"; (e) the "Request edit" primary on a sealed row of an
Approved page becomes "Propose a change" and opens the workflow's demote/return-to-review path
instead of a personal grant; (f) a page with `enforceMode: revert` no longer needs the section
pass at all while Approved — the page revert already restores the sections (one write instead of
two, no double "Restored").
**Rejected alternatives and why:** *Sections as approval units* (AppFox Section Approval: request
approval for a section, approvers, "expire on edit", decision trail in the macro) — the strongest
market shape, but it ADDS a third model (per-section approver lists, per-section expiry) on top of
the two that already disagree; ship it second, as "Request approval for this section" that creates
a workflow-owned seal once SEC-2 exists, so it reuses the approver pickers, e-signature and the
inbox rather than cloning `editreq` again. *Seal → "propose a change"* (requester edits the "my
version", owner sees a diff and approves → re-baseline) — a real improvement to edit requests (the
requester today re-types after a time-boxed grant) but it does not unify anything: it deepens the
personal-seal model. Fold its diff view into (e) above. *Do nothing and just explain the two* — the
approver being reverted on his own Approved page is not explainable, it is wrong.
**Confidence** medium-high that this is the right first step (it removes the observed contradictions
with one rule the engine already has — the privileged set — and adds no new concept); medium on the
mechanics: the section pass and the workflow probe run in one trigger with their own baselines
(`triggers.js:316-498`), and the reconciliation rule ("never launder a tamper into
approvedVersion") must hold for section restores too — the walk showed it currently does advance
the baseline after a section revert (6→8), which is the exact laundering the comment forbids.
**Blast radius** `triggers.js` (privileged set for the section pass, restamp), `section-seals/actions.js`
(status: `ownedByWorkflow`), `editreq/actions.js` (frozen requests on enforced pages),
`workflow/logic.js` (transition hooks), `doc-ribbon` approval dialog + `WorkflowDetails`,
`section-setup` badge, `page-details` rows, `row-state.js`, `notice-blueprints.js`, docs/product
definition BC-2/BC-4.

**Status (2026-09-20):** done in the SEC-2 commit (dev 8.18.0; 8.19.0 shortens the ribbon sentence and adds the badge suffix), evidence `scenarios/sentinel-vault/sec2-workflow-owns-seals.spec.ts` (server: approving the page puts `workflowHeld{remainingMs…}` on Gabriela's section seal and pauses its expiry; her release / extend / grant and Mihai's request are refused with "Locked by the approval of this page — changes go through the workflow"; Mihai — approver, not the owner — edits inside the section over REST and is KEPT: the snapshot re-baselines, no restore write (v2 → v3), the page stays Approved with the baseline at v3; moving to Draft hands the seal back with the time it had left and the owner can release again; browser: the ribbon's Locked pill says "locked by the approval of this page" with no Request edit, the modal row's primary is the held state with only Copy link / Force release under ⋯, light + dark). Shipped: (a) custody + one privileged set, (b) approver edits re-baseline, (c) hand-back with remaining time, (d) the approval dialog lists what it will freeze, plus "Locked by the approval of this page" on the rows, the ribbon, the macro badge and My work. NOT done: (e) "Propose a change" as the sealed row's primary on an Approved page (the row offers nothing personal and says why; the workflow's own Move to… is the path), (f) skipping the section pass in revert mode (it already stays off while the page revert runs — `ctx.enforcedRevert`; in demote mode the page is no longer enforced after the demote and the section pass runs on the handed-back seal, so "Restored" + "Moved back" can still both show on that one save).

### SEC-3 One status language for the section badge, the ribbon, the byline chip, the rows and My work
**Who** everyone.
**Observed** The same page in one session said: badge "Sealed by Mihai Perdum" (cyan pill on the
macro); panel row "Risks · until Sep 22, 2026, 10:57 PM · Release"; details row "Sealed by you ·
until Tue 10:57 PM"; ribbon "Locked · Decisions is sealed by Gabriela Perdum until Tue 23:13" (24-h
clock, the others 12-h); ribbon "Restored / 2 Restored"; workflow chip "Awaiting your approval 0 of
1" then "Approved" AND "Approved v6 · review due Feb 16" side by side; byline chip "Unclassified"
with the seals only in a tooltip; My work "Sealed / Overdue / In the trash" pills for files, no
section rows at all; verbs: seal, release, unseal (resolver), unlock (My work copy), force release,
locked, sealed; the config dialog's "You can edit this section" vs the row's "Edit now until"; the
declined state has no visible word at all (disabled button + tooltip). `untilLabel`
(`ribbon-rules.js`), `when()` (`seal-row.js`), `renderLapseDate` (panel) and `fmtUntil`
(section-setup) are four date formatters.
**Why it fails the user** A reader cannot tell "locked for me" from "locked by me" from "approved"
from "reverted" without learning four dialects; the Comala byline shows one status word; AppFox
shows one lozenge.
**Proposal** One vocabulary, one formatter, one place (`src/ui/kit/status-language.js`, pure,
unit-tested, imported by all five surfaces): states **Sealed by you · until {when}** / **Locked by
{name} · until {when}** / **Waiting for {name}** (your request) / **Waiting for you (N)** / **Edit
now · until {when}** / **Declined · ask again {when}** / **Expired** / **Approved v{n} · with the
page** (after SEC-2) / **Undone** (the alert — the word "Restored" is the app's point of view, not
the editor's); one `when()` (weekday + 24-h inside 7 days, "22 Sep 22:57" beyond) used by the
badge, rows, ribbon, My work; one verb pair **Seal / Release** everywhere (kill "unlock" in My
work, "unseal" in user-facing refusals); the workflow chip is ONE chip ("Approved v6 · review
due 16 Feb ▾" — drop the duplicate state chip when the details chip is present); the byline chip
title carries the status, not only the tooltip: "Sealed (2) · Approved" — the byline is the one
surface every Confluence page shows without the app's ribbon (Comala's model). The macro badge
uses the same state words as the rows ("Locked by Gabriela Perdum · until Tue 23:13 ·
Request edit") so a collaborator can act from the section itself.
**Confidence** high — string and formatter consolidation; the only risk is the ribbon's "one pill"
rule (mockup decision 3), which stays: the pill just takes its words from the shared file.
**Blast radius** `kit/` (new module), `section-setup/index.jsx`, `SealRowParts.jsx`, `seal-row.js`,
`page-details/index.jsx`, `my-work/index.jsx`, `doc-ribbon/index.jsx`, `byline.js`, `row-state.js`
labels, `test/ribbon-rules.test.mjs`.

### SEC-4 Where sealing a section starts — today only inside a second macro
**Who** editor / page owner.
**Observed** `list-page-headings` and `seal-section` are invoked from exactly one place,
`inline-panel/index.jsx:1012,1028` (grep). To seal a section a user must (1) know the "Sentinel
Vault" panel macro exists, (2) edit the page and insert it (`/sentinel`), (3) publish, (4) find the
"SEALED SECTIONS" group at the bottom of the panel, (5) "Seal a section", (6) pick a heading — six
steps, two of which change the page. The alternatives a naive editor tries all dead-end: the
heading's toolbar (`04`), the "Sealed Section" slash macro (`05` → `06`, "open the Sentinel Vault
panel"), the byline chip → details modal (`08`, no control), the ⋯ page menu (no content action for
sections; the existing `sentinel-vault-seal-action` opens the modal in "Seal attachments" mode
only). The panel group's own note defines the feature by what it is not ("no files involved").
**Why it fails the user** Comala: byline status + a page-level popup; AppFox: a macro that *is* the
control (insert it around content, done); Guard: a lozenge on the page. Ours: a macro that says
"go to the other macro".
**Proposal** Make the section macro the control and the details modal the second door; retire the
panel picker as the only path. (a) The "Sealed Section" config dialog (`section-setup` config
mode) becomes the seal step: on insert with a body → "Seal this section now · holds for [3 days ▾]
· note (optional)" → `seal-section` with the macro's own range (the macro IS the range, so SEC-1
cannot happen here), Insert = sealed; on insert without a body → a heading picker (the same
`list-page-headings` rows) so "insert macro" wraps a heading instead of creating an empty box.
(b) Details modal Overview: "SEALS ON THIS PAGE · 0 — Nothing on this page is sealed. [Seal a
section ▾] [Seal attachments]" with the same heading picker; My work's "Open page" links land
here. (c) A second content action "Seal a section…" next to the existing "Seal attachments" in
the ⋯ page menu (manifest `confluence:contentAction`), opening the modal on the picker. (d) Keep
the panel group but as a mirror. Copy for the group note: "Freeze a heading and everything under
it; only you and people you approve can change it."
**Confidence** high for (b) and (c) (they reuse the modal and resolvers that exist); medium for (a) —
Forge bodied-macro config can read `ext.macro.body` but the seal must run server-side against the
saved page, so "Insert = sealed" needs a post-publish step (the page-content trigger already sees
the new wrapper; it can adopt an un-sealed wrapper that carries a `sealOnPublish` param). That
timing is the risk.
**Blast radius** `section-setup/index.jsx` (config mode), `manifest.yml` (content action, config
`viewportSize`), `page-details/index.jsx` (Overview seal controls), `section-seals/actions.js`
(adopt-on-publish), `triggers.js`, docs/features/content-sealing.md.

### SEC-5 The editor never warns the collaborator; the warning lives in a dialog nobody opens
**Who** collaborator (the person about to lose their text).
**Observed** In the editor a sealed section is a plain box titled "Sentinel Vault Sealed Section"
with an editable body (`16-editor-placeholder.png`, `17-editor-macro-selected.png`); the lock line
"Locked by {name} until {date} — edits you publish here are reverted automatically. Ask to edit
from the Sentinel Vault panel." is rendered only in config mode (`section-setup/index.jsx:236-246`,
comment: "the app iframe is never mounted there (platform fact)"). A collaborator finds out after
publishing, from the amber notice and a page comment ("Your change was undone").
**Why it fails the user** The whole feature is "you cannot change this"; the one surface where the
change is made says nothing. Community threads ask precisely for "lock a section" so people are
*stopped*, not corrected afterwards.
**Proposal** Since the macro iframe cannot mount in the editor, put the warning where Forge can:
(a) macro title/parameters: the bodied extension's visible title is the manifest `title`; make the
server rewrite the wrapper's `attrs.parameters.macroParams.title` (or `layout` title) on seal to
"🔒 Sealed by Gabriela Perdum · until 22 Sep — edits here are undone" so the editor's grey caption
(`16`) carries the state; (b) on publish, the page-content trigger already detects the drift within
seconds and the view-time guard within the same load — keep that, but make the editor-revert
comment and the amber notice the same words (they are today: good), and add "Ask Gabriela for
access" as a one-click action that sends the request from the notice (today it says "use Request
edit in the Sentinel Vault panel"); (c) name the honest limit in docs: the editor cannot block
typing. Also: the config dialog's green "You can edit this section" for the owner is fine, but for
a non-owner the dialog's Done button still says "Done" — make it "Close" and drop "Place the
content you want to protect…" when the node is already sealed.
**Confidence** medium — (a) depends on the editor honouring a rewritten title on an existing bodied
extension (it renders `extensionTitle`/`parameters.title` for Connect macros; for Forge the caption
is the manifest title; needs a spike); (b) is high.
**Blast radius** `doc-surgery.js buildSealedSectionNode`, `section-seals/actions.js`,
`section-setup/index.jsx`, `triggers.js` notice, docs.

### SEC-6 The violation alert never lets go: "Restored" masks every later state
**Who** collaborator, approver, reader.
**Observed** After one revert, the ribbon showed "Restored" for the rest of the session — through the
request (should be "Waiting for Gabriela"), the grant ("Edit now"), In Review, Approved, and then
"2 Restored" after the approver's own revert (`20`, `35`, `40`, `42`, `43`). `pickUrgent` puts
alerts first; alerts are dispatch records with no auto-expiry in the ribbon; the "Locked" state's
"Request edit" button is not offered while an alert is showing (`canRequest = urgent.kind ===
"locked"`). Dismiss (×) hides the whole ribbon until the state key changes.
**Why it fails the user** The alert is history; the lock, the wait and the grant are the present.
**Proposal** Alerts become a secondary line, not the pill: the pill always shows the present state
(Locked / Waiting / Edit now / nothing), and a one-line "Undone: your edit to Decisions (v5) —
See my version · ×" sits under it, auto-cleared once the viewer has seen it (acknowledge on render
after 10 s, like the macro's `UNDONE_NOTICE_WINDOW_MS`), never counted ("2 Restored" means nothing
to a reader). Keep "Request edit" available whenever `lockedFor` exists.
**Confidence** high.
**Blast radius** `ribbon-rules.js pickUrgent` (+ tests), `doc-ribbon/index.jsx`, dispatch
acknowledge resolver (`acknowledgeDispatch` exists in the hook list).

### SEC-7 Seal-time defaults are silent and un-extendable; the refusal names a button that does not exist
**Who** owner, then the requester.
**Observed** Picking a heading seals it immediately for the space default (3 days here — "until Sep
22, 2026, 10:57 PM", `13`) with no duration, no note, no confirmation; attachments get a "Seal holds
for" picker + note (`page-details` seal mode). A section cannot be extended (`menuActionsFor`:
extend is attachments-only; there is no `extend-section` resolver), yet `approveSectionEdit` and
`grantDirect` refuse a lapsed seal with "This section's seal has lapsed — **extend it first**, then
grant edit access". An expired section shows "Expired" and can be released by anyone who can edit
the page (F6) — so the owner's only way to keep protecting it is release + re-seal, which issues a
new sectionId and drops the grants/requests (sweep).
**Why it fails the user** The owner never chose 3 days; three days later the protection silently
stops (the trigger ignores expired seals) and the copy points at a control that is not there.
**Proposal** (a) The picker row becomes a two-step: pick heading → inline "Holds for [3 days ▾] ·
note (optional) · [Seal]" (same `DurationPicker` as attachments; default from
`resolveSealHoldPeriod`); (b) add `extend-section` (mirror `extend-seal`, carry grants forward)
and put "Extend the seal" in the section ⋯; (c) reword the refusal to the action offered; (d) show
"expires in 2 days" on the owner's row as amber before it lapses, and post the halfway/lapse
notices sections lack today (they exist for files).
**Confidence** high for (a)(c), medium for (b) (the extension must carry grants' TTL forward —
`setUntil` per grant — and must not re-baseline).
**Blast radius** `section-seals/actions.js`, `editreq/actions.js` (refusal copy), `row-state.js`,
`inline-panel` picker, `page-details` rows, lapse policy in `shared/lapse-policy.js`.

**Status (2026-09-20):** done in the SEC-7 commit (dev 8.17.0), evidence `scenarios/sentinel-vault/sec7-section-extend.spec.ts` (server: seal-section takes `lockDuration` + `note` and the rows show them; `extend-section` exists — anchored on the live expiry, from now when lapsed, the grant carried forward, the space index row and the trail updated, no re-baseline; the lapsed refusal now names `⋯ → Extend the seal` and Extend re-arms the grant; browser: the owner's modal row says "expires tomorrow" in amber (rgb 180,83,9) with Extend under ⋯ and the warning clears after the extension; the panel's picker opens a "Holds for" step with the space default preselected, a note, and seals for the chosen day). (a)(b)(c) and the amber half of (d) shipped; REST ops `extend-section` / `extend-attachment`. NOT done: the halfway/lapse notices for sections ((d) second half) — the expiry sweep has never handled section seals; it is a notice-blueprint job of its own.

### SEC-8 The declined state is invisible, and the cooldown is an ISO-UTC timestamp
**Who** requester.
**Observed** After Gabriela declined, the ribbon still says "Locked … Request edit"; pressing it
answers "A previous request was declined; you can ask again after 2026-09-19 20:19 UTC, or ask the
owner to give you access directly" (`31-ribbon-declined-error.png`); the panel/detail row shows a
disabled "Request edit" whose explanation is a `title` tooltip (`row-state.js:44`); nothing in
My work; the decline comment says "was declined by the seal owner" with no reason (the owner is
never asked for one).
**Proposal** State word "Declined · ask again Sat 22:19" as the row's primary (the status-span
style used for "Waiting for …"), a visible "Ask Gabriela on the page" (opens a comment @mention)
and "Try again in 1 h" when the cooldown is short; the owner's Decline gets an optional reason
that reaches the requester; `declinedReason` on the server formats with `untilLabel`, not
`toISOString`. My work gains "Your requests" (pending / declined / granted) — the requester is the
one person with nowhere to look today.
**Confidence** high.
**Blast radius** `editreq/actions.js declinedReason`, `row-state.js`, `SealRowParts.jsx`,
`page-details`, `doc-ribbon`, `my-work` (+ a `list-my-requests` lister — the requester's own
prefix `section-edit-request-*-{me}` is not indexed by requester today).

### SEC-9 Notices call a section a file
**Who** section owner, requester (they read the page comment before any UI).
**Observed** `requestSectionEdit`/`approveSectionEdit`/`denySectionEdit` call `mailEditRequest` /
`mailEditApproved` / `mailEditDenied`, whose layouts are attachment-only: "… is requesting
permission to edit your sealed **file** "Decisions"", "Approve or deny from the Sentinel Vault panel
on the page, or the space console (Edit Requests)" (the console has no section requests), "You
can edit this **file** until the seal expires; other users remain blocked." The revert notice
(`composeEditorRevertLayout`) does take `targetKind` — the request family was never given one.
**Proposal** Add `targetKind` to the three layouts ("your sealed section "Decisions"", "Approve or
decline from the Sentinel Vault panel on the page or from My work"), and route the "Open the page"
CTA to the page-details modal.
**Confidence** high.
**Blast radius** `notice-blueprints.js`, `notice-composer.js` signatures, `editreq/actions.js`
callers, unit tests.

### SEC-10 "Release" is a red danger button on your own seal
**Who** owner.
**Observed** `13-panel-sealed-row-mine.png`: the only primary on "Risks" is **Release** in the red
`unlock` style; in the details modal it is a quiet grey button; `MENU_LABEL`/`DANGER` marks
`release` as danger. Releasing your own 3-day seal is routine, not destructive; "Force release…"
(someone else's) is the dangerous one and correctly sits behind a typed reason.
**Proposal** Owner's Release = the quiet/secondary style everywhere (the details modal already has
it right); keep red for Force release only. With SEC-2, a section under an Approved page shows no
Release at all ("with the page").
**Confidence** high.
**Blast radius** `SealRowParts.jsx PrimarySlot`, `seal-row.js DANGER`, panel CSS.

### SEC-11 Sections are absent from every list that is not the page
**Who** owner, space admin, compliance officer.
**Observed** My work "Files you hold sealed 4" lists files only (`enumerate-operator-seals` is
attachment-scoped, `39-my-work-approver.png`); the space console has no section rows
(UX-REVIEW §2.1 finding, still true); the details modal footer promises "Extend, Watch" that
sections do not have; the byline tooltip counts sections ("1 seal on this page") but nothing links
to them.
**Proposal** "Content you hold sealed" card on My work = files + sections (one list, `kind` icon,
same status words as SEC-3), each row deep-linking to the page-details modal scrolled to the row;
space console "Sealed content" tab lists sections next to files with Force release; footer copy
per kind.
**Confidence** high (listers exist per page; a per-owner index for sections mirrors the
`space-section-protection-*` leg already written on seal).
**Blast radius** `my-work/index.jsx`, `section-seals/actions.js` (owner lister), `realm-console`,
`page-details` footer.

### SEC-12 The app's own page writes surface as Confluence noise
**Who** owner, reader.
**Observed** Every seal/unseal is a page version by the app ("(Sentinel Vault sealed a section)"),
so Confluence toasts "New version published — Sentinel Vault published a new version of this page ·
Reload" (`13`); every revert posts a comment, so "Sentinel Vault commented just now · View their
comment" (`40`, `41`); the page history fills with app versions between human ones.
**Proposal** Nothing to hide here — the versions are the audit trail — but the app should say it
first: the panel/row flashes "Sealed. Sentinel Vault saved a new page version (v3)." before
Confluence's toast does; the revert comment is already opt-in (`enable*` flags); default the
editor's own notice to the ribbon + macro (present) and the comment to off, per UX-REVIEW P1-4.
**Confidence** medium (owner's notification policy call).
**Blast radius** panel/modal flash copy, `bulletin-flags.js` defaults.

### SEC-13 Small copy fixes
- Fresh page byline chip renders "Sentinel Vault (Development) (Development)" (run A log) — the
  manifest title already carries the env suffix; `byline.js` adds it again for pages without a
  property. Production would show a bare "Sentinel Vault", so this is dev-only, but the fallback
  title should be the same words as the computed one ("Unclassified").
- Macro badge before the status fetch answers reads just "Sentinel Vault"; use "Checking…" or
  keep the last known state.
- "Not sealed yet — seal it from the Sentinel Vault panel" on a wrapper that is on the page but
  unsealed (orphan after release): offer "Remove wrapper" — a released section keeps no wrapper
  (unseal splices it out), so this state only arises from the slash-inserted empty box; say so.
- Group note "Locks a heading's content on the page — no files involved" → see SEC-4 copy.
- `page-details` footer: list only actions that exist for the row kinds present.

---

## 2. Questions only the owner can answer
1. SEC-2 direction: is the workflow the senior lock (Approved re-parents every seal to the approver
   set, personal seals resume when the page leaves Approved), or should a personal seal survive
   approval untouched and the approver simply be added to its grantees? The critique recommends
   the former; it changes what "Approved" means for a section owner.
2. Should "Request approval for this section" (AppFox Section Approval parity) be built at all, or
   is per-page approval + section seals under it (SEC-2) the whole story for this release?
3. Is a section seal a *personal* lock (today: 3-day default, one owner, expires) or a *content*
   lock (no expiry by default, owner = the page's approvers/space admins)? The 3-day default was
   never chosen by anyone in the walk; for a "Decisions" section on a policy page it is the wrong
   default.
4. Editor warning (SEC-5): is rewriting the macro caption to carry the lock state acceptable, given
   the caption is visible to everyone in the editor, or must the editor stay silent and the
   after-publish undo remain the only guard?
5. Entry point (SEC-4): may the section macro seal on insert (the macro is the control), or must
   sealing remain a server action from a panel/modal so that every seal has a reason and duration
   chosen in one place?
6. Notification policy (SEC-12): comment on every revert (today) vs ribbon + macro notice only.
7. Should the "Restored" alert ever appear to the *owner* as a pill (it is good news for them), or
   only to the person whose text was undone?
