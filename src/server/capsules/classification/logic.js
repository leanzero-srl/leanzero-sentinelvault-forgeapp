/**
 * Classification capsule — PURE core (Part 3.1 + 3.2).
 *
 * Zero imports (the shared/notice-dedup.js pattern): every I/O the providers need — KVS and the
 * Confluence request function — is INJECTED, so the precedence rule, the level validation, the
 * native fallback and the exact request shapes are all unit-testable without Forge.
 * `provider.js` is the only file that binds these to `@forge/kvs` and `asApp()`.
 *
 * The provider contract (owner's design, not up for re-litigation here):
 *   name                                  "native" | "app"
 *   listLevels()                          → [{ id, name, color, rank, description }]
 *   getSpaceDefault(spaceId)              → levelId | null
 *   setSpaceDefault(spaceId, levelId)     levelId null = clear
 *   getPageLevel(pageId)                  → levelId | null   (the page's OWN override only)
 *   setPageLevel(pageId, levelId)
 *   resetPage(pageId)
 *   effectiveLevel(pageId)                → { level, source: "page" | "space" | "none" }
 *
 * Two providers:
 *
 *   NativeProvider — Confluence's own data-classification (v2 REST). Needs
 *   read:configuration:confluence for the levels list and write:space:confluence for writes,
 *   NEITHER of which is in manifest.yml yet (the owner batches scope additions into a later
 *   major). Live fact (2026-09-14): both test sites answer `[]` from /classification-levels and
 *   the page endpoint answers 404 "Feature is disabled". So live, the App provider is what runs;
 *   the Native provider is proven by the stubbed-request tests only.
 *
 *   AppProvider — the app's own scheme. Levels in KVS `classification-levels`; a space default in
 *   KVS `classification-space-{spaceId}` (the READ path) mirrored to a space property
 *   `sentinel-classification` (for CQL / visibility, best-effort); a page override in KVS
 *   `classification-page-{pageId}` mirrored to a content property of the same key.
 */

export const LEVELS_KVS_KEY = "classification-levels";
export const PROPERTY_KEY = "sentinel-classification";
export const spaceKvsKey = (spaceId) => `classification-space-${spaceId}`;
export const pageKvsKey = (pageId) => `classification-page-${pageId}`;

// Solid, saturated hues — the owner's UI rule (no washed tints). Ranks 1..4, low → high.
// The approved mockup values (docs/mockups/sv-status-surfaces.html, decision 1): white ink on each
// is >= 4.5:1 (15803D 5.0, 1D4ED8 6.3, B45309 5.0, B91C1C 6.4); the previous #059669/#D97706 were 3.8/3.2.
export const DEFAULT_LEVELS = Object.freeze([
  { id: "public", name: "Public", color: "#15803D", rank: 1, description: "Safe to share outside the organisation." },
  { id: "internal", name: "Internal", color: "#1D4ED8", rank: 2, description: "For people inside the organisation only." },
  { id: "confidential", name: "Confidential", color: "#B45309", rank: 3, description: "Limited to a named audience; handle with care." },
  { id: "restricted", name: "Restricted", color: "#B91C1C", rank: 4, description: "Highest sensitivity; strictly need-to-know." },
]);

export const MAX_LEVELS = 8;
const HEX = /^#[0-9a-fA-F]{6}$/;
const LEVEL_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const NUMERIC_ID = /^\d{1,20}$/;

/** A Confluence page/space id is numeric. Anything else never reaches a route. */
export function isContentId(id) {
  return NUMERIC_ID.test(String(id ?? ""));
}

/**
 * PURE. The precedence rule: the page's own override wins, else the space default, else none.
 * `levels` resolves an id to its object; an id that no longer names a level (a level deleted from
 * the scheme after it was assigned) is treated as unset, so the UI never shows a dangling id.
 */
export function decideEffective(pageLevelId, spaceLevelId, levels) {
  const byId = new Map((levels || []).map((l) => [String(l.id), l]));
  if (pageLevelId != null && byId.has(String(pageLevelId))) return { level: byId.get(String(pageLevelId)), source: "page" };
  if (spaceLevelId != null && byId.has(String(spaceLevelId))) return { level: byId.get(String(spaceLevelId)), source: "space" };
  return { level: null, source: "none" };
}

