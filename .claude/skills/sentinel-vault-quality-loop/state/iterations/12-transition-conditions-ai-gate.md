# Iteration 12 — #46 Transition conditions + AI content-review gate

Branch: `aql/workflow-state-engine`. Block a transition until the page's content passes checks — required content (sync) AND/OR an automated AI content review (async). The last ledger feature; the lower-confidence async one.

## Research-first (the user's "FIND A SOLUTION")
The research workflow's Part-#46 design (`state/F46-F47-SOLUTIONS.md`, adversarially pre-vetted) settled the architecture: reuse `evaluateRules` verbatim for content conditions; the AI review is ASYNC/queued (no sync verdict — the LLM can exceed the 25s resolver limit), so model it as a **"robot approver" axis (`aiGate`) carried on the SAME `workflow-pending-{pageId}` record**, AND-composed with the human quorum on one pinned version, resolved through the existing `decideApproval` machinery. No forked pending/inbox key.

## Implementation
- **Part A — content conditions (sync, HIGH confidence):** `checkContentConditions` in `requestTransition` runs `evaluateRules(adfDoc, labels, rules)` before the enforce/approval branch; block-severity violations block the move with the reasons. Hoisted `fetchPageLabels` to `infra/labels.js` (shared by the gate, validations, and the trigger — no third copy).
- **Part B — AI gate (async, LOWER confidence):** `aiGate` on the pending record; `enqueueAiGate` (budget/misconfig verdict) pushes a `mode:"gate"` job; a new `handleGateReview` branch in `aiValidationConsumer` scores the PINNED version (fail-closed terminal on error), then `applyAiVerdict` writes the verdict + completes iff the human quorum is also met; a `workflowSweep` reaper flips a stuck gate to failed. UI: two toggles in the Workflow tab ("Require content rules" / "Require an AI content review" + strictness) — never called a "gate"; the ribbon shows block reasons + an "AI content review" axis in the awaiting panel.

## Verify — the adversarial pass earned its keep AGAIN
- conditions-e2e proved Part A end-to-end + Part B wiring via SIMULATED verdicts (the LLM verdict is non-deterministic): passed→complete, failed→block, stale-version→fail, duplicate→CAS no-op, compound AI+human, reaper timeout.
- **The mandatory adversarial review of the SHIPPED code found 7 real defects the 16/16 harness passed over** (the #44 lesson: green harness ≠ concurrency proof) — all fixed, re-graded PASS:
  1. **[HIGH] Content gate fails OPEN** — used `resolveEffectiveConfig` (returns no rules unless the separate space-wide validation master switch is on, default off) → `requireRules` silently no-opped. Fix: enabled-INDEPENDENT `resolveRules`. (Regression-guarded: conditions-e2e runs Part A with global validation OFF.)
  2. **[HIGH] Authority downgrade** — enabling `requireAi` on an enforce state with no human approvers removed the steward gate (any editor could reach Approved; AI-disabled → immediate pass). Fix: steward check — AI augments, never replaces, enforce authority. (Regression-guarded.)
  3. **[HIGH] Double-completion** (×2: duplicate AI delivery; AI-verdict-vs-last-human-vote) — no consume-once guard on the finalize path. Fix: a `workflow-completing-{pageId}` claim + **gate ALL side-effects on the transition actually succeeding** (a losing finalizer no-ops instead of double-emailing / resurrecting a phantom pending).
  4. **[MED] Phantom resurrection** — `applyAiVerdict`'s non-atomic set re-created a pending a concurrent clear deleted. Fix: re-read immediately before the write.
  5. **[MED] Lost-wakeup deadlock** — `decideApproval` read the pending once (stale aiGate) → neither path finalized. Fix: re-read the aiGate fresh before holding.
  6. **[LOW]** orphan approval records on AI-fail (skip in the inbox); stale immediate-verdict return (reflect the outcome).
  Rejected: 1. KVS has no CAS, so the completion claim + re-reads NARROW the residual windows; the durable backstop is the res.success gate + transitionPageWorkflow's own already-left-state no-op.
- **Full grade PASS** — 11 E2E suites; conditions-e2e 18/18, approval-e2e 12/12 (the refactored completion path unbroken), enforce-e2e 30/30.

## Outcome
**#46 COMPLETE + verified.** Confidence HIGH on the content-rule half; **MEDIUM on the async AI wiring** — the design was reused-not-reinvented and the review-found races are fixed + regression-guarded, but KVS-no-CAS means a rare double-log in the tightest read→persist window is inherent (benign, append-only; the durable guards prevent the harmful double-email / phantom-pending / double-transition). The **entire Comala-style workflow-rules capability (#42→#43→#44→#45→#48→#47→#46) is now shipped and verified.**
