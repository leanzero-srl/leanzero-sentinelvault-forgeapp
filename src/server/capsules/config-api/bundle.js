/*
 * Config API bundle — PURE validation and planning (docs/REST-CONFIG-API.md "The bundle").
 *
 * validateBundle(bundle) → { ok, errors[], plan[] }
 * planBundle(bundle)     → ordered [ { path, resolverKey, payload, needs? } ]
 *
 * Both are pure so test/config-api.test.mjs pins the limits, the key allow-lists and the
 * resolver-mapping table without Forge. The consumer executes the plan through the SAME
 * resolver handlers the UI calls (consumer.js); nothing here touches storage.
 *
 * Shapes:
 *  - every key is UPSERT; omitted keys are untouched.
 *  - `workflows` and `validation.rules` accept either an array (merged by id) or
 *    `{ "$replace": true, "items": [...] }` (the set is replaced). JSON arrays cannot carry a
 *    flag of their own, which is why the object form exists.
 *  - every content op has an EXPLICIT allow-list of fields: a payload key the resolver never
 *    read is a 400, never something forwarded on trust.
 *  - steps that need a runtime lookup say so in `needs` (spaceId from a key, headingIndex from a
 *    heading text, the existing workflow set for a $replace); the consumer resolves them.
 */

export const BUNDLE_VERSION = 1;
export const MAX_BUNDLE_BYTES = 256 * 1024;
export const MAX_CONTENT_OPS = 200;
export const MAX_SPACES = 100;
const SPACE_KEY_RE = /^[A-Za-z0-9~][A-Za-z0-9_.~-]{0,254}$/;
const ID_RE = /^[A-Za-z0-9:._-]{1,120}$/;

const TOP_KEYS = ["version", "site", "spaces", "content"];
const SITE_KEYS = ["policy", "validation", "classification", "notifications", "receiptPageId"];
const SPACE_KEYS = ["policy", "validation", "workflows", "workflowSettings", "classificationDefault", "classification", "spaceAdmins"];
const SPACE_ADMIN_KEYS = ["users", "groups"];

/** Content op → allowed fields (besides `op`) and the ones that are required. */
export const CONTENT_OPS = Object.freeze({
  "seal-attachment": { allow: ["pageId", "attachmentId", "lockDuration", "note"], required: ["attachmentId"], resolverKey: "seal-artifact", role: "editor" },
  "unseal-attachment": { allow: ["attachmentId", "reason"], required: ["attachmentId"], resolverKey: "unseal-artifact", role: "editor" },
  "seal-section": { allow: ["pageId", "headingText", "lockDuration"], required: ["pageId", "headingText"], resolverKey: "seal-section", role: "editor" },
  "unseal-section": { allow: ["sectionId", "reason"], required: ["sectionId"], resolverKey: "unseal-section", role: "editor" },
  // SEC-7 (2026-09-20): a seal can be extended over the API too — a section (new resolver) or an
  // attachment (the existing extend-seal). `additionalSeconds` omitted = the space's default hold.
  "extend-section": { allow: ["sectionId", "additionalSeconds"], required: ["sectionId"], resolverKey: "extend-section", role: "editor" },
  "extend-attachment": { allow: ["attachmentId", "additionalSeconds"], required: ["attachmentId"], resolverKey: "extend-seal", role: "editor" },
  // Direct grants (2026-09-17): the seal owner (or a steward) names the editor — no request needed.
  "grant-attachment-edit": { allow: ["attachmentId", "editorAccountId"], required: ["attachmentId", "editorAccountId"], resolverKey: "grant-edit-access", role: "editor" },
  "revoke-attachment-edit": { allow: ["attachmentId", "editorAccountId"], required: ["attachmentId", "editorAccountId"], resolverKey: "revoke-edit-grant", role: "editor" },
  "grant-section-edit": { allow: ["sectionId", "editorAccountId"], required: ["sectionId", "editorAccountId"], resolverKey: "grant-section-edit", role: "editor" },
  "revoke-section-edit": { allow: ["sectionId", "editorAccountId"], required: ["sectionId", "editorAccountId"], resolverKey: "revoke-section-edit-grant", role: "editor" },
  // SEC-8 (2026-09-20): a request can be declined over the API, with the optional word that reaches the requester.
  "decline-attachment-edit": { allow: ["attachmentId", "requesterAccountId", "reason"], required: ["attachmentId", "requesterAccountId"], resolverKey: "deny-edit-request", role: "editor" },
  "decline-section-edit": { allow: ["sectionId", "requesterAccountId", "reason"], required: ["sectionId", "requesterAccountId"], resolverKey: "deny-section-edit", role: "editor" },
  "classify-page": { allow: ["pageId", "levelId"], required: ["pageId"], resolverKey: "classification-set-page", role: "editor" },
  "assign-workflow": { allow: ["pageId", "workflowId"], required: ["pageId"], resolverKey: "assign-workflow", role: "editor" },
  "transition": { allow: ["pageId", "toStateId", "reason"], required: ["pageId", "toStateId"], resolverKey: "request-transition", role: "editor" },
  // 2026-09-23: judge a page against its validation rules now and store the verdict (where
  // pass/fail status is on and the token's minter can edit the page) — e.g. after a script
  // changed its labels, which makes no page version and so no save check. And a space admin's
  // "Approve anyway" for a page that fails.
  "recheck-validation": { allow: ["pageId"], required: ["pageId"], resolverKey: "recheck-page-validation", role: "editor" },
  "approve-validation": { allow: ["pageId"], required: ["pageId"], resolverKey: "approve-page-gate", role: "editor" },
});

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** `[...]` or `{ $replace, items }` → { replace, items } or null when malformed. */
export function readSet(v) {
  if (Array.isArray(v)) return { replace: false, items: v };
  if (isObj(v) && Array.isArray(v.items)) return { replace: v.$replace === true, items: v.items };
  return null;
}

