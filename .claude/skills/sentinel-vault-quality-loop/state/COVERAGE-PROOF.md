# Coverage Proof — Sentinel Vault

Generated 2026-09-05T15:55:20.005Z by `scripts/coverage-proof.mjs` (parsed inventory — never hand-maintained; do not edit).

**193 inventory items** — 143 string-verified, 38 annotated, 12 gaps.
Evidence: 93 files (harness specs, app e2e scripts, unit tests).

## manifest/confluence:globalSettings (1 items, 0 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `steward-console` | string-verified | harness/admin-render.spec.ts, harness/full-app-walkthrough.spec.ts, harness/steward-console-deep.spec.ts |

## manifest/confluence:pageBanner (1 items, 0 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `sentinel-vault-ribbon` | annotated | harness/page-seal-state.spec.ts (annotated) |

## manifest/confluence:spacePage (1 items, 0 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `realm-console` | string-verified | harness/deploy-state-guard.spec.ts, harness/full-app-walkthrough.spec.ts, harness/realm-console-deep.spec.ts, harness/realm-directory-lists.spec.ts, harness/realm-operator-search.spec.ts, harness/realm-plainuser-gate.spec.ts … +9 more |

## manifest/consumer (2 items, 0 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `realm-audit-queue` | string-verified | harness/trigger-guards.spec.ts |
| `ai-validation-queue` | annotated | harness/ai-validation-live.spec.ts (annotated) |

## manifest/macro (2 items, 0 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `sentinel-vault-panel` | string-verified | harness/panel-prefs-preview.spec.ts, harness/upload-boundary-live.spec.ts, harness/validation-eval.spec.ts, e2e/ensure-fixture.mjs |
| `sentinel-vault-sealed-section` | string-verified | harness/sealed-section.spec.ts, harness/validation-eval.spec.ts, unit/doc-surgery.test.mjs |

## manifest/scheduledTrigger (4 items, 0 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `expiry-sweep-scheduled` | annotated | harness/expiry-sweep.spec.ts (annotated) |
| `recurring-nudge-scheduled` | string-verified | harness/trigger-guards.spec.ts |
| `seal-index-cron` | string-verified | harness/trigger-guards.spec.ts |
| `workflow-sweep-scheduled` | string-verified | e2e/workflow-conditions-e2e.mjs, e2e/workflow-enforce-e2e.mjs |

## manifest/trigger-events (7 items, 0 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `avi:confluence:updated:attachment` | string-verified | e2e/seal-revert-e2e.mjs |
| `avi:confluence:trashed:attachment` | string-verified | harness/sealed-artifact-trash.spec.ts |
| `avi:confluence:deleted:attachment` | string-verified | harness/perm-delete-cleanup.spec.ts |
| `avi:confluence:updated:page` | string-verified | e2e/live-trigger-e2e.mjs |
| `avi:confluence:created:page` | annotated | e2e/workflow-autoassign-e2e.mjs (annotated) |
| `avi:forge:installed:app` | string-verified | harness/trigger-guards.spec.ts |
| `avi:forge:uninstalled:app` | string-verified | harness/trigger-guards.spec.ts |

## manifest/webtrigger (1 items, 0 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `harness-test-state` | string-verified | e2e/ensure-fixture.mjs, e2e/workflow-e2e.mjs |

## resolver/bulletins (9 items, 1 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `load-bulletin-toggles` | string-verified | harness/bulletin-toggles.spec.ts |
| `recent-dispatches` | annotated | harness/page-watch-dispatch.spec.ts (annotated) |
| `operator-dispatches` | annotated | harness/page-watch-dispatch.spec.ts (annotated) |
| `acknowledge-dispatch` | annotated | harness/page-watch-dispatch.spec.ts (annotated) |
| `watch-artifact` | annotated | harness/page-watch-dispatch.spec.ts (annotated) |
| `check-watch` | annotated | harness/page-watch-dispatch.spec.ts (annotated) |
| `unwatch-artifact` | annotated | harness/page-watch-dispatch.spec.ts (annotated) |
| `flush-operator-dispatches` | **GAP** | — |
| `list-breach-dispatches` | annotated | harness/page-watch-dispatch.spec.ts (annotated) |

