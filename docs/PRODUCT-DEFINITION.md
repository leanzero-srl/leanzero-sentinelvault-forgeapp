# Sentinel Vault — what it is, converged into business requirements

Written 2026-09-05 from the code (102 resolver actions, 9 triggers/crons/queues, 7 UI surfaces),
not from the marketing copy. Competitor facts are from the vendors' own Cloud documentation and
the Marketplace pricing API on the same day (`scratchpad/competitors.md` in the AQL session has
every citation; the numbers below are the ones that matter).

---

## 1. The one-sentence definition

**Sentinel Vault is a content-integrity enforcement layer for Confluence Cloud: it lets a person
declare "this must not change without me" about a file, a section of a page, or a whole approved
page, and then physically undoes any change that breaks that declaration, tells everyone involved,
and keeps a record.**

Everything in the app is one of four things: a way to make that declaration (seal, seal a section,
approve into an enforced state, define a rule), the machine that enforces it (the two triggers and
their restore passes), the release valves that keep enforcement from becoming a hostage situation
(edit requests and grants, expiry, steward override, lapse release), or the administration and
telemetry around it (consoles, notifications, dashboard).

## 2. The five business capabilities

Sliced by the job the customer is hiring the app for, not by capsule.

### BC-1 Exclusive edit rights on a file (the Lockpoint job)

*A user reserves an attachment; nobody else's upload survives.*

- Seal (lock) any attachment with a duration, comment and labels. Default 48 h, per-space override,
  global default, extendable in place (the extension carries edit grants forward).
- Enforcement is a revert, not a block: a foreign upload is accepted by Confluence and then the
  sealed binary is re-uploaded as a new version, so the intruder's work stays in version history.
- Trash by a non-owner is undone; permanent delete is detected, cleaned up and announced; the
  owner trashing their own file releases the seal instead of fighting it.
- Release valves: request-to-edit with owner/steward approval and revocable grants that die with
  the seal; watch-for-release; halfway reminder; lapse reminders then auto-release after N notices;
  steward force-unseal behind a global toggle; pause-all-timers.
- Surfaces: page banner counts, inline panel cards, a full-table overlay, "My Sealed Files" and a
  steward "Sealed Files" audit tab, thumbnails for images, upload/label/delete/restore/purge.

### BC-2 Freezing a piece of a page (nobody else has this)

*A user wraps a heading + body in a sealed section; edits by others are restored from a snapshot.*

- Server-side wrap of a heading range into a bodied macro with a stable id, snapshot of the ADF,
  content hash plus structural compare, restore of every duplicate copy, re-insert by heading
  anchor when the wrapper is cut, owner and grantee edits re-baseline, expired seals go inert.
- Same request/approve/deny/grant model as files. Same lapse and steward rules.

### BC-3 Enforced page-body integrity for embedded sealed media

*If a sealed image or file is embedded in the page, its embed and its presentation (layout, width,
height) are part of what is sealed.*

- Removing the embed is undone by surgical re-splice from up to five prior versions; only the
  missing blocks are re-inserted, every other edit in the same save is preserved.
- Resizing or re-laying-out a sealed image is undone (strict mode default; shadow mode logs only).
- Owner removing their own embed re-baselines to "not embedded" so nobody is blamed later.

### BC-4 Document workflow with an enforced Approved state (the Comala job, done our way)

*A steward turns on a review workflow for a space; Approved pages cannot drift.*

- State machine Draft → In Review → Approved → Expired with a by-state index, transition log
  (no TTL, compliance record), auto-assign on page create, bulk assign to existing pages.
- Approvals: named users and groups, modes any / all / min-N, version-pinned so a page edited
  after review comes back as stale, requester cannot self-approve, @mention notifications, an
  inbox on the space console, a decision dialog on the page banner.
- Entry conditions per target state: structural rules (required heading/table/label/macro,
  hierarchy, length) evaluated synchronously, plus an AI content review as an asynchronous "robot
  approver" with a threshold and a budget-exhausted policy.
- Enforcement of Approved: demote (page returns to Draft, content kept) or revert (body restored
  to the highest sanctioned version, editor's work stays in history). Privileged editors (the
  approver snapshot, live stewards) edit freely and re-stamp the baseline. Hourly sweep catches
  drift the trigger missed and expires pages past their review date.
