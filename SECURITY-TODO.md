# Security items

## ✅ SV-SEC-1 — resolver authorization gap — **CLOSED 2026-08-20**

Raised 2026-08-20, fixed the same day, while the app was in Marketplace certification.

**What it was.** `sealSection` took `pageId` from the client payload and then read and REWROTE
that page through `asApp()`, with no check that the caller was entitled to edit it, while
`unsealSection` three lines below gated on owner-or-steward. That asymmetry was the tell.

**What it turned out to be.** Not one function. Auditing all ~90 registered resolver actions for
the same shape — a payload-named identifier reaching an `asApp()` operation with nothing checking
`req.context.accountId` against it — found roughly twenty-five more. Any logged-in user on the
site can invoke any registered action key with any payload, and the app's doc helpers run as
`asApp()`, which holds `read:confluence-content.all` + `write:confluence-content` tenant-wide. So
each of those was the app lending its own site-wide authority to an unentitled caller. The worst
returned the raw bytes of any attachment on the site as a base64 data URI.

**The fix.** `src/server/shared/content-access.js` — ask Confluence rather than re-derive:
`POST /wiki/rest/api/content/{id}/permission/check`, as `asApp` with the caller named as subject.
No new scope was needed (`read:confluence-content.permission` and
`read:content.permission:confluence` were already in the manifest), so no re-consent.

Two properties of that module are load-bearing and easy to undo by accident:

- It **fails closed** on anything that is not an explicit `hasPermission: true` on a 2xx. Probed
  live: an accountId the site cannot resolve returns **404 with a NotFoundException body**, not
  `hasPermission: false`. Code that read only the response body would treat that as an allow.
- `mustVerify()` skips the round-trip when the id came from `req.context`, and is used **only on
  read paths**. Authenticity is not entitlement: holding a page id in context proves the caller
  can SEE the page, never that they may CHANGE it. Every privileged write checks unconditionally.

### Verification — all three passed

- [x] **The negative case.** A caller who is not entitled is REFUSED by `sealSection`, and the
      refused call leaves the page body untouched. Proven with **Gabriela**, a real licensed
      wolfaenpak account with genuinely no permission on the target space — not a synthetic id.
      The unresolvable-account branch is asserted separately, because it is a different code path
      (404, per the note above).
- [x] **The positive case still works.** An entitled caller still lists headings and still seals,
      in both an open and a private space. Not fixed into uselessness.
- [x] **Covered in the live harness**, not a unit mock:
      `~/Projects/forge-live-harness/scenarios/sentinel-vault/authz-content-gate.spec.ts`.
      Plus 22 unit tests over the pure decision core in `test/content-access.test.mjs`.

Manufacturing a real unentitled user needed a dedicated private space (`SVSEC1P`): the API token
cannot set page-level restrictions on this site, and there is still no second non-admin identity
provisioned. That is the standing `SV_USER_B` gap.

---

## Known, pre-existing, NOT part of SV-SEC-1

Both surfaced while running the full live suite against the fix. Neither is a regression from it —
`triggers.js` imports nothing that the authorization work changed — and both are in violation
**comment dedup**, never in protection itself: the restore happens every time either way.

**1. A duplicate trigger delivery can clear the dedup marker it did not claim.**
`clearViolationNotices` runs on a clean save. Forge delivers page events at least once, so a twin
invocation can read the body *after* its sibling restored it, judge it clean, and delete the marker
the sibling just claimed — after the comment has already posted. The next tamper then comments
again. The guard that was meant to prevent this (`probeCache.get("__saw-violations")`) cannot:
`probeCache` is a fresh `Map` per invocation (`triggers.js:246`), so it only ever covered a single
run's own 409 retries. Observed directly — the marker is claimed ~3.6s after the tamper and is
sometimes gone by the time the spec reads it. Catches: `violation-dedup.spec.ts`, ~1 run in 3.

An ordering-only guard (ignore markers claimed after this run began) was written, tested and
**reverted**: it is correct as far as it goes, but a *delayed* redelivery starts after the claim,
so it did not move the failure rate. A real fix needs a design pass — most likely keying the
marker to the page version that caused the violation, rather than to a time window — and that does
not belong inside a security release.

**2. Two comments for one incident, via the documented no-CAS window.**
`claimViolationNotice` is a check-then-act (`kvs.get` then `kvs.set`) with no compare-and-swap.
Two near-simultaneous deliveries can both read null and both comment. The code says so in as many
words: *"KVS has no CAS — the tiny concurrent double-claim window is the same one T6 already
accepts."* `sealed-media-attrs.spec.ts` asserts "never ≥2 comments for one incident", which is
stricter than the implementation can guarantee, so it fails occasionally.

Together these are the residue of the incident-2026-07-22 comment-spam shape. They deserve their
own iteration, with the design-first and adversarial-review discipline that `triggers.js` changes
require.