/**
 * PURE. Validate a replacement level set for the App provider.
 * @returns {{ ok: true, levels: Array } | { ok: false, error: string }}
 * Normalises: trims names, lowercases colours, sorts by rank. Rejects: not 1..MAX_LEVELS entries,
 * duplicate ids / names (case-insensitive) / ranks, a non-hex colour, a rank that is not a
 * positive integer, an id that is not a slug.
 */
export function validateLevels(input) {
  if (!Array.isArray(input)) return { ok: false, error: "levels must be an array" };
  if (input.length < 1 || input.length > MAX_LEVELS) return { ok: false, error: `Between 1 and ${MAX_LEVELS} levels are allowed` };
  const ids = new Set(), names = new Set(), ranks = new Set();
  const out = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return { ok: false, error: "Each level must be an object" };
    const id = String(raw.id ?? "").trim();
    const name = String(raw.name ?? "").trim();
    const color = String(raw.color ?? "").trim().toLowerCase();
    const rank = Number(raw.rank);
    const description = typeof raw.description === "string" ? raw.description.trim().slice(0, 200) : "";
    if (!LEVEL_ID.test(id)) return { ok: false, error: `Level id "${id}" must be a slug (a-z, 0-9, - or _)` };
    if (!name || name.length > 40) return { ok: false, error: `Level "${id}" needs a name of 1–40 characters` };
    if (!HEX.test(color)) return { ok: false, error: `Level "${name}" needs a hex colour like #DC2626` };
    if (!Number.isInteger(rank) || rank < 1 || rank > 99) return { ok: false, error: `Level "${name}" needs a whole-number rank from 1 to 99` };
    // Name first: the editor derives the id from the name, so "Duplicate level name" is the
    // message that matches what the person actually typed (UAT defect 4).
    if (names.has(name.toLowerCase())) return { ok: false, error: `Duplicate level name "${name}"` };
    if (ids.has(id)) return { ok: false, error: `Duplicate level id "${id}"` };
    if (ranks.has(rank)) return { ok: false, error: `Two levels share rank ${rank}` };
    ids.add(id); names.add(name.toLowerCase()); ranks.add(rank);
    out.push({ id, name, color, rank, description });
  }
  out.sort((a, b) => a.rank - b.rank);
  return { ok: true, levels: out };
}

/**
 * PURE. Is this response from the native levels endpoint "the feature is not available here"?
 * 401/403 = the scope is not granted (it is not in the manifest yet); 404 = "Feature is disabled"
 * on the site. Any of those means the selector must fall back to the App provider. A 5xx is also
 * treated as unavailable: the app must keep classifying while Confluence hiccups.
 */
export function nativeUnavailable(status) {
  return status === 401 || status === 403 || status === 404 || status >= 500;
}

/** Native level objects carry `id, status, order, name, description, guideline, color`. */
export function normalizeNativeLevel(l) {
  return {
    id: String(l.id),
    name: l.name || String(l.id),
    color: l.color || "#64748B",
    rank: Number.isFinite(Number(l.order)) ? Number(l.order) : 0,
    description: l.description || l.guideline || "",
  };
}

const readJson = async (res) => { try { return await res.json(); } catch (_) { return null; } };

/**
 * NativeProvider. `request(path, init)` is a fetch-like function (Forge's
 * asApp().requestConfluence in production; a stub under test). Every id that reaches a path has
 * already passed isContentId(). `listLevels` returns null when native is UNAVAILABLE (see
 * nativeUnavailable) so the selector can fall back; on a 2xx it returns the active levels.
 */