## resolver/editreq (13 items, 0 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `request-edit-access` | string-verified | harness/editreq-request-lifecycle.spec.ts |
| `check-edit-request` | annotated | harness/editreq-request-lifecycle.spec.ts (annotated) |
| `list-edit-requests` | annotated | harness/lapsed-seal-lifecycle.spec.ts (annotated), harness/page-editrequest-approve.spec.ts (annotated) |
| `list-my-edit-requests` | annotated | harness/editreq-request-lifecycle.spec.ts (annotated) |
| `approve-edit-request` | annotated | harness/lapsed-seal-lifecycle.spec.ts (annotated), harness/page-editrequest-approve.spec.ts (annotated) |
| `deny-edit-request` | annotated | harness/editreq-request-lifecycle.spec.ts (annotated), harness/page-editrequest-deny-revoke.spec.ts (annotated) |
| `revoke-edit-grant` | annotated | harness/page-editrequest-deny-revoke.spec.ts (annotated), e2e/editgrant-revoke-e2e.mjs (annotated) |
| `list-edit-grants` | annotated | harness/page-editrequest-deny-revoke.spec.ts (annotated), e2e/editgrant-revoke-e2e.mjs (annotated) |
| `request-section-edit` | annotated | harness/page-section-editrequest.spec.ts (annotated) |
| `check-section-edit` | annotated | harness/page-section-editrequest.spec.ts (annotated) |
| `list-section-edit-requests` | annotated | harness/page-section-editrequest.spec.ts (annotated) |
| `approve-section-edit` | annotated | harness/page-section-editrequest.spec.ts (annotated) |
| `deny-section-edit` | annotated | harness/page-section-editrequest.spec.ts (annotated) |

## resolver/entitlements (3 items, 1 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `load-session` | **GAP** | — |
| `check-license` | string-verified | harness/license-banner.spec.ts |
| `steward-override-enabled` | string-verified | harness/steward-force-unseal.spec.ts |

## resolver/operators (5 items, 1 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `identify-operator` | string-verified | harness/overlay-owner-name.spec.ts |
| `search-operators` | string-verified | harness/realm-directory-lists.spec.ts, harness/realm-operator-search.spec.ts |
| `current-operator` | **GAP** | — |
| `enumerate-operators` | string-verified | harness/realm-directory-lists.spec.ts |
| `enumerate-teams` | string-verified | harness/realm-directory-lists.spec.ts |

## resolver/panels (9 items, 0 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `enumerate-panel-artifacts` | string-verified | harness/panel-labels.spec.ts, harness/upload-boundary-live.spec.ts (annotated) |
| `label-artifact` | string-verified | harness/panel-labels.spec.ts |
| `unlabel-artifact` | string-verified | harness/panel-labels.spec.ts |
| `delete-artifact` | string-verified | harness/destructive-actions-perm.spec.ts |
| `check-panel-status` | string-verified | harness/panel-prefs-preview.spec.ts |
| `store-doc-panel-prefs` | string-verified | harness/panel-prefs-preview.spec.ts |
| `upload-artifact` | string-verified | harness/upload-boundary-live.spec.ts |
| `discover-panel-key` | string-verified | harness/panel-prefs-preview.spec.ts |
| `resolve-artifact-preview` | string-verified | harness/panel-prefs-preview.spec.ts |

## resolver/policies (3 items, 0 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `load-policy` | string-verified | harness/steward-global-persist.spec.ts |
| `store-policy` | string-verified | harness/realm-reservation-persist.spec.ts, harness/space-access-persist.spec.ts, harness/steward-global-persist.spec.ts, unit/sealing-logic.test.mjs |
| `enumerate-realm-rulesets` | string-verified | harness/ruleset-enum-gate.spec.ts |

## resolver/realms (11 items, 2 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `identify-realm` | string-verified | harness/realm-directory-lists.spec.ts |
| `enumerate-realm-seals` | annotated | harness/realm-stale-badge.spec.ts (annotated), harness/steward-force-unseal.spec.ts (annotated) |
| `launch-realm-audit` | **GAP** | — |
| `check-audit-status` | **GAP** | — |
| `steward-unseal` | string-verified | harness/steward-force-unseal.spec.ts |
| `check-user-role` | string-verified | harness/realm-plainuser-gate.spec.ts |
| `request-steward-access` | annotated | harness/realm-plainuser-gate.spec.ts (annotated) |
| `check-steward-request` | annotated | harness/realm-plainuser-gate.spec.ts (annotated) |
| `list-steward-requests` | string-verified | harness/steward-grant-roundtrip.spec.ts |
| `approve-steward-request` | annotated | harness/steward-grant-roundtrip.spec.ts (annotated) |
| `deny-steward-request` | annotated | harness/steward-grant-roundtrip.spec.ts (annotated) |

## resolver/registry (1 items, 1 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `heartbeat` | **GAP** | — |

