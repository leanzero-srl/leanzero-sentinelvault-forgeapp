/*
 * DEV-ONLY test-state web trigger for the forge-live-harness E2E suite.
 * Gated by HARNESS_SECRET (set ONLY in the development environment). Returns 404
 * unless the secret is configured (absent in prod) AND matches the Bearer header.
 * Read-only: a generic KVS get covers seal records (protection-{id}), section
 * records (section-protection-{id} incl. stored hash), validation findings/gate,
 * and grants — the deterministic state the harness asserts against.
 */
import { kvs } from "@forge/kvs";
import { expirySweepTask, workflowSweep, collectWorkflowEnforcementForPage, sweepRevertToApproved } from "./server/triggers";
import {
  assignPageWorkflow,
  transitionPageWorkflow,
  getPageWorkflow,
  getWorkflowLog,
  getSpaceWorkflowSettings,
  setSpaceWorkflowSettings,
  bulkAssignPagesInSpace,
  readPageWorkflow,
} from "./server/capsules/workflow/logic.js";
import {
  requestApprovalTransition,
  decideApproval,
  getPageApprovalStatus,
} from "./server/capsules/workflow/approvals.js";
import { getWorkflowDashboard, requestTransition } from "./server/capsules/workflow/actions.js";
import { applyAiVerdict } from "./server/capsules/workflow/approvals.js";
import { mirrorNativeState, readNativeState, clearNativeState } from "./server/capsules/workflow/native-state.js";
import { revokeEditGrant, listEditGrants } from "./server/capsules/editreq/actions.js";
// #6: section edit-access request/approve/deny seams (editreq is Queue/LLM-free — import-safe).
import {
  requestSectionEdit,
  checkSectionEdit,
  listSectionEditRequests,
  approveSectionEdit,
  denySectionEdit,
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
} from "./server/capsules/bulletins/actions.js";
// B6: section-seal CREATION resolvers (section-seals imports workflow/logic + sealing/logic, both
// already in the hook bundle → no new problematic deps; the page read/write is asApp).
import {
  listPageHeadings,
  enumerateSectionSeals,
  sealSection,
  unsealSection,
} from "./server/capsules/section-seals/actions.js";
// B7: plain-user persona resolvers (realms/actions.js is now import-safe after the it57 lazy-Queue
// refactor). check-user-role returns "user" for a synthetic actor (asUser has no webtrigger context);
// the steward-request flow is asApp + KVS.
import {
  checkUserRole,
  requestStewardAccess,
  checkStewardRequest,
} from "./server/capsules/realms/actions.js";
// it46: destructive-action permission-matrix seams (Queue/LLM-free modules — safe to import).
import { deleteArtifact } from "./server/capsules/panels/actions.js";
import { purgeSealRecord, restoreSealedArtifact } from "./server/capsules/sealing/actions.js";
// B11: live AI validation pipeline. validations/actions.js is import-safe after the it57 lazy-Queue
// refactor (ai-validation-queue is now built at push time, not module load — the it17 trap). The real
// Forge LLM runs in the queue consumer; the enqueue/poll/findings resolvers are the driveable seam.
import {
  enqueuePageValidation,
  getValidationJob,
  getAiFindings,
} from "./server/capsules/validations/actions.js";

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

export async function testStateTrigger(req) {
  const secret = process.env.HARNESS_SECRET;
  if (!secret) return notFound();
  const authArr = (req && req.headers && (req.headers.authorization || req.headers.Authorization)) || null;
  const auth = Array.isArray(authArr) ? authArr[0] : authArr;
  const provided = typeof auth === "string" ? auth.replace(/^Bearer\s+/i, "").trim() : "";
  if (!provided || provided !== secret) return notFound();

  const what = q(req, "what") || "kvs";
  try {
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
    // DEV-ONLY: invoke a scheduled task on demand so the harness can assert the scheduled tier
    // deterministically (no waiting for the daily/hourly cron).
    if (what === "invoke") {
      const fn = q(req, "fn");
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
        return json(200, { invoked: fn, result: { reverted: ok } });
      }
      if (fn === "dashboard") {
        const r = await getWorkflowDashboard({ payload: { spaceKey: q(req, "spaceKey") } });
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
      if (fn === "nativeState") {
        const pageId = q(req, "pageId");
        if (q(req, "clear")) await clearNativeState(pageId);
        else if (q(req, "state")) await mirrorNativeState(pageId, q(req, "state"));
        const current = await readNativeState(pageId);
        return json(200, { invoked: fn, result: { current } });
      }
      if (fn === "getWorkflow") {
        const result = await getPageWorkflow(q(req, "pageId"), q(req, "spaceKey"));
        if (q(req, "withLog")) result.log = await getWorkflowLog(q(req, "pageId"));
        return json(200, { invoked: fn, result });
      }
      if (fn === "setSpaceWorkflowSettings") {
        const r = await setSpaceWorkflowSettings(q(req, "spaceKey"), {
          enabled: q(req, "enabled") === "1",
          autoAssignNew: q(req, "autoAssignNew") === "1",
          workflowId: q(req, "workflowId"),
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
          pinnedVersion: parseInt(q(req, "pinnedVersion"), 10) || null,
        });
        return json(200, { invoked: fn, result: r });
      }
      if (fn === "decideApproval") {
        const r = await decideApproval({
          pageId: q(req, "pageId"), approverAccountId: q(req, "approver"),
          decision: q(req, "decision"), reason: q(req, "reason"), actorName: q(req, "approver"),
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
        const r = await getAiFindings({ payload: { pageId: q(req, "page"), spaceKey: q(req, "space") } });
        return json(200, { invoked: fn, result: r });
      }
      return json(400, { error: `unknown fn=${fn}` });
    }
    return json(400, { error: `unknown what=${what}` });
  } catch (e) {
    return json(500, { error: String((e && e.message) || e) });
  }
}