- Dashboard: exact per-state counts, overdue count, recent pages, CSV export.

### BC-5 Content rules and AI review (a Comala-adjacent job)

*Stewards define what a compliant page looks like; pages are checked on every save.*

- Seven rule types, warn/block severity, three modes that are a union (advisory comment, gate
  status property, revert to last-good version), a global block-rule floor spaces cannot weaken.
- AI review through Atlassian-hosted Claude (Forge LLM, Haiku only, monthly token budget per
  space, prompt-injection fence, schema-clamped findings, per-finding triage state). No egress, so
  the app keeps "Runs on Atlassian".

### Cross-cutting requirements the code already satisfies

- **R-Loop**: the app never reacts to its own writes; if it cannot prove who it is, it does nothing.
- **R-Surgical**: a restore never destroys a concurrent human edit; one read, ordered passes, one
  write, 409 backoff, no false "restored" claims.
- **R-Authz**: the caller must be able to do it themselves before the app does it as itself
  (`content-access.js`), and the space is derived from the object, never from the caller.
- **R-Notify**: comment-with-@mention is the notification channel (no email egress); one comment
  per (page, target, class) per 24 h; each party gets their own paragraph.
- **R-Fail-safe**: licensing fails open (a protection app must never stop protecting), triggers
  fail closed, AI gates fail closed.

## 3. What it resembles

| Product | What it is | Overlap with Sentinel Vault | What we have that it does not |
|---|---|---|---|
| **Cenote Lockpoint Cloud** (791 installs, Connect, Smart Locking only, reactive revert ~15–30 s) | Attachment check-out/check-in | BC-1 almost 1:1: lock/unlock, LOCKED lozenges, Notify Me, 24 h warning + 48 h auto-unlock, force unlock, space-wide locked list | Sealed sections, embedded-media and presentation enforcement, edit requests and grants, extend, labels/upload/thumbnails, lapse policy, workflow, rules, AI, audit tabs |
| **Comala Document Management Cloud** (6,105 installs, Forge since Jun 2026) | Page workflow, approvals, e-signature, reporting | BC-4/BC-5 partially: states, approvals with quorum, expiry, dashboard, labels-as-scope (theirs), read-only via restrictions (theirs) | An *enforced* Approved state (theirs is advisory: page restrictions flipped by triggers), attachment-level protection of any kind, AI review, revert-to-compliant, structural rules |
| **Scroll Content Manager (Scroll Documents)** | Page-tree snapshots, read-only versions | Adjacent: "approved version stays intact" achieved by copying the tree | We keep the live page intact instead of snapshotting a copy |
| **Comala Publishing** | Draft space → published space | Not overlapping; our enforcement makes the two-space model unnecessary for the integrity use case | — |

**Category verdict.** It is a *Lockpoint superset* with a *Comala-style workflow whose Approved
state is physically enforced*. The strategic line from the 2026-07-05 expansion research still
holds and is now shipped: **everyone else tracks, Sentinel Vault enforces**.

## 4. Not yet live in production (as of 2026-09-06)

Production (Marketplace) is 4.1.0, deployed 2026-08-20. Dev is at commit `3c7ce48`+. Everything
between is built and verified on dev but not shipped:

- it60, the owner's six feedback items: approve-vs-deny asymmetry on lapsed seals surfaced with a
  reason; party-specific restore notices (file came back out of trash vs page content reverted);
  real image thumbnails on panel, overlay and console; **Extend seal** (new action `extend-seal`);
  lapse policy (N reminders then auto-release, tunable); dropzone moved under "Add a file".
- `getAiFindings` answered for the caller's space, not the page's (fixed).
- Section-surface marker-clear race closed (mirror of the media fix).
- Shared `sealing/release.js` teardown and `resolveSealHoldPeriod` (duplication removed).
- it61 (2026-09-05): coverage pass — three defects (space name read via v1 failed under
  asUser; watcher sweeps queried a prefix nothing wrote; approvals inbox blind past 1,500
  records) and SV-SEC-2 (eight dead resolvers removed, one of them ungated).
