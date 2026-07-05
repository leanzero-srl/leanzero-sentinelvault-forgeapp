---
name: sentinel-vault-quality-loop
description: Per-app App Quality Loop (AQL) skill for Sentinel Vault (Confluence Forge content-protection app on wolfaenpak.atlassian.net). Use whenever running the AQL loop on this repo (map/next/run/status/design/verify), deploying this app, driving its test harness, or making any UI/feature change here. Holds the tuned config, core contract, brand tokens, harness recipes, feature ledger, and iteration history. Living skill — update the changelog and state every iteration.
---

# Sentinel Vault — AQL per-app skill

App repo: `/Users/mihaiperdum/Projects/Sentinel Vault` (**path contains a space — always quote it in shell**).
App ID `c30bf71e-4287-4872-954d-db49cc68f0ff` · dev site **wolfaenpak.atlassian.net** (Confluence) · dev install `09797ffe-…5e1f` (v5, up-to-date) · prod install `a04a7780-…87a2` (v2, outdated — do NOT touch prod in the loop).
Git remote exists (`origin`); branches `main` + working branches. Loop branches: `aql/<feature>-<desc>`.

## Config (source of truth — tune here every iteration)

```yaml
app_name: sentinel-vault
repo_path: /Users/mihaiperdum/Projects/Sentinel Vault

profiles:
  platform: forge
  brand:
    id: leanzero
    live_site: https://leanzero.atlascrafted.com     # leanzero.net is an unrelated placeholder — never reference it
    theme_paths:
      - src/ui/tokens/foundation.css                 # + per-surface token css in src/ui/tokens/
    canonical_brand_doc: ~/.claude/skills/leanzero-management/references/brand.md   # exact palette/type/motion
  domain_packs: [doc-workflow]                       # authored for this app (capability expansion); no gantt pack here

harness:
  grade_cmd:   bash .claude/skills/sentinel-vault-quality-loop/scripts/grade.sh
  deploy_cmd:  forge deploy -e development
  install_cmd: forge install --upgrade --non-interactive   # ONLY needed when manifest scopes/modules change (major bump ⇒ re-consent)
  serve_cmd:   forge tunnel
  lint_cmd:    npm run lint && forge lint

priority_weights:
  impact: 3
  current_score_gap: 3
  effort: -1
  risk: -1
  domain_pack_boost: 2      # doc-workflow (workflow rules) candidates get this — owner directive 2026-07-05

quality_gates:
  frame_budget_ms_max: 16
  interaction_fps_min: 60
  heavy_recompute_ms_max: 400     # ADF canonicalize/hash/surgery + restore path on a large page
  large_dataset_size: 200         # attachments on one page / sealed sections per page render+interact target
  visual_regression_tolerance: low
  a11y: wcag_AA
  reduced_motion: required

adversarial_rounds:
  default: 1
  core_touching_or_perf: 3

max_iter: 12
```

## Operating facts (verified 2026-07-05, map phase)

- Forge CLI logged in as mihai@wolfaenpak.com; `forge lint` clean; root unit tests 65/65 (`npm test`: json-salvage 11, rules-engine 15, doc-surgery 19, validations-logic 20).
- `test-harness/.env` exists (SV_EMAIL/SV_TOKEN/SV_BASE/SV_PAGE_ID/SV_SPACE_KEY); `npm run health` authenticates OK.
- **Frontend must be rebuilt after any UI/CSS change**: `npm run build` (webpack → `static/*`). Forge serves the built bundles, not `src/ui`.
- Dev-gated test hooks: `_testState` webtrigger + `invoke(expirySweep)` (see `src/test-hook.js`) — the harness drives real backend tiers with these.
- Screenshot harness: `static/_screenshot-harness/` (capture.mjs/driver.mjs, output in shots-png/ and clips/) — use for visual baselines and regression.

## MANDATORY rules (owner-set — no exceptions)

- **Qualitative UX review on EVERY UI change** (owner directive — the CogniRunner lesson): passing tests + a11y + code-review is NOT enough. In the verify phase of any UI iteration, render the change in context (light+dark), LOOK at it as a naive user, AND spawn a fresh-eyes "naive user" reviewer over the screenshots asking "does this make sense? is anything confusing/cluttered? is it usable end-to-end from the UI?". Act on genuine confusion (rename, disambiguate, remove clutter, defer half-built surfaces) — do NOT add motion/polish for its own sake; restraint (removing/simplifying) is often the right tweak. A green loop that quietly makes the app more confusing is the failure mode to avoid.