function unknownKeys(obj, allowed) {
  return Object.keys(obj).filter((k) => !allowed.includes(k));
}

/** The role floor of a whole bundle: any site/spaces key → admin; content only → editor. */
export function bundleRoleFloor(bundle) {
  if (!isObj(bundle)) return "admin";
  if (isObj(bundle.site) && Object.keys(bundle.site).length) return "admin";
  if (isObj(bundle.spaces) && Object.keys(bundle.spaces).length) return "admin";
  return "editor";
}

export function validateBundle(bundle, { rawBytes = null } = {}) {
  const errors = [];
  const err = (path, msg) => errors.push(`${path}: ${msg}`);
  if (rawBytes != null && rawBytes > MAX_BUNDLE_BYTES) err("$", `bundle exceeds ${MAX_BUNDLE_BYTES} bytes`);
  if (!isObj(bundle)) { err("$", "bundle must be a JSON object"); return { ok: false, errors, plan: [] }; }
  if (rawBytes == null) {
    let n = 0;
    try { n = Buffer.byteLength(JSON.stringify(bundle), "utf8"); } catch { n = 0; }
    if (n > MAX_BUNDLE_BYTES) err("$", `bundle exceeds ${MAX_BUNDLE_BYTES} bytes`);
  }
  if (bundle.version !== BUNDLE_VERSION) err("version", `must be ${BUNDLE_VERSION}`);
  for (const k of unknownKeys(bundle, TOP_KEYS)) err(k, "unknown key");

  if (bundle.site !== undefined) {
    if (!isObj(bundle.site)) err("site", "must be an object");
    else {
      const s = bundle.site;
      for (const k of unknownKeys(s, SITE_KEYS)) err(`site.${k}`, "unknown key");
      if (s.policy !== undefined && !isObj(s.policy)) err("site.policy", "must be an object");
      if (s.validation !== undefined) {
        if (!isObj(s.validation)) err("site.validation", "must be an object");
        else if (s.validation.rules !== undefined && !readSet(s.validation.rules)) err("site.validation.rules", "must be an array or { $replace, items }");
      }
      if (s.classification !== undefined) {
        if (!isObj(s.classification)) err("site.classification", "must be an object");
        else {
          for (const k of unknownKeys(s.classification, ["enabled", "levels", "assetsLink"])) err(`site.classification.${k}`, "unknown key");
          if (s.classification.enabled !== undefined && typeof s.classification.enabled !== "boolean") err("site.classification.enabled", "must be true or false");
          if (s.classification.assetsLink !== undefined && s.classification.assetsLink !== null) {
            const al = s.classification.assetsLink;
            if (!isObj(al)) err("site.classification.assetsLink", "must be an object or null");
            else {
              for (const k of unknownKeys(al, ["schemaId", "objectTypeId", "mapping", "schemaName", "objectTypeName"])) err(`site.classification.assetsLink.${k}`, "unknown key");
              for (const k of ["schemaId", "objectTypeId"]) if (al[k] === undefined || !/^[0-9]{1,12}$/.test(String(al[k]))) err(`site.classification.assetsLink.${k}`, "required numeric id");
            }
          }
          if (s.classification.levels !== undefined && !Array.isArray(s.classification.levels)) err("site.classification.levels", "must be an array");
        }
      }
      if (s.notifications !== undefined && !isObj(s.notifications)) err("site.notifications", "must be an object");
      if (s.receiptPageId !== undefined && !/^\d{1,20}$/.test(String(s.receiptPageId))) err("site.receiptPageId", "must be a page id");
    }
  }

  if (bundle.spaces !== undefined) {
    if (!isObj(bundle.spaces)) err("spaces", "must be an object keyed by space key");
    else {
      const keys = Object.keys(bundle.spaces);
      if (keys.length > MAX_SPACES) err("spaces", `at most ${MAX_SPACES} spaces per bundle`);
      for (const key of keys) {
        const p = `spaces.${key}`;
        if (!SPACE_KEY_RE.test(key)) { err(p, "invalid space key"); continue; }
        const sp = bundle.spaces[key];
        if (!isObj(sp)) { err(p, "must be an object"); continue; }
        for (const k of unknownKeys(sp, SPACE_KEYS)) err(`${p}.${k}`, "unknown key");
        if (sp.policy !== undefined && !isObj(sp.policy)) err(`${p}.policy`, "must be an object");
        if (sp.validation !== undefined) {
          if (!isObj(sp.validation)) err(`${p}.validation`, "must be an object");
          else if (sp.validation.rules !== undefined && !readSet(sp.validation.rules)) err(`${p}.validation.rules`, "must be an array or { $replace, items }");
        }
        if (sp.workflows !== undefined) {
          const set = readSet(sp.workflows);
          if (!set) err(`${p}.workflows`, "must be an array or { $replace, items }");
          else set.items.forEach((w, i) => {
            if (!isObj(w)) return err(`${p}.workflows[${i}]`, "must be an object");
            for (const k of unknownKeys(w, ["workflowId", "def", "labels", "priority"])) err(`${p}.workflows[${i}].${k}`, "unknown key");
            if (!isObj(w.def)) err(`${p}.workflows[${i}].def`, "def is required");
            if (w.workflowId !== undefined && !ID_RE.test(String(w.workflowId))) err(`${p}.workflows[${i}].workflowId`, "invalid id");
          });
        }
        if (sp.workflowSettings !== undefined && !isObj(sp.workflowSettings)) err(`${p}.workflowSettings`, "must be an object");
        if (sp.classificationDefault !== undefined && sp.classificationDefault !== null && !ID_RE.test(String(sp.classificationDefault))) err(`${p}.classificationDefault`, "must be a level id or null");
        if (sp.classification !== undefined && !["inherit", "off"].includes(sp.classification)) err(`${p}.classification`, 'must be "inherit" or "off"');
        if (sp.spaceAdmins !== undefined) {
          if (!isObj(sp.spaceAdmins)) err(`${p}.spaceAdmins`, "must be an object");
          else {
            for (const k of unknownKeys(sp.spaceAdmins, SPACE_ADMIN_KEYS)) err(`${p}.spaceAdmins.${k}`, "unknown key");
            for (const k of SPACE_ADMIN_KEYS) {
              if (sp.spaceAdmins[k] !== undefined && !(Array.isArray(sp.spaceAdmins[k]) && sp.spaceAdmins[k].every((x) => typeof x === "string"))) err(`${p}.spaceAdmins.${k}`, "must be an array of strings");
            }
          }
        }
      }
    }
  }

  if (bundle.content !== undefined) {
    if (!Array.isArray(bundle.content)) err("content", "must be an array");
    else {
      if (bundle.content.length > MAX_CONTENT_OPS) err("content", `at most ${MAX_CONTENT_OPS} ops per bundle`);
      bundle.content.forEach((c, i) => {
        const p = `content[${i}]`;
        if (!isObj(c)) return err(p, "must be an object");
        const spec = CONTENT_OPS[c.op];
        if (!spec) return err(`${p}.op`, `unknown op "${String(c.op).slice(0, 40)}"`);
        for (const k of unknownKeys(c, ["op", ...spec.allow])) err(`${p}.${k}`, `not a field of ${c.op}`);
        for (const k of spec.required) if (c[k] === undefined || c[k] === null || c[k] === "") err(`${p}.${k}`, "required");
        for (const k of ["pageId", "attachmentId", "sectionId", "levelId", "workflowId", "toStateId", "editorAccountId"]) {
          if (c[k] !== undefined && c[k] !== null && !ID_RE.test(String(c[k]))) err(`${p}.${k}`, "invalid id");
        }
        if (c.lockDuration !== undefined && !(Number.isFinite(Number(c.lockDuration)) && Number(c.lockDuration) > 0)) err(`${p}.lockDuration`, "must be a positive number of seconds");
        if (c.additionalSeconds !== undefined && !(Number.isFinite(Number(c.additionalSeconds)) && Number(c.additionalSeconds) > 0)) err(`${p}.additionalSeconds`, "must be a positive number of seconds");
      });
    }
  }

  const ok = errors.length === 0;
  return { ok, errors, plan: ok ? planBundle(bundle) : [] };
}

