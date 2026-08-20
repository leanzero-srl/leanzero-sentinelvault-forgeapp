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

## Open, pre-existing

Two violation-**comment** dedup races in `triggers.js` — details and evidence in
`SECURITY-TODO.md`. They make `violation-dedup.spec.ts` and `sealed-media-attrs.spec.ts` fail
intermittently. Protection itself is unaffected; the restore happens every time.
