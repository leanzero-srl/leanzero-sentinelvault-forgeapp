# Iteration 18 — error/empty/loading states: dashboard load-failure

Branch: `aql/workflow-state-engine`. **Angle: error/empty/loading states.**

## Verify-first (audit, don't assume)
Read the async surfaces. Findings:
- **Inline panel** — full triad: `sv-panel-loading` ("Retrieving files…", "Reading page…", "Loading sealed sections…"), `sv-panel-error` (line 1534), `sv-panel-empty` ("No files attached…", "No validation rules configured.", "No headings to seal."). SOLID.
- **AI-review poll** (panel, `poll(taskId, tries)`) — capped at `tries > 40` → "AI review timed out." + `setBusy(false)`; handles `status:done`/`status:error`/`parseError`; catch → note + `setBusy(false)`; `run()` handles `!success` + catch. Clears busy on EVERY path — no stuck spinner. SOLID.
- **WorkflowInbox** — `if (items === null || items.length === 0) return null`: intentional restraint (renders nothing when empty/loading so it never clutters). Correct by design.
- **WorkflowDashboard** — loading ✓. But `if (!data || data.error || data.total === 0) return null` lumped ERROR in with empty → a failed `get-workflow-dashboard` made the whole dashboard SILENTLY VANISH.

## The one genuine gap + fix
The dashboard vanishing on error is inconsistent with the app's OWN error-surfacing pattern (panel `sv-panel-error`; it16 made saves surface `{success:false}`). Split the error case out:
```
if (data?.error) return <div className="wf-dash-error" role="status">Couldn't load workflow status right now. Reload the page to try again.</div>;
if (!data || data.total === 0) return null;  // empty stays quiet — deliberate restraint
```
Kept empty→null: the dashboard mounts even when workflow is DISABLED (realm-console:2258 renders it unconditionally), so an empty-state message would clutter a space not using workflow. Without an `enabled` flag from the resolver we can't distinguish disabled vs enabled-but-empty — so restraint is correct. (Adding `enabled` to the resolver for an onboarding empty state was considered and deferred as churn.)

New `.wf-dash-error`: solid saturated red text (`#dc2626`) — brand-compliant (no washed tint, no left rail), lighter than the full `.alert-error` bar since it's a transient read-only reporting widget.

## Verify
- Flipped the screenshot mock `get-workflow-dashboard → {error:true}`, scripted-asserted (3/3): `.wf-dash-error` renders the message; color is `rgb(220,38,38)` (solid, not muted); the full `.wf-dash` is NOT shown. Reverted the mock; desktop capture confirms the normal dashboard is unchanged (2901 root chars).
- Full grade PASS, units 131/131, deployed to dev.

## Outcome
Dashboard load-failure now surfaces a clear, brand-styled message instead of vanishing. The rest of the app's error/empty/loading handling was found solid. Confidence HIGH (UI-only, scripted-verified both states, desktop unchanged).

## Learning
null-on-EMPTY is fine (restraint — the inbox does it well). null-on-ERROR is a silent failure. When a component collapses both into one `return null`, split them so errors surface.

## Open leads
- WorkflowDashboard onboarding empty state (enabled && total===0 → "no pages yet, apply to existing") needs the resolver to return `enabled` — deferred (nice-to-have, not a defect).
- `set-ai-finding-state` optimistic update (panel L876) doesn't roll back on error (low stakes, overlaps it16).
- Standing leads: setAiFindingState authz; WorkflowInbox aria-labels; dashboard `<th scope>`; overlay tab-nav.
