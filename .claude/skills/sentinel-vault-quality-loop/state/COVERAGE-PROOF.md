# Coverage Proof — Sentinel Vault

Generated 2026-08-14T19:39:37.605Z by `scripts/coverage-proof.mjs` (parsed inventory — never hand-maintained; do not edit).

**178 inventory items** — 95 string-verified, 0 annotated, 83 gaps.
Evidence: 79 files (harness specs, app e2e scripts, unit tests).

## manifest/confluence:globalSettings (1 items, 0 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `steward-console` | string-verified | harness/admin-render.spec.ts, harness/full-app-walkthrough.spec.ts, harness/steward-console-deep.spec.ts |

## manifest/confluence:pageBanner (1 items, 1 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `sentinel-vault-ribbon` | **GAP** | — |

## manifest/confluence:spacePage (1 items, 0 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `realm-console` | string-verified | harness/deploy-state-guard.spec.ts, harness/full-app-walkthrough.spec.ts, harness/realm-console-deep.spec.ts, harness/realm-operator-search.spec.ts, harness/realm-plainuser-gate.spec.ts, harness/realm-reservation-persist.spec.ts … +7 more |

## manifest/consumer (2 items, 1 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `realm-audit-queue` | string-verified | harness/trigger-guards.spec.ts |
| `ai-validation-queue` | **GAP** | — |

## manifest/macro (2 items, 0 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `sentinel-vault-panel` | string-verified | harness/upload-boundary-live.spec.ts, harness/validation-eval.spec.ts |
| `sentinel-vault-sealed-section` | string-verified | harness/sealed-section.spec.ts, harness/validation-eval.spec.ts, unit/doc-surgery.test.mjs |

## manifest/scheduledTrigger (4 items, 1 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `expiry-sweep-scheduled` | **GAP** | — |
| `recurring-nudge-scheduled` | string-verified | harness/trigger-guards.spec.ts |
| `seal-index-cron` | string-verified | harness/trigger-guards.spec.ts |
| `workflow-sweep-scheduled` | string-verified | e2e/workflow-conditions-e2e.mjs, e2e/workflow-enforce-e2e.mjs |

## manifest/trigger-events (7 items, 1 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `avi:confluence:updated:attachment` | string-verified | e2e/seal-revert-e2e.mjs |
| `avi:confluence:trashed:attachment` | string-verified | harness/sealed-artifact-trash.spec.ts |
| `avi:confluence:deleted:attachment` | string-verified | harness/perm-delete-cleanup.spec.ts |
| `avi:confluence:updated:page` | string-verified | e2e/live-trigger-e2e.mjs |
| `avi:confluence:created:page` | **GAP** | — |
| `avi:forge:installed:app` | string-verified | harness/trigger-guards.spec.ts |
| `avi:forge:uninstalled:app` | string-verified | harness/trigger-guards.spec.ts |

## manifest/webtrigger (1 items, 0 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `harness-test-state` | string-verified | e2e/ensure-fixture.mjs, e2e/workflow-e2e.mjs |

## resolver/bulletins (9 items, 9 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `load-bulletin-toggles` | **GAP** | — |
| `recent-dispatches` | **GAP** | — |
| `operator-dispatches` | **GAP** | — |
| `acknowledge-dispatch` | **GAP** | — |
| `watch-artifact` | **GAP** | — |
| `check-watch` | **GAP** | — |
| `unwatch-artifact` | **GAP** | — |
| `flush-operator-dispatches` | **GAP** | — |
| `list-breach-dispatches` | **GAP** | — |

## resolver/editreq (13 items, 13 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `request-edit-access` | **GAP** | — |
| `check-edit-request` | **GAP** | — |
| `list-edit-requests` | **GAP** | — |
| `list-my-edit-requests` | **GAP** | — |
| `approve-edit-request` | **GAP** | — |
| `deny-edit-request` | **GAP** | — |
| `revoke-edit-grant` | **GAP** | — |
| `list-edit-grants` | **GAP** | — |
| `request-section-edit` | **GAP** | — |
| `check-section-edit` | **GAP** | — |
| `list-section-edit-requests` | **GAP** | — |
| `approve-section-edit` | **GAP** | — |
| `deny-section-edit` | **GAP** | — |

