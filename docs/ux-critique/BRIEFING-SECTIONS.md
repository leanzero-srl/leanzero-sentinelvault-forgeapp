# Briefing — Section sealing × workflow UI/UX critique (2026-09-19)

Read BRIEFING-COMMON.md first. The owner's question: *"the section sealing, how do we tie that up
easier to the comala [workflow]?"* — i.e. sealed sections and the page workflow are two separate
mental models today; find how a user would want them to be ONE, and what is confusing now.

## What exists today (code truth — verify it, then judge it)

- Sealed section = a bodied macro `sentinel-vault-sealed-section` wrapping a heading + body with a
  stable app-issued `sectionId`; the server wraps a heading range on request (`seal-section` from
  the panel's Sections group / the page-details modal / `listPageHeadings`), snapshots the ADF,
  restores foreign edits (surgical), re-inserts when cut, owner/grantee edits re-baseline; same
  request → approve/decline → grant model as attachments (`editreq`), direct grant to a named
  person (shipped 2026-09-17), expiry, space-admin force release, signed actions. Surface:
  `src/ui/surfaces/section-setup/index.jsx` (the macro body in VIEW: badge + rendered body via
  the ADF renderer handshake; the "your version was undone" amber notice with "Open my version";
  in EDIT mode the macro shows a placeholder), the panel `SectionRow`, page-details rows,
  My work. Docs: docs/features/content-sealing.md, docs/features/edit-requests.md.
- Workflow (see BRIEFING-WORKFLOW.md): whole-page states, approvals, enforced Approved, entry
  conditions (structural rules, AI review).
- Nothing links the two today: a sealed section is not a workflow state; approving a page does not
  seal anything; a sealed section inside a page in review is enforced independently; the ribbon
  shows ONE urgent thing (pickUrgent) so a page with both a workflow wait and a section lock shows
  only one.

## What the market does with parts of pages

AppFox Approvals for Confluence "Section Approval macro" (2026): a macro marks a section for
approval; approvers or Approval Team; minimum approvals; expiry date/interval; "Expire on edit"
(the approval dies when the content changes — which is exactly what our seal snapshot detects);
"lock the decision"; owner notifications; the audit trail of decisions is shown INSIDE the macro.
Comala has no section concept. Lockpoint locks files only. Community asks: lock part of a page;
lock the page during approval; lock at the end of the workflow without hiding the state.

## Candidate unifications to examine (judge each against the code and the user's path)

- **Sections as approval units**: "Request approval for this section" → approvers → on approval
  the section is sealed to the approvers' snapshot (enforced), "Expire on edit" is inherent; the
  macro shows the decision trail. The page workflow then aggregates: a page is Approved when all
  its approval-sections are approved (or stays whole-page).
- **Approved page auto-seals its sections / attachments**: entering Approved seals every section
  + embedded media to the approver group; leaving Approved releases them. Removes the "two
  models" problem by making sealing the MECHANISM of the workflow rather than a sibling feature.
- **Seal → "propose a change"**: an edit request on a sealed section IS a mini review: the requester
  edits a draft copy (the "my version" the app already keeps), the owner sees a diff and approves →
  the section re-baselines to the proposed version. Today the requester gets a time-boxed grant
  and re-types their change.
- **One status language**: the section badge, the ribbon pill, the byline chip and My work rows
  should use one vocabulary for "locked / in review / approved / waiting for you / yours".
- **Where the user starts**: today sealing a section means inserting a macro or picking a heading
  in a panel; approving means a ribbon dialog; the two entry points look unrelated. Where would a
  naive editor look (⋯ page menu, the heading's hover, the selection toolbar, the byline chip)?

## Questions to answer with evidence

1. Editor: seal a section from scratch on a fresh page (screenshot every step). What does the
   page look like in edit mode afterwards (the placeholder), and would I dare edit around it?
2. Collaborator: edit inside someone's sealed section, wait for the guard, read the notice. Do I
   understand what happened and what to do? Then request edit → what do I see while waiting; what
   after approval; after decline (cooldown copy)?
3. Same page under the workflow (assign the space workflow to WFH or a test space, put the page
   In Review with a sealed section inside): what do the ribbon, byline, modal and My work show?
   Which of the two "waits" wins in the ribbon, and is the other reachable?
4. Approver: approve the page — does anything happen to the sealed section? Should it?
5. Copy audit: every string in section-setup, SectionRow, the section rows of page-details and
   My work — list the ones a user would not understand.

Deliverable: docs/ux-critique/BACKLOG-SECTIONS.md. Include one item that picks THE unification
you would ship first (with the ones you rejected and why), one for the single status language,
and one for the section entry point.
