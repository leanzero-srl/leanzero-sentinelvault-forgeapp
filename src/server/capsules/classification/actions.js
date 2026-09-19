/*
 * Classification capsule (Part 3.1 + 3.2) — resolvers.
 *
 *   classification-provider            {}                                → { name, levels, canManageLevels }   any logged-in user
 *   classification-list-spaces         {}                                → { spaces: [{ id, key, name, type, defaultLevelId }] }
 *                                                                            site admin: every space; steward: the spaces they administer
 *   classification-set-space-default   { spaceId | spaceIds[], levelId } → { results: [{ spaceId, ok, reason? }] }
 *                                                                            per space: site admin OR steward of THAT space
 *   classification-get-page            { pageId }                        → { effective: { level, source }, pageLevelId }   canReadPage
 *   classification-set-page            { pageId, levelId|null }          → { ok, effective }   canEditPage, unconditional
 *   classification-manage-levels       { levels }                        → { ok, levels }      site admin; App provider only
 *
 * Authorization (CLAUDE.md): every id in req.payload is attacker-controlled and every provider
 * write runs as the app. The caller must be able to do it themselves first. A space is authorised
 * against the key RESOLVED FROM THE PAYLOAD SPACE ID (never a payload spaceKey); a page against
 * canEditPage on that page. Everything fails closed: an id that does not resolve is a refusal.
 */
import { asApp, asUser, assumeTrustedRoute, route } from "@forge/api";
import { canEditPage, canReadPage, mustVerify } from "../../shared/content-access.js";
import { authorizeSteward, isAccountStewardAsApp, isOperatorSiteAdmin } from "../../shared/steward-checks.js";
import { getAppProvider, getClassificationProvider, resetProviderCache, resolveClassificationActive, classificationActiveForPage } from "./provider.js";
import { isContentId, validateLevels, levelsFromAssetsObjects, guessAssetsMapping, ASSETS_LINK_KVS_KEY, classificationOffReason } from "./logic.js";
import { kvs } from "@forge/kvs";
import { refreshByline } from "../page-details/byline.js"; // 5.0 byline chip (page writes only; a space default refreshes lazily on open)

const NOT_AUTHORIZED = "Not authorized";

/** v2 space read: id → { id, key, name, type } or null. Null is a deny for every caller below. */
async function readSpace(spaceId) {
  if (!isContentId(spaceId)) return null;
  try {
    const res = await asApp().requestConfluence(route`/wiki/api/v2/spaces/${spaceId}`, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const s = await res.json();
    return s?.key ? { id: String(s.id), key: s.key, name: s.name || s.key, type: s.type || "global" } : null;
  } catch (_) { return null; }
}

/** Every space the CALLER can see (asUser, so a private space they cannot open never lists). */
async function listVisibleSpaces() {
  const out = [];
  let next = "/wiki/api/v2/spaces?limit=250&sort=name";
  let guard = 0;
  while (next && guard++ < 40) {
    // `_links.next` is a relative path carrying its own cursor query; it is Confluence-supplied
    // (never from the payload), and route`` would escape its `?`, so cursor pages follow the
    // documented link verbatim via assumeTrustedRoute.
    const res = guard === 1
      ? await asUser().requestConfluence(route`/wiki/api/v2/spaces?limit=250&sort=name`, { headers: { Accept: "application/json" } })
      : await asUser().requestConfluence(assumeTrustedRoute(next), { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`spaces list → ${res.status}`);
    const body = await res.json();
    for (const s of body?.results || []) out.push({ id: String(s.id), key: s.key, name: s.name || s.key, type: s.type || "global" });
    next = body?._links?.next || null;
  }
  return out;
}

async function mapLimited(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; results[idx] = await fn(items[idx]); }
  });
  await Promise.all(workers);
  return results;
}

