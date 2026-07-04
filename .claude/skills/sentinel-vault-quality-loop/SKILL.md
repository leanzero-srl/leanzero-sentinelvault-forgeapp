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

## Changelog (append every iteration — living skill)

- **2026-07-05 — Skill scaffolded (map phase).** Harness confirmed green end-to-end. Owner directive captured: expand capability with Comala-style **workflow rules** (doc-workflow domain pack; states/approvals/transitions/review-dates composed onto edit-requests + validations + sealing enforcement) — these candidates carry the domain_pack_boost. Map + expansion-research workflows running; ledger and reference docs being synthesized.