- **A1** Activity log per page + space Activity tab with filters and CSV (`activity-*` family).
- **A4 + A6** Approval record kept after the approval; "View approved version" links.
- **A2 + A5** Configurable demote target; per-state review clocks and a steward-editable review
  date on the page (UTC end-of-day, custom date picker).
- Trashed pages leave the workflow dashboard, inbox and sweep; purged pages lose their keys.
- **A7** Cross-space "My work" global page (approvals, edit requests on my seals, my seals).
- Edit-request owner index (the last site-wide scan filtered client-side).
- **Tier B (owner: "do the Tier B items too now", 2026-09-05):** B4 label sync (`sv-state-{id}`),
  B2 read confirmations, B3 signed decisions (TOTP), B1 definition editor + label-scoped
  workflows. **B5 webhook deliberately not built** — it needs an egress permission (major
  version, re-consent, loss of "Runs on Atlassian"); that trade is the owner's to make.
- **UX pass (it68, 2026-09-06, owner: "bring it to production ready"):** the banner shows the
  state chip and ONE details chip (approval record, review date, readers behind a sectioned
  popover) instead of three; the Workflow tab is four titled sections (Workflow, Readers,
  Approval, Protecting Approved pages); the sign-to-move dialog reports a refused code inside
  the dialog; pickers, definitions grid, My work dark mode reviewed from screenshots.
- **it69 (2026-09-06):** the two violation-comment dedup races (`SECURITY-TODO.md`, pre-existing,
  ~1 run in 3) are closed — a clean save re-arms the comment only when a user authored it, and a
  comment claim is confirmed by token after a settle interval. Restores were never affected.

Shipping requires the paid plan to be live in the Partner portal (`deploy-prod.sh` refuses
without `--licensing-live`) and is a minor bump — none of it61–it66 adds a scope; the
`confluence:globalPage` module was proven a minor bump on dev (6.97 → 6.100, no re-consent).
Last full-suite verdict on the dev build: PASS, 79/79 specs (`sv-it68-final`, commit 269d63f, UX pass included); GRADE PASS.

## 5. Comala-parity gap analysis — what we could add

Ranked by confidence that the feature is worth building and that we can build it correctly.
Effort is not a ranking axis. "Blast" is the reach of the change.

### Tier A — high confidence, fits the enforcement story, no new scopes

| # | Feature | What Comala/Lockpoint has | What we would build | Blast |
|---|---|---|---|---|
| A1 | **Document Activity per page + space Document Report with CSV** | Comala: full audit trail per page (transitions, approvals with version at decision, overrides), space report with filters and CSV | We already write `workflow-log-*` (no TTL) and `dispatch` records. Build a per-page activity view (banner dialog + panel group) that merges workflow log, seal events, restores and approvals; a space "Activity" tab with filters + CSV. Seal events need a durable log family (`seal-log-*`) since dispatches TTL out at 1 h. | New KVS family, 2 surfaces, uninstall wipe covers it by prefix |
| A2 | **Reset-on-edit and "updated" transition semantics as configurable behaviour** | Comala: editing a page in Approved returns it to Review (their only protection) | We have demote, but demote goes to the *initial* state. Add per-space `onTamper: demote-to` target (e.g. In Review) and expose "who edited, which version" in the demote comment. | `collectWorkflowEnforcementForPage`, settings editor |
| A3 | **Per-state page restrictions as an optional add-on to enforcement** | Comala: `add/set/remove-restrictions` triggers, "remove restrictions on final state" | Optional per-state view/edit restriction (users/groups/@approvers) applied on entry and removed on exit. Needs live probe of the v1 restrictions API under Forge first. Off by default; enforcement stays revert-based. | New scope likely (`write:confluence-props`? verify) → major bump |
| A4 | **Approval decision comments and "Approved and version N" evidence macro** | Comala Document Approvals macro shows reviewer, decision, date, page version at decision | We pin the version already. Add an optional reason on approve/deny (the dialog has a reason field for deny; make it symmetric), and a read-only "Approval record" block in the panel/dialog listing reviewer, decision, date, version. | `decide-approval`, `get-page-approvals`, dialog |
| A5 | **Workflow parameters: due-date editing by users, per-state expiry** | Comala: due date per state, editable from the dialog, `set-expiration` | We have `reviewAfterDays` on Approved only. Add per-state `expiresAfterDays` and an "edit review date" affordance in the banner dialog for stewards. | `computeReviewDueAt`, sweep, dialog |
| A6 | **"View approved version" link and stale-approval banner copy** | Comala: link to last approved version in the dialog | We know `approvedVersion`; link to `/pages/viewpageversion.action` from the chip. One-line UI change. | doc-ribbon |
| A7 | **Cross-space "My work" page** (approvals waiting on me + my seals + my requests) | Comala: Document Report filters "My assigned/pending approvals"; Lockpoint: none | `list-my-approvals`, `enumerate-operator-seals`, `list-my-edit-requests` all exist; add a `confluence:globalPage` that composes them. | Built 2026-09-05 (it65). PROVEN: a module without a scope is a MINOR version (dev 6.97 → 6.100, install stayed Up-to-date) — ships on a minor prod deploy |

