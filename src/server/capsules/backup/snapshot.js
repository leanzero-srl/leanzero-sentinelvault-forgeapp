/*
 * Backup — the snapshot format (PURE: node crypto only, no Forge import; pinned by
 * test/backup-snapshot.test.mjs). docs/BACKUP-AND-RESTORE.md "The format".
 *
 * A generation is one MANIFEST plus the CHUNKS it names:
 *
 *   chunk     sv-chunk-<sha256[0..40]>.json   {"f":"sv-backup-chunk","v":1,"e":[[key,value,expireAt|null],…]}
 *             Content-addressed: an unchanged run of keys produces the same bytes, the same name,
 *             and is not uploaded again. Boundaries are CONTENT-DEFINED on the key (a key whose
 *             hash ends in the boundary pattern closes a chunk once it holds MIN_CHUNK bytes; any
 *             chunk closes at MAX_CHUNK), so inserting one key changes the chunk it lands in and
 *             not every chunk after it — the activity log's newest-first keys would otherwise
 *             shift every boundary on every event.
 *   manifest  sv-backup-<generationId>.manifest.json — what the generation holds, per family
 *             counts, the chunk list with each chunk's sha256 and size, the secrets that were NOT
 *             backed up (names only), and `manifestSha256` over the manifest itself.
 *
 * Integrity: a restore re-hashes EVERY chunk against the manifest and the manifest against its own
 * hash before it writes a single key; one mismatch and nothing is written.
 */
import { createHash } from "crypto";
import { familyOf, FAMILIES, GROUP_LABELS } from "./families.js";

export const FORMAT = "sentinel-vault-backup";
export const FORMAT_VERSION = 1;
export const CHUNK_FORMAT = "sv-backup-chunk";
export const EXPORT_FORMAT = "sentinel-vault-export";
export const MIN_CHUNK = 128 * 1024;
export const MAX_CHUNK = 900 * 1024;
const BOUNDARY_MASK = 0x1f; // 1 in 32 keys can close a chunk (once MIN_CHUNK is reached)

export const sha256 = (s) => createHash("sha256").update(String(s), "utf8").digest("hex");

/** PURE. JSON with object keys sorted at every level — the same value always gives the same bytes. */
export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value === undefined ? null : value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v === undefined ? null : v)).join(",")}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

/** PURE. Does this key close a chunk (given the chunk is already MIN_CHUNK bytes)? */
export const isBoundaryKey = (key) => (parseInt(sha256(key).slice(-2), 16) & BOUNDARY_MASK) === 0;

export const chunkName = (sha) => `sv-chunk-${sha.slice(0, 40)}.json`;
export const manifestName = (generationId) => `sv-backup-${generationId}.manifest.json`;
export const isManifestName = (title) => /^sv-backup-[A-Za-z0-9-]+\.manifest\.json$/.test(String(title || ""));
export const isChunkName = (title) => /^sv-chunk-[0-9a-f]{40}\.json$/.test(String(title || ""));

/** PURE. A generation id: sortable UTC stamp + a short random tail. */
export function newGenerationId(nowMs = Date.now(), rand = Math.random().toString(36).slice(2, 6)) {
  const iso = new Date(nowMs).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `${iso}-${rand}`;
}

/**
 * Streams entries (in key order) into content-defined chunks. `push` returns a finished chunk or
 * null; `finish` returns the last one (or null when empty). A chunk is
 * { name, sha256, bytes, keys, text } — `text` is what gets uploaded.
 */
export class ChunkBuilder {
  constructor({ min = MIN_CHUNK, max = MAX_CHUNK } = {}) { this.min = min; this.max = max; this.parts = []; this.bytes = 0; }
  push(key, value, expireAt = null) {
    const part = stableStringify([key, value, expireAt ?? null]);
    this.parts.push(part);
    this.bytes += part.length + 1;
    if (this.bytes >= this.max || (this.bytes >= this.min && isBoundaryKey(key))) return this.cut();
    return null;
  }
  finish() { return this.parts.length ? this.cut() : null; }
  cut() {
    const text = `{"f":"${CHUNK_FORMAT}","v":1,"e":[${this.parts.join(",")}]}`;
    const sha = sha256(text);
    const chunk = { name: chunkName(sha), sha256: sha, bytes: Buffer.byteLength(text, "utf8"), keys: this.parts.length, text };
    this.parts = []; this.bytes = 0;
    return chunk;
  }
}

