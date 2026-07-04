# Sentinel Vault — Forge Capabilities: used today vs available

AQL reference. Ground truth from `manifest.yml`, `src/boot.js`, `src/server/*` (map phase,
2026-07-05). Platform statuses marked **[verified 2026-07-05]** were checked against current Forge
docs during this map; items marked **[verify]** are from training knowledge and must be re-checked
against developer.atlassian.com before an iteration relies on them.

App: `ari:cloud:ecosystem::app/c30bf71e-4287-4872-954d-db49cc68f0ff`, runtime `nodejs22.x`,
Custom UI resources. **Zero egress** (no `external` block at all) → Runs on Atlassian eligible.
Any external fetch/image/script/style addition breaks that eligibility — treat egress as forbidden.

---

## 1. Capabilities USED today

| Capability | Where | Status / gotchas |
|---|---|---|
| Forge LLMs (`llm` module) | `sentinel-vault-llm`, model `claude` | **Preview** [verified 2026-07-05]. Adding it caused a major-version bump + admin re-consent |
| Macro (block) | `sentinel-vault-panel` (inline panel) | Config resource `panel-setup-ui`, openOnInsert false, viewport medium |
| Macro (**bodied**) | `sentinel-vault-sealed-section` | The content-sealing primitive: wraps user content, carries stable app-issued `sectionId`; openOnInsert true |
| `confluence:pageBanner` | `sentinel-vault-ribbon` (doc-ribbon) | Polls `check-seal-stamp` every 5s |
| `confluence:globalSettings` | `steward-console` | Site-admin console |
| `confluence:spacePage` | `realm-console` | NOT spaceSettings; space-admin gating is app-side, no manifest condition |
| Product event triggers ×3 | `attachment-events` (updated/trashed/deleted:attachment), `page-content-events` (updated/created:page), `app-lifecycle-events` (installed/uninstalled:app) | **No `filter` expressions, no `ignoreSelf` anywhere** — see §3.1 |
| Scheduled triggers ×3 | `expiry-sweep-scheduled` (hour), `seal-index-cron` (hour), `recurring-nudge-scheduled` (day) | `halfway-check-task` function is declared but wired to no trigger (kept as no-op) |
| Async events / queues (`@forge/events`) ×2 | `realm-audit-queue` (900s timeout), `ai-validation-queue` (120s) | AI validation queued because LLM call exceeds the 25s resolver limit |
| KVS (`storage:app`) | Entire data model (`protection-*`, `section-protection-*`, grants, findings, settings — see CORE_CONTRACT) | Plain untyped KVS + prefix queries; **no custom entities/indexes**. Uses KVS TTLs (grants self-expire at seal expiry) |
| Content properties | `protection-`, `section-protection-`, `sentinel-vault-validation`, `sentinel-vault-page-settings` | CQL-able mirror + trigger fast-path probes (core contract C12/C13) |
| Web trigger | `harness-test-state` | DEV-ONLY (404 without `HARNESS_SECRET`); reads/writes KVS, invokes `expirySweep` for the harness |
| Resolver | One shared `action-router` for ALL surfaces | 10 capsules' actions + `heartbeat` |
| Custom UI + `view.theme.enable()` | All 7 surfaces | `permissions.content.styles: [unsafe-inline]` |
| Confluence REST (asApp/asUser) | v1 + v2 mix | 31 scopes; scope additions ⇒ major version bump ⇒ admin re-approval |

Modules NOT present: content actions, byline items, contextMenu, spaceSettings, globalPage,
homepageFeed, Jira anything.

---

## 2. Capabilities AVAILABLE but unused — what each could unlock here

Ordered by correctness/architecture leverage, not effort.

### 2.1 `@forge/realtime` — kill the polling

