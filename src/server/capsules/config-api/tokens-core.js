/*
 * Config API tokens — the PURE core (docs/REST-CONFIG-API.md "Authentication and authority").
 *
 * Mirrors CogniRunner's src/rules-api.js token store, adapted: `svt_` prefix, `api-tokens` row,
 * `api-token-revoked:<id>` tombstones. Everything here takes a `storage` with get/set/delete so
 * test/config-api.test.mjs drives it against a Map; tokens.js binds it to @forge/kvs.
 *
 * Invariants that must not break (each one is a CogniRunner scar):
 *  - only the SHA-256 hash is stored; the plaintext leaves createApiToken exactly once.
 *  - revoke writes the TOMBSTONE FIRST. `api-tokens` is one array written by three
 *    read-modify-write sites (mint, revoke, lastUsedAt touch); a request that snapshotted the
 *    array before a revoke could write the live hash back and resurrect the token. The
 *    tombstone lives outside that array, and authenticate() consults it after a hash match.
 *  - hash comparison is timing-safe.
 *  - lastUsedAt is touched at most once per hour, and NEVER by writing back the snapshot:
 *    re-read and merge only that one field.
 *  - a MISSING role reads as admin (compatibility rule); an UNKNOWN role reads as viewer
 *    (a word we cannot read is not a grant); mint REFUSES an unknown role rather than coercing.
 */
import { createHash, randomBytes, timingSafeEqual } from "crypto";

export const API_TOKENS_KEY = "api-tokens";
export const REVOKED_TOKEN_PREFIX = "api-token-revoked:";
export const TOKEN_PREFIX = "svt_";
export const TOKEN_ROLES = Object.freeze(["viewer", "editor", "admin"]);
export const MAX_TOKENS = 25;
const ROLE_RANK = Object.freeze({ viewer: 1, editor: 2, admin: 3 });
const TOKEN_RE = /^svt_[0-9a-f]{48}$/;
const TOUCH_INTERVAL_MS = 3600000;
const PRUNE_AFTER_MS = 30 * 86400000;

export const sha256 = (s) => createHash("sha256").update(String(s)).digest("hex");

/** PURE. The role a stored row grants. absent → admin; unknown → viewer. */
export const tokenRole = (t) => {
  if (!t || t.role === undefined || t.role === null || t.role === "") return "admin";
  const r = String(t.role);
  return TOKEN_ROLES.includes(r) ? r : TOKEN_ROLES[0];
};

/** PURE. Does this token's role reach the floor? */
export const tokenRoleAtLeast = (who, floor) => (ROLE_RANK[tokenRole(who)] || 0) >= (ROLE_RANK[floor] || Infinity);

/** PURE. Mint-time role: omitted stays null (reads as admin); anything else must be in the set. */
export const normalizeMintRole = (role) => {
  if (role === undefined || role === null || role === "") return null;
  const r = String(role).trim().toLowerCase();
  if (!TOKEN_ROLES.includes(r)) throw new Error(`Unknown token role "${String(role).slice(0, 40)}". Use one of: ${TOKEN_ROLES.join(", ")}.`);
  return r;
};

