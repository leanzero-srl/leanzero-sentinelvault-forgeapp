# Sentinel Vault — Test Harness

Two layers, mirroring the CogniRunner / Altomata harness pattern:

1. **Unit tests** (in the repo root `test/`, run with `npm test` from the project root) — pure, deterministic, no Forge runtime. They cover the highest-risk novel logic: JSON salvage, the rules engine, ADF canonicalization/hashing/surgery, section ranges, and AI findings normalization.
2. **Black-box E2E** (this folder) — drives the **real** Confluence REST API and reads **forge logs**. It never imports the app or KVS; it asserts on observable results, exactly how a user/admin would exercise the app.

## Unit tests (no setup)

```bash
cd ..            # project root
npm test
```

## E2E setup

1. Deploy the app and install it on a Confluence test site:
   ```bash
   cd ..
   forge deploy -e development
   forge install -e development   # complete the admin consent (the new `llm` module forces a re-consent)
   ```
2. Create `test-harness/.env` (gitignored):
   ```
   SV_EMAIL=you@example.com
   SV_TOKEN=<api token from id.atlassian.com>
   SV_BASE=https://your-site.atlassian.net/wiki
   SV_PAGE_ID=<a page id to test against>
   SV_SPACE_KEY=<space key>
   ```
3. Run:
   ```bash
   cd test-harness
   npm run health        # confirms creds + connectivity
   npm run seal-e2e      # smoke: page readable, seal property present, no error logs
   npm run forge-logs    # scans deployed logs for crash/5xx/egress/LLM/parse signals
   ```

## Manual E2E verification matrix

Run these in the installed app, then `npm run forge-logs` to confirm no errors were logged.

**Forge LLM / Runs on Atlassian**
- Confirm the app still shows the "Runs on Atlassian" badge (no egress declared in the manifest).
- Steward console → Validations → Semantic AI: enable, pick a Haiku model (the dropdown is populated by `list-ai-models`), save.
- On a page, panel → AI Review → Run AI review → findings render; `forge logs` shows no `[FORGE-LLM] error`.

**Edit Requests**
- As a non-owner, on a sealed attachment: "Request Edit" → owner sees it in Realm Console → My Sealed Files → Edit Requests → Approve.
- Approved editor replaces the file → it is NOT reverted (and the seal re-baselines: a later edit by a non-editor reverts to the approved version, not the original).
- Revoke, then edit again → reverted. Unseal → grants swept.

**Content Sealing (sections)**
- Panel → Sealed Sections → Seal a section (pick a heading).
- As a non-owner, edit the body inside the macro → restored. Delete the whole macro → restored.
- Round-trip the page through the editor with NO change → assert NO false revert (canonicalization check — the key risk).
- Owner edits freely; steward can unseal.

**Conditions & Validations**
- Steward console → Validations: add a `required-table` rule (severity Required), enable, mode Advisory.
- Save a page with no table → a validation comment appears.
- Switch to Gate mode → panel shows Issues; `approve-page-gate` flips to Passed.
- Switch to Revert mode (per the LOW-confidence warning) on a page with a prior compliant version → non-compliant save reverts; v1 pages fall back to advisory.

**Cross-cutting**
- On a page with a sealed attachment + a sealed section + a failing validation rule, one save should produce a single body-restore write (no 409 storm, no trigger loop). Check `forge logs` for one `[PAGE-PROTECT]` write and the loop-guard short-circuiting the app's own re-save.

## Notes

- The harness exits non-zero on failure so it can gate CI once a sandbox is wired up.
- `forge-logs.mjs` requires the Forge CLI authenticated and the app deployed.
