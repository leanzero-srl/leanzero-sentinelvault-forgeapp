# Briefing — Document workflow ("the Comala feature") UI/UX critique (2026-09-19)

Read BRIEFING-COMMON.md first.

## What exists today (code truth — verify it, then judge it)

- `src/server/capsules/workflow/` — `logic.js` (state machine Draft → In Review → Approved →
  Expired, by-state index, transition log `workflow-log-*` with no TTL, auto-assign on page
  create, bulk assign), `approvals.js` (named users/groups, modes any/all/min-N, version-pinned
  decisions so an edit after review makes the approval stale, requester cannot self-approve,
  @mention notices), `read-acks.js` (read confirmations?), `signature.js` (TOTP e-signature on
  decisions; today also `signSealActions` for seal actions), `label-sync.js` (labels mirror the
  state), `actions.js` (resolvers; enrol/confirm signature). Entry conditions per target state:
  structural rules from the validations capsule + the AI review as an async "robot approver".
  Enforcement of Approved: demote (back to Draft) or revert (body restored to the sanctioned
  version); privileged editors (approver snapshot, space admins) edit freely and re-baseline.
  Hourly sweep expires pages past their review date. Dashboard with per-state counts, overdue,
  CSV. docs/PRODUCT-DEFINITION.md BC-4 and §5 (A1–A3 Comala-parity gaps) describe the intent.
- Where a user MEETS it: the page banner (`doc-ribbon`) pill "Waiting for you N" / decision dialog;
  the page-details modal; My work (`my-work`: requests, approvals, grants — the deciders); the space
  console (`realm-console`: workflow settings editor — JSON? forms? —, approvals inbox, dashboard);
  Confluence comments with @mentions as the notification channel; labels on the page.
- Harness specs that drive it: `workflow-*.spec.ts`, `workflow-conditions-e2e.mjs`,
  `page-editrequest-*`, `my-work*.spec.ts`, `realm-console-deep.spec.ts`. Use them to reach each
  screen, then walk it as a naive user and screenshot.

## Questions to answer with evidence

1. Space admin, day one: can I turn the workflow on for my space and understand the four states,
   who approves, what "enforced" means, and what will happen to my colleagues' edits — from the
   UI alone, without docs? Quote every copy string that assumes knowledge. Compare with Comala's
   "apply a workflow to the space / to a page" and its workflow builder; with AppFox Approvals'
   macro-in-page model.
2. Page author: how do I submit for review? Is the current state visible on the page at all
   times (Comala: byline status; ours: the ribbon hides in "exceptions" mode)? How do I know who
   must approve and whether they have been told? What do I see after a rejection?
3. Approver: where do I decide (ribbon dialog / My work / comment link)? Is the version I approve
   the version that gets enforced, and does the UI tell me the page changed since I looked?
   Is the e-signature prompt understandable? Comala's complaint: no avatars of who can review.
4. Reader: on an Approved page, do I know it is approved and by whom? On a page in review, do I
   know I am reading unapproved content (community need: hide/flag unapproved work)?
5. What happens to a user whose edit was demoted/reverted — do they understand why, and is the
   "editor notice" (shipped 2026-09-17, `editor_revert`) enough? Read `triggers.js`
   `runValidationPhase` and the notice policy.
6. Reporting: compare our dashboard/CSV with Comala's Space Document Report (filters by reviewer,
   creator, owner; columns) and Document Activity Report per page (A1 in the product definition).
   What does a compliance officer still lack?
7. Read confirmation (`read-acks.js`) — is it exposed anywhere? Comala sells it for HR policies.
8. Terminology: state names, "enforced", "demote", "revert", "stale", "robot approver", "steward",
   "realm" — which words would a Confluence admin not understand? (UX-REVIEW §1 already renamed
   some; check what survived.)

Deliverable: docs/ux-critique/BACKLOG-WORKFLOW.md. Include one item that defines the SINGLE
"workflow status" surface a page must always have (what, where, when hidden), and one that
defines the first-run setup for a space admin (the three questions, defaults), each with the
alternatives you rejected.
