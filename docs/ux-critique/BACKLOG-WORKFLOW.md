# Backlog — Document workflow ("the Comala feature") UI/UX critique (2026-09-19)

Method: read `src/server/capsules/workflow/*`, `triggers.js` (enforcement + sweep), `infra/approval-blueprints.js`,
`shared/notice-policy.js`, the doc-ribbon / page-details / my-work / realm-console surfaces and the four
`kit/Workflow*.jsx` files; then walked the live dev app on wolfaenpak as a naive user with
`~/Projects/forge-live-harness/scenarios/sentinel-vault/critique-workflow.spec.ts` (throwaway). Evidence:
`~/Projects/forge-live-harness/evidence/sv-critique-wf/*.png` + `steps.json` (every copy string quoted below is
from that dump). The walk covered space admin → author → approver (incl. an edit after the request) → reader
(read confirmation) → demoted editor → rejection. The browser profile was reclaimed by another run after the
rejection step, so the signature (G) and reporting (H) screenshots are missing; those items cite code and the
A1 capture of the dashboard. Space WFH was left as found (workflow enabled, no approvers, as the sections agent
had set it); the throwaway page and all its workflow keys were deleted.

Personas: Mihai (space admin + approver, the browser session), Gabriela (author/requester, real account driven
through the test hook), `sv-critique-editor` (synthetic non-approver for the demote path).

---

## Answers to the briefing questions (evidence first, verdict second)

**1. Space admin, day one.** The Workflow tab (`A1-workflow-tab-off.png`, `A2-workflow-on-full.png`) opens on a
toggle whose description reads *"Track a review/approval state on pages in this space. When on, pages carry a
workflow state shown on the Sentinel Vault ribbon, and rights-holders move it along the workflow."* Nobody
outside this repo knows what a "rights-holder" is. Turning it on reveals four sections and 20 controls at once
(Workflow / Readers / Approval / Protecting Approved pages) plus a second, separately-saved "Workflow
definitions" editor whose own copy admits the trap: *"Each workflow saves with its own button; the bar at the
bottom saves the settings above, not the workflows."* (`A3-definitions-open.png`). The four states are shown as
chips `Draft → In Review → Approved → Expired` with no sentence saying what each means or who may move a page;
"Expired" is never explained (it is "the review date passed", not "the page is old"). What "enforced" means is
only discoverable in the fourth section: *"Approved pages are protected: an edit by someone who is not an
approver or a space admin is undone or sends the page back"* — accurate, but the word "enforced" never appears
in the UI while it is the product's headline. The definition editor shows raw ids (`in_review`) in a `<code>`
next to names, a column literally headed "First" and one headed "Protected" (tooltip only). Nothing tells the
admin that saving with "Require approval" ON and no approvers means only space admins can approve, or that the
default re-review clock is 150 days. Comala's model is "apply a workflow to this space / this page" with a
visible list of workflows and a builder; AppFox's is "drop an Approval macro on the page". Ours is a settings
form — workable, but it needs a first-run card (item WF-12) and the vocabulary fixed (WF-10).

**2. Page author.** Submitting is discoverable: the state chip on the ribbon opens *"MOVE TO… › In Review"*
(`B2-author-menu.png`) and then *"Request approval → Approved"* (`B4-author-menu-inreview.png`) — good. The state
IS visible at all times as long as the ribbon is visible: `decideRibbon` opens the row whenever a workflow is
assigned, even in "exceptions" mode (`kit/ribbon-rules.js:94`). But the viewer can dismiss the row (×) and then
there is NO workflow status anywhere on the page: the byline chip says only the classification
(`page-details/byline.js:66-84`) and the page-details modal has no workflow section at all
(`B8-page-details.png`: Overview = Classification, Seals, Recent activity). After requesting, the author sees
*"Awaiting approval 0 of 1"* and, in the popover, the approver names — no avatars, no "they were told by a page
comment". After a rejection the author sees `In Review ▾` and nothing else (`F1-after-deny.png`); the denial
reason the approver typed ("Needs a summary section at the top") is shown NOWHERE: the comment says only *"your
request to move this page to Approved was declined by Mihai Perdum. The page stays in its current state."*
(`notifyApprovalResolved` has no reason parameter) and the details popover renders `approvalRecord` only when
the page is enforced (`doc-ribbon/index.jsx:214`). Item WF-3.