export const getProvider = async (req) => {
  const accountId = req.context?.accountId;
  if (!accountId) return { name: "app", levels: [], canManageLevels: false, error: NOT_AUTHORIZED };
  try {
    const [{ provider, levels }, sw] = await Promise.all([getClassificationProvider(), resolveClassificationActive(null)]);
    // Levels are editable only on the App scheme and only by a site admin; native levels belong
    // to Confluence's own admin UI. `enabled` is the SITE switch (CLS-1) — what the console's
    // Classification tab dims its sections on; the levels are still answered so the tab can
    // show what is kept.
    const canManageLevels = provider.name === "app" && (await isOperatorSiteAdmin(accountId));
    return { name: provider.name, levels, canManageLevels, enabled: sw.active };
  } catch (e) {
    console.error("[CLASSIFICATION] provider failed:", e);
    return { name: "app", levels: [], canManageLevels: false, error: "Could not load the classification scheme" };
  }
};

export const listSpaces = async (req) => {
  const accountId = req.context?.accountId;
  if (!accountId) return { spaces: [], reason: NOT_AUTHORIZED };
  try {
    const siteAdmin = await isOperatorSiteAdmin(accountId);
    let spaces = await listVisibleSpaces();
    if (!siteAdmin) {
      // A steward sees the spaces they administer — each row is checked on ITS OWN key, so being
      // steward of one space never lists the defaults of another (the confused-deputy shape).
      const keep = await mapLimited(spaces, 8, (s) => isAccountStewardAsApp(accountId, s.key));
      spaces = spaces.filter((_, i) => keep[i] === true);
      if (spaces.length === 0) return { spaces: [], reason: NOT_AUTHORIZED };
    }
    const { provider } = await getClassificationProvider();
    const defaults = await mapLimited(spaces, 8, async (s) => {
      try { return await provider.getSpaceDefault(s.id); } catch (_) { return null; }
    });
    return { spaces: spaces.map((s, i) => ({ ...s, defaultLevelId: defaults[i] ?? null })), siteAdmin };
  } catch (e) {
    console.error("[CLASSIFICATION] list-spaces failed:", e);
    return { spaces: [], error: "Could not load spaces" };
  }
};

export const setSpaceDefault = async (req) => {
  const accountId = req.context?.accountId;
  const payload = req.payload || {};
  const levelId = payload.levelId == null || payload.levelId === "" ? null : String(payload.levelId);
  const ids = Array.isArray(payload.spaceIds) ? payload.spaceIds : payload.spaceId != null ? [payload.spaceId] : [];
  const unique = [...new Set(ids.map((x) => String(x)))].slice(0, 500);
  if (!accountId || unique.length === 0) return { results: [], reason: NOT_AUTHORIZED };
  let provider;
  try { ({ provider } = await getClassificationProvider()); } catch (e) {
    console.error("[CLASSIFICATION] provider failed:", e);
    return { results: unique.map((spaceId) => ({ spaceId, ok: false, reason: "Could not load the classification scheme" })) };
  }
  const siteAdmin = await isOperatorSiteAdmin(accountId);
  // CLS-1: the SITE switch gates every default write (a space that opted out may still be given
  // a default — it is kept for when the space opts back in). Authorization runs first, as always.
  const siteSwitch = await resolveClassificationActive(null);
  const results = await mapLimited(unique, 4, async (spaceId) => {
    // Authorise against the key the SPACE ID resolves to — never against anything the payload
    // says about the space. A space that does not resolve is a refusal, not a skip.
    const space = await readSpace(spaceId);
    if (!space) return { spaceId, ok: false, reason: NOT_AUTHORIZED };
    if (!siteAdmin && !(await authorizeSteward(accountId, space.key))) return { spaceId, ok: false, reason: NOT_AUTHORIZED };
    if (!siteSwitch.active) return { spaceId, ok: false, reason: classificationOffReason(siteSwitch) };
    try {
      await provider.setSpaceDefault(space.id, levelId);
      return { spaceId, ok: true, key: space.key, defaultLevelId: levelId };
    } catch (e) {
      console.error(`[CLASSIFICATION] set-space-default ${spaceId} failed:`, e);
      return { spaceId, ok: false, reason: e?.message || "Could not set the default" };
    }
  });
  return { results };
};