/**
 * The resolver-mapping table. Order is site → spaces → content, and inside a space the order
 * policy → validation → workflows → workflowSettings → classificationDefault → spaceAdmins, so
 * a settings write that names a state always follows the definition that introduces it.
 */
export function planBundle(bundle) {
  const plan = [];
  const step = (path, resolverKey, payload, extra = {}) => plan.push({ path, resolverKey, payload, ...extra });
  const site = isObj(bundle?.site) ? bundle.site : {};
  if (isObj(site.policy)) step("site.policy", "store-policy", { scope: "global", data: site.policy });
  if (isObj(site.validation)) step("site.validation", "store-validation-config", { scope: "global", data: site.validation }, { needs: "validationMerge" });
  // CLS-1: the site switch is a policy key; it is written BEFORE the levels so a bundle that turns
  // classification on and sets levels in one go leaves the tenant exactly as the bundle reads.
  if (isObj(site.classification) && typeof site.classification.enabled === "boolean") step("site.classification.enabled", "store-policy", { scope: "global", data: { classificationEnabled: site.classification.enabled } });
  if (isObj(site.classification) && Array.isArray(site.classification.levels)) step("site.classification.levels", "classification-manage-levels", { levels: site.classification.levels });
  // The Assets LINK (schema/type/mapping) can be set over the API; the import itself needs a user
  // session (Assets refuses the app's identity) and is done from the steward console.
  if (isObj(site.classification) && site.classification.assetsLink !== undefined) {
    const al = site.classification.assetsLink;
    step("site.classification.assetsLink", "classification-assets-set-link", al === null ? { link: null } : { schemaId: String(al.schemaId), objectTypeId: String(al.objectTypeId), mapping: al.mapping || {}, schemaName: al.schemaName, objectTypeName: al.objectTypeName });
  }
  if (isObj(site.notifications)) step("site.notifications", "store-policy", { scope: "global", data: site.notifications });

  const spaces = isObj(bundle?.spaces) ? bundle.spaces : {};
  for (const key of Object.keys(spaces)) {
    const sp = spaces[key];
    if (!isObj(sp)) continue;
    const p = `spaces.${key}`;
    if (isObj(sp.policy)) step(`${p}.policy`, "store-policy", { scope: "space", key, data: sp.policy });
    if (isObj(sp.validation)) step(`${p}.validation`, "store-validation-config", { scope: "space", key, data: sp.validation }, { needs: "validationMerge" });
    const wf = readSet(sp.workflows);
    if (wf) {
      if (wf.replace) step(`${p}.workflows.$replace`, "delete-space-workflow", { spaceKey: key, keep: wf.items.map((w) => w.workflowId || "default") }, { needs: "workflowPrune" });
      wf.items.forEach((w, i) => step(`${p}.workflows[${i}]`, "store-space-workflow", { spaceKey: key, workflowId: w.workflowId ?? null, def: w.def, labels: w.labels, priority: w.priority }));
    }
    if (isObj(sp.workflowSettings)) step(`${p}.workflowSettings`, "set-space-workflow-settings", { spaceKey: key, settings: sp.workflowSettings });
    if (sp.classificationDefault !== undefined) step(`${p}.classificationDefault`, "classification-set-space-default", { spaceKey: key, levelId: sp.classificationDefault }, { needs: "spaceId" });
    // CLS-1: the per-space opt-out is a space policy key ("inherit" | "off").
    if (sp.classification !== undefined) step(`${p}.classification`, "store-policy", { scope: "space", key, data: { classification: sp.classification } });
    if (isObj(sp.spaceAdmins)) {
      // The steward roster lives in the space policy row (adminUsers / adminGroups) and the UI
      // writes it through store-policy — the same resolver, the same A1 gate.
      const data = {};
      if (Array.isArray(sp.spaceAdmins.users)) data.adminUsers = sp.spaceAdmins.users.map((accountId) => ({ accountId }));
      if (Array.isArray(sp.spaceAdmins.groups)) data.adminGroups = sp.spaceAdmins.groups.slice();
      step(`${p}.spaceAdmins`, "store-policy", { scope: "space", key, data });
    }
  }

  const content = Array.isArray(bundle?.content) ? bundle.content : [];
  content.forEach((c, i) => {
    const spec = CONTENT_OPS[c?.op];
    if (!spec) return;
    const p = `content[${i}]`;
    switch (c.op) {
      case "seal-attachment":
        step(p, spec.resolverKey, { attachmentId: String(c.attachmentId), lockDuration: c.lockDuration, note: c.note }, { pageId: c.pageId != null ? String(c.pageId) : null });
        break;
      case "unseal-attachment":
        // adminOverride is harmless for the owner (the owner arm is checked first) and is what
        // lets a steward release someone else's seal — with the typed reason the UI demands.
        step(p, spec.resolverKey, { attachmentId: String(c.attachmentId), adminOverride: true, reason: c.reason });
        break;
      case "seal-section":
        step(p, spec.resolverKey, { pageId: String(c.pageId), headingText: String(c.headingText), lockDuration: c.lockDuration }, { needs: "headingIndex" });
        break;
      case "unseal-section":
        step(p, spec.resolverKey, { sectionId: String(c.sectionId), reason: c.reason });
        break;
      case "extend-section":
        step(p, spec.resolverKey, { sectionId: String(c.sectionId), additionalSeconds: c.additionalSeconds });
        break;
      case "extend-attachment":
        step(p, spec.resolverKey, { attachmentId: String(c.attachmentId), additionalSeconds: c.additionalSeconds });
        break;
      case "grant-attachment-edit":
      case "revoke-attachment-edit":
        step(p, spec.resolverKey, { attachmentId: String(c.attachmentId), editorAccountId: String(c.editorAccountId) });
        break;
      case "grant-section-edit":
      case "revoke-section-edit":
        step(p, spec.resolverKey, { sectionId: String(c.sectionId), editorAccountId: String(c.editorAccountId) });
        break;
      case "decline-attachment-edit":
        step(p, spec.resolverKey, { attachmentId: String(c.attachmentId), requesterAccountId: String(c.requesterAccountId), reason: c.reason });
        break;
      case "decline-section-edit":
        step(p, spec.resolverKey, { sectionId: String(c.sectionId), requesterAccountId: String(c.requesterAccountId), reason: c.reason });
        break;
      case "classify-page":
        step(p, spec.resolverKey, { pageId: String(c.pageId), levelId: c.levelId ?? null });
        break;
      case "assign-workflow":
        step(p, spec.resolverKey, { pageId: String(c.pageId), workflowId: c.workflowId ?? null });
        break;
      case "transition":
        step(p, spec.resolverKey, { pageId: String(c.pageId), toStateId: String(c.toStateId), reason: c.reason });
        break;
      case "recheck-validation":
      case "approve-validation":
        step(p, spec.resolverKey, { pageId: String(c.pageId) });
        break;
      default:
        break;
    }
  });
  return plan;
}

/** PURE. Which spaces a plan touches (for the receipt mirror). */
export function touchedSpaceKeys(plan) {
  const out = new Set();
  for (const s of plan || []) {
    const m = /^spaces\.([^.]+)/.exec(s.path);
    if (m) out.add(m[1]);
  }
  return [...out];
}
