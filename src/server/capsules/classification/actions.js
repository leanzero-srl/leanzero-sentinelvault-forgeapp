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
import { getAppProvider, getClassificationProvider, resetProviderCache } from "./provider.js";
import { isContentId, validateLevels } from "./logic.js";
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
    const { provider, levels } = await getClassificationProvider();
    // Levels are editable only on the App scheme and only by a site admin; native levels belong
    // to Confluence's own admin UI.
    const canManageLevels = provider.name === "app" && (await isOperatorSiteAdmin(accountId));
    return { name: provider.name, levels, canManageLevels };
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
  const results = await mapLimited(unique, 4, async (spaceId) => {
    // Authorise against the key the SPACE ID resolves to — never against anything the payload
    // says about the space. A space that does not resolve is a refusal, not a skip.
    const space = await readSpace(spaceId);
    if (!space) return { spaceId, ok: false, reason: NOT_AUTHORIZED };
    if (!siteAdmin && !(await authorizeSteward(accountId, space.key))) return { spaceId, ok: false, reason: NOT_AUTHORIZED };
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
    const { provider } = await getClassificationProvider();
    const [effective, pageLevelId] = await Promise.all([provider.effectiveLevel(pageId), provider.getPageLevel(pageId)]);
    return { effective, pageLevelId: pageLevelId ?? null, provider: provider.name };
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

export const actions = [
  ["classification-provider", getProvider],
  ["classification-list-spaces", listSpaces],
  ["classification-set-space-default", setSpaceDefault],
  ["classification-get-page", getPage],
  ["classification-set-page", setPage],
  ["classification-manage-levels", manageLevels],
];
