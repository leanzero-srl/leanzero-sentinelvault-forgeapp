/*
 * Config API — the READ side (docs/REST-CONFIG-API.md "The receipt"): mirrors receipts and the
 * effective config onto Confluence properties the customer reads with THEIR credentials.
 *
 *   space property   sentinel-vault-receipt   last 20 receipts for that space, newest first
 *   content property sentinel-vault-receipt   same, on site.receiptPageId (last 20)
 *   space property   sentinel-vault-config    the PUBLIC part of that space's effective config
 *   content property sentinel-vault-config    the PUBLIC part of the site config, on site.receiptPageId
 *
 * Both config mirrors go through redactConfigForMirror (pure.js): a space property is readable
 * by every viewer of the space, so the roster, the workflow settings, the rule text and the AI
 * prompts never land there — the full export is the gated export-*-config resolvers' answer.
 *
 * Best-effort by design (same doctrine as classification's mirrorProperty, which this reuses):
 * KVS is the truth, the property is a mirror. Space properties need write:space:confluence
 * (in the 7.0 batch); until consented, the space mirror logs the 403 and moves on.
 */
import { asApp, route } from "@forge/api";
import { mirrorProperty } from "../classification/logic.js";
import { confluenceRequest } from "../classification/provider.js";
import { pushReceipt, redactConfigForMirror, RECEIPTS_KEPT } from "./pure.js";
export { RECEIPTS_KEPT };

export const RECEIPT_PROPERTY_KEY = "sentinel-vault-receipt";
export const CONFIG_PROPERTY_KEY = "sentinel-vault-config";
const log = (m) => console.warn(m.replace("[CLASSIFICATION]", "[CONFIG-API]"));

/** v2 space id from a key (asApp). Null when the space cannot be resolved. */
export async function spaceIdByKey(spaceKey) {
  if (!spaceKey) return null;
  try {
    const res = await asApp().requestConfluence(route`/wiki/api/v2/spaces?keys=${spaceKey}&limit=1`, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const s = (await res.json())?.results?.[0];
    return s?.id != null ? String(s.id) : null;
  } catch (_) { return null; }
}

async function readProperty(base, key) {
  try {
    const res = await confluenceRequest(`${base}/properties?key=${key}`, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json())?.results?.[0]?.value ?? null;
  } catch (_) { return null; }
}

async function appendReceipt(base, receipt) {
  const current = await readProperty(base, RECEIPT_PROPERTY_KEY);
  return mirrorProperty(confluenceRequest, base, pushReceipt(current, receipt), log, RECEIPT_PROPERTY_KEY);
}

/** Receipt → every touched space (by key) + the site receipt page. Returns { spaces:{key:ok}, page:ok|null }. */
export async function mirrorReceipt(receipt, { spaceKeys = [], receiptPageId = null } = {}) {
  const outcome = { spaces: {}, page: null };
  for (const key of spaceKeys) {
    const id = await spaceIdByKey(key);
    outcome.spaces[key] = id ? await appendReceipt(`/wiki/api/v2/spaces/${id}`, receipt) : false;
  }
  if (receiptPageId) outcome.page = await appendReceipt(`/wiki/api/v2/pages/${receiptPageId}`, receipt);
  return outcome;
}

export async function mirrorSpaceConfig(spaceKey, config) {
  const id = await spaceIdByKey(spaceKey);
  if (!id) return false;
  return mirrorProperty(confluenceRequest, `/wiki/api/v2/spaces/${id}`, redactConfigForMirror(config, "space"), log, CONFIG_PROPERTY_KEY);
}

export async function mirrorSiteConfig(receiptPageId, config) {
  if (!receiptPageId) return null;
  return mirrorProperty(confluenceRequest, `/wiki/api/v2/pages/${receiptPageId}`, redactConfigForMirror(config, "site"), log, CONFIG_PROPERTY_KEY);
}

/**
 * The effective-config mirror (`sentinel-vault-config`) must stay current after a UI write too,
 * not only after an API job — otherwise "export = a Confluence GET" is a lie the moment an admin
 * touches a setting in the console. `scopeOfConfigWrite` (pure, tested) maps a resolver key +
 * payload to the scope that changed; the registry calls this once, after any such write succeeds.
 * Site config mirrors onto the receipt page the last bundle named (persisted in
 * `admin-settings-global.apiReceiptPageId`); with no page named, the site mirror is skipped.
 */
export const CONFIG_WRITER_KEYS = Object.freeze([
  "store-policy", "store-validation-config", "store-space-workflow", "delete-space-workflow",
  "set-space-workflow-settings", "classification-set-space-default", "classification-manage-levels",
]);

export function scopeOfConfigWrite(key, payload) {
  const p = payload || {};
  switch (key) {
    case "store-policy":
    case "store-validation-config":
      return p.scope === "space" && p.key ? { scope: "space", spaceKey: String(p.key) } : { scope: "site" };
    case "store-space-workflow":
    case "delete-space-workflow":
    case "set-space-workflow-settings":
      return p.spaceKey ? { scope: "space", spaceKey: String(p.spaceKey) } : null;
    case "classification-set-space-default":
      return { scope: "space-by-id", spaceIds: [].concat(p.spaceIds || p.spaceId || []).map(String) };
    case "classification-manage-levels":
      return { scope: "site" };
    default:
      return null;
  }
}

export async function refreshConfigMirror(target, accountId) {
  if (!target) return null;
  const { exportSpaceConfig, exportSiteConfig } = await import("./export.js");
  if (target.scope === "site") {
    const { kvs } = await import("@forge/kvs");
    const pageId = (await kvs.get("admin-settings-global"))?.apiReceiptPageId || null;
    if (!pageId) return null;
    return mirrorSiteConfig(String(pageId), await exportSiteConfig(accountId));
  }
  if (target.scope === "space") return mirrorSpaceConfig(target.spaceKey, await exportSpaceConfig(target.spaceKey, accountId));
  if (target.scope === "space-by-id") {
    const { asApp, route } = await import("@forge/api");
    const out = [];
    for (const id of target.spaceIds) {
      try {
        const r = await asApp().requestConfluence(route`/wiki/api/v2/spaces/${id}`);
        const key = r.ok ? (await r.json())?.key : null;
        if (key) out.push(await mirrorSpaceConfig(key, await exportSpaceConfig(key, accountId)));
      } catch (e) { log(`[CONFIG-API] space ${id} mirror skipped: ${e?.message || e}`); }
    }
    return out;
  }
  return null;
}
