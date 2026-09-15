/*
 * DEV-ONLY test-state web trigger for the forge-live-harness E2E suite.
 * Gated by HARNESS_SECRET (set ONLY in the development environment). Returns 404
 * unless the secret is configured (absent in prod) AND matches the Bearer header.
 * Read-only: a generic KVS get covers seal records (protection-{id}), section
 * records (section-protection-{id} incl. stored hash), validation findings/gate,
 * and grants — the deterministic state the harness asserts against.
 */
import { kvs, WhereConditions } from "@forge/kvs";
import { expirySweepTask, workflowSweep, collectWorkflowEnforcementForPage, sweepRevertToApproved, handleSealedArtifactDeleted, handleSealedArtifactTrash, lifecycleTrigger, recurringNudgeTask } from "./server/triggers";
import {
  assignPageWorkflow,
  transitionPageWorkflow,
  getPageWorkflow,
  getWorkflowLog,
  getSpaceWorkflowSettings,
  setSpaceWorkflowSettings,
  bulkAssignPagesInSpace,
  readPageWorkflow,
  storeWorkflowConfig, fetchLivePageVersion, autoAssignOnEvent } from "./server/capsules/workflow/logic.js";
import {
  requestApprovalTransition,
  decideApproval,
  getPageApprovalStatus,
} from "./server/capsules/workflow/approvals.js";
import { getWorkflowDashboard, requestTransition, actions as workflowActions } from "./server/capsules/workflow/actions.js";
import { applyAiVerdict } from "./server/capsules/workflow/approvals.js";
import { revokeEditGrant, listEditGrants } from "./server/capsules/editreq/actions.js";
// #6: section edit-access request/approve/deny seams (editreq is Queue/LLM-free — import-safe).
import {
  requestSectionEdit,
  checkSectionEdit,
  listSectionEditRequests,
  approveSectionEdit,
  denySectionEdit,
  // Owner feedback F1/F4 (2026-08-27): the attachment approve/deny pair, so the harness can prove
  // the asymmetry that made "Approve" look like a dead button — approve refuses a lapsed seal,
  // deny never did. Both paths gate on the caller's own accountId against the seal record and
  // never touch content, so a synthetic actor is still valid here (unlike the SV-SEC-1 resolvers).
  listEditRequests,
  approveEditRequest,
  denyEditRequest,
  // Coverage gaps (2026-09-05): the non-exported request/check/list-my trio is reached through the
  // capsule's registered `actions` list (byKey below) — the same fn the resolver router calls.
  actions as editreqActions,
} from "./server/capsules/editreq/actions.js";
// #13: watch/bulletins capsule seams (bulletins/actions.js → @forge/kvs + bulletin-flags → baseline;
// all Queue/LLM-free → it17-safe).
import {
  watchArtifact,
  checkWatch,
  unwatchArtifact,
  acknowledgeDispatch,
  operatorDispatches,
  recentDispatches,
  listBreachDispatches,
  actions as bulletinsActions,
} from "./server/capsules/bulletins/actions.js";
// B6: section-seal CREATION resolvers (section-seals imports workflow/logic + sealing/logic, both
// already in the hook bundle → no new problematic deps; the page read/write is asApp).
import {
  listPageHeadings,
  enumerateSectionSeals,
  sealSection,
  unsealSection,
} from "./server/capsules/section-seals/actions.js";
// 5.0 byline chip + page-details modal: the property writer and the summary resolver (both light —
// classification/provider + section-seals/logic + editreq/logic, all already in the bundle).
import { refreshByline } from "./server/capsules/page-details/byline.js";
import { pageDetailsSummary } from "./server/capsules/page-details/actions.js";
// 5.0 classification: the six resolvers as an ACTOR, so the authorization negatives (a real
// non-admin account naming a page it cannot edit, a non-site-admin managing levels) can be driven
// from a spec — the browser only ever carries the harness user's own token.
import { actions as classificationActions } from "./server/capsules/classification/actions.js";
// B7: plain-user persona resolvers (realms/actions.js is now import-safe after the it57 lazy-Queue
// refactor). check-user-role returns "user" for a synthetic actor (asUser has no webtrigger context);
// the steward-request flow is asApp + KVS.
import {
  checkUserRole,
  requestStewardAccess,
  checkStewardRequest,
} from "./server/capsules/realms/actions.js";
// it46: destructive-action permission-matrix seams (Queue/LLM-free modules — safe to import).
import { deleteArtifact, actions as panelsActions } from "./server/capsules/panels/actions.js";
import { purgeSealRecord, restoreSealedArtifact, extendSeal, actions as sealingActions } from "./server/capsules/sealing/actions.js";
// Fixture repair (2026-09-05): the inline-panel macro is stripped from the fixture page whenever a
// spec relinquishes its last seal, and six browser specs then fail on a page with no panel.
// ensure-fixture.mjs step 7b re-inserts it through the app's own insertion path (asApp).
import { insertPanelNode, resolveExtensionKey } from "./server/infra/doc-surgery.js";
// resolvePreview's download leg runs asUser(), which has no session in a webtrigger, so the seam
// also reports the gate decision on its own — otherwise an allowed-but-undownloadable preview is
// indistinguishable from a refused one (both are null).
import { canReadPage } from "./server/shared/content-access.js";
// A1: activity-log read seams. The capsule is KVS + the two shared gates only (Queue/LLM-free —
// import-safe). Both gated resolvers need a REAL account: the page feed asks Confluence whether
// the actor can read the page, the space report resolves stewardship through the KVS adminUsers
// list (asUser has no session in a webtrigger — same shape as the getWorkflowDashboard seam).
import { actions as activityActions } from "./server/capsules/activity/actions.js";
// B11: live AI validation pipeline. validations/actions.js is import-safe after the it57 lazy-Queue
// refactor (ai-validation-queue is now built at push time, not module load — the it17 trap). The real
// Forge LLM runs in the queue consumer; the enqueue/poll/findings resolvers are the driveable seam.
import {
  enqueuePageValidation,
  getValidationJob,
  getAiFindings,
  actions as validationsActions,
} from "./server/capsules/validations/actions.js";
// B15: cross-space ruleset enumeration — now site-admin gated (was ungated → leaked every space's
// steward list). policies/actions.js is Queue/LLM-free → import-safe.
import { enumerateRealmRulesets } from "./server/capsules/policies/actions.js";
// C1: license read-through (dev-safe, fail-open). Drives a synthetic context.license.
import { checkLicense } from "./server/capsules/entitlements/actions.js";
// Build stamp (generated by scripts/gen-build-info.mjs; committed placeholder always resolves).
// what=version returns it so specs can detect a stale deploy before asserting anything else.
import { BUILD_INFO } from "./build-info.js";

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": ["application/json"] },
  body: JSON.stringify(body),
});
const notFound = () => ({ statusCode: 404, headers: { "Content-Type": ["text/plain"] }, body: "not found" });
const q = (req, n) => {
  const v = req && req.queryParameters && req.queryParameters[n];
  return Array.isArray(v) ? v[0] : v;
};
// Resolve a capsule's registered action by key — for resolvers the capsule does not export by
// name. Dispatching through the same `actions` list registry.js consumes means the seam drives the
// exact function the router would, not a copy.
const byKey = (list, key) => (list.find(([k]) => k === key) || [])[1];

