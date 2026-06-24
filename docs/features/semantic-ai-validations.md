# Semantic AI Validations

> AI-powered content review against your custom rules, style guide, tone, and compliance standards — using Atlassian-hosted Claude via the Forge LLM API (no BYOK).

| | |
|---|---|
| **Surfaces** | Steward console → *Validations → Semantic AI Validations* (config) · Inline panel → *AI Review* (run) |
| **Who can use it** | Admins enable + configure; users run a review on demand |
| **Status** | Shipped in v4.0.0 — **off by default** |
| **Runs on Atlassian** | **Yes** — Atlassian-hosted Claude via `@forge/llm`, no external API keys, no egress |

## What it does

Instead of bring-your-own-key, Semantic AI Validations call **Atlassian-hosted Claude through the Forge LLM API**, so the app keeps its **"Runs on Atlassian"** badge. Admins configure custom rules, a style guide, tone/voice, and compliance standards; a user runs a review from the panel. The model returns structured findings (severity, category, excerpt, explanation, suggestion) that are shown in the panel and optionally posted as an @mention comment to the page author. To control cost (tokens bill to the app’s Forge account), AI is **off by default**, **Claude Haiku-only**, page text is **truncated** to a budget, and a **monthly token budget** caps usage per space.

## Where to find it

- **Configure:** Steward console → **Validations** tab → **Semantic AI Validations** section (enable, model, custom rules, style guide, tone, compliance, severity threshold, notify author, monthly token budget).
- **Run:** the inline panel’s **AI Review** group → **Run AI review** (appears once AI is enabled for the space).

## How to test — step by step

1. Steward console → **Validations → Semantic AI Validations** → toggle **Enable AI review**, set a style guide / tone / compliance, choose the Haiku model, Save.
2. Open the panel on a page → **AI Review → Run AI review**.
3. Wait for the async job to finish (it polls) → findings render with severity chips and suggestions.
4. (Optional) enable **Notify page author** + a severity threshold → a footer comment @mentions the author for qualifying findings.
5. Check the monthly token usage in the space console (the audit accrues input/output tokens).

## What you should see

- A **Semantic AI Validations** config block with a **"Runs on Atlassian"** badge, a Haiku-only model dropdown, the rules/style/tone/compliance fields, and a monthly token budget.
- An **AI Review** group in the panel: **Run AI review** → **Reviewing…** → a findings list (HIGH/MEDIUM/LOW + excerpt + suggestion), or "No issues found."
- If the model returns unparseable output, no fabricated findings (fail-closed) — an audit row records the parse error instead.

## Walkthrough — screenshots & video

Configuration — the **Semantic AI Validations** section of the Validations tab (light + dark):

![AI config in the Validations tab](../media/screenshots/steward-validations.png)
![AI config in the Validations tab (dark)](../media/screenshots/steward-validations-dark.png)

Results — the **AI Review** group in the panel (HIGH/MEDIUM/LOW findings + suggestions):

![AI Review findings in the panel](../media/screenshots/inline-panel.png)

▶ **Video (Run AI review, in context):** [01-inline-panel-features.mp4](../media/videos/01-inline-panel-features.mp4)
▶ **Video (AI config in the Validations tab):** [02-steward-validations-ai.mp4](../media/videos/02-steward-validations-ai.mp4)

<video src="../media/videos/01-inline-panel-features.mp4" controls width="900"></video>

## Troubleshooting

- **No "Run AI review" button** — AI is disabled for the space (default). An admin enables it in the Validations tab.
- **"reached its monthly AI token budget"** — raise or clear the monthly budget in the config.
- **Only Haiku in the model dropdown** — intentional cost control; Sonnet/Opus are reserved for a future paid tier and are clamped at three layers.
- **The card text still says "BYOK"** — that wording lives on the Marketplace listing / marketing site, not in this repo; update it there to "Atlassian-hosted Claude — Runs on Atlassian."

## Under the hood — how it's proven

- **Backend:** ported Forge LLM adapter `src/server/infra/forge-llm.js` (+ pure salvage `src/server/infra/json-salvage.js`); async consumer `src/server/capsules/validations/ai-worker.js` on the `ai-validation-queue`; prompt/findings logic in `validations/logic.js`; comment builder in `validation-blueprints.js`. Manifest `llm` module + consumer.
- **Unit tests:** `test/json-salvage.test.mjs` (11 — fenced/prose/truncated/unescaped-quote recovery) and `test/validations-logic.test.mjs` (20 — `normalizeFindings` clamping/cap, `buildValidationPrompt`, `severityRank`).
- **Platform proof:** deployed as **v4.0.0**; Forge reports the build is **eligible for the Runs on Atlassian program** (confirming no egress). The `llm` module installed with admin re-consent.
- **Confidence:** HIGH on the LLM plumbing (proven in CogniRunner and ported); MEDIUM on finding quality (inherent to the model — mitigated by the strict JSON contract + tolerant parser + Haiku-only); MEDIUM on cost (mitigated by default-off, truncation, dedup, and the monthly budget).

---
See also: [Edit Requests](edit-requests.md) · [Content Sealing](content-sealing.md) · [Conditions & Validations](conditions-validations.md) · [Testing & verification](../TESTING.md)