## resolver/sealing (9 items, 0 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `seal-artifact` | string-verified | harness/page-seal-unseal.spec.ts, unit/sealing-logic.test.mjs |
| `unseal-artifact` | string-verified | harness/page-seal-unseal.spec.ts |
| `extend-seal` | string-verified | harness/operator-seals-stamp.spec.ts, harness/lapsed-seal-lifecycle.spec.ts (annotated) |
| `enumerate-doc-artifacts` | annotated | harness/page-seal-state.spec.ts (annotated), harness/page-seal-unseal.spec.ts (annotated) |
| `enumerate-operator-seals` | string-verified | harness/operator-seals-stamp.spec.ts, harness/realm-directory-lists.spec.ts |
| `enumerate-page-seals` | string-verified | harness/sealed-delete-restore-journey.spec.ts |
| `check-seal-stamp` | string-verified | harness/operator-seals-stamp.spec.ts |
| `restore-sealed-artifact` | string-verified | harness/restore-gate.spec.ts |
| `purge-seal-record` | string-verified | harness/destructive-actions-perm.spec.ts |

## resolver/section-seals (5 items, 1 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `list-page-headings` | string-verified | harness/page-section-seal-create.spec.ts |
| `enumerate-section-seals` | string-verified | harness/page-section-seal-create.spec.ts |
| `seal-section` | string-verified | harness/page-section-seal-create.spec.ts |
| `unseal-section` | string-verified | harness/page-section-seal-create.spec.ts |
| `refresh-section-snapshot` | **GAP** | — |

## resolver/validations (11 items, 2 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `load-validation-config` | annotated | harness/realm-validation-crud.spec.ts (annotated) |
| `store-validation-config` | string-verified | harness/realm-validation-crud.spec.ts |
| `validate-page-now` | string-verified | harness/validation-readouts.spec.ts |
| `get-validation-state` | string-verified | harness/validation-readouts.spec.ts |
| `approve-page-gate` | **GAP** | — |
| `list-ai-models` | string-verified | harness/validation-readouts.spec.ts |
| `enqueue-page-validation` | string-verified | harness/ai-validation-live.spec.ts |
| `get-validation-job` | annotated | harness/ai-validation-live.spec.ts (annotated) |
| `get-ai-findings` | string-verified | harness/validation-readouts.spec.ts, harness/ai-validation-live.spec.ts (annotated) |
| `set-ai-finding-state` | string-verified | harness/validation-readouts.spec.ts |
| `get-validation-audit` | **GAP** | — |

## resolver/workflow (15 items, 1 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `get-page-workflow` | string-verified | harness/page-ribbon-workflow.spec.ts |
| `get-workflow-dashboard` | annotated | e2e/workflow-enforce-e2e.mjs (annotated) |
| `get-workflow-log` | annotated | e2e/workflow-e2e.mjs (annotated) |
| `assign-workflow` | annotated | e2e/workflow-e2e.mjs (annotated) |
| `request-transition` | string-verified | e2e/workflow-conditions-e2e.mjs |
| `load-workflow-config` | **GAP** | — |
| `store-workflow-config` | annotated | harness/workflow-deadend-warn.spec.ts (annotated) |
| `get-space-workflow-settings` | annotated | harness/realm-workflow-persist.spec.ts (annotated), e2e/workflow-autoassign-e2e.mjs (annotated) |
| `set-space-workflow-settings` | string-verified | harness/realm-workflow-persist.spec.ts |
| `bulk-assign-workflow` | annotated | e2e/workflow-bulk-e2e.mjs (annotated) |
| `decide-approval` | string-verified | harness/page-ribbon-workflow.spec.ts, harness/ribbon-approval-dialog.spec.ts |
| `get-page-approvals` | string-verified | harness/ribbon-approval-dialog.spec.ts |
| `list-my-approvals` | string-verified | harness/workflow-pickers-inbox.spec.ts |
| `search-workflow-users` | string-verified | harness/workflow-pickers-inbox.spec.ts |
| `search-workflow-groups` | annotated | harness/workflow-pickers-inbox.spec.ts (annotated) |

