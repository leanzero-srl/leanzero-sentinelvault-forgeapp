# Iteration 11 — #47 Native content-state mirroring

Branch: `aql/workflow-state-engine`. Project the app's workflow state onto Confluence's OWN native content-status pill (the coloured badge in the page header) — so the state shows in native Confluence, not only the app's custom ribbon. A genuine differentiator (research suggests Comala keeps status in its own bar, not the native pill — flagged UNVERIFIED, kept out of external copy).

## Research-first (the user's "research until confidence is high — FIND A SOLUTION")
A research workflow (5 web+code investigators → synthesis → 2 critics → fixer, `state/F46-F47-SOLUTIONS.md`) answered the gating question with cited evidence: **the native content status IS writable by a Forge app** — `PUT /wiki/rest/api/content/{id}/state?status=current`, v1, on `write:confluence-content` which the app ALREADY holds. The critics' explicit job was to catch a phantom-feature claim (the CogniRunner trap); it survived, then I **live-probed it** before trusting it.

## Live probe (before building on the assumption)
Real page on wolfaenpak: `mirror("approved")` → native pill `{name:"Approved", color:"#00875a"}` (HEX accepted — pin hex, not the `B200` UI tokens); **idempotent** re-mirror did NOT bump the version (v2→v2); `mirror("in_review")` switched it. Writable + idempotent + shape confirmed.

## Implementation
- **`native-state.js` (new):** `NATIVE_STATE_MAP` (4 states → solid hex colours, no pastels), `mirrorNativeState(pageId, stateId)` (GET-then-skip idempotent; best-effort try/catch; KVS stays source of truth), `readNativeState` (shape-tolerant), `clearNativeState`. Modeled on the proven `writeStateContentProp` precedent.
- **Call site:** `persistState` (logic.js) — mirrors ONLY on a genuine state change (`!prevStateId || prevStateId !== record.stateId`), so restamps don't fire a redundant PUT (every PUT bumps the page version).
- **#44 interaction fix (the flagged risk):** every mirror PUT publishes a new page version (body unchanged). The event-path is absorbed by the trigger's app-account guard; the SWEEP would otherwise see the app-authored bump as drift and (in demote mode) wrongly demote the Approved page. Fix: the sweep's authorized check now treats `author === systemAccountId` as authorised — the app's own version bumps (mirror, revert) are never tampers. General + correct.

## Verify
- **Full grade PASS** — 9 E2E suites; workflow-enforce-e2e **30/30** incl. 3 new #47 checks: state mirrored to the native pill; mirror published a new version; **the mirror's app-authored version bump did NOT demote the Approved page** (the #44-interaction proof).
- Fixed a stale test assumption the mirror surfaced: `workflow-autoassign-e2e` hardcoded `version:2` after auto-assign — the mirror now bumps it, so the test reads the live version dynamically (the mirror working *is* the intended behavior).

## Outcome
**#47 COMPLETE + verified.** Confidence HIGH — the one unknown (native writability) is live-confirmed, not assumed; the one risk (#44 version-bump interaction) is fixed and harness-proven; zero new scopes (no re-consent). The "Comala doesn't mirror native status" differentiator stays out of external copy until re-checked against a live Comala release.