- **Git identity**: every commit uses `leanzero-srl <office@leanzero.net>` as BOTH author AND committer (set `GIT_AUTHOR_*` and `GIT_COMMITTER_*` env vars per command; never edit git config). NO `Co-Authored-By` trailers. Verify with `git log -1 --format=fuller`.
- **UI hard rules**: no left accent rails/stripes ever; no faded/washed tints — solid saturated accents only; no native browser primitives (alert/confirm/prompt/`<select>`) — use the app's own dialog/dropdown primitives; avoid the AI-default looks (cream+serif+terracotta `#D97757`, near-black+acid-green, broadsheet hairlines).
- **Core contract is inviolable** (reference/CORE_CONTRACT.md): change around it, never through it. Adapters over rewrites.
- **AQL invariants**: WIP=1; evidence over vibes (live harness run before "verified"); adversarial pass on research, design, and verification; small reviewable diffs; ledger updated every phase.
- Loop never touches the production environment/install.

## Structure

- `reference/` — CORE_CONTRACT.md · APP_MAP.md · DESIGN_TOKENS.md · CAPABILITIES.md
- `state/` — FEATURE_LEDGER.md (the loop's memory) · CAPABILITY_EXPANSION.md (doc-workflow candidates) · iterations/<n>-<feature>.md
- `scripts/` — grade.sh (harness composite) · deploy-and-grade.sh (build+deploy+install-if-needed+grade)
- `workflows/` — saved dynamic-workflow recipes + adversary lenses that caught real issues

## Deep E2E (verify phase, core-touching changes)

`~/Projects/forge-live-harness` has 10 Playwright specs under `scenarios/sentinel-vault/` (gate-revert, revert-destructive, sealed-media, sealed-section, sealed-artifact-trash, expiry-sweep, validation×2, realm, admin-render) — REST+testhook driven, no browser session needed:
```bash
cd ~/Projects/forge-live-harness && npx playwright test scenarios/sentinel-vault --project=chromium
```
Hook plumbing lives in that repo's `.env`: `SENTINEL_TESTHOOK_URL` + `HARNESS_SECRET` (the local `test-harness/scripts/ensure-fixture.mjs` falls back to it). Specs seed state via `testhook/client.ts` (`what=set/kvs/delete`) and use `data/confluence.mjs` + `waitForTerminal` — copy those conventions for new specs.

## Changelog (append every iteration — living skill)

- **2026-07-05 (iteration 5 — #43 approval engine + qualitative UX pass · branch `aql/workflow-state-engine`)** — Multi-approver transition engine (`workflow/approvals.js`: any/all/min-N; gates the enforce state; approval-e2e 11/11). Adversarial review found+fixed 7 real defects (unit 47/47, grade PASS). BACKEND-ONLY correctness LEARNINGS: (1) **`kvs.query()` is EVENTUALLY consistent — NEVER use it to read a record you just `kvs.set()`**; per-key `get`/`delete` over a known id list (stored `pending.approvers`) is strongly consistent. Query-after-set caused a stuck-pending single-approver bug AND an empty-set→approved bug. (2) Resolve authz/space from the SERVER-OWNED record (`readPageWorkflow().spaceKey`), never a caller payload — a payload `spaceKey` let a steward of space X drive a transition on space Y's page. (3) A green E2E does NOT prove concurrency/consistency — the review caught what 11/11 live checks couldn't. **QUALITATIVE UX PASS (owner directive):** ran a naive-user review over the actual screenshots — it found real confusion no code gate caught: the workflow chip "In Review" collided with the "AI review" chip (two "review"s), the chip didn't look clickable, "Auto-assign" misread as assigning to a person, and a "workflow builder is planned" teaser read as a leaked dev note. FIXED: workflow chip gained a flag icon (reads as a state control) + AI chip → "AI check" (kills the collision); "Auto-start workflow on new pages"; teaser removed. See the new MANDATORY qualitative-UX rule above. #43 backend done; inbox + approver-picker UI + notifications = iteration 6 (MUST land before approvals are user-reachable). 
- **2026-07-05 (iteration 4 — #42 config UI + bulk apply · #42 COMPLETE · branch `aql/workflow-state-engine`)** — Steward realm-console "Workflow" tab (`WorkflowSettingsEditor` kit mirroring `ValidationsEditor`) + `bulk-assign-workflow`; matches the app in light+dark (screenshots). Full grade PASS (10 suites). LEARNINGS: (1) **a too-small E2E fixture silently skips the pagination branch** — a HIGH bulk-cursor bug (kit dropped `nextCursor`, so "Apply to existing" never passed page 25) sailed through a 3-page throwaway-space E2E because `capped` was never true; the adversarial review caught it. Verify pagination with either a >page-size fixture OR a stateful-mock UI test asserting the cursor is threaded (`scratchpad/bulk-cursor.mjs`: instrument the mock with `window.__bulkCalls`, click twice, assert call[1].cursor). (2) **Bulk ops pollute the shared dev space** — the first bulk E2E assigned workflows to 25 real WFH pages; ALWAYS test bulk in a dedicated throwaway space (`POST /rest/api/space` → use → `DELETE /rest/api/space/{key}` returns 202; a fresh space has 1 Home page). (3) To match the app, mirror `ValidationsEditor` exactly (self-contained kit, `SettingsRow`/`Toggle`/`settings-panel`/`btn-primary`/`action-bar`, mounted as a `userRole`-gated tab excluded from the generic save-bar) — the shared config classes are duplicated in each console's CSS, so a kit only needs to add its own novel styles (`.wf-state-*`). (4) Shared-kit a11y gaps (Toggle needs `aria-label`; status banner needs `role=status aria-live`) — fix across ALL consumers at once (both editors) for consistency. **The Comala-style workflow-rules capability the owner asked for is now shipped end-to-end (it1 engine → it2 chip/transitions → it3 auto-assign → it4 config UI + bulk).** Next: #43 multi-approver transitions.
- **2026-07-05 (iteration 3 — #42 at-scale auto-assign · branch `aql/workflow-state-engine`)** — Per-space `workflow-settings-{key}` + a create-only auto-assign pass in `pageContentTrigger` (new pages in an enabled space auto-get a workflow; workflow-autoassign-e2e 8/8, full grade PASS). 3-lens adversarial trigger-safety review (loop/ordering/concurrency, Opus 4.8). LEARNINGS: (1) **any triggers.js pass that writes a no-TTL/compliance record MUST claim a dedup marker BEFORE side effects** (the T6/`markVersionChecked` pattern) — check-then-act on a record written late leaves a concurrent double-fire window, and Forge events are at-least-once; fixed auto-assign with a `workflow-autoassigned-{pageId}` claim. (2) `pageContentTrigger` fires on BOTH created AND updated:page — gate event-specific behavior on `event.eventType` (destructured in the artifact trigger; `.includes("created")`), don't assume create-only. (3) The **3-lens trigger review recipe** (loop-safety / ordering-isolation / gating-concurrency, each finding independently verified) is the right shape for ANY triggers.js change — reuse it for #44's enforcement surgery (same file, higher stakes: a wrong branch destroys user content). (4) CORE_CONTRACT T4's KVS-budget is scoped to seal passes; a per-save point-get for a config-gated feature is within budget (the contract already blesses the validation body-read). Next: iteration 4 = #42 config UI (realm-console "Workflow" tab, mirror ValidationsEditor) + bulk apply, then #42→verified, then #43.
- **2026-07-05 (iteration 2 — #42 workflow chip + transition UI · branch `aql/workflow-state-engine`)** — Doc-ribbon now shows the page's workflow state as a solid branded chip + a keyboard-accessible custom transition menu; full grade PASS, zero regression. LEARNINGS: (1) **the screenshot-mock bridge returns data regardless of args → it MASKS null-arg bugs.** A real regression (renamed `pageId`→`ctxPageId` but left 3 call-sites reading the null `pageId` state) rendered fine in the mock and passed the visual + grade; only the adversarial CODE review caught it. → Run the parallel adversarial review (brand/a11y/correctness/motion, each finding verified) on EVERY UI change; don't trust screenshots + grade alone. (2) `role="menu"`/`menuitem` is a CONTRACT — it promises arrow-key roving focus + roving tabindex + focus-on-open + focus-return; shipping it with only a click handler is a real SR defect. The correct pattern (Arrow/Home/End roving, `tabIndex` 0-on-active/-1-else, focus first item on open, return focus to trigger on Escape AND selection, `focusin` outside-close, `aria-label`) is now proven here (menu-a11y 13/13) and should seed a shared kit `Menu` primitive to consolidate the app's 5 mouse-only dropdowns. (3) Verify keyboard a11y with a scripted Playwright pass (`scratchpad/menu-a11y.mjs` pattern: focus, press keys, assert `document.activeElement`), not by eye. (4) doc-ribbon.css previously lacked a `prefers-reduced-motion` guard (§5.3) — adding chip motion closed it. Next: iteration 3 = #42 config UI + at-scale assignment, then #43.
- **2026-07-05 (iteration 1 — #42 workflow state engine · branch `aql/workflow-state-engine`)** — Shipped the workflow-rules FOUNDATION: new `workflow` capsule (state machine + KVS storage + 6 resolvers), verified live (workflow-e2e 13/13, full grade PASS, zero regression). KNOB-TURNING LEARNINGS: (1) **new resolver actions need NO manifest change** — they route through the existing `action-router` fn and use held `storage:app`; `forge deploy` only, no re-consent (huge: keeps iterations fast). (2) KVS cursor gotcha: **never call `.query().cursor(undefined)`** — it 500s "request body invalid"; first query must be cursorless, add `.cursor(nextCursor)` only on later pages (use `WhereConditions.beginsWith`, cap iterations) — see `editreq/actions.js:154` as the canonical pattern. (3) Verify UI-only resolver logic live by extending the dev test-hook `invoke` dispatcher (`fn=assignWorkflow|transitionWorkflow|getWorkflow`) — REST can't call resolvers, but the hook can drive the real logic fns with explicit args (mirrors the 74a0911 expirySweep precedent); structure capsules as authz-free `logic.js` + thin `actions.js` so both unit tests and the hook hit the real storage paths. (4) **Storage decision: KVS hand-rolled index over Custom Entity Store** — matches every sibling capsule (`space-protection-*` is the same pattern), avoids a novel primitive + manifest change; migration stays available via a scan-worker rebuild. (5) Runs-on-Atlassian eligibility flags the harness webtrigger ("can egress") — pre-existing (commit 12e86af), stripped for prod; workflow capsule itself is egress-free. Next: continue #42 (doc-ribbon chip + steward config UI) before #43.
- **2026-07-05 (map complete + capability expansion)** — Map workflow finished: 41-row FEATURE_LEDGER + CORE_CONTRACT (T/S/X/G/V/E/A/K clauses with known-gaps documented) + APP_MAP + DESIGN_TOKENS + CAPABILITIES, all adversarially critiqued (phantom-feature claims corrected on rows 1/6/9/14/15/19/21/26/33/37; contract known-gaps flagged). Expansion workflow (owner's Comala directive) finished 13/13 agents, every product claim verified against live Comala docs/pricing/reviews: authored `state/CAPABILITY_EXPANSION.md` (7 vetted candidates, F1–F7 = ledger rows 42–48) and merged them into the ledger with the doc-workflow `domain_pack_boost` (+2). **Strategy: everyone tracks, SV enforces** (revert-on-tamper Approved state is the moat). Ship order 42→43→44→45→48→47→46. Zero new scopes, minor-version only, Runs-on-Atlassian preserved — no guardrail trip for F1–F4/F7. F5/F6 deferred/spike-gated with 3 open owner questions (LLM spend, native-mirror version churn + Automation-quota cascade). **Next: iteration 1 on #42 (Workflow state engine, Priority 23.0) — the foundation everything depends on.**
- **2026-07-05 (map, harness bring-up · commit ee68930)** — Baseline grade PASS end-to-end. Learnings: (1) root `npm run lint` glob was broken (`eslint src/**/*` hits the assets dir — fixed to `--ext .js,.jsx`); (2) seal-e2e needs a seeded fixture — `npm run ensure-fixture` in test-harness creates page+attachment, seeds `protection-*` KVS via the dev hook with the EXACT `sealArtifact` payload shape, mirrors the `protection-` content property, persists SV_PAGE_ID/.env (fixture: page 265912321, att265945089, WFH); (3) NEVER invoke grade.sh through a pipe (`| tail`) — it swallows the exit code; redirect to a log file instead; (4) v2 attachment ids are `att`-prefixed and that format IS the KVS key suffix; (5) `.claude/skills/` is versioned via a `.gitignore` carve-out (rest of `.claude/` stays ignored).
- **2026-07-05 — Skill scaffolded (map phase).** Harness confirmed green end-to-end. Owner directive captured: expand capability with Comala-style **workflow rules** (doc-workflow domain pack; states/approvals/transitions/review-dates composed onto edit-requests + validations + sealing enforcement) — these candidates carry the domain_pack_boost. Map + expansion-research workflows running; ledger and reference docs being synthesized.