export const getPage = async (req) => {
  const ctxPageId = req.context?.extension?.content?.id;
  const pageId = req.payload?.pageId || ctxPageId;
  const accountId = req.context?.accountId;
  if (!pageId || !isContentId(pageId)) return { effective: { level: null, source: "none" }, pageLevelId: null, reason: NOT_AUTHORIZED };
  if (mustVerify(req.payload?.pageId, ctxPageId) && !(await canReadPage(accountId, pageId))) {
    return { effective: { level: null, source: "none" }, pageLevelId: null, reason: NOT_AUTHORIZED };
  }
  try {
    // CLS-1: off → nothing is answered about the page (the stored override stays where it is).
    const sw = await classificationActiveForPage(pageId);
    if (!sw.active) return { enabled: false, reason: sw.reason, effective: { level: null, source: "none" }, pageLevelId: null };
    const { provider } = await getClassificationProvider();
    const [effective, pageLevelId] = await Promise.all([provider.effectiveLevel(pageId), provider.getPageLevel(pageId)]);
    return { enabled: true, effective, pageLevelId: pageLevelId ?? null, provider: provider.name };
  } catch (e) {
    console.error("[CLASSIFICATION] get-page failed:", e);
    return { effective: { level: null, source: "none" }, pageLevelId: null, error: "Could not load the classification" };
  }
};

export const setPage = async (req) => {
  const ctxPageId = req.context?.extension?.content?.id;
  const pageId = req.payload?.pageId || ctxPageId;
  const accountId = req.context?.accountId;
  const levelId = req.payload?.levelId == null || req.payload?.levelId === "" ? null : String(req.payload.levelId);
  if (!pageId || !isContentId(pageId)) return { ok: false, reason: NOT_AUTHORIZED };
  // Write path: unconditional. A context id proves the caller can SEE the page, not change it.
  // The owner's bar is "stewards and page editors"; a steward of the space can edit its pages,
  // so the edit check covers both without a second round-trip.
  if (!(await canEditPage(accountId, pageId))) return { ok: false, reason: NOT_AUTHORIZED };
  // CLS-1: off → refused AFTER the authorization check (an unauthorized caller learns nothing about
  // the site's switches); the config API's classify-page rides this same refusal.
  const sw = await classificationActiveForPage(pageId);
  if (!sw.active) return { ok: false, reason: classificationOffReason(sw) };
  try {
    const { provider } = await getClassificationProvider();
    if (levelId == null) await provider.resetPage(pageId);
    else await provider.setPageLevel(pageId, levelId);
    await refreshByline(pageId).catch((e) => console.warn("[BYLINE] set-page refresh failed:", e?.message || e));
    return { ok: true, effective: await provider.effectiveLevel(pageId), pageLevelId: levelId };
  } catch (e) {
    console.error("[CLASSIFICATION] set-page failed:", e);
    return { ok: false, reason: e?.message || "Could not set the classification" };
  }
};

export const manageLevels = async (req) => {
  const accountId = req.context?.accountId;
  if (!accountId || !(await isOperatorSiteAdmin(accountId))) return { ok: false, reason: NOT_AUTHORIZED };
  const { provider } = await getClassificationProvider();
  if (provider.name !== "app") return { ok: false, reason: "Levels are managed in Confluence's own classification settings on this site" };
  const v = validateLevels(req.payload?.levels);
  if (!v.ok) return { ok: false, reason: v.error };
  try {
    const levels = await getAppProvider().setLevels(v.levels);
    resetProviderCache();
    return { ok: true, levels };
  } catch (e) {
    console.error("[CLASSIFICATION] manage-levels failed:", e);
    return { ok: false, reason: "Could not save the levels" };
  }
};

// ── JSM Assets (docs/CLASSIFICATION-ASSETS-DESIGN.md) ──────────────────────────────────────
// Every call runs asUser: the Assets API refuses the app's own identity (401 in background
// contexts, per Atlassian staff on the developer community), so the steward's session is the
// only door. Site admins only — this is site configuration, and the steward console is the
// only surface that calls it. Nothing here writes to Assets.
const ASSETS_ID = /^[0-9]{1,12}$/;
async function assetsWorkspaceId() {
  const res = await asUser().requestJira(route`/rest/servicedeskapi/assets/workspace`, { headers: { Accept: "application/json" } });
  if (!res.ok) return { error: `Assets workspace lookup answered ${res.status}` };
  const data = await res.json().catch(() => ({}));
  const id = data?.values?.[0]?.workspaceId;
  return id ? { id } : { error: "This site has no Assets workspace (JSM Premium/Enterprise)" };
}
async function assetsGet(path) {
  const res = await asUser().requestJira(assumeTrustedRoute(path), { headers: { Accept: "application/json" } });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}
