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

Processing is asynchronous: the handler validates, authenticates, stores the job (`api-job-<id>`,
TTL 7 days) and pushes it to the existing async queue infrastructure (`config-api-queue` consumer),
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

After the consumer finishes, `api-job-<id>` holds:

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

The effective configuration is mirrored the same way (`sentinel-vault-config`, written on every
config write from the UI or the API), so **export** is a Confluence GET, and a config can be
version-controlled by reading it, editing it and POSTing it back as a bundle.

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