## resolver/entitlements (3 items, 1 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `load-session` | **GAP** | — |
| `check-license` | string-verified | harness/license-banner.spec.ts |
| `steward-override-enabled` | string-verified | harness/steward-force-unseal.spec.ts |

## resolver/operators (5 items, 4 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `identify-operator` | **GAP** | — |
| `search-operators` | string-verified | harness/realm-operator-search.spec.ts |
| `current-operator` | **GAP** | — |
| `enumerate-operators` | **GAP** | — |
| `enumerate-teams` | **GAP** | — |

## resolver/panels (12 items, 10 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `enumerate-panel-artifacts` | **GAP** | — |
| `label-artifact` | **GAP** | — |
| `unlabel-artifact` | **GAP** | — |
| `delete-artifact` | string-verified | harness/destructive-actions-perm.spec.ts |
| `inject-panel` | **GAP** | — |
| `extract-panel` | **GAP** | — |
| `check-panel-status` | **GAP** | — |
| `store-doc-panel-prefs` | **GAP** | — |
| `upload-artifact` | string-verified | harness/upload-boundary-live.spec.ts |
| `register-panel-key` | **GAP** | — |
| `discover-panel-key` | **GAP** | — |
| `resolve-artifact-preview` | **GAP** | — |

## resolver/policies (8 items, 5 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `load-policy` | string-verified | harness/steward-global-persist.spec.ts |
| `store-policy` | string-verified | harness/realm-reservation-persist.spec.ts, harness/space-access-persist.spec.ts, harness/steward-global-persist.spec.ts, unit/sealing-logic.test.mjs |
| `load-global-ruleset` | **GAP** | — |
| `store-global-ruleset` | **GAP** | — |
| `load-realm-ruleset` | **GAP** | — |
| `store-realm-ruleset` | **GAP** | — |
| `enumerate-realm-rulesets` | string-verified | harness/ruleset-enum-gate.spec.ts |
| `discard-realm-ruleset` | **GAP** | — |

## resolver/realms (11 items, 8 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `identify-realm` | **GAP** | — |
| `enumerate-realm-seals` | **GAP** | — |
| `launch-realm-audit` | **GAP** | — |
| `check-audit-status` | **GAP** | — |
| `steward-unseal` | string-verified | harness/steward-force-unseal.spec.ts |
| `check-user-role` | string-verified | harness/realm-plainuser-gate.spec.ts |
| `request-steward-access` | **GAP** | — |
| `check-steward-request` | **GAP** | — |
| `list-steward-requests` | string-verified | harness/steward-grant-roundtrip.spec.ts |
| `approve-steward-request` | **GAP** | — |
| `deny-steward-request` | **GAP** | — |

## resolver/registry (1 items, 1 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `heartbeat` | **GAP** | — |

## resolver/sealing (8 items, 3 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `seal-artifact` | string-verified | harness/page-seal-unseal.spec.ts, unit/sealing-logic.test.mjs |
| `unseal-artifact` | string-verified | harness/page-seal-unseal.spec.ts |
| `enumerate-doc-artifacts` | **GAP** | — |
| `enumerate-operator-seals` | **GAP** | — |
| `enumerate-page-seals` | string-verified | harness/sealed-delete-restore-journey.spec.ts |
| `check-seal-stamp` | **GAP** | — |
| `restore-sealed-artifact` | string-verified | harness/restore-gate.spec.ts |
| `purge-seal-record` | string-verified | harness/destructive-actions-perm.spec.ts |

## resolver/section-seals (5 items, 2 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `list-page-headings` | string-verified | harness/page-section-seal-create.spec.ts |
| `enumerate-section-seals` | **GAP** | — |
| `seal-section` | string-verified | harness/page-section-seal-create.spec.ts |
| `unseal-section` | string-verified | harness/page-section-seal-create.spec.ts |
| `refresh-section-snapshot` | **GAP** | — |

