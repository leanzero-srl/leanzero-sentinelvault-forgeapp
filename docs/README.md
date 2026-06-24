# Sentinel Vault — Documentation

Index of the product, feature, and verification docs. Each feature doc explains the feature and **embeds the screenshots and links the walkthrough videos** produced by the screenshot/video harness.

## Feature guides (v4.0.0 roadmap)

Each guide follows the same template: *What it does · Where to find it · How to test (step by step) · What you should see · Walkthrough (screenshots + video) · Troubleshooting · Under the hood — how it's proven.*

| Feature | Guide | Demo |
|---|---|---|
| **Edit Requests** | [edit-requests.md](features/edit-requests.md) | [video](media/videos/03-realm-edit-requests.mp4) |
| **Content Sealing** (sections) | [content-sealing.md](features/content-sealing.md) | [video](media/videos/01-inline-panel-features.mp4) |
| **Conditions & Validations** | [conditions-validations.md](features/conditions-validations.md) | [video](media/videos/02-steward-validations-ai.mp4) |
| **Semantic AI Validations** | [semantic-ai-validations.md](features/semantic-ai-validations.md) | [video](media/videos/01-inline-panel-features.mp4) |

## Testing & verification

- [TESTING.md](TESTING.md) — unit results (65/65), `forge lint`, build, deploy/install (v4.0.0, Runs on Atlassian), frontend render verification, and the per-feature proof matrix.
- [`../test-harness/README.md`](../test-harness/README.md) — the black-box E2E harness (REST + forge-logs) and the full manual matrix.

## Media

- [media/screenshots/](media/screenshots) — light + dark stills of every surface.
- [media/videos/](media/videos) — MP4 walkthroughs (`01`–`05`).

Regenerate with the screenshot/video harness:

```bash
cd static/_screenshot-harness
npm install && npx playwright install chromium
npm run build && npm run record   # videos (webm) → clips/
node capture.mjs                   # stills → shots-png/
THEME=dark node capture.mjs        # dark stills
```

## Reference docs

- [architecture.md](architecture.md) — backend capsules, the unified page-content pipeline, KVS schema, surfaces.
- [settings-reference.md](settings-reference.md) — every admin setting.
- [notifications.md](notifications.md) — native footer-comment notifications.
- [deployment.md](deployment.md) · [troubleshooting.md](troubleshooting.md) · [user-guide.md](user-guide.md) · [contributing.md](contributing.md)
- [api/](api) — Confluence event + content-surgery notes, OpenAPI specs.

---
Project overview: [../README.md](../README.md)