export const tombstoneKey = (id) => REVOKED_TOKEN_PREFIX + String(id).replace(/[^a-zA-Z0-9:._#-]/g, "-").slice(0, 120);

export const publicRow = (t) => ({
  id: t.id,
  name: t.name,
  prefix: t.prefix,
  createdAt: t.createdAt,
  createdBy: t.createdBy || null,
  role: tokenRole(t),
  lastUsedAt: t.lastUsedAt || null,
  revokedAt: t.revokedAt || null,
});

/** Pull the bearer out of a web-trigger request (Authorization: Bearer … or X-Api-Key). */
export function extractBearer(req) {
  const h = (req && req.headers) || {};
  const pick = (name) => {
    const v = h[name] ?? h[name.toLowerCase()] ?? h[name[0].toUpperCase() + name.slice(1)];
    return Array.isArray(v) ? v[0] : v;
  };
  const auth = pick("authorization");
  let token = typeof auth === "string" ? auth.replace(/^Bearer\s+/i, "").trim() : "";
  if (!token) { const k = pick("x-api-key"); if (typeof k === "string") token = k.trim(); }
  return token || "";
}

/**
 * Build the store over a get/set/delete storage. `now` is injectable so the hourly touch and
 * the 30-day prune are testable without waiting.
 */
export function createTokenStore(storage, { now = () => Date.now(), random = randomBytes } = {}) {
  const nowIso = () => new Date(now()).toISOString();
  const readTokens = async () => { const v = (await storage.get(API_TOKENS_KEY)) || []; return Array.isArray(v) ? v : []; };
  const isRevoked = async (id) => Boolean(await storage.get(tombstoneKey(id)));

  const listApiTokens = async () => {
    const rows = await readTokens();
    const out = [];
    for (const t of rows) {
      const row = publicRow(t);
      // A resurrected row reports as revoked: the tombstone, not the array, is the truth.
      if (!row.revokedAt) {
        try { const stone = await storage.get(tombstoneKey(t.id)); if (stone) row.revokedAt = stone.revokedAt || nowIso(); } catch { /* best-effort */ }
      }
      out.push(row);
    }
    return out;
  };

  const createApiToken = async ({ name, accountId, role }) => {
    const token = `${TOKEN_PREFIX}${random(24).toString("hex")}`;
    const row = {
      id: `tok_${now().toString(36)}${random(3).toString("hex")}`,
      name: String(name || "API token").slice(0, 80),
      hash: sha256(token),
      prefix: token.slice(0, 10),
      createdAt: nowIso(),
      createdBy: accountId || null,
      role: normalizeMintRole(role),
      lastUsedAt: null,
      revokedAt: null,
    };
    // Read immediately before the write: a mint or revoke that landed while this request was
    // hashing must not be dropped by a stale snapshot. A revoke can never be lost regardless —
    // its tombstone lives outside this array.
    const cutoff = now() - PRUNE_AFTER_MS;
    const all = await readTokens();
    const expired = all.filter((t) => t.revokedAt && Date.parse(t.revokedAt) <= cutoff);
    const rows = all.filter((t) => !expired.includes(t));
    if (rows.filter((t) => !t.revokedAt).length >= MAX_TOKENS) throw new Error(`Token limit reached (${MAX_TOKENS}). Revoke unused tokens first.`);
    rows.push(row);
    await storage.set(API_TOKENS_KEY, rows);
    for (const t of expired) { try { await storage.delete(tombstoneKey(t.id)); } catch { /* best-effort */ } }
    return { token, row: publicRow(row) };
  };

  const revokeApiToken = async (id) => {
    const rows = await readTokens();
    const t = rows.find((r) => r.id === id);
    if (!t) return { revoked: false };
    const revokedAt = nowIso();
    // TOMBSTONE FIRST — dead from this instant even if the array write below fails or an
    // in-flight request writes its stale snapshot after us.
    await storage.set(tombstoneKey(id), { id, revokedAt });
    const fresh = await readTokens();
    const row = fresh.find((r) => r.id === id);
    if (row) { row.revokedAt = revokedAt; row.hash = "revoked"; await storage.set(API_TOKENS_KEY, fresh); }
    return { revoked: true };
  };

  /** Plaintext → the live row (with role), or null. Fails CLOSED on any storage error. */
  const authenticate = async (token) => {
    if (!token || !TOKEN_RE.test(token)) return null;
    const want = Buffer.from(sha256(token), "hex");
    const rows = await readTokens();
    let hit = null;
    for (const r of rows) {
      if (r.revokedAt || typeof r.hash !== "string" || r.hash.length !== 64) continue;
      const have = Buffer.from(r.hash, "hex");
      if (have.length === want.length && timingSafeEqual(have, want)) hit = r;
    }
    if (!hit) return null;
    if (await isRevoked(hit.id)) return null;
    if (!hit.lastUsedAt || now() - Date.parse(hit.lastUsedAt) > TOUCH_INTERVAL_MS) {
      let fresh; let row;
      try { fresh = await readTokens(); row = fresh.find((r) => r.id === hit.id); }
      catch { return hit; }
      if (!row || row.revokedAt || row.hash !== hit.hash) return null;
      row.lastUsedAt = nowIso();
      try { await storage.set(API_TOKENS_KEY, fresh); } catch { /* best-effort */ }
      return { ...row };
    }
    return hit;
  };

  return { listApiTokens, createApiToken, revokeApiToken, authenticate, readTokens };
}