**3. Approver.** Three doors: ribbon popover (`C3-approver-panel.png`), My work (`C1-mywork-pending.png`), the
space console inbox (`A0-console-landing.png`), and the @mention comment. The version pinned at request time is
what gets enforced — correct — but the UI does NOT tell the approver the page changed since: I edited the page
after Gabriela's request (v1 → v2), reopened the popover, and it still read *"View the version you are approving
(v1)"* with no warning (`C4-approver-panel-after-edit.png`; `steps.json` C4: `versionBefore:1, pinned:1`,
`getPageApprovalStatus` computes `stale` but the popover never renders it). Clicking Approve then produced the
worst outcome of the walk: the server returned `outcome:"stale"` with `success:true`, the popover closed
silently, the ribbon reverted to *"In Review"* (`C5-after-approve-click.png`), the request was cleared, and the
requester got a comment saying *"Approval declined … by Mihai Perdum"* — he approved. Item WF-1. My work and
the console inbox decide with two buttons and no reason field, no version link, no page preview
(`WorkflowInbox.jsx:73-76`): a blind Approve. The e-signature prompt copy is clear (*"Sign with your
authenticator code"*, *"Set up your signature on My work first"*) but the walk did not reach it live. Comala's
"no avatars" complaint applies to us too: names only, everywhere.

**4. Reader.** On an Approved page a reader sees `Approved ▾` and `Approved v2 · review due Feb 16 ▾`
(`C6-approved-ribbon.png`) and can open the record (*"Approved for version 2 on Sep 19, 2026 · any approver /
Requested by Gabriela Perdum / Mihai Perdum Approved … "Looks good to me" / View approved version (v2)"*,
`C7-approved-details.png`) — this is genuinely better than Comala's byline. On a page In Review the reader sees
`In Review ▾` only; nothing says "you are reading unapproved content" and the ribbon can be dismissed. There is
no "hide/flag unapproved work" option (community need). Item WF-6.

**5. Demoted / reverted editor.** For a demote the editor gets a page comment: *"Moved back to Draft — this page
was edited after it was Approved, so Sentinel Vault moved it back to Draft. Re-submit it for approval when the
changes are ready."* (`E1-comments`, `approval-blueprints.js:59-62`) and NOTHING on the ribbon: `recent-dispatches`
for the editor returned `[]` (`E1-dispatches-for-editor`) because `collectWorkflowEnforcementForPage` records
an activity row but no dispatch, so the "Restored" pill never fires for workflow enforcement. The
`editor_revert` carve-out (`notice-policy.js:22-27`, `notifyEditorOnRevert`) covers SEAL reverts; the workflow
revert comment (`postEnforceComment(…,"revert")`) goes through the ordinary master gate, so on a site that never
opted into comments (`ENABLE_NATIVE_NOTIFICATIONS` is opt-in since 4.7) a person whose Approved-page edit was
byte-reverted is told nothing at all. Their edit is only in page history. The revert comment also says *"verified
by structural compare"* and *"first request a transition out of Approved"* — engineering, not user language.
Item WF-2.

**6. Reporting.** Ours (`A1-workflow-tab-off.png`): four count tiles, "Review overdue" tile, a table Page / State
/ Entered / Review due (100 rows), CSV with six columns (`WorkflowDashboard.jsx:10`), plus the space Activity
tab (category chips, time range, "page title contains", CSV) and a per-page Activity tab in the modal. Comala's
Space Document Report filters by assigned/pending reviewer, creator, owner, with chosen columns; its Document
Activity Report lists every approval with who/when/version. A compliance officer still lacks: who approved each
Approved page (and on which version) as a column; pages waiting on WHOM; read-confirmation coverage per page;
signed-vs-unsigned; expired pages; filter by approver/requester; a per-page "document report" export (the
`workflow-log-*` + `approvalRecord` exist, nothing renders them as a report). Item WF-8.

**7. Read confirmation** is exposed and works: `Confirm I've read v2` on the ribbon (`D1-reader-confirm.png`),
`Read v2 ✓` after (`D2`), and for a space admin a Readers list (`D3-readers-report.png`: *"1 of 2 people asked to
read this page have confirmed version 2 … Gabriela Perdum Not yet / Mihai Perdum Read v2"*). Gaps: readers are
never told they are expected to read (no comment, no My work row — `UX-REVIEW §5` gap 3 still open); the
audience is per SPACE, not per page (HR policy A and lunch menu B get the same audience); no nudge/expiry; no
report across pages. Item WF-7.

**8. Terminology that survived.** UI: *"rights-holders"* (settings toggle), *"First"* / *"Protected"* column
heads, raw state ids `in_review`, *"Expired"* as a state name, *"Set review date"* chip on every Draft page,
*"Sanctioned baseline is now v3"* (ribbon details, `doc-ribbon/index.jsx:254`), *"Unsanctioned edits are reverted
automatically"*. Server strings reaching users: *"Leaving "Approved" requires space admin approval"* and
*"Entering "Approved" requires space admin approval"* (`workflow/actions.js:208,233,284` — "approval" here means
permission, and it collides with the approval feature), *"verified by structural compare"*, *"Enforcement
pending"* (revert-failed comment), *"page changed since review (reviewed v1, now v2)"* (log only). "Steward",
"realm", "robot approver", "demote", "revert" do NOT reach the user any more (verified by the §1.5 grep and the
walk). Item WF-10.

---

## Items (ordered by how badly the user is misled or blocked)

### WF-1 A stale approval is silently thrown away and reported as "declined by <the approver>"
**Who** approver, page author.
**Observed** `C4-approver-panel-after-edit.png` → `C5-after-approve-click.png`. Page edited after the request
(v1→v2). Popover still says *"View the version you are approving (v1)"*, `Pending Mihai Perdum (you)`, *"You're
the deciding approval — approving moves this page to Approved."* Click Approve: popover closes, no message,
ribbon shows `1 Waiting for you · 1 approval waiting for your decision · In Review ▾` (the count is stale too, see
WF-4). Comment posted to the requester: *"Approval declined — your request to move this page to Approved was
declined by Mihai Perdum. The page stays in its current state."* Code: `approvals.js:285-303` returns
`{ success:true, outcome:"stale", transitioned:false, reason:"Page changed since review — re-approval required." }`
and calls `notifyApprovalResolved({ outcome:"denied", deciderName })`; `doc-ribbon/index.jsx:382-385` treats any
`r.success` as done and never reads `outcome`/`reason`; `getPageApprovalStatus` computes `stale` (`:479`) but the
popover never renders it.
**Why it fails the user** The approver did the right thing and was made to look like he rejected it; the author
re-submits without knowing why; the reason field the approver typed is lost. Comala's popup shows the page
version at decision and refuses with a reason; AppFox "Expire on edit" invalidates the approval VISIBLY.
**Proposal** (a) In the popover, when `approvals.stale` is true: a solid amber block *"This page changed after the
request (reviewed v1, now v2). Approving will not move it — ask <requester> to re-request, or re-request it
yourself."*, Approve disabled, a *"Re-request for v2"* button for stewards/requester. (b) `doDecide` branches on
`r.outcome`: `stale` → keep the popover open with the reason; `pending-ai` / `ai-blocked` → show
`r.reason`. (c) `finalizeApprovedTransition` stale path notifies with a new outcome `"stale"` whose comment says
*"The page changed after Gabriela asked for approval (v1 → v2), so the request was closed. Re-request when
ready."* — never "declined by X". (d) Same in `WorkflowInbox.jsx:37`.
**Confidence** high — the server already has every fact; this is wiring and copy.
**Blast radius** `approvals.js` (stale branch + `notifyApprovalResolved` outcome), `approval-blueprints.js`,
`doc-ribbon/index.jsx` (`doDecide`, approval popover), `WorkflowInbox.jsx`, `my-work`.
**Status (2026-09-20):** fixed in the WF-1 commit (dev 8.7.0), evidence
`~/Projects/forge-live-harness/scenarios/sentinel-vault/wf1-stale-approval.spec.ts` (server + browser tests,
`evidence/wf1-stale-approval/*.png`). Shipped: `decideApproval` REFUSES a stale approve up front (`success:false,
stale:true`, nothing recorded, request kept, no comment); the finalizer's race branch posts outcome `stale`
("Approval request closed … Nobody declined it") never "declined by"; `get-page-approvals` carries `liveVersion`;
the popover shows a solid amber stale block with **Re-request for vN** (`rerequest-approval` re-pins the OPEN
request, original requester kept — re-requesting under the approver's name would trip segregation of duties) and
disables Approve; `doDecide` branches on `outcome` and says the result next to the chip (`wf-notice`); the
inbox (My work + console) marks stale rows and disables Approve there. Unit: `test/approval-notice.test.mjs`.
Pre-fix run: `{"success":true,"outcome":"stale"}` + comment "Approval declined … by <approver>".

### WF-2 The person whose edit was undone by workflow enforcement is not told on the page, and may not be told at all
**Who** editor (non-approver) of an Approved page.
**Observed** `E1-after-demote.png`: after the demote the ribbon shows `Draft ▾ · Set review date ▾` — identical to
a page nobody touched. `E1-dispatches-for-editor` → `notifications: []`. The only signal is a page comment
(`E1-comments` #6, quoted in Q5) — and that channel is opt-in: `shouldPostComment` (`notice-policy.js:63`) blocks
every workflow comment unless `ENABLE_NATIVE_NOTIFICATIONS` is true; the `editor_revert` carve-out is only used
by the SEAL revert path (`grep NOTICE_EDITOR_REVERT src/server` → outbound seal notices only), not by
`postEnforceComment`. In revert mode the comment reads *"…your change was reverted to the approved version (v2),
verified by structural compare. … To edit an approved page, first request a transition out of Approved."*
**Why it fails the user** "You save, 20 minutes later Sentinel deletes it and you never knew it would" — the
tester's own report (2026-09-17) that produced the seal carve-out; the workflow revert is the same experience
and was left out. Comala never destroys an edit, so it needs no such notice; we do, so we must.
**Proposal** (a) `collectWorkflowEnforcementForPage` and `enforceApprovedStatePass` record a dispatch of type
`workflow-demoted` / `workflow-reverted` (editor + approvedBy as parties) so the ribbon's "Restored" pill fires
for the editor with *"Your edit to this Approved page was moved back to Draft for a new review"* / *"…was
reverted to the approved version (v2). See my version (v3)"* — the `ribbon-my-version` link already exists for
seals. (b) Route both enforce comments through `NOTICE_EDITOR_REVERT` so `notifyEditorOnRevert` governs them.
(c) Copy: drop "structural compare", "transition"; say *"Ask an approver or space admin to move the page out of
Approved before editing, or request approval for your version."*
**Confidence** high on (a)/(b) (mirrors the shipped seal path); medium on the exact pill copy.
**Blast radius** `triggers.js` (two enforcement sites + sweep), `approval-blueprints.js`, `notice-policy.js`,
`doc-ribbon/index.jsx` `alertSentence`, `ribbon-rules` (dispatch types).
**Status (2026-09-20):** fixed in the WF-2 commits (dev 8.13.0), evidence
`~/Projects/forge-live-harness/scenarios/sentinel-vault/wf2-enforcement-notice.spec.ts` (server + browser,
`evidence/wf2-enforcement-notice/*.png`). **Verified live with a REAL non-privileged editor (2026-09-20, plain-editor bed):** `scenarios/sentinel-vault/plain-editor-refusals.spec.ts` ("WF-2 REVERT") — space SVPLAIN, editor PLAIN (`712020:6c8dccca-…`, the one real account with no admin operation), `enforceMode: revert`: the decision for PLAIN is `revert`, the pipeline (hook `pageEvent` as PLAIN — the page version itself is authored by the harness token, the stated limit) writes the restore (v3), the baseline follows, PLAIN reads his own `workflow-reverted` dispatch with `revertedVersion: 2` through the gated `recent-dispatches`, and the comment is on the page. Shipped: ONE announcer in `triggers.js` (`announceWorkflowEnforcement`)
behind all four sites (event demote, event revert, sweep demote, sweep revert): a dispatch `workflow-demoted` /
`workflow-reverted` (editor + approver as parties, `approvedVersion`, `revertedVersion` = the version holding the
editor's text) and the editor's comment routed through the `editor_revert` carve-out (posted with the master OFF —
proven live); copy rewritten in the editor's words (`enforceCommentBody`, pure: "Reverted to the approved version …
open your version (v2) … ask an approver or space admin …" / "Moved back to Draft … Nothing was lost"); ribbon pill
"Restored" / "Moved back" with editor and approver sentences and "See my version (vN)". Unit:
`test/approval-notice.test.mjs` (WF-2 block). HONEST LIMIT: the live server test exercises the EVENT DEMOTE path
end to end (synthetic editor — every real wolfaenpak account is a steward, hence privileged); the revert dispatch
sites (event + sweep) are exercised only by the unit tests and the browser render from a seeded dispatch.

### WF-3 A rejected author never sees the rejection reason
**Who** page author / requester.
**Observed** Approver typed *"Needs a summary section at the top"* and clicked Deny. Author's page:
`F1-after-deny.png` → `In Review ▾ · Set review date ▾`. Comment: *"Approval declined — your request … was declined
by Mihai Perdum. The page stays in its current state."* No reason. `decideApproval` → `notifyApprovalResolved({
pageId, requestedBy, outcome, targetName, deciderName })` — no `reason` (`approvals.js:465`). The denial evidence
is written to `workflow-log` (`kind:"approval-denied"`, with the reason) but `WorkflowDetails` renders an approval
record only `if (enforced)` (`doc-ribbon/index.jsx:214`), and the details chip on an In Review page is just *"Set
review date"* (`F1`).
**Why it fails the user** The whole point of Deny + reason is to tell the author what to fix. Comala's popup and
Document Activity Report show every decision with its comment.
**Proposal** (a) Carry `reason` into `notifyApprovalResolved` and print it: *"… declined by Mihai Perdum: "Needs a
summary section at the top"."* (b) The details chip on a non-enforced page shows the LAST decision:
`Declined Sep 19 ▾` → popover "Last approval: Declined by Mihai Perdum on Sep 19 · "Needs a summary…" · reviewed
v1 · Re-request approval" (read the newest `approval-denied` / `approval-stale` log entry; `get-workflow-log`
exists). (c) My work: the requester's own open requests as a card ("Approval requests you made") with status.
**Confidence** high (a), medium (b: needs a small resolver or a `lastDecision` field on `get-page-workflow`).
**Blast radius** `approvals.js`, `approval-blueprints.js`, `workflow/actions.js` `getWorkflow`, `doc-ribbon`
`WorkflowDetails`, `my-work`.
**Status (2026-09-20):** fixed in the WF-3 commit (dev 8.9.0) for (a) and (b), evidence
`~/Projects/forge-live-harness/scenarios/sentinel-vault/wf3-rejection-reason.spec.ts` (server + browser,
`evidence/wf3-rejection-reason/*.png`). Shipped: the denial comment prints the reason (`approvalResolvedBody`);
`get-page-workflow` answers `lastDecision` (pure `lastDecisionFrom(log)`: newest approval-denied / approval-stale
entry, null once anything moved the page since) only on a non-enforced page with no open request; the details chip
reads "Declined Sep 20" (critical tone) / "Request closed …" and its popover has a "Last approval decision" section
with who, when, reviewed vN and the reason in a solid block. Unit: `test/workflow-engine.test.mjs` (lastDecisionFrom).
NOT done: (c) the requester's "Approval requests you made" card on My work — a new index, left for the WF-9/My-work pass.

### WF-4 The ribbon's "Waiting for you" pill and count are stale after every decision
**Who** approver.
**Observed** `C5-after-approve-click.png`, `F1-after-deny.png`: after Approve or Deny the left half still reads
`1 Waiting for you · 1 approval waiting for your decision` while the chip says `In Review ▾`. `onTransitioned`
is `reloadWorkflow` (`doc-ribbon/index.jsx:732-747`), which refreshes workflow + approvals but not
`ribbon-summary`, whose `waitingOnMe.approvals` drives the pill (`sealing/actions.js:1474`).
**Why it fails the user** The banner contradicts itself; a naive approver clicks the pill again looking for the
work.
**Proposal** After any decision/transition call `evaluate("decided")` (full re-read) instead of `reloadWorkflow`;
show a one-line confirmation for 5 s (*"Approved — the page is now Approved"* / *"Denied — Gabriela has been
told"*).
**Confidence** high.
**Blast radius** `doc-ribbon/index.jsx` only.
**Status (2026-09-20):** fixed in the WF-4 commit (dev 8.10.0), evidence
`~/Projects/forge-live-harness/scenarios/sentinel-vault/wf4-ribbon-after-decision.spec.ts` (approve + deny beds,
`evidence/wf4-ribbon-after-decision/*.png`). Shipped: `onTransitioned` = `afterWorkflowChange` (workflow reload, then
the full `evaluate("workflow changed")` — summary, alerts, validation, the show rule); the outcome line next to the
chip (`wf-notice`, 6 s) reads "Approved — the page is now Approved." / "Denied — Gabriela Perdum has been told."
Pre-fix run: pill `1 Waiting for you` still present 20 s after Approve.

### WF-5 The requester is offered "Awaiting YOUR approval" and "You're the deciding approval" on their own request
**Who** an author who is also an approver (every small team).
**Observed** `B5-self-requested.png` → chip `Awaiting your approval 0 of 1`; `B6/B7-self-approve-refused.png` →
*"Pending Mihai Perdum (you) · You're the deciding approval — approving moves this page to Approved."* then, on
click, *"You cannot approve a transition you requested"*. Also the menu item *"Request approval → Approved"* is
offered to a sole approver with no hint that requesting will lock them out of deciding.
**Why it fails the user** The UI promises an action, the server refuses it. With one approver the page is now
stuck until a space admin intervenes (a steward may re-request over it, `actions.js:243`).
**Proposal** `getPageApprovalStatus` returns `requestedBy`; the popover computes `iCanDecide = mine && mine.status
=== "pending" && pendingApproval.requestedBy !== operatorId`, renders *"You requested this — another approver must
decide"* and, for a sole approver, offers *"Withdraw request"* (new resolver `withdraw-approval`, requester or
steward). In the menu, when the caller is the only approver: *"Request approval → Approved (someone else must
approve)"* disabled with title, or let a steward-approver move directly.
**Confidence** high on the copy/predicate; medium on withdraw (new write path, needs the SV-SEC-1 gate).
**Blast radius** `doc-ribbon/index.jsx` popover, `workflow/actions.js` (+1 resolver), `registry.js`.

### WF-6 There is no single, always-present workflow status surface (the mandated item)
**Who** everyone — reader, author, approver, admin.
**Observed** The state lives ONLY on the ribbon. The ribbon opens for a workflow page in both modes
(`ribbon-rules.js:94`) but (a) the viewer can × it — the dismissal is remembered per state for the session
(`dismissKey`) and after that the page has no status anywhere: byline chip = classification only
(`B8-page-details.png` byline row shows `Unclassified (Staging) · RESTRICTED (Development)` — competitors'
bylines, not ours), the page-details modal has no workflow block, no label unless `syncLabels` is on (default
off); (b) when the ribbon is off site-wide (`enableDocRibbons`) the workflow becomes invisible; (c) the status
chip competes with the classification block, the seal pill, "Set review date", validation chips and the AI chip in
one 44 px row.
**Why it fails the user** Comala's byline status is the thing people cite as "I always know where the page is".
A reader must be able to tell approved from unapproved content without an app banner they may have closed.
**Proposal — the definition.** *What:* one status = the state name + tone colour, plus ONE qualifier: `Approved v2`
/ `Awaiting approval 0 of 2` / `Review overdue` / `Declined Sep 19` / `Moved back to Draft`. *Where:* (1) the
byline chip (`composeByline`) becomes `<Level> · <State>` when the page has a workflow — e.g. `Internal · Approved
v2` — with the icon carrying the state colour; (2) the page-details modal gets a "Workflow" block ABOVE Seals
(state, who can move it, last decision, approval record, readers, review date, the same Move-to menu); (3) the
ribbon keeps the interactive chip. *When hidden:* never for (1) and (2); the ribbon may be dismissed except while
something is waiting on the viewer. *Rejected alternatives:* a page label (`sv-state-*`) as the primary surface —
labels are opt-in, delayed by up to an hour, and read as tags not status; the native content-status pill —
removed as a silent no-op (`logic.js:512-520`); a macro on the page (AppFox model) — requires editing every page
and our enforcement is page-level, not macro-level.
**Confidence** high on (1)/(2) design; medium on (1) implementation — the byline is a content property refreshed
lazily (`refreshByline`), so the state must be folded into `bylineStamp` and refreshed on every transition and
enforcement (five call sites).
**Blast radius** `page-details/byline.js` + its refresh callers (`workflow/logic.js` persistState,
`triggers.js`), `page-details/index.jsx` + summary resolver, `doc-ribbon`.

**Status (2026-09-20):** done in the WF-6 commit (dev 8.15.0; 8.16.0 pins the chip's date to UTC and composes the modal's sentence in the viewer's zone), evidence `scenarios/sentinel-vault/wf6-byline-state.spec.ts` (server: the `sentinel-byline` title follows Draft → In Review → `Awaiting approval 0 of 1` → `Approved v1` → `Review overdue`, and `Declined <date>`, written BY the transition / request / decision (no manual refresh); `Level · State` with classification on; page-details-summary carries the Workflow block; browser: ribbon dismissed → the chip still reads `Approved v1`, the modal's Workflow block sits above Seals with the approval sentence, the review-due chip, the decisions and Move to… → Draft, light + dark PNGs). One status rule: `workflow/status.js` (`workflowStatus`, unit-tested). NOT done: "Moved back to Draft" as a chip qualifier (the WF-2 alert covers it on the ribbon only); approve/deny and signed moves stay on the ribbon — the block says so.

### WF-7 Readers are asked to read only if they happen to open the page; the audience is per space
**Who** reader in the audience, HR/compliance owner.
**Observed** `D1-reader-confirm.png`: the ask is a ribbon button, nothing else — no comment, no My work row
(`my-work/index.jsx` has no readers card; `UX-REVIEW §5` gap 3), no reminder. `WorkflowSettingsEditor.jsx:310-333`:
one audience for every Approved page in the space. The report (`D3`) is in the ribbon popover, per page, steward
only; no space-level "who has not read what".
**Why it fails the user** Comala's read confirmation is sold for "mandatory reading" — the value is the chase and
the report. Ours proves who clicked, but nobody is chased.
**Proposal** Per-page audience override on the details popover (*"Readers: space audience (2) · Change for this
page"*), a "Pages you must read" card on My work (lister over `read-ack` + the space audiences the caller is in),
one @mention comment on approval when read confirmation is on (*"Please confirm you have read version 2"*), and a
Readers column + filter on the space dashboard.
**Confidence** medium — needs a "pages awaiting my confirmation" index (audience × approved pages) that does not
exist; per-page audience touches the settings shape.
**Blast radius** `read-acks.js`, `workflow/logic.js` settings, new lister + `count-my-work`, `my-work`,
`WorkflowDashboard`, `doc-ribbon` details.

### WF-8 The dashboard is a state count, not a document report (compliance officer's gaps)
**Who** compliance officer, space admin.
**Observed** `A1-workflow-tab-off.png`: tiles `0 Draft · 1 In Review · 0 Approved · 0 Expired`, table `Page / State
/ Entered / Review due`, `Export CSV` = `Page ID, Title, State, Entered, Review due, Overdue`. No filter, no
approver/requester, no "waiting on", no approved version, no read coverage, no signed flag. The Activity tab has
category/time/title filters and CSV but is an event stream, not a per-document status. Comala: Space Document
Report with reviewer/creator/owner filters and chosen columns; per-page Document Activity Report.
**Proposal** Add to `get-workflow-dashboard` rows: `approvedVersion`, `approvedByName`, `approvedAt`,
`waitingOn` (names from `workflow-pending`), `readAcked/readAudience`, `signed`; UI: filter chips (state, overdue,
waiting on me, waiting on <person>), a search box, column picker (reuse the overlay's), CSV with the new
columns; a per-page "Document report" export (transitions + approval records + read acks from `workflow-log` and
`read-ack-*`) as a button in the page-details Activity tab.
**Confidence** high — every field exists on the state record / pending record / acks; it is composition.
**Blast radius** `workflow/actions.js` dashboard (+ pending/ack reads per row, bounded), `WorkflowDashboard.jsx`,
`page-details` Activity tab, CSV writers.

### WF-9 Deciding from My work and the console inbox is blind
**Who** approver.
**Observed** `C1-mywork-pending.png`: `HARNESS critique-wf … Move to Approved · requested by Gabriela Perdum ·
[Approve] [Deny]`; no space, no time, no version link, no reason field, no avatar, no "what changed". Console
inbox identical (`A0-console-landing.png`, "requested by Harness"). `WorkflowInbox.jsx:36` sends `decide-approval`
with no reason/code — in a space with `requireSignature` the Approve button fails with the server's
*"Enter the current code…"* after the click.
**Why it fails the user** Approving is attestation; approving from a list without seeing the content is what
auditors reject. Comala's complaint was "no avatars"; we have no avatars, no context, no reason.
**Proposal** Each inbox row: avatar + name (Confluence user API), space, "asked <when>", *"v3 · view"* link, the
requester's reason if any, an expandable "Approve with reason / Deny with reason" bar (the page-details
`ReasonBar` exists), signature code field when the space requires it (`get-page-approvals.requireSignature`).
Keep one-click Approve only when no signature is required.
**Confidence** high.
**Blast radius** `WorkflowInbox.jsx` (shared by my-work + console), `list-my-approvals` (add spaceKey, version,
requester reason, requireSignature).

### WF-10 Vocabulary that a Confluence admin does not have
**Who** space admin, author, editor.
**Observed** (all quoted from `steps.json` / code): *"rights-holders move it along the workflow"*
(`WorkflowSettingsEditor.jsx:270`); columns *"First"*, *"Protected"* and the raw ids `draft / in_review /
approved / expired` in the definition table (`WorkflowDefinitionEditor.jsx:88-94`); state name *"Expired"*;
*"Sanctioned baseline is now v3 (edited by an approver or space admin since the review)"* and *"Unsanctioned edits
are reverted automatically"* (`doc-ribbon/index.jsx:254,259`); *"Leaving "Approved" requires space admin
approval"* / *"Entering "Approved" requires space admin approval"* (`workflow/actions.js:208,233,284`);
*"…verified by structural compare"*, *"Enforcement pending"*, *"first request a transition out of Approved"*
(`approval-blueprints.js:66-75`); *"Set review date"* chip on every Draft page for stewards (`B1-author-draft.png`).
**Proposal** rights-holders → *"approvers and space admins"*; First → *"Starts here"*; Protected → *"Approved
(enforced)"* with the sentence under the table; hide raw ids (show on hover); Expired → keep the id, rename the
built-in state *"Needs re-review"*; "Sanctioned baseline" → *"Approved content was last updated by an approver in
v3"*; "requires space admin approval" → *"Only a space admin can move a page out of Approved"* / *"…into Approved
when no approvers are set"*; drop "structural compare"; "Enforcement pending" → *"Sentinel Vault could not
restore the approved version yet — it will retry"*; the "Set review date" chip only when the state has a clock
or the page is Approved (move "set a date" into the details popover for the rest).
**Confidence** high (strings).
**Blast radius** the five files above; no ids/keys change.

**Status (2026-09-20):** done in the WF-10 + WF-11 commit (dev 8.27.0), evidence `scenarios/sentinel-vault/wf10-wf11-workflow-tab.spec.ts` (server: the built-in lapsed state is named `Needs re-review` (id `expired` unchanged); browser: the definitions table reads `Starts here` / `Approved (enforced)` with the sentence under it, no raw id on the rows (the id is the name field's tooltip: `Stored as "draft" — the id never changes once saved`), no "rights-holders", no "moved to Expired" in the settings copy, and a steward's Draft page (no clock) shows NO "Set review date" chip; PNGs light + dark read). Shipped: "approvers and space admins"; refusals `Only a space admin can move a page out of {state}` / `…into {state} when no approvers are set`; the ribbon popover's "Sanctioned baseline" → `Approved content was last updated by an approver or space admin in vN.` and "Unsanctioned edits" → `An edit by anyone who is not an approver or space admin is …` (SEC-3 commit); "Enforcement pending" → `Approved version not restored yet — … will retry`; the expiry comment and the ribbon/settings copy name the expired STATE by its name. **Verified live (2026-09-20, plain-editor bed):** both refusal sentences are provoked by a REAL editor through the gated `request-transition` — `scenarios/sentinel-vault/plain-editor-refusals.spec.ts` ("WF-10"): PLAIN in SVPLAIN with no approvers set gets `Only a space admin can move a page into Approved when no approvers are set`, and `Only a space admin can move a page out of Approved` once Mihai moved it in; the steward's same calls go through. The earlier premise was wrong in its cause: every account the harness knew is a SITE admin (`administer/application`), not merely a space admin — no space could have made Gabriela a non-steward. Spaces with a saved copy of the definition keep the name their copy carries ("Expired" until an admin renames it).

### WF-11 Two Save buttons, two models, one tab
**Who** space admin.
**Observed** `A3-definitions-open.png`: "Save workflow settings" bar at the bottom of the settings, and a separate
"Save workflow" per definition inside "Workflow definitions"; copy: *"Each workflow saves with its own button; the
bar at the bottom saves the settings above, not the workflows."* Approval / enforcement settings name a state
("Approved") that the definition editor can rename or un-protect, with only a `defRev` re-render tying them.
**Why it fails the user** A form that has to explain which button saves what is two forms. Comala keeps
"apply a workflow" (settings) and "edit the workflow" (builder) on different screens.
**Proposal** Split the tab into "Workflow" (enable, which workflow, auto-start, apply to existing, labels — one
Save) and a "Workflows" sub-page/modal for definitions (opened from a *"Edit the states"* link next to the
chips); approval / protection / readers move under the state they concern in the definition view
(*Approved: requires approval by … · protected: move back / revert · re-review after … · readers …*), one
Save per workflow. Show the effective rule sentence at the top of the tab: *"New pages start in Draft. Any one of
Mihai Perdum approves. Approved pages are protected: an unapproved edit moves the page back to Draft. Re-review
after 150 days."*
**Confidence** medium — clear win on comprehension; the settings record and the definition record stay separate
on the server, so the UI must write both on one Save and report partial failure.
**Blast radius** `WorkflowSettingsEditor.jsx`, `WorkflowDefinitionEditor.jsx`, `realm-console` workflow tab.

**Status (2026-09-20):** done in the WF-10 + WF-11 commit (dev 8.27.0), evidence `scenarios/sentinel-vault/wf10-wf11-workflow-tab.spec.ts` (browser: the Workflow tab opens with ONE rule sentence — `Pages start in Draft. Mihai Perdum approves before a page is Approved. Approved pages are protected: an edit by anyone who is not an approver or a space admin moves the page back to Draft. Re-review after 150 days.` — exactly one Save button (`Save workflow settings`) and no definition editor on that view; `Edit the states…` beside the state chips switches the tab to the states view, where the settings Save is gone, each workflow has its own `Save workflow`, and `← Back to workflow settings` returns; the two-buttons explainer sentence is gone). Shipped: `kit/workflow-rule.js workflowRuleSentence(settings, def)` (pure, `test/workflow-rule.test.mjs`), `WorkflowSettingsEditor` prop `onEditStates`, `WorkflowDefinitionEditor` props `standalone` / `onBack`, `realm-console` `wfView`. NOT done: moving the approval / protection / readers settings INTO the definition view with one Save per workflow — the settings record and the definition record are separate on the server and a single Save would have to report partial failure; the rule sentence covers the comprehension gap the critic named, the two records keep their own Save on their own screens.

### WF-12 First-run setup for a space admin (the mandated item)
**Who** space admin, day one.
**Observed** No first-run: the tab is the full settings form (`A2`), 20 controls, defaults that matter hidden in
placeholders (150 days), "Require approval" ON with no approvers = "space admins approve" is never stated
(`WorkflowSettingsEditor.jsx:381` only warns in revert mode).
**Proposal — the three questions**, shown once when `workflow-settings-{space}` does not exist, as three solid
cards with a live sentence preview and one *"Turn on the workflow"* button:
1. **Who approves?** — *"Space admins (default)"* / *"These people or groups …"* (pickers) / *"Any one · All ·
   At least N"* → `approval`.
2. **What happens if someone edits an Approved page?** — *"Move it back to In Review for a new look (default,
   keeps their edit)"* / *"Restore the approved version (their edit stays in history)"* → `enforceMode`,
   `demoteTo:"in_review"` (default here should be In Review, not Draft — Comala's semantics, item A2 in the
   product definition).
3. **Which pages?** — *"New pages start the workflow automatically"* (default ON) / *"Also start it on the N
   existing pages now"* (runs bulk assign in batches with progress) / *"Only pages I add by hand"* →
   `autoAssignNew`, bulk-assign.
Everything else (readers, signature, AI/rules conditions, review clocks, labels, definitions) stays in
"Advanced" and is off. *Rejected alternatives:* asking for the state names first (nobody changes them on day
one); a JSON/visual builder (non-goal #5); making review-date/expiry a first-run question (the 150-day default
is fine until a page reaches it and the ribbon says so).
**Confidence** high on the questions; medium on defaulting `demoteTo` to In Review (owner call — it changes
today's behaviour for new spaces).
**Blast radius** `WorkflowSettingsEditor.jsx` (new mode), `set-space-workflow-settings` unchanged.

### WF-13 Comment noise: every request and decision posts a page comment; the approver comment points at a banner that may be closed
**Who** author, approver, everyone watching the page.
**Observed** One walk = six Sentinel Vault comments on one page (`E1-comments`): two "Approval requested", one
"declined", one more "requested", one "approved", one "Moved back". Approver comment: *"Open the Sentinel Vault
ribbon at the top of this page to Approve or Deny."* — the ribbon may be dismissed (WF-6) or disabled.
**Proposal** One comment per request that is EDITED with the outcome (v2 footer comments support update) or, if
edit is not possible, a single closing comment per request; the approver comment links to My work
(`myWorkPath`) *and* the page; a per-space "quiet" mode already exists — surface it on the Workflow tab as
*"Post page comments for approvals: on/off"*.
**Confidence** medium (comment update through Forge needs a probe).
**Blast radius** `approval-blueprints.js`, `outbound-notify.js`, settings editor.

### WF-14 The approver list has no avatars and no "told" state
**Who** approver, author.
**Observed** `C3-approver-panel.png`: `Pending  Mihai Perdum (you)` — text rows; the author cannot tell whether the
approvers were notified. Comala users complain about exactly this.
**Proposal** Avatar (Confluence `/user?accountId` → `profilePicture`) + name + status lozenge + *"told by page
comment, Sep 19 21:52"* (from `notifyApprovalRequested` result) per row; groups shown as *"Legal team (7)"*
expanded on hover.
**Confidence** high (data available; avatars need one extra fetch, cache per session).
**Blast radius** `getPageApprovalStatus` (+names/avatars), `doc-ribbon` popover, `WorkflowInbox`.

### WF-15 "Request approval" tells the author nothing about who approves or what happens next
**Who** author.
**Observed** `B4-author-menu-inreview.png`: menu item `Request approval → Approved`; after clicking, the chip reads
`Awaiting approval 0 of 1` and the author has to open it to learn who. No confirmation, no "you will be told
by comment".
**Proposal** Before sending: a one-line inline confirm in the ribbon *"Ask Mihai Perdum to approve v3? They get a
page comment; you'll be told here and in My work."* [Send] [Cancel]; after: a 5 s status *"Sent to 1 approver"*.
**Confidence** high.
**Blast radius** `doc-ribbon/index.jsx` `doTransition`.

### WF-16 Signature prompt (written from code — screenshot missing)
**Who** approver in a space that requires signed decisions.
**Observed** Popover: *"Sign with your authenticator code"* input, or *"This space requires a signed decision. Set
up your signature on My work first."* with Approve/Deny disabled (`doc-ribbon/index.jsx:518-544`). My work card:
*"Your approval signature … It proves the approval came from you and your device."*, QR + key, *"Enter the 6-digit
code it shows to finish"* (`my-work/index.jsx:305-396`). Copy is clear. Gaps: the inbox path (WF-9) has no code
field; nothing tells an approver at ENROLMENT time which spaces require it; the "Not a Part 11 claim"
(`signature.js:1-3`) is never stated to the admin who turns it on.
**Proposal** Add the code field to the inbox rows; on the settings toggle description: *"This is a second factor
proving the approver's device, not a regulated e-signature."*; on My work, list the spaces that require it.
**Confidence** high.
**Blast radius** `WorkflowInbox.jsx`, `WorkflowSettingsEditor.jsx`, `my-work`.

### WF-17 "Apply to existing pages" is a 25-page-per-click loop
**Who** space admin.
**Observed** Copy: *"Large spaces are processed in batches — run again to continue."*; `bulkAssignPagesInSpace`
handles 25 per call and returns a cursor the button keeps in React state (`WorkflowSettingsEditor.jsx:231-249`).
**Proposal** Loop client-side until `capped` is false with a progress line *"Applied to 75 of ~300 pages…"* and a
Stop button; report the total once.
**Confidence** high.
**Blast radius** `WorkflowSettingsEditor.jsx`.

---

## Questions only the owner can answer

1. Should the demote target default to **In Review** (Comala semantics, WF-12 q2) for new spaces, changing
   today's "back to Draft" default?
2. Is the byline chip allowed to carry the workflow state next to the classification (WF-6) — the byline is
   the one surface the page-classification critique also wants to own?
3. Comment policy: one comment per request updated in place, or keep one comment per event and make the
   space "quiet" switch the answer (WF-13)?
4. Read confirmation: per-page audience overrides, or keep it space-wide and only add the chase (My work +
   comment) (WF-7)?
5. Is a requester-side "Withdraw request" write acceptable (WF-5), or should a stuck sole-approver request be a
   space-admin-only action?
6. Rename the built-in "Expired" state to "Needs re-review" (id stays `expired`), or keep Comala's word?
7. Should the revert-mode enforcement comment be exempt from the opt-in comment master like the seal
   `editor_revert` is (WF-2b)? It is the same "your work vanished" case.