## resolver/validations (11 items, 9 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `load-validation-config` | **GAP** | — |
| `store-validation-config` | string-verified | harness/realm-validation-crud.spec.ts |
| `validate-page-now` | **GAP** | — |
| `get-validation-state` | **GAP** | — |
| `approve-page-gate` | **GAP** | — |
| `list-ai-models` | **GAP** | — |
| `enqueue-page-validation` | string-verified | harness/ai-validation-live.spec.ts |
| `get-validation-job` | **GAP** | — |
| `get-ai-findings` | **GAP** | — |
| `set-ai-finding-state` | **GAP** | — |
| `get-validation-audit` | **GAP** | — |

## resolver/workflow (15 items, 11 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `get-page-workflow` | string-verified | harness/page-ribbon-workflow.spec.ts |
| `get-workflow-dashboard` | **GAP** | — |
| `get-workflow-log` | **GAP** | — |
| `assign-workflow` | **GAP** | — |
| `request-transition` | **GAP** | — |
| `load-workflow-config` | **GAP** | — |
| `store-workflow-config` | **GAP** | — |
| `get-space-workflow-settings` | **GAP** | — |
| `set-space-workflow-settings` | string-verified | harness/realm-workflow-persist.spec.ts |
| `bulk-assign-workflow` | **GAP** | — |
| `decide-approval` | string-verified | harness/page-ribbon-workflow.spec.ts, harness/ribbon-approval-dialog.spec.ts |
| `get-page-approvals` | string-verified | harness/ribbon-approval-dialog.spec.ts |
| `list-my-approvals` | **GAP** | — |
| `search-workflow-users` | **GAP** | — |
| `search-workflow-groups` | **GAP** | — |

## testhook/invoke-seams (51 items, 2 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `expirySweep` | string-verified | harness/expiry-sweep.spec.ts |
| `assignWorkflow` | string-verified | harness/page-ribbon-workflow.spec.ts, harness/ribbon-approval-dialog.spec.ts, e2e/workflow-approval-e2e.mjs, e2e/workflow-conditions-e2e.mjs, e2e/workflow-e2e.mjs, e2e/workflow-enforce-e2e.mjs |
| `transitionWorkflow` | string-verified | harness/ribbon-approval-dialog.spec.ts, e2e/workflow-approval-e2e.mjs, e2e/workflow-conditions-e2e.mjs, e2e/workflow-e2e.mjs, e2e/workflow-enforce-e2e.mjs |
| `workflowSweep` | string-verified | e2e/workflow-conditions-e2e.mjs, e2e/workflow-enforce-e2e.mjs |
| `enforceDecision` | string-verified | e2e/workflow-enforce-e2e.mjs |
| `sweepRevert` | string-verified | e2e/workflow-enforce-e2e.mjs |
| `dashboard` | string-verified | e2e/workflow-enforce-e2e.mjs |
| `reqTransition` | string-verified | e2e/workflow-conditions-e2e.mjs |
| `aiVerdict` | string-verified | e2e/workflow-conditions-e2e.mjs |
| `listEditGrants` | string-verified | e2e/editgrant-revoke-e2e.mjs |
| `revokeEditGrant` | string-verified | e2e/editgrant-revoke-e2e.mjs |
| `requestSectionEdit` | string-verified | harness/page-section-editrequest.spec.ts |
| `checkSectionEdit` | string-verified | harness/page-section-editrequest.spec.ts |
| `listSectionEditRequests` | string-verified | harness/page-section-editrequest.spec.ts |
| `approveSectionEdit` | string-verified | harness/page-section-editrequest.spec.ts |
| `denySectionEdit` | string-verified | harness/page-section-editrequest.spec.ts |
| `watchArtifact` | string-verified | harness/page-watch-dispatch.spec.ts |
| `checkWatch` | string-verified | harness/page-watch-dispatch.spec.ts |
| `unwatchArtifact` | string-verified | harness/page-watch-dispatch.spec.ts |
| `acknowledgeDispatch` | string-verified | harness/page-watch-dispatch.spec.ts |
| `operatorDispatches` | string-verified | harness/page-watch-dispatch.spec.ts |
| `recentDispatches` | string-verified | harness/page-watch-dispatch.spec.ts |
| `listBreachDispatches` | string-verified | harness/page-watch-dispatch.spec.ts |
| `listPageHeadings` | string-verified | harness/page-section-seal-create.spec.ts |
| `enumerateSectionSeals` | **GAP** | — |
| `sealSection` | string-verified | harness/page-section-seal-create.spec.ts |
| `unsealSection` | string-verified | harness/page-section-seal-create.spec.ts |
| `checkUserRole` | string-verified | harness/realm-plainuser-gate.spec.ts |
| `requestStewardAccess` | string-verified | harness/realm-plainuser-gate.spec.ts |
| `checkStewardRequest` | string-verified | harness/realm-plainuser-gate.spec.ts |
| `getWorkflow` | string-verified | e2e/workflow-autoassign-e2e.mjs, e2e/workflow-bulk-e2e.mjs, e2e/workflow-e2e.mjs |
| `setSpaceWorkflowSettings` | string-verified | e2e/workflow-autoassign-e2e.mjs, e2e/workflow-bulk-e2e.mjs, e2e/workflow-enforce-e2e.mjs |
| `getSpaceWorkflowSettings` | string-verified | e2e/workflow-autoassign-e2e.mjs |
| `bulkAssignWorkflow` | string-verified | e2e/workflow-bulk-e2e.mjs |
| `requestApproval` | string-verified | harness/ribbon-approval-dialog.spec.ts, e2e/workflow-approval-e2e.mjs |
| `decideApproval` | string-verified | e2e/workflow-approval-e2e.mjs, e2e/workflow-conditions-e2e.mjs |
| `pageApprovals` | string-verified | e2e/workflow-approval-e2e.mjs |
| `deleteArtifact` | string-verified | harness/destructive-actions-perm.spec.ts |
| `purgeSealRecord` | string-verified | harness/destructive-actions-perm.spec.ts |
| `restoreSealedArtifact` | string-verified | harness/restore-gate.spec.ts |
| `enqueuePageValidation` | string-verified | harness/ai-validation-live.spec.ts |
| `getValidationJob` | string-verified | harness/ai-validation-live.spec.ts |
| `getAiFindings` | string-verified | harness/ai-validation-live.spec.ts |
| `enumerateRealmRulesets` | string-verified | harness/ruleset-enum-gate.spec.ts |
| `handleSealedArtifactDeleted` | string-verified | harness/perm-delete-cleanup.spec.ts |
| `probeAttachment` | **GAP** | — |
| `handleSealedArtifactTrash` | string-verified | harness/sealed-artifact-trash.spec.ts |
| `lifecycleGuard` | string-verified | harness/trigger-guards.spec.ts |
| `recurringNudgeGuard` | string-verified | harness/trigger-guards.spec.ts |
| `checkLicense` | string-verified | harness/license-banner.spec.ts, unit/license.test.mjs |
| `storeWorkflowConfigProbe` | string-verified | harness/workflow-deadend-warn.spec.ts |