### Tier B — worth it, but a design decision or a spike comes first

| # | Feature | Why it needs a decision |
|---|---|---|
| B1 | **Label-scoped workflows and multiple workflows per space with priority** (Comala's model) | We have one workflow per space plus a global/space definition with no UI. The definition editor (states, transitions, colours, dead-end warning) is the missing UI; label scoping changes auto-assign. Non-goal #5 in the expansion doc said "no visual builder" — a *definition editor* (not a builder) is the middle ground. Owner call. |
| B2 | **Read confirmations** ("I have read version N") | Comala sells it as a separate app. Fits BC-4 (an Approved page can require acknowledgement from a group). Needs a `read-ack-*` family, a byline/panel affordance, a report. Owner call because it is a new category. |
| B3 | **Per-approval e-signature (OTP)** | Comala's Part 11 story. Non-goal #9 stands unless a regulated customer pulls; but a *lighter* "re-authenticate before approve" is not available on Forge (no auth API), so the only honest version is TOTP enrolment inside the app. Defer. |
| B4 | **CQL-visible state** | Comala exposes `cw_state`, `cw_expires`. Probed live 2026-09-05: `content.property[sentinel-vault-workflow].stateId = "approved"` fails to parse on wolfaenpak — CQL indexing of content properties needs a Connect `confluenceContentProperties` index schema, which Forge does not offer. The honest substitute is **label sync** (Comala does this too): mirror the workflow state as a label (`sv-state-approved`) so Content by Label / Page Properties Report can filter. Needs the `write:label` scope check (verify in manifest) and a design call on label naming. |
| B5 | **Outbound webhook on state change** | Comala has it. Egress kills "Runs on Atlassian" — the app's headline compliance property. Hard no unless the owner decides the badge is worth trading. |

### Tier C — Lockpoint gaps we should close because they are cheap and expected

| # | Feature |
|---|---|
| C1 | Lock state on the **Attachments page** and in the **Attachments macro** (Lockpoint shows lozenges there). We only show state in our own panel/overlay/banner. Needs a byline item or content action (`confluence:contentBylineItem`); verify module availability. |
| C2 | **Anonymous / unlicensed editor warning** parity is already better than Lockpoint (we comment); nothing to do. |
| C3 | **Lock history on the file**: Lockpoint has none; we show owner/time but no per-file history. Covered by A1. |

### What I would NOT build (still)

Publishing to a second space, a visual workflow builder with JSON, external email approvers,
webhooks, our own diff/version store. Reasons in `CAPABILITY_EXPANSION.md §3` still hold.

## 6. Recommendation

Build **A1 (activity + report + CSV)** first: it is the single feature every Comala evaluation
checklist asks for, it turns our already-superior enforcement into *evidence*, and it needs no
scope. Then **A4 + A6** (approval evidence, approved-version link) because they complete the
"Approved means something" story on the page itself. **A2 and A5** round out workflow parity.
**A7** is the discoverability win. Everything in Tier B goes to the owner as a question with the
trade-off stated.

Confidence: HIGH on A1, A4, A6 (all composition of existing records and resolvers); MEDIUM on A2
and A5 (they touch the enforcement pass and the sweep, so design-first with the 3-lens trigger
review); LOW on A3 and A7's manifest impact until probed live.