## testhook/invoke-seams (73 items, 1 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `expirySweep` | string-verified | harness/expiry-sweep.spec.ts, harness/lapsed-seal-lifecycle.spec.ts |
| `assignWorkflow` | string-verified | harness/page-ribbon-workflow.spec.ts, harness/ribbon-approval-dialog.spec.ts, harness/workflow-pickers-inbox.spec.ts, e2e/workflow-approval-e2e.mjs, e2e/workflow-conditions-e2e.mjs, e2e/workflow-e2e.mjs … +1 more |
| `transitionWorkflow` | string-verified | harness/ribbon-approval-dialog.spec.ts, harness/workflow-pickers-inbox.spec.ts, e2e/workflow-approval-e2e.mjs, e2e/workflow-conditions-e2e.mjs, e2e/workflow-e2e.mjs, e2e/workflow-enforce-e2e.mjs |
| `workflowSweep` | string-verified | e2e/workflow-conditions-e2e.mjs, e2e/workflow-enforce-e2e.mjs |
| `enforceDecision` | string-verified | e2e/workflow-enforce-e2e.mjs |
| `sweepRevert` | string-verified | e2e/workflow-enforce-e2e.mjs |
| `dashboard` | string-verified | e2e/workflow-enforce-e2e.mjs |
| `reqTransition` | string-verified | e2e/workflow-conditions-e2e.mjs |
| `aiVerdict` | string-verified | e2e/workflow-conditions-e2e.mjs |
| `listEditRequests` | string-verified | harness/lapsed-seal-lifecycle.spec.ts |
| `approveEditRequest` | string-verified | harness/lapsed-seal-lifecycle.spec.ts, harness/sealed-owner-intent.spec.ts |
| `denyEditRequest` | string-verified | harness/editreq-request-lifecycle.spec.ts, harness/lapsed-seal-lifecycle.spec.ts, harness/page-editrequest-deny-revoke.spec.ts |
| `extendSeal` | string-verified | harness/lapsed-seal-lifecycle.spec.ts, harness/operator-seals-stamp.spec.ts |
| `listEditGrants` | string-verified | e2e/editgrant-revoke-e2e.mjs |
| `revokeEditGrant` | string-verified | e2e/editgrant-revoke-e2e.mjs |
| `requestSectionEdit` | string-verified | harness/page-section-editrequest.spec.ts |
| `checkSectionEdit` | string-verified | harness/page-section-editrequest.spec.ts |
| `listSectionEditRequests` | string-verified | harness/page-section-editrequest.spec.ts |
| `approveSectionEdit` | string-verified | harness/page-section-editrequest.spec.ts |
| `denySectionEdit` | string-verified | harness/page-section-editrequest.spec.ts |
| `watchArtifact` | string-verified | harness/page-watch-dispatch.spec.ts, harness/steward-force-unseal.spec.ts |
| `checkWatch` | string-verified | harness/page-watch-dispatch.spec.ts |
| `unwatchArtifact` | string-verified | harness/page-watch-dispatch.spec.ts |
| `acknowledgeDispatch` | string-verified | harness/page-watch-dispatch.spec.ts |
| `operatorDispatches` | string-verified | harness/page-watch-dispatch.spec.ts |
| `recentDispatches` | string-verified | harness/page-watch-dispatch.spec.ts |
| `listBreachDispatches` | string-verified | harness/page-watch-dispatch.spec.ts |
| `listPageHeadings` | string-verified | harness/authz-content-gate.spec.ts, harness/page-section-seal-create.spec.ts |
| `enumerateSectionSeals` | string-verified | harness/authz-content-gate.spec.ts, harness/page-section-seal-create.spec.ts |
| `sealSection` | string-verified | harness/authz-content-gate.spec.ts, harness/page-section-seal-create.spec.ts |
| `unsealSection` | string-verified | harness/authz-content-gate.spec.ts, harness/page-section-seal-create.spec.ts |
| `checkUserRole` | string-verified | harness/realm-plainuser-gate.spec.ts |
| `requestStewardAccess` | string-verified | harness/realm-plainuser-gate.spec.ts |
| `checkStewardRequest` | string-verified | harness/realm-plainuser-gate.spec.ts |
| `getWorkflow` | string-verified | e2e/workflow-autoassign-e2e.mjs, e2e/workflow-bulk-e2e.mjs, e2e/workflow-e2e.mjs |
| `setSpaceWorkflowSettings` | string-verified | e2e/workflow-autoassign-e2e.mjs, e2e/workflow-bulk-e2e.mjs, e2e/workflow-enforce-e2e.mjs |
| `getSpaceWorkflowSettings` | string-verified | e2e/workflow-autoassign-e2e.mjs |
| `bulkAssignWorkflow` | string-verified | e2e/workflow-bulk-e2e.mjs |
| `requestApproval` | string-verified | harness/ribbon-approval-dialog.spec.ts, harness/workflow-pickers-inbox.spec.ts, e2e/workflow-approval-e2e.mjs |
| `decideApproval` | string-verified | e2e/workflow-approval-e2e.mjs, e2e/workflow-conditions-e2e.mjs |
| `pageApprovals` | string-verified | e2e/workflow-approval-e2e.mjs |
| `deleteArtifact` | string-verified | harness/destructive-actions-perm.spec.ts |
| `purgeSealRecord` | string-verified | harness/destructive-actions-perm.spec.ts |
| `restoreSealedArtifact` | string-verified | harness/restore-gate.spec.ts |
| `enqueuePageValidation` | string-verified | harness/ai-validation-live.spec.ts |
| `getValidationJob` | string-verified | harness/ai-validation-live.spec.ts |
| `getAiFindings` | string-verified | harness/ai-validation-live.spec.ts, harness/validation-readouts.spec.ts |
| `enumerateRealmRulesets` | string-verified | harness/ruleset-enum-gate.spec.ts |
| `handleSealedArtifactDeleted` | string-verified | harness/perm-delete-cleanup.spec.ts |
| `probeAttachment` | **GAP** | — |
| `handleSealedArtifactTrash` | string-verified | harness/sealed-artifact-trash.spec.ts |
| `lifecycleGuard` | string-verified | harness/trigger-guards.spec.ts |
| `recurringNudgeGuard` | string-verified | harness/trigger-guards.spec.ts |
| `checkLicense` | string-verified | harness/license-banner.spec.ts, unit/license.test.mjs |
| `storeWorkflowConfigProbe` | string-verified | harness/workflow-deadend-warn.spec.ts |
| `ensurePanel` | string-verified | harness/panel-prefs-preview.spec.ts, e2e/ensure-fixture.mjs |
| `requestEditAccess` | string-verified | harness/editreq-request-lifecycle.spec.ts |
| `checkEditRequest` | string-verified | harness/editreq-request-lifecycle.spec.ts |
| `listMyEditRequests` | string-verified | harness/editreq-request-lifecycle.spec.ts |
| `checkPanelStatus` | string-verified | harness/panel-prefs-preview.spec.ts |
| `storeDocPanelPrefs` | string-verified | harness/panel-prefs-preview.spec.ts |
| `discoverPanelKey` | string-verified | harness/panel-prefs-preview.spec.ts |
| `resolvePreview` | string-verified | harness/panel-prefs-preview.spec.ts |
| `enumerateOperatorSeals` | string-verified | harness/realm-directory-lists.spec.ts |
| `checkSealStamp` | string-verified | harness/operator-seals-stamp.spec.ts |
| `validatePageNow` | string-verified | harness/validation-readouts.spec.ts |
| `getValidationState` | string-verified | harness/validation-readouts.spec.ts |
| `listAiModels` | string-verified | harness/validation-readouts.spec.ts |
| `setAiFindingState` | string-verified | harness/validation-readouts.spec.ts |
| `listMyApprovals` | string-verified | harness/workflow-pickers-inbox.spec.ts |
| `searchWorkflowUsers` | string-verified | harness/workflow-pickers-inbox.spec.ts |
| `searchWorkflowGroups` | string-verified | harness/workflow-pickers-inbox.spec.ts |
| `loadBulletinToggles` | string-verified | harness/bulletin-toggles.spec.ts |

