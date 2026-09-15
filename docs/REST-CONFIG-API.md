# Deploying Sentinel Vault configuration and content over REST

Design, 2026-09-15. Modelled on CogniRunner's Rules REST API (`docs/REST-API-RULES.md` and
`docs/LISTENERS-AND-JOBS.md#rules-rest-api` in that repo), adapted to one hard constraint that
CogniRunner does not have: **Sentinel Vault must stay eligible for "Runs on Atlassian".**

## The constraint that shapes everything

CogniRunner's endpoint is a Forge web trigger with `response.type: dynamic`. Forge's own rule:
only **static** web triggers are eligible for Runs on Atlassian, because a dynamic one can return
arbitrary data (egress). CogniRunner is not eligible today for that reason (its `forge eligibility`
says so). Sentinel Vault's production manifest has no web trigger at all, which is why it is eligible.

So the same two-way channel CogniRunner has (POST a config, GET it back as JSON) cannot be copied
verbatim. The design splits the channel:

| Direction | Mechanism | Why it keeps the badge |
|---|---|---|
| **Write** (deploy config, apply content ops) | A **static** web trigger `config-api`. The handler reads the request (method, headers, query, body) and returns one of a fixed set of outputs: `202 accepted`, `400 invalid`, `401 unauthorized`, `403 forbidden`, `409 conflict`, `429 busy`. No response body ever carries data. | A static trigger cannot egress anything the manifest did not already spell out. |
| **Read** (what is configured, what a job did) | Confluence's own REST API, with **the caller's** credentials, on properties Sentinel Vault writes: a **space property** `sentinel-vault-config` on every space it configures (the effective space config), a **content property** `sentinel-vault-config` on a designated site page for the global config, and a space property `sentinel-vault-receipt` holding the last job receipts for that space. | Confluence already exposes properties over REST; the app writes them with scopes it already holds (content properties) or the 7.0 batch (space properties). Confluence's own permission model governs who can read them. |

