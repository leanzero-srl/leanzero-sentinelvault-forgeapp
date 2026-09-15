/*
 * Config API — effective-config export (docs/REST-CONFIG-API.md, the `sentinel-vault-config`
 * mirror). Reads through the SAME load resolvers the consoles call, as `accountId`, so every
 * read-side gate (roster redaction for a non-steward, steward-only workflow settings) applies.
 * The shape is the bundle's own `site` / `spaces.<KEY>` object, so an export can be edited and
 * POSTed straight back as a bundle.
 */
import { invoke } from "./resolvers.js";
import { spaceIdByKey } from "./mirror.js";
import { getClassificationProvider } from "../classification/provider.js";
import { BUNDLE_VERSION } from "./bundle.js";

const strip = (o, keys) => { if (!o || typeof o !== "object") return o; const c = { ...o }; for (const k of keys) delete c[k]; return c; };

export async function exportSpaceConfig(spaceKey, accountId) {
  const policy = await invoke("load-policy", { scope: "space", key: spaceKey }, accountId);
  const validation = await invoke("load-validation-config", { scope: "space", key: spaceKey }, accountId);
  const wf = await invoke("list-space-workflows", { spaceKey }, accountId);
  const ws = await invoke("get-space-workflow-settings", { spaceKey }, accountId);
  let classificationDefault = null;
  try {
    const spaceId = await spaceIdByKey(spaceKey);
    if (spaceId) classificationDefault = (await (await getClassificationProvider()).provider.getSpaceDefault(spaceId)) ?? null;
  } catch (_) { /* best-effort */ }
  const workflows = [];
  if (wf && !wf.error) {
    if (wf.source === "space" && wf.default) workflows.push({ workflowId: "default", def: wf.default });
    for (const x of wf.extras || []) if (x.def) workflows.push({ workflowId: x.workflowId, def: x.def, labels: x.labels, priority: x.priority });
  }
  const users = (policy?.adminUsers || []).map((u) => (typeof u === "string" ? u : u?.accountId)).filter(Boolean);
  return {
    version: BUNDLE_VERSION,
    spaceKey,
    exportedAt: new Date().toISOString(),
    policy: strip(policy, ["adminUsers", "adminGroups"]),
    validation: validation || null,
    workflows,
    workflowSettings: ws?.settings ?? null,
    classificationDefault,
    spaceAdmins: { users, groups: policy?.adminGroups || [] },
  };
}

export async function exportSiteConfig(accountId) {
  const policy = await invoke("load-policy", { scope: "global" }, accountId);
  const validation = await invoke("load-validation-config", { scope: "global" }, accountId);
  const provider = await invoke("classification-provider", {}, accountId);
  return {
    version: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    policy: strip(policy, ["adminUsers", "adminGroups"]),
    validation: validation || null,
    classification: { provider: provider?.name || null, levels: provider?.levels || [] },
  };
}