const listAssetsSchemas = async (req) => {
  const accountId = req.context?.accountId;
  if (!accountId || !(await isOperatorSiteAdmin(accountId))) return { error: "Only a site admin can link classification to Assets" };
  const ws = await assetsWorkspaceId();
  if (ws.error) return { error: ws.error };
  const r = await assetsGet(`/jsm/assets/workspace/${ws.id}/v1/objectschema/list`);
  if (!r.ok) return { error: `Assets answered ${r.status}${r.body?.errorMessages ? `: ${r.body.errorMessages.join("; ")}` : ""}`, status: r.status };
  return { workspaceId: ws.id, schemas: (r.body?.values || []).map((s) => ({ id: String(s.id), key: s.objectSchemaKey, name: s.name, objectTypeCount: s.objectTypeCount, objectCount: s.objectCount })) };
};
const listAssetsObjectTypes = async (req) => {
  const accountId = req.context?.accountId;
  if (!accountId || !(await isOperatorSiteAdmin(accountId))) return { error: "Only a site admin can link classification to Assets" };
  const schemaId = String(req.payload?.schemaId || "");
  if (!ASSETS_ID.test(schemaId)) return { error: "Pick a schema" };
  const ws = await assetsWorkspaceId();
  if (ws.error) return { error: ws.error };
  const r = await assetsGet(`/jsm/assets/workspace/${ws.id}/v1/objectschema/${schemaId}/objecttypes`);
  if (!r.ok) return { error: `Assets answered ${r.status}`, status: r.status };
  const types = Array.isArray(r.body) ? r.body : (r.body?.values || []);
  return { objectTypes: types.map((t) => ({ id: String(t.id), name: t.name, objectCount: t.objectCount ?? null })) };
};

