/*
 * DEV-ONLY test-state web trigger for the forge-live-harness E2E suite.
 * Gated by HARNESS_SECRET (set ONLY in the development environment). Returns 404
 * unless the secret is configured (absent in prod) AND matches the Bearer header.
 * Read-only: a generic KVS get covers seal records (protection-{id}), section
 * records (section-protection-{id} incl. stored hash), validation findings/gate,
 * and grants — the deterministic state the harness asserts against.
 */
import { kvs } from "@forge/kvs";
import { expirySweepTask } from "./server/triggers";
import {
  assignPageWorkflow,
  transitionPageWorkflow,
  getPageWorkflow,
  getWorkflowLog,
  getSpaceWorkflowSettings,
  setSpaceWorkflowSettings,
  bulkAssignPagesInSpace,
} from "./server/capsules/workflow/logic.js";
import {
  requestApprovalTransition,
  decideApproval,
  getPageApprovalStatus,
} from "./server/capsules/workflow/approvals.js";

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
        const r = await transitionPageWorkflow({
          pageId: q(req, "pageId"),
          spaceKey: q(req, "spaceKey"),
          toStateId: q(req, "to"),
          actorAccountId: q(req, "actor") || "harness",
          actorName: q(req, "actorName") || "Harness",
          reason: q(req, "reason"),
        });
        return json(200, { invoked: fn, result: r });
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
      return json(400, { error: `unknown fn=${fn}` });
    }
    return json(400, { error: `unknown what=${what}` });
  } catch (e) {
    return json(500, { error: String((e && e.message) || e) });
  }
}
