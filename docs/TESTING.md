# Testing & Verification

How the v4.0.0 roadmap features (Edit Requests, Content Sealing, Conditions & Validations, Semantic AI Validations) and the UI scrub were tested. Mirrors the CogniRunner / Altomata harness style: deterministic unit tests + a black-box E2E harness + a screenshot/video harness, with per-feature proof.

## Result at a glance

| Layer | What | Result |
|---|---|---|
| Unit tests | Pure logic (`node test/*.test.mjs`) | **65 / 65 assertions pass** |
| Static | `forge lint` | **No issues** |
| Static | Production build (`npm run build`) | **0 errors** |
| Platform | `forge deploy` + `forge install --upgrade` | **v4.0.0 deployed & installed (development)** |
| Platform | Runs on Atlassian | **Eligible** (no external egress) |
| Frontend | Screenshot/video harness | **6 surfaces render, 0 page errors** |
| E2E | Black-box harness (`test-harness/`) | Manual matrix, runnable vs a dev install |

## 1. Unit tests — `npm test` (65/65)

Pure, Forge-free modules tested with a zero-dependency micro-assertion runner (`test/_assert.mjs`), one Node process per file:

| Suite | Assertions | Covers |
|---|---|---|
| `test/json-salvage.test.mjs` | 11 | Tolerant LLM-JSON recovery: fenced, prose-wrapped, truncated, unescaped-quote repair, null/garbage |
| `test/rules-engine.test.mjs` | 15 | Every validation rule type; severity → `passed`; disabled rules |
| `test/doc-surgery.test.mjs` | 19 | ADF canonicalization/hashing, section range, sealed-section node round-trip, body replace/splice, text/heading walkers |
| `test/validations-logic.test.mjs` | 20 | AI findings normalization (clamp/cap), prompt builder, severity rank, section range |

```
json-salvage: 11/11 passed
rules-engine: 15/15 passed
doc-surgery: 19/19 passed
validations-logic: 20/20 passed
```

These deliberately target the **highest-risk novel logic** (canonicalization that must not false-revert sealed sections; tolerant JSON parsing of model output; rule evaluation).

## 2. Static checks

- `npx forge lint` → **No issues found.**
- `npm run build` (webpack production, 6 surfaces) → **0 errors.**
- ESLint clean across `src/**/*.js,jsx`.

## 3. Platform deploy & install

- `forge deploy` → **Deployed Sentinel Vault to development**, app version **4.0.0** (major bump from the new `llm` module).
- Forge: *"eligible for the Runs on Atlassian program"* — confirms the Forge-LLM (no-BYOK) approach kept the app **egress-free**.
- `forge install --upgrade` (development, `wolfaenpak.atlassian.net`, Confluence) → **Up-to-date**, with the new `read:label:confluence` scope and `llm` module consent applied.

## 4. Frontend render verification (screenshot/video harness)

A standalone Playwright harness (`static/_screenshot-harness/`, mock `@forge/bridge`) builds each surface and renders it outside Confluence with deterministic data. Every surface rendered content with **0 page errors** (light + dark):

| Surface | Result |
|---|---|
| inline-panel | ✓ all four features + onboarding explainer + in-panel owner Edit-Requests inbox (with reasons) |
| steward-console | ✓ General + Validations + AI authoring |
| realm-console | ✓ Edit Requests inbox + My Sealed Files |
| section-setup | ✓ Sealed Section macro card |
| overlay | ✓ attachment management modal |
| doc-ribbon | ✓ Validation + AI status chips |

Artifacts (committed under [`docs/media/`](media)): 12 screenshots (light + dark × 6) and 5 MP4 walkthroughs. Reproduce:

```bash
cd static/_screenshot-harness
npm install && npx playwright install chromium
npm run build          # build the mock-bridge surface bundles
npm run record         # → clips/*.webm     (videos, animated cursor)
node capture.mjs        # → shots-png/*.png  (light stills)
THEME=dark node capture.mjs   # dark stills
```

## 4b. Live on-instance REST E2E (wolfaenpak)

Run against the deployed dev install with a real API token (`test-harness/.env`, gitignored):

```
node scripts/live-trigger-e2e.mjs   → 8/8 passed
node scripts/forge-logs.mjs         → no error signals
```

`live-trigger-e2e.mjs` creates a throwaway page, reads its ADF, **edits it (firing the
deployed `avi:confluence:updated:page` trigger)**, probes the `protection-` /
`section-protection-` / `sentinel-vault-validation` content-property fast-paths, then
deletes the page. Result: **the deployed app accepts real Confluence events and the
content-property surface with zero error signals in `forge logs`.**

Scope/limit (honest): REST cannot invoke the UI-only resolvers, so this verifies the
deployed REST surface + trigger resilience — **not** the seal→revert, section-restore,
or LLM behaviours, which are exercised via the UI (mock-bridge render harness) and the
manual matrix below.

## 5. Black-box E2E harness (`test-harness/`)

Drives the **real** Confluence REST API + reads `forge logs` (never imports the app/KVS). Run against a deployed dev install:

```bash
cd test-harness
npm run health        # creds + connectivity
npm run seal-e2e      # page readable, seal property present, no error logs
npm run forge-logs    # scan deployed logs for crash/5xx/egress/LLM/parse signals
```

The full manual matrix (per feature) is in [`test-harness/README.md`](../test-harness/README.md).

## 6. Per-feature proof matrix

| Feature | Unit tests | Static + platform | Live matrix | Confidence |
|---|---|---|---|---|
| [Edit Requests](features/edit-requests.md) | indirect (trigger/seal logic) | lint ✓ · build ✓ · deploy ✓ | request→approve→edit-kept→revoke→reverted→sweep | MEDIUM-HIGH |
| [Content Sealing](features/content-sealing.md) | `doc-surgery` (19) | lint ✓ · build ✓ · macro deploys ✓ | seal→restore→delete-restore→**no false revert**→unseal | MEDIUM-HIGH (wrapper) |
| [Conditions & Validations](features/conditions-validations.md) | `rules-engine` (15) + `validations-logic` (20) | lint ✓ · build ✓ · `read:label` scope ✓ | advisory comment → gate flip → revert (opt-in) | MEDIUM; LOW for revert |
| [Semantic AI Validations](features/semantic-ai-validations.md) | `json-salvage` (11) + `validations-logic` (20) | **Runs on Atlassian eligible** · `llm` module ✓ | enable → Run AI review → findings render | HIGH plumbing / MED quality / MED cost |

## 7. Reproduce everything

```bash
npm test                 # 65/65 unit assertions
npx forge lint           # No issues
npm run build            # 0 errors
forge deploy             # v4.0.0
forge install --upgrade  # apply scopes/consent
```

---
Back to the [docs index](README.md).
