# Iteration 16 — failure-surfacing: settings saves no longer report false success

Branch: `aql/workflow-state-engine`. **Angle: failure-mode surfacing** (does the UI show backend errors, or fail silently?).

## Verify-first (grep every save + read the resolvers)
The workflow ACTION paths surface failure correctly: ribbon `doTransition` (shows `res.violations`/"Transition failed"), `doDecide` (ribbon), `decide` (inbox), and `applyToExisting` all check `r?.success`/`res.success` and route to an error banner.

The four SETTINGS SAVES did NOT:
- `WorkflowSettingsEditor.save` → `set-space-workflow-settings`
- `ValidationsEditor.save` → `store-validation-config`
- `steward-console.onSavePreferences` → `store-policy` (global)
- `realm-console` save → `store-policy` (space)

Each did `await invoke(...)` then a hardcoded success message, never checking the return. But the resolvers return `{ success:false, reason }` on rejection (NOT a throw):
- `setSpaceSettings` → `{success:false,"Only a realm steward…"}` on authz; delegates to `setSpaceWorkflowSettings` → `{success:true,settings}`.
- `storePolicy` → `DENY = {success:false,"Not authorized…"}` on authz (audit A1); `{success:true}` on both success paths (L127/133).
- `storeConfig` → `{success:false,"No data"}` on empty; `storeValidationConfig` → `{success:true}`.

So a rejected save (non-steward, or the realm-console "Realm preferences updated!") showed a FALSE success while nothing persisted — a silent failure, made live by audit A1's shift to returning `DENY` instead of throwing.

## Fix (WIP=1, UI-only, high-confidence)
All four handlers now `const r = await invoke(...); if (r?.success) <success> else setMsg(error, r?.reason)` — reusing the existing `.alert-error`/`error` banner (mirrors `applyToExisting`). Verified the happy-path return shapes first so checking `success` can't create a false ERROR on success.

## Verify
- Read all three resolvers' success returns (`{success:true...}`) → the check is safe on the happy path.
- Failure path END-TO-END: flipped the screenshot mock to reject `set-space-workflow-settings`, scripted a click on "Save workflow settings", asserted `.alert-error` renders with the resolver's reason ("Only a realm steward…") and NO success banner (2/2). Reverted the mock.
- Full grade PASS (the settings-save E2E still round-trips a real save); units 131/131; deployed to dev. Not core-touching → no deep E2E.

## Outcome
Every settings save now surfaces a backend rejection instead of a false "saved". Confidence HIGH (UI-only, return shapes verified, failure path scripted-proven, happy path grade-verified).

## Learning
`invoke()` resolves normally for a `{success:false}` business rejection — it only throws on transport/uncaught errors. So `await invoke(...)` with no return-check is a false-success trap. Audit A1 (resolvers return `DENY` rather than throw) is exactly the pattern that makes this bite.

## OPEN LEAD (authz angle — NOT this tick)
`store-validation-config` (`storeConfig`) has NO server-side authz check, unlike `store-policy` (post-A1) and `set-space-workflow-settings` (steward-gated). Anyone able to invoke it can write a space/global validation ruleset. Verify against the UI gating and add a steward/site-admin gate in a future authz tick.