export async function testStateTrigger(req) {
  const secret = process.env.HARNESS_SECRET;
  if (!secret) return notFound();
  const authArr = (req && req.headers && (req.headers.authorization || req.headers.Authorization)) || null;
  const auth = Array.isArray(authArr) ? authArr[0] : authArr;
  const provided = typeof auth === "string" ? auth.replace(/^Bearer\s+/i, "").trim() : "";
  if (!provided || provided !== secret) return notFound();

  const what = q(req, "what") || "kvs";
  try {
    // Deploy-staleness probe: which build is this BACKEND bundle actually serving? Pair with the
    // data-sv-build DOM attribute on the console roots for the frontend half (the it26 lesson).
    if (what === "version") {
      return json(200, { build: BUILD_INFO });
    }
    if (what === "kvs") {
      const key = q(req, "key");
      if (!key) return json(400, { error: "key required" });
      return json(200, { key, value: (await kvs.get(key)) ?? null });
    }
    // DEV-ONLY writes (gated by the same secret) so deterministic suites can set up
    // state (e.g. a validation rule) and restore it. `value` is URL-encoded JSON.
    if (what === "set") {
      const key = q(req, "key");
      const valueStr = q(req, "value");
      if (!key || valueStr === undefined) return json(400, { error: "key+value required" });
      await kvs.set(key, JSON.parse(valueStr));
      return json(200, { set: key });
    }
    if (what === "delete") {
      const key = q(req, "key");
      if (!key) return json(400, { error: "key required" });
      await kvs.delete(key);
      return json(200, { deleted: key });
    }
    // DEV-ONLY: empirically exercise the shared TTL helper (the hunt found { expiresAt } was
    // silently invalid; this seam proves whatever shape kvs-ttl.js uses ACTUALLY persists).
    if (what === "setttl") {
      const key = q(req, "key");
      if (!key) return json(400, { error: "key required" });
      try {
        const { setWithTtl } = await import("./server/shared/kvs-ttl.js");
        await setWithTtl(key, { probe: true, at: new Date().toISOString() }, Number(q(req, "ms")) || 300000);
        return json(200, { setttl: key, readBack: (await kvs.get(key)) ?? null });
      } catch (e) {
        return json(200, { setttl: key, error: String(e?.message || e) });
      }
    }
    // DEV-ONLY read: run an EVENTUALLY-CONSISTENT kvs.query for a prefix and return the keys.
    // Specs that seed an index row and then drive a query-backed surface (realm sealed files)
    // MUST poll this until the seeded key is query-visible — per-key gets prove nothing (it45).
    if (what === "query") {
      const prefix = q(req, "prefix");
      if (!prefix) return json(400, { error: "prefix required" });
      const { results } = await kvs.query().where("key", WhereConditions.beginsWith(prefix)).limit(100).getMany();
      return json(200, { prefix, keys: (results || []).map((r) => r.key) });
    }
    // DEV-ONLY: invoke a scheduled task on demand so the harness can assert the scheduled tier
    // deterministically (no waiting for the daily/hourly cron).
    if (what === "invoke") {
      const fn = q(req, "fn");
      // Config REST API (docs/REST-CONFIG-API.md): mint/revoke a token as an ACTOR so the live
      // spec (config-api.spec.ts) can drive the static web trigger with plain fetch. The seam
      // calls the same tokens.js store the resolver does; the site-admin gate is the resolver's
      // (the hook is dev-only and secret-gated).
      if (fn === "createApiToken") {
        const { createApiToken } = await import("./server/capsules/config-api/tokens.js");
        const r = await createApiToken({ name: q(req, "name") || "harness", role: q(req, "role") || undefined, accountId: q(req, "actor") });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "revokeApiToken") {
        const { revokeApiToken } = await import("./server/capsules/config-api/tokens.js");
        return json(200, { invoked: fn, result: await revokeApiToken(q(req, "id")) });
      }
      if (fn === "runApiJob") {
        // Drive the consumer synchronously when the queue is slow (dev queues can lag minutes).
        const { runJob } = await import("./server/capsules/config-api/consumer.js");
        return json(200, { invoked: fn, result: await runJob(q(req, "id")) });
      }
      if (fn === "expirySweep") {
        const r = await expirySweepTask();
        let result = null;
        try { result = JSON.parse(r?.body || "null"); } catch (_) { /* non-JSON */ }
        return json(200, { invoked: fn, result });
      }
      // Workflow engine (#42) — drive the real storage/state-machine paths that
      // REST cannot reach (UI-only resolvers). Dev-gated by the same secret.
      if (fn === "assignWorkflow") {
        const r = await assignPageWorkflow({
          pageId: q(req, "pageId"),
          spaceKey: q(req, "spaceKey"),
          actorAccountId: q(req, "actor") || "harness",
          actorName: q(req, "actorName") || "Harness",
          workflowId: q(req, "workflowId"),
        });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "transitionWorkflow") {
        // #44: optional approvers + approvedVersion passthrough so enforce scenarios can
        // seed the privileged set and baseline deterministically.
        const apprCsv = q(req, "approvers");
        const av = q(req, "approvedVersion");
        const r = await transitionPageWorkflow({
          pageId: q(req, "pageId"),
          spaceKey: q(req, "spaceKey"),
          toStateId: q(req, "to"),
          actorAccountId: q(req, "actor") || "harness",
          actorName: q(req, "actorName") || "Harness",
          reason: q(req, "reason"),
          approvers: apprCsv ? apprCsv.split(",").filter(Boolean) : undefined,
          approvedVersion: av != null ? parseInt(av, 10) : undefined,
        });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "workflowSweep") {
        const r = await workflowSweep();
        let result = null;
        try { result = JSON.parse(r?.body || "null"); } catch (_) { /* non-JSON */ }
        return json(200, { invoked: fn, result });
      }
      // #44 test seams — drive the enforcement decision with a SYNTHETIC actor (the
      // harness's real user is a steward, so a real edit is always privileged).
      if (fn === "enforceDecision") {
        const r = await collectWorkflowEnforcementForPage(
          q(req, "pageId"), q(req, "actor"),
          q(req, "eventVersion") ? parseInt(q(req, "eventVersion"), 10) : null,
          q(req, "sysAccount") || "sv-app",
        );
        return json(200, { invoked: fn, result: r ? { action: r.action } : { action: null } });
      }
      if (fn === "sweepRevert") {
        const rec = await readPageWorkflow(q(req, "pageId"));
        const ok = await sweepRevertToApproved(q(req, "pageId"), rec);
        return json(200, { invoked: fn, result: { reverted: !!ok, wrote: ok ? ok.wrote : null, version: ok ? ok.version : null } });
      }
      if (fn === "dashboard") {
        // SV-SEC-1: get-workflow-dashboard is steward-gated now (it returns a whole space's page
        // inventory), so the seam has to pass a caller. In a webtrigger asUser() has no context,
        // so isOperatorSteward resolves only via the explicit adminUsers list in KVS — which is
        // exactly what the e2e seeds, and what makes this assert the gate rather than bypass it.
        const r = await getWorkflowDashboard({
          payload: { spaceKey: q(req, "spaceKey") },
          context: { accountId: q(req, "actor") },
        });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "reqTransition") {
        // #46: drive the GATED transition resolver (content conditions + AI axis), not the
        // raw engine — so the harness exercises the entryConditions gate.
        const r = await requestTransition({
          payload: { pageId: q(req, "pageId"), toStateId: q(req, "to"), spaceKey: q(req, "spaceKey") },
          context: { accountId: q(req, "actor") || "harness" },
        });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "aiVerdict") {
        // #46: simulate the async worker's verdict landing (deterministic — bypasses the LLM).
        const r = await applyAiVerdict(
          q(req, "pageId"),
          q(req, "version") ? parseInt(q(req, "version"), 10) : null,
          q(req, "status"),
          q(req, "reason") || null,
        );
        return json(200, { invoked: fn, result: r });
      }
      // Owner feedback F1 (2026-08-27): approve/deny an ATTACHMENT edit request. The pair exists
      // so a spec can assert what the owner reported — on a lapsed seal, deny succeeds and
      // approve refuses, which is why the request stayed on screen.
      if (fn === "listEditRequests") {
        const r = await listEditRequests({ payload: { attachmentId: q(req, "att") }, context: { accountId: q(req, "actor") } });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "approveEditRequest") {
        const r = await approveEditRequest({ payload: { attachmentId: q(req, "att"), requesterAccountId: q(req, "requester") }, context: { accountId: q(req, "actor") } });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "denyEditRequest") {
        const r = await denyEditRequest({ payload: { attachmentId: q(req, "att"), requesterAccountId: q(req, "requester") }, context: { accountId: q(req, "actor") } });
        return json(200, { invoked: fn, result: r });
      }
      // Owner feedback F4: extend a seal's retention period. Owner-or-steward against the seal
      // record, no content call, so a synthetic actor drives it.
      if (fn === "extendSeal") {
        const secs = Number(q(req, "seconds"));
        const r = await extendSeal({
          payload: { attachmentId: q(req, "att"), additionalSeconds: Number.isFinite(secs) && secs > 0 ? secs : undefined },
          context: { accountId: q(req, "actor") },
        });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "listEditGrants") {
        const r = await listEditGrants({ payload: { attachmentId: q(req, "att") }, context: { accountId: q(req, "actor") } });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "revokeEditGrant") {
        const r = await revokeEditGrant({ payload: { attachmentId: q(req, "att"), editorAccountId: q(req, "editor") }, context: { accountId: q(req, "actor") } });
        return json(200, { invoked: fn, result: r });
      }
      // #6: section edit-access flow — drive the request/approve/deny resolvers with synthetic
      // actors (the owner/requester paths need distinct accountIds a single REST user can't supply).
      if (fn === "requestSectionEdit") {
        const r = await requestSectionEdit({ payload: { sectionId: q(req, "section"), reason: q(req, "reason") }, context: { accountId: q(req, "actor") } });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "checkSectionEdit") {
        const r = await checkSectionEdit({ payload: { sectionId: q(req, "section") }, context: { accountId: q(req, "actor") } });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "listSectionEditRequests") {
        const r = await listSectionEditRequests({ payload: { sectionId: q(req, "section") }, context: { accountId: q(req, "actor") } });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "approveSectionEdit") {
        const r = await approveSectionEdit({ payload: { sectionId: q(req, "section"), requesterAccountId: q(req, "requester") }, context: { accountId: q(req, "actor") } });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "denySectionEdit") {
        const r = await denySectionEdit({ payload: { sectionId: q(req, "section"), requesterAccountId: q(req, "requester") }, context: { accountId: q(req, "actor") } });
        return json(200, { invoked: fn, result: r });
      }
      // #13: watch / bulletin-dispatch flow (synthetic actor + attachment/notification ids).
      if (fn === "watchArtifact") {
        const r = await watchArtifact({ payload: { attachmentId: q(req, "att") }, context: { accountId: q(req, "actor") } });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "checkWatch") {
        const r = await checkWatch({ payload: { attachmentId: q(req, "att") }, context: { accountId: q(req, "actor") } });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "unwatchArtifact") {
        const r = await unwatchArtifact({ payload: { attachmentId: q(req, "att") }, context: { accountId: q(req, "actor") } });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "acknowledgeDispatch") {
        const r = await acknowledgeDispatch({ payload: { notificationId: q(req, "nid") }, context: { accountId: q(req, "actor") } });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "operatorDispatches") {
        const r = await operatorDispatches({ payload: {}, context: { accountId: q(req, "actor") } });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "recentDispatches") {
        const r = await recentDispatches({ payload: { pageId: q(req, "pageId") }, context: { accountId: q(req, "actor") } });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "listBreachDispatches") {
        const r = await listBreachDispatches({ payload: {}, context: { accountId: q(req, "actor") } });
        return json(200, { invoked: fn, result: r });
      }
      // B6: section-seal creation flow — drive the real resolvers (create/seal/unseal a section on a
      // DISPOSABLE page) with a synthetic actor; the page read/write is asApp so it works here.
      if (fn === "listPageHeadings") {
        const r = await listPageHeadings({ payload: { pageId: q(req, "pageId") }, context: { accountId: q(req, "actor") } });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "enumerateSectionSeals") {
        const r = await enumerateSectionSeals({ payload: { pageId: q(req, "pageId") }, context: { accountId: q(req, "actor") } });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "sealSection") {
        const r = await sealSection({
          payload: { pageId: q(req, "pageId"), headingIndex: q(req, "hi") != null ? parseInt(q(req, "hi"), 10) : null, headingText: q(req, "htext"), lockDuration: q(req, "dur") != null ? parseInt(q(req, "dur"), 10) : undefined },
          context: { accountId: q(req, "actor") },
        });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "unsealSection") {
        const r = await unsealSection({ payload: { sectionId: q(req, "section") }, context: { accountId: q(req, "actor") } });
        return json(200, { invoked: fn, result: r });
      }
      // B7: plain-user persona — role gate + steward-request flow with a synthetic non-steward actor.
      if (fn === "checkUserRole") {
        const r = await checkUserRole({ payload: { spaceKey: q(req, "spaceKey") }, context: { accountId: q(req, "actor") } });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "requestStewardAccess") {
        const r = await requestStewardAccess({ payload: { spaceKey: q(req, "spaceKey") }, context: { accountId: q(req, "actor") } });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "checkStewardRequest") {
        const r = await checkStewardRequest({ payload: { spaceKey: q(req, "spaceKey") }, context: { accountId: q(req, "actor") } });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "getWorkflow") {
        // With an `actor`, go through the REGISTERED resolver (read gate, requiresApproval,
        // liveVersion, enforceMode — A4) instead of the logic layer; without one, the legacy
        // logic-layer read the older specs rely on.
        if (q(req, "actor")) {
          const r = await byKey(workflowActions, "get-page-workflow")({
            payload: { pageId: q(req, "pageId"), spaceKey: q(req, "spaceKey"), withLog: !!q(req, "withLog") },
            context: { accountId: q(req, "actor"), extension: {} },
          });
          return json(200, { invoked: fn, result: r });
        }
        const result = await getPageWorkflow(q(req, "pageId"), q(req, "spaceKey"));
        if (q(req, "withLog")) result.log = await getWorkflowLog(q(req, "pageId"));
        return json(200, { invoked: fn, result });
      }
      // A4: the raw workflow log on its own — the approval-evidence spec asserts the transition
      // entry's details.approvalRecord and the `approval-denied` entry a denial leaves behind.
      if (fn === "getWorkflowLog") {
        return json(200, { invoked: fn, result: { log: await getWorkflowLog(q(req, "pageId")) } });
      }
      if (fn === "setSpaceWorkflowSettings") {
        // A2/A5: `demoteTo` (stateId | "initial"), `reviewAfterDays` (int), `enforceMode`, and the
        // JSON-valued `reviewAfterDaysByState` / `entryConditions` / `approval` pass through to the
        // same validation the resolver runs (a bad demoteTo is REFUSED, not stored). An optional
        // `settings` JSON param is merged underneath the named ones for anything else.
        const jsonParam = (n) => { const v = q(req, n); if (!v) return undefined; try { return JSON.parse(v); } catch (_) { return undefined; } };
        const rad = q(req, "reviewAfterDays");
        const r = await setSpaceWorkflowSettings(q(req, "spaceKey"), {
          ...(jsonParam("settings") || {}),
          enabled: q(req, "enabled") === "1",
          autoAssignNew: q(req, "autoAssignNew") === "1",
          workflowId: q(req, "workflowId"),
          ...(q(req, "enforceMode") ? { enforceMode: q(req, "enforceMode") } : {}),
          ...(rad != null && rad !== "" ? { reviewAfterDays: parseInt(rad, 10) } : {}),
          ...(q(req, "demoteTo") ? { demoteTo: q(req, "demoteTo") } : {}),
          ...(jsonParam("reviewAfterDaysByState") !== undefined ? { reviewAfterDaysByState: jsonParam("reviewAfterDaysByState") } : {}),
          ...(jsonParam("entryConditions") !== undefined ? { entryConditions: jsonParam("entryConditions") } : {}),
          ...(jsonParam("approval") !== undefined ? { approval: jsonParam("approval") } : {}),
        });
        return json(200, { invoked: fn, result: r });
      }
      // A5: the steward-editable review date, through the REGISTERED resolver (both gates run, so
      // the actor must be a REAL account that can edit the page; `reviewDueAt` "" / "null" clears).
      // B1: the created-page auto-assign path with label-scoped selection, driven directly.
      if (fn === "autoAssign") {
        const r = await autoAssignOnEvent({ pageId: q(req, "pageId"), spaceKey: q(req, "spaceKey"), actorAccountId: q(req, "actor"), actorName: q(req, "actor") });
        return json(200, { invoked: fn, result: r });
      }
      // 5.0: recompute + write the byline property for a page (what every seal/section/classification
      // write does with one line), and the page-details summary for an actor.
      if (fn === "refreshByline") {
        const r = await refreshByline(q(req, "pageId"), { force: q(req, "force") === "1" });
        return json(200, { invoked: fn, result: r });
      }
      // Generic actor seam (2026-09-15): drive ANY registered resolver as an actor through the exact
      // handler the router would call. Dev-only (HARNESS_SECRET gate) — the resolver's own gates
      // still apply to the actor named, which is the whole point of driving it this way.
      if (fn === "invoke") {
        const key = q(req, "key");
        let payload = {};
        try { payload = q(req, "payload") ? JSON.parse(q(req, "payload")) : {}; } catch (_) { payload = {}; }
        const { wrappedActions } = await import("./server/registry.js");
        const handler = byKey(wrappedActions, key);
        if (!handler) return json(400, { error: `unknown resolver key ${key}` });
        const r = await handler({ payload, context: { accountId: q(req, "actor"), extension: {} } });
        return json(200, { invoked: key, result: r });
      }
      if (fn.startsWith("classification.")) {
        const key = "classification-" + fn.slice("classification.".length);
        let payload = {};
        try { payload = q(req, "payload") ? JSON.parse(q(req, "payload")) : {}; } catch (_) { payload = {}; }
        const handler = byKey(classificationActions, key);
        if (!handler) return json(400, { error: `unknown classification fn ${key}` });
        const r = await handler({ payload, context: { accountId: q(req, "actor"), extension: {} } });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "pageDetailsSummary") {
        const r = await pageDetailsSummary({ payload: { pageId: q(req, "pageId") }, context: { accountId: q(req, "actor"), extension: {} } });
        return json(200, { invoked: fn, result: r });
      }
      // B1: the definition editor's resolvers (steward-gated on the space named).
      if (fn === "listSpaceWorkflows" || fn === "storeSpaceWorkflow" || fn === "deleteSpaceWorkflow") {
        const key = { listSpaceWorkflows: "list-space-workflows", storeSpaceWorkflow: "store-space-workflow", deleteSpaceWorkflow: "delete-space-workflow" }[fn];
        let def; try { def = q(req, "def") ? JSON.parse(q(req, "def")) : undefined; } catch (_) { def = undefined; }
        const labels = q(req, "labels") ? String(q(req, "labels")).split(",") : undefined;
        const r = await byKey(workflowActions, key)({ payload: { spaceKey: q(req, "spaceKey"), workflowId: q(req, "workflowId") || undefined, def, labels, priority: q(req, "priority") }, context: { accountId: q(req, "actor"), extension: {} } });
        return json(200, { invoked: fn, result: r });
      }
      // B3: the approver's signature device. `enrollSignature` returns the secret (it leaves the
      // app exactly once, at enrolment) so a spec can compute codes like an authenticator would.
      if (fn === "signatureStatus" || fn === "enrollSignature" || fn === "confirmSignatureEnrollment" || fn === "revokeSignature") {
        const key = { signatureStatus: "signature-status", enrollSignature: "enroll-signature", confirmSignatureEnrollment: "confirm-signature-enrollment", revokeSignature: "revoke-signature" }[fn];
        const r = await byKey(workflowActions, key)({ payload: { code: q(req, "code") }, context: { accountId: q(req, "actor"), extension: {} } });
        return json(200, { invoked: fn, result: r });
      }
      // B2: read confirmations — the caller's own ack, the counts, and the steward report.
      if (fn === "confirmRead") {
        const r = await byKey(workflowActions, "confirm-read")({ payload: { pageId: q(req, "pageId") }, context: { accountId: q(req, "actor"), extension: {} } });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "getReadStatus") {
        const r = await byKey(workflowActions, "get-read-status")({ payload: { pageId: q(req, "pageId") }, context: { accountId: q(req, "actor"), extension: {} } });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "getReadReport") {
        const r = await byKey(workflowActions, "get-read-report")({ payload: { pageId: q(req, "pageId") }, context: { accountId: q(req, "actor"), extension: {} } });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "setReviewDue") {
        const raw = q(req, "reviewDueAt");
        const r = await byKey(workflowActions, "set-review-due")({
          payload: { pageId: q(req, "pageId"), reviewDueAt: raw && raw !== "null" ? raw : null, reason: q(req, "reason") },
          context: { accountId: q(req, "actor"), extension: {} },
        });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "getSpaceWorkflowSettings") {
        return json(200, { invoked: fn, result: await getSpaceWorkflowSettings(q(req, "spaceKey")) });
      }
      if (fn === "bulkAssignWorkflow") {
        const r = await bulkAssignPagesInSpace({
          spaceKey: q(req, "spaceKey"),
          spaceId: q(req, "spaceId"),
          cursor: q(req, "cursor") || null,
          actorAccountId: q(req, "actor") || "harness",
        });
        return json(200, { invoked: fn, result: r });
      }
      // Approvals (#43): drive the multi-approver flow the resolvers gate on.
      if (fn === "requestApproval") {
        const approvers = (q(req, "approvers") || "").split(",").filter(Boolean);
        const r = await requestApprovalTransition({
          pageId: q(req, "pageId"), toStateId: q(req, "to"), toStateName: q(req, "toName") || q(req, "to"), spaceKey: q(req, "spaceKey"),
          approvers, mode: q(req, "mode") || "any", min: parseInt(q(req, "min"), 10) || 1,
          actorAccountId: q(req, "actor") || "harness", actorName: "Harness",
          // Default to the LIVE version, as the request-transition resolver does — a request
          // pinned to nothing approves nothing (no evidence chip, no version link).
          pinnedVersion: parseInt(q(req, "pinnedVersion"), 10) || (await fetchLivePageVersion(q(req, "pageId"))) || null,
        });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "decideApproval") {
        const r = await decideApproval({
          pageId: q(req, "pageId"), approverAccountId: q(req, "approver"),
          decision: q(req, "decision"), reason: q(req, "reason"), actorName: q(req, "approver"),
          signatureCode: q(req, "code") || null, // B3
        });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "pageApprovals") {
        return json(200, { invoked: fn, result: await getPageApprovalStatus(q(req, "pageId")) });
      }
      // it46: destructive gated actions — drive the PERMISSION MATRIX with a synthetic actor +
      // a FAKE att id (denials return before any REST; a fake id 404s on the REST probe → no-op).
      if (fn === "deleteArtifact") {
        const r = await deleteArtifact({ payload: { attachmentId: q(req, "att") }, context: { accountId: q(req, "actor") || "harness" } });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "purgeSealRecord") {
        const r = await purgeSealRecord({ payload: { attachmentId: q(req, "att") }, context: { accountId: q(req, "actor") || "harness" } });
        return json(200, { invoked: fn, result: r });
      }
      // B8: restore-sealed-artifact gate + unrecoverable path (fake att id → 404 probe → no real restore).
      if (fn === "restoreSealedArtifact") {
        const r = await restoreSealedArtifact({ payload: { attachmentId: q(req, "att") }, context: { accountId: q(req, "actor") || "harness" } });
        return json(200, { invoked: fn, result: r });
      }
      // B11: live AI validation. enqueue authorizes against the page's REAL space (steward-gated) →
      // pass a real steward's accountId as actor. The queue consumer runs the real Forge LLM (Haiku).
      if (fn === "enqueuePageValidation") {
        const r = await enqueuePageValidation({ payload: { pageId: q(req, "page"), spaceKey: q(req, "space") }, context: { accountId: q(req, "actor") } });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "getValidationJob") {
        const r = await getValidationJob({ payload: { taskId: q(req, "task") } });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "getAiFindings") {
        // SV-SEC-1 fallout, found 2026-08-27 by running the opt-in live-LLM spec: the resolver
        // now reads req.context.extension and req.context.accountId, and this seam passed NO
        // context at all — so it threw "Cannot read properties of undefined (reading 'extension')"
        // before reaching any assertion. It went unnoticed because the only spec that drives it is
        // gated behind SV_LIVE_LLM=1 and so never ran after that patch. Pass a real caller, the
        // way every other gated seam does; the findings quote the page body back, so the read gate
        // is correct and the actor has to be someone who can actually read the page.
        const r = await getAiFindings({
          payload: { pageId: q(req, "page"), spaceKey: q(req, "space") },
          context: { accountId: q(req, "actor") },
        });
        return json(200, { invoked: fn, result: r });
      }
      // B15: the cross-space ruleset enumeration is now site-admin gated. In the webtrigger asUser
      // has no session, so canWriteGlobal is always false → a non-site-admin caller gets []. The
      // e2e pairs this with a `what=kvs` check that admin-settings-space-* is non-empty, proving the
      // [] comes from the gate suppressing real data (the leak is closed), not from an empty store.
      if (fn === "enumerateRealmRulesets") {
        const r = await enumerateRealmRulesets({ context: { accountId: q(req, "actor") } });
        return json(200, { invoked: fn, result: r });
      }
      // B13: permanent-delete cleanup. Mirrors the real trigger: read the seeded seal record from
      // KVS (protection-{att}), then run the cleanup. Pass a FAKE pageId so the final notice fails
      // (postDocFootnote 4xx) — the ordering fix means the KVS purge STILL runs (regression guard).
      if (fn === "handleSealedArtifactDeleted") {
        const att = q(req, "att");
        const sealRecord = await kvs.get(`protection-${att}`);
        if (!sealRecord) return json(200, { invoked: fn, result: { skipped: "no seal record" } });
        // Fault injection: failAfter=notice forces a nonexistent pageId so the final notice
        // (postDocFootnote) 4xxes — proving the KVS purge still runs after a notice failure
        // (the B13 ordering guarantee), without weakening any production code path.
        // failAfter=kvs is NOT implemented: kvs.delete has no injectable seam, and we will not
        // touch production code to fabricate one — callers get an explicit 400, never a silent no-op.
        const failAfter = q(req, "failAfter");
        if (failAfter && failAfter !== "notice") {
          return json(400, { error: `failAfter=${failAfter} not implemented (only "notice"; a kvs seam would require weakening production code)` });
        }
        const page = failAfter === "notice"
          ? "999999999999" // nonexistent page → sendViolationNotifications 4xxes, purge must survive
          : (q(req, "page") || sealRecord.contentId);
        await handleSealedArtifactDeleted(
          sealRecord, att, page,
          q(req, "actor") || "harness-deleter",
          { title: sealRecord.attachmentName || "seal-me.txt" },
        );
        return json(200, { invoked: fn, result: { ran: true, failAfter: failAfter || null } });
      }
      // Fix 5 diag: run the shared attachment probe AS THE APP (asApp semantics can differ from
      // a user token — the classifier decision table must hold for the identity that runs it).
      if (fn === "probeAttachment") {
        const { probeAttachmentStatus } = await import("./server/infra/attachment-status.js");
        const r = await probeAttachmentStatus(q(req, "att"));
        return json(200, { invoked: fn, result: r });
      }
      // Fix 2 (incident 2026-07-22): trash-restore with a UI-shaped event payload. `bare=1` omits
      // version AND container (the shape the Confluence UI delete emitted on 07-22, which the old
      // guards silently abandoned) so the probe fetch-and-proceed path is exercised for real.
      if (fn === "handleSealedArtifactTrash") {
        const att = q(req, "att");
        const sealRecord = await kvs.get(`protection-${att}`);
        if (!sealRecord) return json(200, { invoked: fn, result: { skipped: "no seal record" } });
        const bare = !!q(req, "bare");
        const attachment = bare
          ? { id: att }
          : { id: att, title: sealRecord.attachmentName, version: { number: Number(q(req, "ver")) || 1 } };
        await handleSealedArtifactTrash(
          sealRecord, att,
          bare ? null : (q(req, "page") || sealRecord.contentId),
          q(req, "actor") || "harness-trasher",
          attachment,
        );
        return json(200, { invoked: fn, result: { ran: true, bare } });
      }
      // B12 (guard-only): lifecycleTrigger mass-deletes the ENTIRE KVS on uninstall. A NON-uninstall
      // event must skip the whole body (triggers.js eventType guard). The e2e seeds a canary key,
      // fires an "installed" event here, and asserts the canary survives (the wipe did NOT run).
      if (fn === "lifecycleGuard") {
        await lifecycleTrigger({ eventType: q(req, "event") || "avi:forge:installed:app" });
        return json(200, { invoked: fn, result: { ran: true } });
      }
      // B12 (guard-only): recurringNudgeTask early-returns {reminderCount:0} when auto-unseal is
      // ACTIVE (autoUnlockEnabled !== false), BEFORE the instance-wide seal scan. Self-guard here so
      // this seam can NEVER reach the invasive scan branch: refuse unless auto-unseal is active.
      if (fn === "recurringNudgeGuard") {
        const g = await kvs.get("admin-settings-global");
        if (g && g.autoUnlockEnabled === false) {
          return json(200, { invoked: fn, result: { refused: "auto-unseal disabled — would scan; guard-only seam refuses" } });
        }
        const r = await recurringNudgeTask();
        return json(200, { invoked: fn, result: r });
      }
      // B14-A (#7): save-time dead-end warning. Writes to a THROWAWAY space key (caller cleans up via
      // what=delete). `stuck=1` → a def where Approved is a target with no outgoing edge → warning.
      // C1: license read-through. lic=none → context.license undefined → isLicensed true (dev never
      // locked out); lic=inactive → active:false → isLicensed false + unlicensedButAllowed; lic=active → true.
      if (fn === "checkLicense") {
        const lic = q(req, "lic");
        const license = lic === "none" || !lic ? undefined : { active: lic === "active" };
        const r = await checkLicense({ context: { license } });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "storeWorkflowConfigProbe") {
        const stuck = !!q(req, "stuck");
        const def = stuck
          ? { id: "probe", name: "Probe", states: [{ id: "draft", name: "Draft", initial: true }, { id: "approved", name: "Approved" }], transitions: [{ from: "draft", to: "approved" }] }
          : { id: "probe", name: "Probe", states: [{ id: "draft", name: "Draft", initial: true }, { id: "approved", name: "Approved" }], transitions: [{ from: "draft", to: "approved" }, { from: "approved", to: "draft" }] };
        const r = await storeWorkflowConfig("space", q(req, "key") || "B14PROBE", def);
        return json(200, { invoked: fn, result: r });
      }
      // ---- Coverage gaps (2026-09-05): seams for the resolvers no spec could reach. ----
      // FIXTURE REPAIR: re-insert the inline-panel macro on a page through the app's own insertion
      // path (the macro is stripped when a spec relinquishes the last seal on the fixture page).
      if (fn === "ensurePanel") {
        const extensionKey = await resolveExtensionKey();
        if (!extensionKey) return json(200, { invoked: fn, result: { success: false, error: "no extension key resolvable" } });
        const r = await insertPanelNode(q(req, "pageId"), extensionKey, 3, "bottom");
        return json(200, { invoked: fn, result: { ...r, extensionKey } });
      }
      // editreq: the requester side of the attachment edit-access loop. The harness user OWNS the
      // fixture seal, so "Request edit access" never renders for them — hook-driven with a real
      // non-owner (canReadPage gate on the seal's page).
      if (fn === "requestEditAccess") {
        const r = await byKey(editreqActions, "request-edit-access")({ payload: { attachmentId: q(req, "att"), reason: q(req, "reason") }, context: { accountId: q(req, "actor") } });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "checkEditRequest") {
        const r = await byKey(editreqActions, "check-edit-request")({ payload: { attachmentId: q(req, "att") }, context: { accountId: q(req, "actor") } });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "listMyEditRequests") {
        const r = await byKey(editreqActions, "list-my-edit-requests")({ payload: {}, context: { accountId: q(req, "actor") } });
        return json(200, { invoked: fn, result: r });
      }
      // panels: the overlay's "hide the macro on this page" pair (page content property +
      // removePanelNode on disable), the panel-key discovery every panel load performs, and the
      // thumbnail preview. checkPanelStatus/discoverPanelKey are mustVerify READ paths, so the
      // context carries an empty extension (no content id → the payload id IS verified).
      if (fn === "checkPanelStatus") {
        const r = await byKey(panelsActions, "check-panel-status")({ payload: { pageId: q(req, "pageId") }, context: { accountId: q(req, "actor"), extension: {} } });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "storeDocPanelPrefs") {
        const r = await byKey(panelsActions, "store-doc-panel-prefs")({ payload: { pageId: q(req, "pageId"), macroDisabled: q(req, "macroDisabled") === "true" }, context: { accountId: q(req, "actor"), extension: {} } });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "discoverPanelKey") {
        const r = await byKey(panelsActions, "discover-panel-key")({ payload: { pageId: q(req, "pageId") }, context: { accountId: q(req, "actor"), extension: {} } });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "resolvePreview") {
        // `gate` is the same shared check the resolver runs first. The resolver's own null is
        // ambiguous from a webtrigger (refused vs. asUser download unavailable) — see the import note.
        const actor = q(req, "actor");
        const contentId = q(req, "pageId");
        const gate = await canReadPage(actor, contentId);
        const r = await byKey(panelsActions, "resolve-artifact-preview")({ payload: { artifactId: q(req, "att"), contentId }, context: { accountId: actor, extension: {} } });
        return json(200, { invoked: fn, result: r, gate });
      }
      // sealing: "My Sealed Files" (self-scoped) and the 5-second cross-surface stamp poll.
      // NOTE enumerateOperatorSeals probes every attachment asUser(), which has no session here,
      // so from the hook every row is skipped — the seam exists for the shape/empty case only; the
      // populated list is a browser-lane proof.
      if (fn === "enumerateOperatorSeals") {
        const lim = Number(q(req, "limit"));
        const r = await byKey(sealingActions, "enumerate-operator-seals")({ payload: { limit: Number.isFinite(lim) && lim > 0 ? lim : 10 }, context: { accountId: q(req, "actor") } });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "checkSealStamp") {
        const r = await byKey(sealingActions, "check-seal-stamp")({ payload: {}, context: {} });
        return json(200, { invoked: fn, result: r });
      }
      // validations: the inline-panel "Validate now" readout, the ribbon's state chip, the admin
      // model dropdown (Forge LLM list — no tokens billed) and per-finding triage (canEditPage write).
      if (fn === "validatePageNow") {
        const r = await byKey(validationsActions, "validate-page-now")({ payload: { pageId: q(req, "pageId") }, context: { accountId: q(req, "actor"), extension: {} } });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "getValidationState") {
        const r = await byKey(validationsActions, "get-validation-state")({ payload: { pageId: q(req, "pageId") }, context: { accountId: q(req, "actor"), extension: {} } });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "listAiModels") {
        const r = await byKey(validationsActions, "list-ai-models")({ payload: {}, context: {} });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "setAiFindingState") {
        const r = await byKey(validationsActions, "set-ai-finding-state")({ payload: { pageId: q(req, "pageId"), findingId: q(req, "findingId"), state: q(req, "state") }, context: { accountId: q(req, "actor"), extension: {} } });
        return json(200, { invoked: fn, result: r });
      }
      // workflow: the WorkflowInbox (self-scoped pending approvals) and the approver pickers
      // (asApp CQL user search / group picker; payload field is `query`).
      if (fn === "listMyApprovals") {
        const r = await byKey(workflowActions, "list-my-approvals")({ payload: {}, context: { accountId: q(req, "actor") } });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "searchWorkflowUsers") {
        const r = await byKey(workflowActions, "search-workflow-users")({ payload: { query: q(req, "q") }, context: { accountId: q(req, "actor") } });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "searchWorkflowGroups") {
        const r = await byKey(workflowActions, "search-workflow-groups")({ payload: { query: q(req, "q") }, context: { accountId: q(req, "actor") } });
        return json(200, { invoked: fn, result: r });
      }
      // bulletins: the toggle read that feeds flashMessagesEnabled() (toast gate) on every surface.
      if (fn === "loadBulletinToggles") {
        const r = await byKey(bulletinsActions, "load-bulletin-toggles")({ payload: {}, context: {} });
        return json(200, { invoked: fn, result: r });
      }
      // A1: per-page activity feed. No extension context is passed on purpose, so mustVerify
      // always sends the payload pageId through canReadPage — the seam asserts the gate, not a
      // bypass of it (a refused actor gets entries: [] + reason).
      if (fn === "getPageActivity") {
        const lim = parseInt(q(req, "limit"), 10);
        const r = await byKey(activityActions, "get-page-activity")({
          payload: { pageId: q(req, "page") || q(req, "pageId"), cursor: q(req, "cursor") || undefined, limit: Number.isFinite(lim) ? lim : undefined },
          context: { accountId: q(req, "actor"), extension: {} },
        });
        return json(200, { invoked: fn, result: r });
      }
      // A1: per-space activity report with the server-side filters. `types` is a csv of exact
      // ACTIVITY_TYPES strings; since/until are ISO or ms; pageId narrows to one page.
      if (fn === "getSpaceActivity") {
        const lim = parseInt(q(req, "limit"), 10);
        const typesCsv = q(req, "types");
        const r = await byKey(activityActions, "get-space-activity")({
          payload: {
            spaceKey: q(req, "space") || q(req, "spaceKey"),
            cursor: q(req, "cursor") || undefined,
            limit: Number.isFinite(lim) ? lim : undefined,
            types: typesCsv ? String(typesCsv).split(",").map((t) => t.trim()).filter(Boolean) : undefined,
            since: q(req, "since") || undefined,
            until: q(req, "until") || undefined,
            pageId: q(req, "page") || q(req, "pageId") || undefined,
            actorAccountId: q(req, "actorAccountId") || undefined,
          },
          context: { accountId: q(req, "actor") },
        });
        return json(200, { invoked: fn, result: r });
      }
      return json(400, { error: `unknown fn=${fn}` });
    }
    return json(400, { error: `unknown what=${what}` });
  } catch (e) {
    return json(500, { error: String((e && e.message) || e) });
  }
}
