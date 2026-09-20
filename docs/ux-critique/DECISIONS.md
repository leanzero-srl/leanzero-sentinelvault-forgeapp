# UX critique — owner decisions and the build order (2026-09-19)

Owner, 2026-09-19 evening: "CLS-1 default off · WF-6 yes · SEC-2 what is recommended? · please
start on all — be careful to evidence to yourself the fixes otherwise they're all meaningless."

## Decisions

- **CLS-1** — classification is OFF by default: site setting `classificationEnabled` (default
  false) + per-space override; when off, no surface mentions classification (no "Unclassified"
  chip/block, no tab controls beyond the switch itself), stored levels/overrides are kept.
- **WF-6** — the byline chip may carry `Level · State`; the page-details modal gets a Workflow block.
- **SEC-2** — recommended and adopted: the workflow is the senior lock. While a page is Approved
  (enforced), every section/attachment seal on it is owned by the approver set: the personal owner
  cannot release it alone, expiry is suspended, and edits by anyone outside the approver set are
  undone by the workflow's baseline (not the personal snapshot). Leaving Approved hands the seals
  back to their owners with their remaining time. Outside the workflow a section seal stays what it
  is today: personal, 3-day default, extendable (SEC-7 adds Extend for sections).
  Rejected: sections-as-approval-units (a third model — may come later on top of this);
  seal→propose-a-change (an editreq improvement, unifies nothing).

## Rule for every fix

Evidence or it did not happen: each item ships with (a) a unit test where there is a pure rule,
(b) a live harness spec on wolfaenpak that FAILS before the fix and PASSES after, with the PNGs
read, (c) the deployed dev version noted in the commit. One area at a time on the dev environment
and the shared browser profile — the three critics proved that parallel live runs steal the profile.

## Order

1. Bugs, no decision needed: WF-1, WF-2, WF-3, WF-4, SEC-1.
2. CLS-1 (default off), WF-6 (byline + modal), SEC-2 (workflow owns seals), SEC-7 (Extend for sections).
3. Copy and consistency: SEC-3 (one status vocabulary), SEC-8–10, WF-10/11, CLS-10/11, SEC-4 (entry points).
4. Parked until the owner picks: CLS-2 (reason to exist), sections-as-approval-units.

## Shipped — production 6.1.0 (2026-09-20 evening, minor; Runs on Atlassian eligible)

Everything in groups 1–4 (dev 8.13 → 8.37): the five bugs, CLS-1 off by default, WF-6, SEC-2,
SEC-7 (incl. the section sweep), SEC-3/8/9/10, WF-10/11, CLS-10/11, SEC-4 (a)+(b), WF-3 (c),
SEC-2 (e), the plain-editor bed. Verification: every item's own live spec on wolfaenpak passed
when it shipped; the whole-suite re-run was cut short by the owner ("I will do it") — the manual
test plan he received is the acceptance run. Parked: SEC-4 (c) second contentAction (new module),
CLS-2 "reason to exist", sections-as-approval-units. leanzero-demo must accept major 6 under
Manage apps (still "Outdated app" at deploy time).
