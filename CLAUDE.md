# Sentinel Vault — working notes

## Resolver authorization — read this before adding or editing a resolver action

Every action registered in `src/server/registry.js` is callable by **any logged-in user on the
installed site, with any payload they like**. `req.payload` is attacker-controlled; only
`req.context` is Forge-supplied. Meanwhile `readDocBody` / `writeDocBody` and friends run as
`asApp()`, which holds `read:confluence-content.all` + `write:confluence-content` across the whole
tenant. A payload-named `pageId` or `attachmentId` that reaches one of those unchecked is not a
missing UI control — it lends the app's site-wide authority to someone who has none.

**The rule: the caller must be able to do it themselves before the app does it for them.**
Use `src/server/shared/content-access.js`:

- `canEditPage(accountId, id)` — the bar for any app write to that content. **Unconditional on
  write paths.** Do not reach for the context shortcut here: holding a page id in context proves
  the caller can SEE the page, never that they may CHANGE it.
- `canReadPage(accountId, id)` — the bar for returning any of that content.
- `mustVerify(payloadId, contextId)` — **read paths only.** Skips the round-trip when the id came
  from context, which is authentic and already implied read access.
- `resolvePageSpaceKey(pageId)` — when authorizing by space, derive the space from the **page**.
  Never authorize against a payload `spaceKey` while acting on a payload `pageId`: that is two
  different objects, and it means administering any one space reaches the whole site. That
  confused-deputy shape was the single most common form of this bug in the audit.

Everything fails closed. Only an explicit `hasPermission: true` on a 2xx allows — an unresolvable
account returns 404, not `hasPermission: false`, so never decide from the response body alone.

This was found and fixed in `SECURITY-TODO.md` → SV-SEC-1 (closed 2026-08-20). It was systemic:
one reported symptom, ~25 more instances of the same shape. If you are touching a resolver, assume
the shape can recur and check for it rather than trusting that it was all caught.

Guards: `test/content-access.test.mjs` (pure decision core) and
`~/Projects/forge-live-harness/scenarios/sentinel-vault/authz-content-gate.spec.ts` (live, and the
assertions that matter are the REFUSALS — a happy-path test proves nothing about an authz fix).

## Harness identities

Specs that drive gated resolvers need **real** wolfaenpak accounts; a synthetic account id is
correctly refused now. Real ones available: Mihai `712020:937bc860-…`, Gabriela
`712020:2b9d007d-…`, LeanZero SRL `712020:cecf4c53-…`. Gabriela has no access to the private
`SVSEC1P` space, which is how the negative case is manufactured. Synthetic ids remain fine where
the path filters on the caller's own accountId and never touches content.

**Those three are all SITE admins** (`administer/application` — verified 2026-09-20), so the
steward gate's site-admin arm answers "steward" for them on EVERY space; no space permission can
make them plain editors. The one real, licensed, non-admin account is the second "Mihai Perdum"
(mihai@leanzero.net) **`712020:6c8dccca-a6b1-4c6f-903c-329094a1bac1`** (`PLAIN` in
`scenarios/sentinel-vault/_wf.ts`), a member of `confluence-users-wolfaenpak` only. The
**plain-editor bed is space `SVPLAIN`** (id 344162767): that group has read/create/update,
`administer` stays with confluence-admins-wolfaenpak, site-admins and Mihai — PLAIN can edit and
seal there and is refused every steward-only action. Drive PLAIN through the hook's `actor` seam
(no token, no browser session); `setupWorkflowPage(…, { space: PLAIN_SPACE })` builds a bed there.
The hook seam `pageEvent` runs the whole page-content pipeline as a named editor (the page version
itself is still authored by the harness token) — the closest thing to a non-privileged publish.

## Violation-comment dedup — the two races are closed (it69, 2026-09-06)

`SECURITY-TODO.md` "Known, pre-existing" records two races that made `violation-dedup.spec.ts`
and `sealed-media-attrs.spec.ts` fail about one run in three. Both are closed by two rules in
`src/server/shared/notice-dedup.js` (pure, unit-tested) that `triggers.js` calls: a clean save
re-arms the comment only when a USER authored the version read (the app's own restore never
does), and a claim is write → settle → re-read → announce only if this run's token still stands.
If you touch the marker code, keep both; the design and the timelines are in
`.claude/skills/sentinel-vault-quality-loop/state/DEDUP-RACES-DESIGN.md`.