export function createNativeProvider({ request }) {
  const json = { Accept: "application/json", "Content-Type": "application/json" };
  const levelOf = async (path) => {
    const res = await request(path, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const body = await readJson(res);
    return body?.id != null ? String(body.id) : null;
  };
  const provider = {
    name: "native",
    async listLevels() {
      const res = await request("/wiki/api/v2/classification-levels", { headers: { Accept: "application/json" } });
      if (!res.ok) return nativeUnavailable(res.status) ? null : [];
      const body = await readJson(res);
      const arr = Array.isArray(body) ? body : Array.isArray(body?.results) ? body.results : [];
      return arr.filter((l) => l && (l.status == null || String(l.status).toLowerCase() === "published")).map(normalizeNativeLevel);
    },
    getSpaceDefault: (spaceId) => (isContentId(spaceId) ? levelOf(`/wiki/api/v2/spaces/${spaceId}/classification-level/default`) : Promise.resolve(null)),
    async setSpaceDefault(spaceId, levelId) {
      if (!isContentId(spaceId)) throw new Error("Invalid space id");
      const res = levelId == null
        ? await request(`/wiki/api/v2/spaces/${spaceId}/classification-level/default`, { method: "DELETE" })
        : await request(`/wiki/api/v2/spaces/${spaceId}/classification-level/default`, { method: "PUT", headers: json, body: JSON.stringify({ id: String(levelId) }) });
      if (!res.ok) throw new Error(`Confluence refused the space default (${res.status})`);
    },
    getPageLevel: (pageId) => (isContentId(pageId) ? levelOf(`/wiki/api/v2/pages/${pageId}/classification-level`) : Promise.resolve(null)),
    async setPageLevel(pageId, levelId) {
      if (!isContentId(pageId)) throw new Error("Invalid page id");
      if (levelId == null) return provider.resetPage(pageId);
      const res = await request(`/wiki/api/v2/pages/${pageId}/classification-level`, { method: "PUT", headers: json, body: JSON.stringify({ id: String(levelId) }) });
      if (!res.ok) throw new Error(`Confluence refused the page level (${res.status})`);
      return undefined;
    },
    async resetPage(pageId) {
      if (!isContentId(pageId)) throw new Error("Invalid page id");
      const res = await request(`/wiki/api/v2/pages/${pageId}/classification-level/reset`, { method: "POST", headers: json });
      if (!res.ok) throw new Error(`Confluence refused the page reset (${res.status})`);
    },
    async effectiveLevel(pageId) {
      // Native's GET on a page already returns the inherited level, but it does not say WHERE it
      // came from; the source is what the ribbon shows, so it is derived here the same way as App.
      const levels = (await provider.listLevels()) || [];
      const page = await provider.getPageLevel(pageId);
      let space = null;
      if (page == null) {
        const spaceId = await resolveSpaceId(request, pageId);
        space = spaceId ? await provider.getSpaceDefault(spaceId) : null;
      }
      return decideEffective(page, space, levels);
    },
  };
  return provider;
}

/** v2 `GET /wiki/api/v2/pages/{id}` → spaceId (string) or null. */
export async function resolveSpaceId(request, pageId) {
  if (!isContentId(pageId)) return null;
  const res = await request(`/wiki/api/v2/pages/${pageId}`, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const body = await readJson(res);
  return body?.spaceId != null ? String(body.spaceId) : null;
}

/**
 * Upsert-or-delete a v2 property (page or space share the shape: GET ?key=, POST, PUT with the
 * next version number, DELETE). Best-effort by design: KVS is the read path, the property is a
 * mirror for CQL and visibility, and a mirror that cannot be written must not block the decision.
 *
 * Space properties need write:space:confluence, which is NOT in the manifest yet — live, that
 * branch answers 403 and is logged, nothing more. Page (content) properties are covered by
 * write:content.property:confluence, which is granted.
 */
export async function mirrorProperty(request, base, value, log = () => {}, key = PROPERTY_KEY) {
  // `key` defaults to the classification property; the config API reuses this for its
  // `sentinel-vault-receipt` / `sentinel-vault-config` mirrors (config-api/mirror.js).
  try {
    const gres = await request(`${base}/properties?key=${key}`, { headers: { Accept: "application/json" } });
    if (!gres.ok) { log(`[CLASSIFICATION] property read on ${base} → ${gres.status}`); return false; }
    const existing = (await readJson(gres))?.results?.[0];
    const json = { Accept: "application/json", "Content-Type": "application/json" };
    let res;
    if (value == null) {
      if (!existing) return true;
      res = await request(`${base}/properties/${existing.id}`, { method: "DELETE" });
    } else if (existing) {
      const number = (existing.version?.number || 1) + 1;
      res = await request(`${base}/properties/${existing.id}`, { method: "PUT", headers: json, body: JSON.stringify({ key, value, version: { number } }) });
    } else {
      res = await request(`${base}/properties`, { method: "POST", headers: json, body: JSON.stringify({ key, value }) });
    }
    if (!res.ok) log(`[CLASSIFICATION] property write on ${base} → ${res.status}`);
    return !!res.ok;
  } catch (e) {
    log(`[CLASSIFICATION] property mirror on ${base} threw: ${e?.message || e}`);
    return false;
  }
}

/**
 * AppProvider. `kvs` needs get/set/delete; `request` as above. Levels: a stored set wins, else
 * the seeded default. An unknown level id on a write is refused here (not only in the resolver)
 * so no path can persist a dangling id.
 */
export function createAppProvider({ kvs, request, log = () => {} }) {
  const provider = {
    name: "app",
    async listLevels() {
      const stored = await kvs.get(LEVELS_KVS_KEY);
      const v = Array.isArray(stored?.levels) ? validateLevels(stored.levels) : null;
      return v?.ok ? v.levels : DEFAULT_LEVELS.map((l) => ({ ...l }));
    },
    async setLevels(levels) {
      const v = validateLevels(levels);
      if (!v.ok) throw new Error(v.error);
      await kvs.set(LEVELS_KVS_KEY, { levels: v.levels, updatedAt: new Date().toISOString() });
      return v.levels;
    },
    async assertLevel(levelId) {
      const levels = await provider.listLevels();
      if (!levels.some((l) => l.id === String(levelId))) throw new Error(`Unknown classification level "${levelId}"`);
    },
    async getSpaceDefault(spaceId) {
      if (!isContentId(spaceId)) return null;
      const rec = await kvs.get(spaceKvsKey(spaceId));
      return rec?.levelId ?? null;
    },
    async setSpaceDefault(spaceId, levelId) {
      if (!isContentId(spaceId)) throw new Error("Invalid space id");
      if (levelId == null) {
        await kvs.delete(spaceKvsKey(spaceId));
      } else {
        await provider.assertLevel(levelId);
        await kvs.set(spaceKvsKey(spaceId), { levelId: String(levelId), updatedAt: new Date().toISOString() });
      }
      await mirrorProperty(request, `/wiki/api/v2/spaces/${spaceId}`, levelId == null ? null : { levelId: String(levelId) }, log);
    },
    async getPageLevel(pageId) {
      if (!isContentId(pageId)) return null;
      const rec = await kvs.get(pageKvsKey(pageId));
      return rec?.levelId ?? null;
    },
    async setPageLevel(pageId, levelId) {
      if (!isContentId(pageId)) throw new Error("Invalid page id");
      if (levelId == null) return provider.resetPage(pageId);
      await provider.assertLevel(levelId);
      await kvs.set(pageKvsKey(pageId), { levelId: String(levelId), updatedAt: new Date().toISOString() });
      await mirrorProperty(request, `/wiki/api/v2/pages/${pageId}`, { levelId: String(levelId) }, log);
      return undefined;
    },
    async resetPage(pageId) {
      if (!isContentId(pageId)) throw new Error("Invalid page id");
      await kvs.delete(pageKvsKey(pageId));
      await mirrorProperty(request, `/wiki/api/v2/pages/${pageId}`, null, log);
    },
    async effectiveLevel(pageId) {
      const levels = await provider.listLevels();
      const page = await provider.getPageLevel(pageId);
      let space = null;
      if (page == null) {
        const spaceId = await resolveSpaceId(request, pageId);
        space = spaceId ? await provider.getSpaceDefault(spaceId) : null;
      }
      return decideEffective(page, space, levels);
    },
  };
  return provider;
}

/**
 * PURE selector core. Probe native once; a null levels list (unavailable) or an EMPTY one (the
 * feature answers but the site has defined no levels — the live state on both test sites) both
 * mean the App provider runs: an empty native scheme has nothing to assign.
 */
export async function selectProvider({ native, app }) {
  let levels = null;
  try { levels = await native.listLevels(); } catch (_) { levels = null; }
  if (Array.isArray(levels) && levels.length > 0) return { provider: native, levels };
  return { provider: app, levels: await app.listLevels() };
}

// ── JSM Assets → levels (pure; docs/CLASSIFICATION-ASSETS-DESIGN.md) ─────────────────────────
// An object type's objects become the level list. `mapping` names the attribute ids that carry
// rank / colour / description (the name is the object's label). Colours may be hex or a colour
// WORD (the wolfaenpak "Classification Level" type stores "green", "orange"…); words map onto
// the same solid palette the defaults use; anything unreadable falls back to the palette by
// rank and is reported as a problem, never silently. Output goes through validateLevels, so
// the imported list obeys every rule a hand-typed one does.
export const ASSETS_LINK_KVS_KEY = "classification-assets-link";
const COLOUR_WORDS = Object.freeze({
  green: "#15803D", blue: "#1D4ED8", orange: "#B45309", amber: "#B45309", yellow: "#A16207", red: "#B91C1C",
  purple: "#6D28D9", violet: "#6D28D9", teal: "#0F766E", cyan: "#0E7490", grey: "#475569", gray: "#475569",
  black: "#0F172A", pink: "#BE185D", brown: "#78350F", navy: "#1E3A8A",
});
const PALETTE = Object.freeze(["#15803D", "#1D4ED8", "#B45309", "#B91C1C", "#6D28D9", "#0F766E", "#A16207", "#475569", "#BE185D", "#78350F"]);
export const slugifyLevelId = (name) => String(name || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "level";

function attrValue(obj, attrId) {
  if (!attrId) return null;
  const a = (obj?.attributes || []).find((x) => String(x?.objectTypeAttributeId) === String(attrId));
  const v = a?.objectAttributeValues?.[0];
  if (!v) return null;
  const raw = v.displayValue ?? v.value ?? (v.referencedObject?.label ?? null);
  return raw == null ? null : String(raw).trim();
}
export function colourFromAssets(raw) {
  if (!raw) return null;
  const t = String(raw).trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(t)) return t.toUpperCase();
  if (/^[0-9a-f]{6}$/.test(t)) return `#${t.toUpperCase()}`;
  return COLOUR_WORDS[t] || null;
}
/**
 * @param {object[]} objects  Assets objects (`values` of the AQL answer)
 * @param {{rank?:string, color?:string, description?:string}} mapping  attribute ids
 * @returns {{ ok:boolean, levels?:object[], problems:string[], error?:string }}
 */
export function levelsFromAssetsObjects(objects, mapping = {}) {
  const problems = [];
  const list = Array.isArray(objects) ? objects : [];
  if (list.length === 0) return { ok: false, problems, error: "That object type has no objects to import" };
  const rows = list.map((o, i) => {
    const name = String(o?.label || o?.name || "").trim();
    const rankRaw = attrValue(o, mapping.rank);
    const rankNum = rankRaw == null ? NaN : Number(rankRaw);
    const colourRaw = attrValue(o, mapping.color);
    const colour = colourFromAssets(colourRaw);
    if (mapping.color && colourRaw && !colour) problems.push(`${name || o?.objectKey || "object"}: colour "${colourRaw}" is not a hex value or a known colour word — a palette colour was used`);
    if (mapping.rank && (rankRaw == null || !Number.isInteger(rankNum))) problems.push(`${name || o?.objectKey || "object"}: rank "${rankRaw ?? ""}" is not a whole number — the object's position was used`);
    return { name, objectKey: o?.objectKey || null, rankNum: Number.isInteger(rankNum) ? rankNum : null, colour, description: attrValue(o, mapping.description) || "", order: i };
  });
  // ranks: the attribute where it is a whole number, else positions after the highest given rank
  let next = Math.max(0, ...rows.map((r) => r.rankNum || 0)) + 1;
  const levels = rows
    .sort((a, b) => (a.rankNum ?? Infinity) - (b.rankNum ?? Infinity) || a.order - b.order)
    .map((r, i) => ({
      id: slugifyLevelId(r.name), name: r.name, rank: r.rankNum ?? next++,
      color: r.colour || PALETTE[i % PALETTE.length], description: r.description.slice(0, 200),
      assetsObjectKey: r.objectKey,
    }));
  const v = validateLevels(levels.map(({ assetsObjectKey, ...l }) => l));
  if (!v.ok) return { ok: false, problems, error: v.error };
  // keep the object keys next to the validated rows (validateLevels re-sorts by rank; ids are unique)
  const keyOf = new Map(levels.map((l) => [l.id, l.assetsObjectKey]));
  return { ok: true, levels: v.levels.map((l) => ({ ...l, assetsObjectKey: keyOf.get(l.id) || null })), problems };
}
/** Guess the mapping from attribute names (Rank / Colour|Color / Description|Guidance|Handling). */
export function guessAssetsMapping(attributes) {
  const find = (re) => (attributes || []).find((a) => re.test(String(a?.name || "")))?.id;
  return { rank: find(/^rank$|\brank\b|\border\b|\blevel\b/i) || null, color: find(/colou?r/i) || null, description: find(/description|guidance|handling|summary/i) || null };
}