**Status: Preview [verify — current docs show it live, incl. an official "LLM long-running process
with Forge realtime" pattern].**
Today every open page runs up to THREE concurrent 5s pollers of `check-seal-stamp` (ribbon +
inline panel + overlay), and AI review polls `get-validation-job`. Realtime pub/sub would let
`touchSealTimestamp` publish a seal-stamp event and `aiValidationConsumer` publish job completion;
ribbon/panel/overlay subscribe (`signRealtimeToken` resolver + client subscribe). Unlocks: instant
cross-surface sync, removal of the triple-poller cost, push-driven AI results. Caution: Preview
deprecation windows; keep a degraded polling fallback; module/manifest addition may require
re-consent [verify].

### 2.2 Custom entities (Forge storage entities + indexed queries)

**Status: GA [verify].** All listing today is prefix-scan over untyped KVS:
`enumerate-operator-seals` does a full instance scan (≤10×100) then client-side filters;
`expirySweepTask` scans `protection-*` with limit 100 and **no cursor loop** (silent truncation risk
past 100 seals); realm indexes are hand-maintained secondary keys (`space-protection-{spaceId}-*`)
rebuilt by a cron. Entities with indexes on `lockedBy`, `spaceId`, `expiresAt` would replace all
three patterns with real queries (owner listing, space listing, "expiring before X" sweep).
Caution: this rewires core-contract C11 key patterns — a migration for existing installs is
mandatory, and the harness `kvs` hooks + uninstall cleanup + cron change-gate all read the current
keys. Confidence in the win is high; confidence in a safe migration without a dual-read period is
low — flag for explicit design.

### 2.3 Trigger `filter.expression` — and why `ignoreSelf` is NOT an option

**[verified 2026-07-05]:** `ignoreSelf` **currently only works with Jira events** — for this
Confluence app it does nothing. The in-code loop guard (cached `app-account-id` compare, core
contract C1, fail-closed) is the only self-event suppression available and MUST stay. Do not let a
future iteration "simplify" it away in favor of the manifest flag.
`filter.expression` is documented primarily around Jira entity properties; whether useful
expressions exist for `avi:confluence:*` events needs verification [verify]. If supported, an
expression could pre-filter attachment events without an id, but the current single-KVS-get bail-out
(C13) is already cheap — low expected value.

### 2.4 `confluence:contentAction` — page ••• menu entry

Unlocks "Manage sealed attachments" / "Seal a section" from the page actions menu without needing
the ribbon or an inserted macro — a discoverability win on pages where the banner is toggled off.
Opens the existing overlay resource.

### 2.5 `confluence:contentBylineItem` — byline status chip

A per-page byline item ("3 sealed · validation passed") with an inline dialog. Lighter-weight
alternative surface to the pageBanner for status display; could carry the validation/AI chips so the
banner stays purely alert-focused.

### 2.6 `confluence:contextMenu` — seal from selection

Context menu on selected page text → "Seal this section": maps selection to its heading and calls
the existing `seal-section` flow. Natural entry point for Content Sealing (today buried in the
panel's Sealed Sections group). Needs verification that the module provides enough selection context
to resolve the heading [verify].

### 2.7 `confluence:spaceSettings` vs current `spacePage`

Moving realm-console under Space Settings proper would put it where admins expect it and lean on
placement-level gating instead of the current app-side-only "visible to space admins" enforcement
(manifest comment admits gating is app-side). Counterpoint: regular users use the "My Sealed Files"
tab today — a spaceSettings placement would hide it from them; likely outcome is BOTH (spaceSettings
for steward tabs, keep a user-facing surface). Flag as product decision.

### 2.8 `confluence:globalPage` — cross-space "My Sealed Files" hub

`enumerate-operator-seals` (all seals owned by caller instance-wide) already exists as a resolver
but is only reachable per-space. A globalPage would give users one place to see/relinquish
everything they hold. Backend is ready; this is purely a new surface.

### 2.9 `confluence:homepageFeed` — expiring-seals feed

Feed cards on Confluence Home: "Your seal on X expires in 2h". Pairs with the expiry sweep's
existing dedup keys. Module availability/status [verify].

### 2.10 Async events `delayInSeconds` — short-fuse scheduling only

Queue push supports delayed delivery but the cap is short (~15 min per training knowledge
[verify]) — NOT usable for "fire exactly at seal expiry" (hours). The hourly sweep + lazy expiry
(C10) remains the right architecture; delay is only interesting for retry/backoff choreography.

### 2.11 Production web trigger — inbound integration surface

The webtrigger capability is proven (dev harness endpoint). A prod webtrigger could accept inbound
automation (e.g. CI pipeline seals released docs). Inbound HTTP does not break Runs on Atlassian
(egress is what matters), but it adds an authn surface — would need its own shared-secret/signature
scheme. Product decision, off by default.

### 2.12 Forge LLM `stream()` + tool use

**[verified 2026-07-05]:** current `@forge/llm` exposes `list/chat/stream` and function-tool
definitions. The app uses `chat` with JSON-mode-via-system-message + salvage parsing only.
`stream()` could unlock progressive AI-review UX (findings appearing as generated — pairs with
2.1's realtime pattern, which Atlassian documents together). Tool use could replace the fragile
JSON-salvage layer with a schema-enforced function call. Caution: keep the Haiku-only clamp (C14)
and the fail-closed parse behavior; do not let streaming bypass `normalizeFindings`.

### Explicit NON-candidates

- **Any `external` permission / remote fetch / BYOK AI** — destroys Runs on Atlassian eligibility
  (the app's headline compliance property and the reason AI runs through the `llm` module).
- **Jira modules** — out of scope for this product.

---

## 3. Approval / versioning constraints (read before adding ANY capability)

1. **Major-version bumps require admin re-approval on every install.** Empirically: adding the
   `llm` module bumped major and forced re-consent. New scopes do the same. Budget for the consent
   round-trip on wolfaenpak.atlassian.net (dev) and treat Marketplace installs as blocked until
   admins act.
2. **Preview capabilities** (Forge LLMs [verified]; likely `@forge/realtime` [verify]) are
   production-permitted for early adopters but carry shorter deprecation windows — pin exact
   behavior in the harness so platform changes surface as test failures, not user reports.
3. **Egress additions** additionally change the Marketplace privacy/security posture — forbidden
   here (see NON-candidates).
4. **`ignoreSelf` is Jira-only** — repeated because it is the likeliest future footgun for this
   Confluence app's loop-guard contract (C1).