const assetsGuard = async (req) => {
  const accountId = req.context?.accountId;
  if (!accountId || !(await isOperatorSiteAdmin(accountId))) return { error: "Only a site admin can link classification to Assets" };
  return null;
};
const listAssetsAttributes = async (req) => {
  const g = await assetsGuard(req); if (g) return g;
  const objectTypeId = String(req.payload?.objectTypeId || "");
  if (!ASSETS_ID.test(objectTypeId)) return { error: "Pick an object type" };
  const ws = await assetsWorkspaceId(); if (ws.error) return { error: ws.error };
  const r = await assetsGet(`/jsm/assets/workspace/${ws.id}/v1/objecttype/${objectTypeId}/attributes`);
  if (!r.ok) return { error: `Assets answered ${r.status}`, status: r.status };
  const attributes = (Array.isArray(r.body) ? r.body : []).map((a) => ({ id: String(a.id), name: a.name, type: a?.defaultType?.name || null }));
  return { attributes, suggested: guessAssetsMapping(attributes) };
};
async function readAssetsLevels(objectTypeId, mapping) {
  const ws = await assetsWorkspaceId(); if (ws.error) return { error: ws.error };
  const res = await asUser().requestJira(assumeTrustedRoute(`/jsm/assets/workspace/${ws.id}/v1/object/aql`), {
    method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ qlQuery: `objectTypeId = ${objectTypeId}`, resultPerPage: 50, includeAttributes: true }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) return { error: `Assets answered ${res.status}${body?.errorMessages ? `: ${body.errorMessages.join("; ")}` : ""}`, status: res.status };
  const objects = body?.values || body?.objectEntries || [];
  const mapped = levelsFromAssetsObjects(objects, mapping);
  return { ...mapped, workspaceId: ws.id, objectCount: objects.length, truncated: !!body?.hasMoreResults };
}
const cleanMapping = (m) => ({ rank: ASSETS_ID.test(String(m?.rank || "")) ? String(m.rank) : null, color: ASSETS_ID.test(String(m?.color || "")) ? String(m.color) : null, description: ASSETS_ID.test(String(m?.description || "")) ? String(m.description) : null });
const previewAssetsLevels = async (req) => {
  const g = await assetsGuard(req); if (g) return g;
  const objectTypeId = String(req.payload?.objectTypeId || "");
  if (!ASSETS_ID.test(objectTypeId)) return { error: "Pick an object type" };
  const r = await readAssetsLevels(objectTypeId, cleanMapping(req.payload?.mapping));
  return r.error ? { error: r.error } : { ok: r.ok, levels: r.levels || [], problems: r.problems, error: r.ok ? null : r.error, objectCount: r.objectCount, truncated: r.truncated };
};
// Import = the same read, then the SAME setLevels the levels editor uses (so validateLevels and
// the config mirror apply), plus the link record the console shows and re-imports from.
const importAssetsLevels = async (req) => {
  const g = await assetsGuard(req); if (g) return g;
  const { provider } = await getClassificationProvider();
  if (provider.name !== "app") return { error: "Levels are managed in Confluence's own classification settings on this site" };
  const objectTypeId = String(req.payload?.objectTypeId || "");
  const schemaId = String(req.payload?.schemaId || "");
  if (!ASSETS_ID.test(objectTypeId) || !ASSETS_ID.test(schemaId)) return { error: "Pick a schema and an object type" };
  const mapping = cleanMapping(req.payload?.mapping);
  const r = await readAssetsLevels(objectTypeId, mapping);
  if (r.error || !r.ok) return { error: r.error || "Nothing to import" };
  try {
    const levels = await getAppProvider().setLevels(r.levels.map(({ assetsObjectKey, ...l }) => l));
    resetProviderCache();
    const link = {
      workspaceId: r.workspaceId, schemaId, objectTypeId, objectTypeName: String(req.payload?.objectTypeName || "").slice(0, 120), schemaName: String(req.payload?.schemaName || "").slice(0, 120),
      mapping, importedAt: new Date().toISOString(), importedBy: req.context.accountId, objectKeys: r.levels.map((l) => l.assetsObjectKey), problems: r.problems,
    };
    await kvs.set(ASSETS_LINK_KVS_KEY, link);
    return { ok: true, levels, link, problems: r.problems };
  } catch (e) {
    console.error("[CLASSIFICATION] assets import failed:", e);
    return { error: "Could not save the imported levels" };
  }
};
// The link record: what the console shows ("Imported from Assets · type · date") and what the
// config API may set WITHOUT a user session (mapping only — the import itself needs one).
const getAssetsLink = async (req) => {
  const g = await assetsGuard(req); if (g) return g;
  return { link: (await kvs.get(ASSETS_LINK_KVS_KEY)) || null };
};
const setAssetsLink = async (req) => {
  const g = await assetsGuard(req); if (g) return { success: false, reason: g.error };
  const p = req.payload || {};
  if (p.link === null) { await kvs.delete(ASSETS_LINK_KVS_KEY).catch(() => {}); return { success: true, link: null }; }
  const schemaId = String(p.schemaId || ""), objectTypeId = String(p.objectTypeId || "");
  if (!ASSETS_ID.test(schemaId) || !ASSETS_ID.test(objectTypeId)) return { success: false, reason: "schemaId and objectTypeId are required" };
  const prev = (await kvs.get(ASSETS_LINK_KVS_KEY)) || {};
  const link = { ...prev, schemaId, objectTypeId, mapping: cleanMapping(p.mapping), objectTypeName: String(p.objectTypeName || prev.objectTypeName || "").slice(0, 120), schemaName: String(p.schemaName || prev.schemaName || "").slice(0, 120), linkedAt: new Date().toISOString() };
  await kvs.set(ASSETS_LINK_KVS_KEY, link);
  return { success: true, link };
};

export const actions = [
  ["classification-assets-schemas", listAssetsSchemas],
  ["classification-assets-object-types", listAssetsObjectTypes],
  ["classification-assets-attributes", listAssetsAttributes],
  ["classification-assets-preview", previewAssetsLevels],
  ["classification-assets-import", importAssetsLevels],
  ["classification-assets-link", getAssetsLink],
  ["classification-assets-set-link", setAssetsLink],
  ["classification-provider", getProvider],
  ["classification-list-spaces", listSpaces],
  ["classification-set-space-default", setSpaceDefault],
  ["classification-get-page", getPage],
  ["classification-set-page", setPage],
  ["classification-manage-levels", manageLevels],
];
