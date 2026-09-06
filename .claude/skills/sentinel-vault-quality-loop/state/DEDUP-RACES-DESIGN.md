# it69 — the two violation-comment dedup races (SECURITY-TODO "Known, pre-existing")

Owner: "continue with the fixes you mentioned" (2026-09-06), after the it68 suite hit the races in
two of three runs of batch 2 (`violation-dedup.spec.ts`, `sealed-media-attrs.spec.ts`).

## What the marker is for

`violation-noticed-{pageId}-{targetId}-{class}` (TTL 24h) stands for "the owner has been told about
this incident on this target". It is claimed BEFORE the footer comment and cleared by a CLEAN save
so the next genuine tamper comments afresh. Protection (the restore) never depends on it.

## Race 1 — a late duplicate delivery clears the marker it did not claim

Forge delivers `updated:page` at least once. Timeline: A reads the tampered v5, restores → v6
(written as the app), claims the marker, comments. B is a delayed redelivery of the SAME tamper
event: it reads v6 — clean — and, never having seen a violation, runs the clean-save clear. The
marker A just claimed is gone; the next tamper comments again.

The in-run guard (`probeCache.__saw-violations`) covers only a twin that lost the 409 race inside
one invocation. An ordering guard was tried in SV-SEC-1 and reverted (a delayed redelivery starts
after the claim).

**Rule:** a clean save re-arms the comment only when a USER made that save. The v2 page read
carries `version.authorId`; when it equals the app's own account the run is reading the app's
restore, and there is nothing to re-arm. `decideClear({sawViolations, readAuthorId, appAccountId})`
in `shared/notice-dedup.js`; both surfaces (media + section) go through it. Unknown author or
unresolved app account keep the pre-it69 behaviour (clear) rather than disabling re-arm forever.

Why the version author and not the version number: the event's version is the tamper; the read may
legitimately be a LATER user save (clean) that must clear. Authorship separates "the app's fix" from
"someone's clean save" regardless of how many versions have gone by.

## Race 2 — two comments for one incident (no compare-and-swap)

`claimViolationNotice` was `get` then `set`. Two deliveries in lockstep both read null and both
post. **Rule:** the marker carries a per-outcome claim token. Write, wait `CLAIM_SETTLE_MS` (400),
re-read, `confirmClaim`: `held` → announce; `lost` (another token) → silent, release nothing;
`clobbered` (a sibling OUTCOME's writer overwrote the key — the F2 delete/content-removal pair) →
merge our outcome back beside theirs and confirm once more, so a materially different message is
never lost to the token. The residual window is a claimer whose own get→set stalls longer than the
settle interval.

Cost: +400–800 ms and one or two KVS gets per comment actually posted; nothing on the swallowed path.

## What must not change

- Restores happen every time; only the comment is deduped.
- F2: `delete` + `content-removal` on one key both announce, once each.
- A failed post releases only its own outcome (`decideRelease` now also drops its claim token).
- Pre-F2 markers (no outcome list) keep blocking; markers without `claims` confirm as `clobbered`
  and are merged, never dropped.

## Proof

Unit: `test/notice-dedup.test.mjs` (60 assertions, both races in isolation). Live: the two specs
above, run repeatedly on the deployed build — see SKILL.md it69 for the counts.