/** PURE. Parse a chunk's text into [[key, value, expireAt], …]; throws on a malformed chunk. */
export function parseChunk(text) {
  const doc = JSON.parse(text);
  if (!doc || doc.f !== CHUNK_FORMAT || !Array.isArray(doc.e)) throw new Error("Not a Sentinel Vault backup chunk");
  return doc.e;
}

/** PURE. The manifest's own hash: sha256 of the stable JSON of everything but `manifestSha256`. */
export function manifestHash(manifest) {
  const { manifestSha256, ...rest } = manifest || {};
  return sha256(stableStringify(rest));
}

/** PURE. Seal a manifest (adds manifestSha256). */
export const sealManifest = (m) => ({ ...m, manifestSha256: manifestHash(m) });

/** PURE. { ok, reason } — format, version and self-hash. */
export function verifyManifest(m) {
  if (!m || typeof m !== "object") return { ok: false, reason: "The backup index is unreadable." };
  if (m.format !== FORMAT) return { ok: false, reason: "This is not a Sentinel Vault backup." };
  if (!(Number(m.formatVersion) >= 1) || Number(m.formatVersion) > FORMAT_VERSION) return { ok: false, reason: `This backup was written by a newer Sentinel Vault (format ${m.formatVersion}). Update the app first.` };
  if (!Array.isArray(m.chunks)) return { ok: false, reason: "The backup lists no data." };
  if (m.manifestSha256 !== manifestHash(m)) return { ok: false, reason: "The backup index failed its integrity check (it was changed or damaged)." };
  return { ok: true };
}

/** PURE. Does a chunk's text match what the manifest says it is? */
export const verifyChunk = (text, expected) => !!expected && sha256(text) === expected.sha256;

/** PURE. A content fingerprint of a generation (chunk hashes in order) — equal ⇒ nothing changed. */
export const contentFingerprint = (chunks) => sha256((chunks || []).map((c) => c.sha256).join("|"));

/** PURE. Count keys per family label while streaming. */
export function tallyFamily(counts, key) {
  const f = familyOf(key);
  const id = f.prefix || "other";
  const row = counts[id] || (counts[id] = { prefix: f.prefix, group: f.group, label: f.label, keys: 0 });
  row.keys += 1;
  return counts;
}

/**
 * PURE. What the secrets were, by NAME only — the restore tells the admin what to re-enter.
 * `apiTokens` is the stored `api-tokens` array (hash + metadata); only non-secret metadata leaves.
 */
export function secretsInventory({ apiTokens, authenticatorAccounts }) {
  const tokens = (Array.isArray(apiTokens) ? apiTokens : [])
    .filter((t) => t && !t.revokedAt)
    .map((t) => ({ name: t.name || "(unnamed)", role: t.role || "admin", createdAt: t.createdAt || null, createdBy: t.createdBy || null }));
  return { apiTokens: tokens, authenticatorAccounts: [...new Set((authenticatorAccounts || []).filter(Boolean))] };
}

/** PURE. Preview rows grouped the way the admin thinks about them. */
export function previewGroups(manifest) {
  const byGroup = {};
  for (const row of Object.values(manifest?.counts || {})) {
    const g = row.group || "other";
    const entry = byGroup[g] || (byGroup[g] = { group: g, label: GROUP_LABELS[g] || g, keys: 0, families: [] });
    entry.keys += row.keys;
    entry.families.push({ label: row.label || "Other app data", keys: row.keys });
  }
  const order = Object.keys(GROUP_LABELS);
  return Object.values(byGroup).sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
}

// ── Automations: what comes back PAUSED after a restore ─────────────────────────────────────
// A restore can land weeks after the backup. Anything that acts on its own (a timer, a sweep, a
// rewrite of a page, a paid AI call) comes back OFF until an admin turns it back on, so the app
// never wakes up and does a month of work in one hour. Protections (seals, enforced workflow
// states) come back ON — they only react to a person's edit, and switching them off would leave
// content unprotected.