## testhook/what-verbs (7 items, 1 gaps)

| Item | Coverage | Evidence |
|---|---|---|
| `version` | string-verified | harness/deploy-state-guard.spec.ts |
| `kvs` | string-verified | harness/ai-validation-live.spec.ts, harness/bulletin-toggles.spec.ts, harness/destructive-actions-perm.spec.ts, harness/editreq-request-lifecycle.spec.ts, harness/expiry-sweep.spec.ts, harness/gate-revert.spec.ts … +40 more |
| `set` | string-verified | harness/ai-validation-live.spec.ts, harness/bulletin-toggles.spec.ts, harness/destructive-actions-perm.spec.ts, harness/editreq-request-lifecycle.spec.ts, harness/expiry-sweep.spec.ts, harness/gate-revert.spec.ts … +35 more |
| `delete` | string-verified | harness/ai-validation-live.spec.ts, harness/bulletin-toggles.spec.ts, harness/destructive-actions-perm.spec.ts, harness/editreq-request-lifecycle.spec.ts, harness/expiry-sweep.spec.ts, harness/gate-revert.spec.ts … +42 more |
| `setttl` | **GAP** | — |
| `query` | string-verified | harness/realm-stale-badge.spec.ts, harness/ribbon-approval-dialog.spec.ts, harness/sealed-delete-restore-journey.spec.ts, harness/workflow-pickers-inbox.spec.ts |
| `invoke` | string-verified | harness/ai-validation-live.spec.ts, harness/authz-content-gate.spec.ts, harness/bulletin-toggles.spec.ts, harness/destructive-actions-perm.spec.ts, harness/editreq-request-lifecycle.spec.ts, harness/expiry-sweep.spec.ts … +25 more |