## testhook/what-verbs (7 items, 1 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `version` | string-verified | harness/deploy-state-guard.spec.ts |
| `kvs` | string-verified | harness/ai-validation-live.spec.ts, harness/destructive-actions-perm.spec.ts, harness/expiry-sweep.spec.ts, harness/gate-revert.spec.ts, harness/media-attr-matrix.spec.ts, harness/page-editrequest-approve.spec.ts … +33 more |
| `set` | string-verified | harness/ai-validation-live.spec.ts, harness/destructive-actions-perm.spec.ts, harness/expiry-sweep.spec.ts, harness/gate-revert.spec.ts, harness/license-banner.spec.ts, harness/media-attr-matrix.spec.ts … +31 more |
| `delete` | string-verified | harness/ai-validation-live.spec.ts, harness/destructive-actions-perm.spec.ts, harness/expiry-sweep.spec.ts, harness/gate-revert.spec.ts, harness/license-banner.spec.ts, harness/media-attr-matrix.spec.ts … +37 more |
| `setttl` | **GAP** | — |
| `query` | string-verified | harness/realm-stale-badge.spec.ts, harness/ribbon-approval-dialog.spec.ts, harness/sealed-delete-restore-journey.spec.ts |
| `invoke` | string-verified | harness/ai-validation-live.spec.ts, harness/destructive-actions-perm.spec.ts, harness/expiry-sweep.spec.ts, harness/license-banner.spec.ts, harness/page-ribbon-workflow.spec.ts, harness/page-section-editrequest.spec.ts … +16 more |