This is exactly the shape CogniRunner recommends for its *workflow* rules ("you are calling Jira's
API, not ours"): the customer uses Atlassian's REST for anything that returns data, and the app's
own endpoint only ever accepts.

## Authentication and authority

Tokens are minted in **Site settings → API access** (site admins only). Format `svt_` + 48 hex.
Only the SHA-256 hash is stored (`api-tokens` KVS row: id, name, prefix, hash, createdBy, role,
createdAt, lastUsedAt, revokedAt); the plaintext is shown once. Revocation writes a tombstone
first (`api-token-revoked:<id>`) so a revoke can never be lost to a racing mint. Comparison is
timing-safe. Bearer in `Authorization`, or `X-Api-Key`.

**A token acts as the account that minted it.** Every job runs each operation through the SAME
resolver the UI calls, with `context.accountId = token.createdBy`, so every existing gate
(`canEditPage`, `authorizeSteward`, `isOperatorSiteAdmin`, the SV-SEC-1 rules in CLAUDE.md) applies
unchanged. A REST caller can do nothing the minting admin cannot do in the UI. Roles narrow that:

| Role | May submit |
|---|---|
| `viewer` | nothing (reads are Confluence-side anyway); exists so a token can be minted for a read-only integration and later widened |
| `editor` | content operations (seal, unseal, section seals, classification of a page, workflow assign/transition) — each still gated per page as the minter |
| `admin` | everything above plus site and space configuration |

A token minted without a role is `admin` (CogniRunner's compatibility rule).

## The request

`POST <config-api url>?op=<operation>` with a JSON body. Operations:

| `op` | Body | What runs |
|---|---|---|
| `bundle` | `{ "version": 1, "site": {...}, "spaces": { "<KEY>": {...} }, "content": [ ... ] }` | The whole declarative bundle below, applied in order site → spaces → content. |
| `whoami` | — | Nothing is written; the receipt records the token identity. |
| `dry-run` | same as `bundle` | Validates and plans, writes only the receipt with `plan[]`. |

Every accepted request gets a **job id** (`job_<base36>`) which is returned in the `Location`
header of the static `202` output — the only per-request datum a static trigger can carry, because
headers on static outputs are fixed… so the job id is instead **derived from the request**: the
caller sends `Idempotency-Key: <their id>` and that IS the job id. Same key twice = same job, the
second submission is `409 conflict` while the first is running and `202` (no-op, receipt already
there) once it is done. Callers without the header get `400 invalid`.

Processing is asynchronous: the handler authenticates, validates, stores the job
(`api-job-<tokenId>:<key>`, TTL 7 days — the key is scoped to the token, so two tokens using the
same key get two independent jobs) and pushes it to the existing async queue infrastructure (`config-api-queue` consumer),
so a large bundle never hits the 25 s web-trigger limit. The consumer applies each operation and
writes the receipt.

## The bundle

```json
{
  "version": 1,
  "site": {
    "policy": { "defaultLockDuration": 172800, "allowAdminOverride": true, "ribbonMode": "exceptions" },
    "validation": { "enabled": true, "modes": { "advisory": true, "gate": true, "revert": false }, "rules": [] },
    "classification": { "levels": [ { "id": "public", "name": "Public", "color": "#15803D", "rank": 1 } ] },
    "notifications": { "enableEmailDispatches": false }
  },
  "spaces": {
    "WFH": {
      "policy": { "defaultLockDuration": 86400, "notificationsMode": "quiet" },
      "validation": { "enabled": true, "rules": [] },
      "workflows": [ { "workflowId": "review", "def": { ... }, "labels": ["policy"], "priority": 1 } ],
      "workflowSettings": { "approval": { ... } },
      "classificationDefault": "confidential",
      "spaceAdmins": { "users": ["712020:…"], "groups": ["confluence-admins"] }
    }
  },
  "content": [
    { "op": "seal-attachment", "pageId": "265912321", "attachmentId": "att265945089", "lockDuration": 86400, "note": "release freeze" },
    { "op": "unseal-attachment", "attachmentId": "att…", "reason": "release done" },
    { "op": "seal-section", "pageId": "…", "headingText": "Pricing" },
    { "op": "unseal-section", "sectionId": "…", "reason": "…" },
    { "op": "classify-page", "pageId": "…", "levelId": "restricted" },
    { "op": "assign-workflow", "pageId": "…", "workflowId": "review" },
    { "op": "transition", "pageId": "…", "toStateId": "approved", "reason": "…" }
  ]
}
```

Rules that make it safe to re-run:
- Every key is **upsert** semantics; omitted keys are untouched (a bundle is not a full replace).
  `"$replace": true` on a `workflows` or `rules` array replaces the set.
- `seal-attachment` on an already-sealed file by the same owner is a no-op success; by another owner
  it is refused exactly as the UI refuses it. `seal-section` by heading text refuses when the heading
  is already inside a sealed wrapper (F5 rule).
- Each op maps to ONE existing resolver key; the consumer never touches KVS directly for content.
- Payload sizes: bundle ≤ 256 KB, `content` ≤ 200 ops. Larger is `400 invalid`.

## The receipt (the read side)

After the consumer finishes, `api-job-<tokenId>:<key>` holds:

```json
{ "id": "…", "status": "done|partial|failed|running", "submittedBy": "712020:…", "role": "admin",
  "startedAt": "…", "finishedAt": "…", "summary": { "applied": 14, "refused": 1, "failed": 0 },
  "results": [ { "path": "spaces.WFH.policy", "status": "applied" }, { "path": "content[3]", "status": "refused", "reason": "You do not have permission to edit this page" } ] }
```

It is mirrored to the **space property** `sentinel-vault-receipt` on every space the job touched
(last 20 receipts per space, newest first) and to the **content property** `sentinel-vault-receipt`
on the site page named in `site.receiptPageId` (optional). The customer reads it with:

```bash
curl -u "$EMAIL:$TOKEN" "$SITE/wiki/api/v2/spaces/$SPACE_ID/properties?key=sentinel-vault-receipt"
```

The `sentinel-vault-config` property (space property per configured space; content property on
the receipt page for the site) is written on every config write from the UI or the API, but it
carries only the **public part** of the effective config — a space property is readable by every
viewer of the space, and the site property by every reader of the receipt page, so nothing the
app's own resolvers withhold from non-stewards lands there. The mirror holds:

- `policy` — durations and toggles, **without** `adminUsers` / `adminGroups`;
- `validation` — `{ enabled, modes }` only (rule text and `ai` prompts stay private);
- `workflows` — `[ { workflowId, name, labels, priority } ]`, no definitions; `classificationDefault`;
- site: `classification.levels` (the public level list).

`spaceAdmins`, `workflowSettings` (approver rosters, entry conditions) and `validation.ai` are never
mirrored. The **full** export — the shape that can be edited and POSTed back as a bundle — is the
gated `export-space-config` (steward of that space) / `export-site-config` (site admin) resolver,
i.e. the Export button in the console.

## What stays in the UI

- Token minting/revocation and the endpoint URL (Site settings → API access), with the recipe.
- A "Recent API jobs" list in the same tab (last 50 receipts site-wide, from KVS).

## Limits and failure modes

- One job at a time per token (`429 busy` when a job by the same token is still running).
- The static trigger cannot say *why* a request was refused beyond the status; the reason is in the
  receipt (for `403`/`409` a receipt is still written with `status: "refused"` when the token is
  valid). `401` writes nothing.
- Idempotency keys are kept 7 days.
- Content properties need `write:content.property:confluence` (granted); space properties need
  `write:space:confluence` (in the 7.0 batch — until then the space mirror logs a 403 and the receipt
  is readable only via the site receipt page and the UI).

## Why not a dynamic trigger behind a feature flag

Eligibility is evaluated on the manifest, not on runtime behaviour. A dynamic trigger present but
unused still disqualifies the app. Static is the only shape that keeps the badge.

## Implementation notes (server, 2026-09-15)

Code: `src/server/capsules/config-api/` — `tokens-core.js` (pure store, CogniRunner mirror),
`tokens.js` (KVS binding), `bundle.js` (`validateBundle` / `planBundle`, pure), `admission.js`
(`decideAdmission`, pure), `pure.js` (consumer/mirror helpers, pure), `trigger.js` (the static
web trigger), `consumer.js` (the queue consumer), `resolvers.js` (handler lookup by key),
`export.js` (`exportSpaceConfig` / `exportSiteConfig`), `mirror.js` (property mirrors),
`actions.js` (the resolvers). Unit guard: `test/config-api.test.mjs`. Live guard:
`forge-live-harness/scenarios/sentinel-vault/config-api.spec.ts`.

**Static trigger request access — settled empirically on dev (2026-09-15).** The handler of a
`response.type: static` web trigger receives the request exactly as a dynamic one does:
`method`, `headers`, `queryParameters`, `body` (a string), `path`, `context`. Only the
response is fixed. Log line: `[CONFIG-API] request-shape method=POST
keys=method,call,headers,queryParameters,body,path,userPath,context,contextToken
hasBody=true bodyType=string`. So the body carries the bundle and `Idempotency-Key` is a
header. `?op=` and `?idempotency-key=` remain as query alternatives; the body is the only
carrier of the bundle (the `?b=` base64 fallback was removed once the body was proven to arrive).

**Shapes the implementation fixed:**
- `$replace` on an array: JSON arrays cannot carry a flag, so the object form is
  `"workflows": { "$replace": true, "items": [ ... ] }` (same for `validation.rules`). A bare
  array is merged: workflows by `workflowId`, rules by `id`. Validation configs are upserted
  (shallow overlay, `modes` merged) because `store-validation-config` replaces the row.
- `spaces.<KEY>.spaceAdmins` maps to `store-policy` (scope space) with `adminUsers` /
  `adminGroups` — that is the row the UI writes and the gate (A1) it goes through.
- `seal-attachment` on a file the minter already holds (unexpired) is recorded as
  `applied` with reason `already sealed by you — no-op`; the expiry is not touched. The check
  reads through `enumerate-page-seals`, never KVS.
- `whoami` is open to any live token (viewer included); `bundle` / `dry-run` need `editor`
  for content-only bundles and `admin` as soon as `site` or `spaces` is non-empty.
- A `403` (role) still writes `api-job-<tokenId>:<key>` with `status: "refused"` and the reason;
  a later POST with the same key is a `202` no-op, so pick a new key after fixing the token.
- Check order: method → token → the minter is still a site admin (else `401`, `whoami` included)
  → op / key shape → admission (`409` / `429`, settled key = `202` no-op) → role (`403`) →
  bundle validation (`400`). Role before validation, so an under-privileged token cannot use
  `400` as a validation oracle for config it may not submit.
- `429 busy` is judged from `api-active-<tokenId>` (15-minute TTL) and only while that job is
  still queued/running. A job left `running` for longer than the consumer timeout (300 s) is
  reclaimed: the next POST with its key, or the consumer, settles it as `failed` with reason
  `consumer timed out; resubmit with a new Idempotency-Key`, and it no longer counts as busy.
- Two submissions racing on one key: the row is written only if absent and re-read; the loser
  (its nonce did not land) answers `409` and queues nothing.
- `site.receiptPageId` is honoured only if the minter can edit that page; otherwise the receipt
  carries a `skipped` result for `site.receiptPageId` and nothing is mirrored onto it.
- The consumer never forges a page/space context from the payload: every resolver derives the
  space from the object it acts on (`seal-artifact` from the attachment's page, after its own
  edit gate).
- The receipt row drops the stored bundle when the job settles; `plan[]` stays.
- Space properties: `write:space:confluence` IS consented on the dev install (major 7), so
  both `sentinel-vault-receipt` and `sentinel-vault-config` land on the space (verified over
  v2 REST with a plain Confluence API token).
- The endpoint URL on dev: `forge webtrigger create -f config-api -s wolfaenpak.atlassian.net
  -p Confluence -e development`; the UI reads it via `webTrigger.getUrl("config-api")`, cached
  in KVS `webtrigger-url:config-api`.

**No user session in the consumer.** Resolvers invoked from the queue run with
`context.accountId = token.createdBy` but no `asUser()` session. `isOperatorSiteAdmin` now
asks the same question as the app (naming the same subject — `isAccountStewardAsApp`'s arm 2)
when the user call fails, and the metadata reads in `seal-artifact` / `seal-section` /
workflow `actorName` go through `shared/user-or-app.js`. Authorization still goes through
`content-access.js` / `steward-checks.js` — nothing new is granted.

The `sentinel-vault-config` mirror is refreshed after an API apply and after every config write
from the UI (`refreshConfigMirror`, registry.js), always through `redactConfigForMirror`.

**Runs on Atlassian:** `forge eligibility -e development` reports "a webtrigger module that
can egress data" — the dev environment also carries the DYNAMIC `harness-test-state` trigger,
so the static one cannot be proven eligible from dev. Verify on staging/production, where only
`config-api` exists.
