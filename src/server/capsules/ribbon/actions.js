// The page banner's whole evaluation in ONE resolver invocation (8.12.0).
//
// WHY. The banner (ui/surfaces/doc-ribbon) used to fire six resolvers at once on every evaluation
// (ribbon-summary, get-page-workflow, get-page-approvals, recent-dispatches, get-validation-state,
// get-ai-findings). Each was its own invocation, so each asked Confluence the same permission
// questions again: "is this viewer an admin of this space?" cost ~375 points per ask on a space with
// 186 permission rows, about six times per refresh per viewer, against an hourly points pool every
// site of the app shares (2026-10-18: the pool ran out and every customer site got 429).
//
// Here the six run side by side INSIDE one invocation, so the invocation memo
// (shared/confluence-call.js) answers each question once for all of them; the short-lived cache in
// shared/steward-checks.js then serves the next refresh. Each part is the SAME resolver function with
// the SAME request (Forge's context, the banner's payload): no part gains or loses a check by being
// called from here. A part that throws is reported as failed and the others still answer.
import { actions as sealingActions } from "../sealing/actions.js";
import { actions as workflowActions } from "../workflow/actions.js";
import { actions as bulletinActions } from "../bulletins/actions.js";
import { actions as validationActions } from "../validations/actions.js";

export const RIBBON_PARTS = Object.freeze({
  summary: "ribbon-summary",
  workflow: "get-page-workflow",
  approvals: "get-page-approvals",
  dispatches: "recent-dispatches",
  validation: "get-validation-state",
  ai: "get-ai-findings",
});

const byKey = new Map([...sealingActions, ...workflowActions, ...bulletinActions, ...validationActions]);

const ribbonEvaluate = async (req) => {
  const pageId = req?.payload?.pageId ?? null;
  const spaceKey = req?.payload?.spaceKey ?? null;
  // The payload each part got from the banner before (doc-ribbon evaluate()).
  const payloads = {
    summary: { pageId },
    workflow: { pageId, spaceKey },
    approvals: { pageId, spaceKey },
    dispatches: { pageId },
    validation: { pageId },
    ai: { pageId },
  };
  const out = { failed: [] };
  await Promise.all(Object.entries(RIBBON_PARTS).map(async ([part, key]) => {
    try {
      out[part] = await byKey.get(key)({ ...req, payload: payloads[part] });
    } catch (e) {
      console.warn(`[RIBBON] ${key} failed inside ribbon-evaluate:`, e?.message || e);
      out[part] = null;
      out.failed.push(part);
    }
  }));
  return out;
};

export const actions = [
  ["ribbon-evaluate", ribbonEvaluate],
];