/** The rules: one row per automation. `paths` are dotted field paths inside the record. */
export const AUTOMATION_RULES = Object.freeze([
  { id: "seal-expiry", match: (k) => k === "admin-settings-global", label: "Seals expire (timers, overdue reminders and the automatic release)",
    pausable: (v) => v?.autoUnlockEnabled !== false, pause: (v, at) => ({ ...v, autoUnlockEnabled: false, autoUnlockPausedAt: at }), fields: ["autoUnlockEnabled"] },
  { id: "validation-revert", match: (k) => k.startsWith("validation-config-"), label: "Validation revert mode (rewrites a page that fails a rule)",
    pausable: (v) => v?.modes?.revert === true, pause: (v) => ({ ...v, modes: { ...(v.modes || {}), revert: false } }), fields: ["modes.revert"] },
  { id: "validation-ai", match: (k) => k.startsWith("validation-config-"), label: "AI review (spends AI budget on every save)",
    pausable: (v) => v?.ai?.enabled === true, pause: (v) => ({ ...v, ai: { ...(v.ai || {}), enabled: false } }), fields: ["ai.enabled"] },
  { id: "workflow-auto-assign", match: (k) => k.startsWith("workflow-settings-"), label: "Workflow auto-assign on new pages",
    pausable: (v) => v?.autoAssignNew === true, pause: (v) => ({ ...v, autoAssignNew: false }), fields: ["autoAssignNew"] },
  { id: "workflow-review-due", match: (k) => k.startsWith("workflow-settings-"), label: "Workflow review-due timers",
    pausable: (v) => !!v?.reviewAfterDaysByState && Object.keys(v.reviewAfterDaysByState).length > 0, pause: (v) => ({ ...v, reviewAfterDaysByState: {} }), fields: ["reviewAfterDaysByState"] },
]);

const getPath = (obj, path) => path.split(".").reduce((o, p) => (o == null ? undefined : o[p]), obj);

/** PURE. The scope a KVS key's automation belongs to (for the label and the resume call). */
export function automationScope(key) {
  if (key === "admin-settings-global") return { scope: "site", name: "Site" };
  const vm = /^validation-config-(global|space-(.+))$/.exec(key);
  if (vm) return vm[1] === "global" ? { scope: "site", name: "Site" } : { scope: "space", spaceKey: vm[2], name: `Space ${vm[2]}` };
  const wm = /^workflow-settings-(.+)$/.exec(key);
  if (wm) return { scope: "space", spaceKey: wm[1], name: `Space ${wm[1]}` };
  return { scope: "site", name: "Site" };
}

/**
 * PURE. Apply the pause rules to one restored entry. Returns { value, paused[] } where each paused
 * item records the ORIGINAL field values so "Turn back on" can put them back exactly.
 */
export function pauseAutomations(key, value, { pausedAt = Date.now() } = {}) {
  let v = value;
  const paused = [];
  if (!v || typeof v !== "object") return { value: v, paused };
  for (const rule of AUTOMATION_RULES) {
    if (!rule.match(key) || !rule.pausable(v)) continue;
    const original = Object.fromEntries(rule.fields.map((f) => [f, getPath(v, f)]));
    v = rule.pause(v, pausedAt);
    const sc = automationScope(key);
    paused.push({ id: `${rule.id}:${key}`, rule: rule.id, key, label: rule.label, where: sc.name, spaceKey: sc.spaceKey || null, original });
  }
  return { value: v, paused };
}

/** PURE. Would a restore of this generation pause anything? (for the preview, from the chunks) */
export function previewPauses(entries) {
  const out = [];
  for (const [key, value] of entries || []) out.push(...pauseAutomations(key, value).paused);
  return out;
}

/**
 * PURE. Decide what one backed-up entry becomes on restore, given now.
 *   { action: "write", key, value, expireAt|null } | { action: "skip", key, reason }
 * An entry whose own TTL has run out is skipped (it would have been reaped anyway).
 */
export function restoreDecision([key, value, expireAt], nowMs = Date.now()) {
  if (typeof key !== "string" || !key) return { action: "skip", key, reason: "bad key" };
  if (familyOf(key).cls !== "config") return { action: "skip", key, reason: "not a backed-up family" };
  if (expireAt != null) {
    const ms = typeof expireAt === "number" ? expireAt : Date.parse(expireAt);
    if (Number.isFinite(ms) && ms <= nowMs + 60000) return { action: "skip", key, reason: "expired" };
    return { action: "write", key, value, expireAt: Number.isFinite(ms) ? ms : null };
  }
  return { action: "write", key, value, expireAt: null };
}

/** PURE. Family table for docs/UI — what survives and what does not. */
export function survivalTable() {
  const config = FAMILIES.filter((f) => f.cls === "config");
  const groups = {};
  for (const f of config) (groups[f.group] || (groups[f.group] = [])).push(f.label);
  return {
    survives: Object.entries(groups).map(([g, labels]) => ({ group: g, label: GROUP_LABELS[g] || g, items: labels })),
    secrets: ["REST API tokens — create new ones in API access after a restore", "Authenticator enrolments for signed actions — each person enrolls again"],
    rebuilt: ["Notification and reminder timers, dedup markers and job receipts — the app starts them fresh"],
  };
}
