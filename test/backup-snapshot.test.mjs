// Pillar 12: the backup format — chunking, integrity, restore decisions, automation pause.
import { eq, ok, report } from "./_assert.mjs";
import {
  ChunkBuilder, parseChunk, sealManifest, verifyManifest, verifyChunk, manifestHash, stableStringify, isBoundaryKey,
  pauseAutomations, restoreDecision, secretsInventory, previewGroups, tallyFamily, contentFingerprint,
  chunkName, isChunkName, isManifestName, manifestName, newGenerationId, FORMAT, FORMAT_VERSION, MIN_CHUNK, MAX_CHUNK,
} from "../src/server/capsules/backup/snapshot.js";
import { retainGenerations, mergeInstallations, choosePage, verifyExport } from "../src/server/capsules/backup/engine.js";
import { backupPageTitle } from "../src/server/capsules/backup/store.js";

// ── stable JSON ──
eq("stable JSON sorts keys at every level", stableStringify({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } }), '{"a":{"c":null,"d":[1,{"y":2,"z":1}]},"b":1}');
eq("undefined fields are dropped like JSON.stringify", stableStringify({ a: undefined, b: 2 }), '{"b":2}');

// ── chunking: round trip, determinism, locality ──
const entries = [];
for (let i = 0; i < 3000; i++) entries.push([`protection-att${String(i).padStart(6, "0")}`, { lockedBy: "712020:u", expiresAt: null, note: "x".repeat(200 + (i % 50)) }, i % 7 === 0 ? "2099-01-01T00:00:00.000Z" : null]);
const build = (list) => { const b = new ChunkBuilder(); const out = []; for (const [k, v, e] of list) { const c = b.push(k, v, e); if (c) out.push(c); } const last = b.finish(); if (last) out.push(last); return out; };
const chunks = build(entries);
ok("3000 entries split into several chunks", chunks.length > 2);
ok("every chunk is under the max size", chunks.every((c) => c.bytes <= MAX_CHUNK + 2048));
ok("every chunk but the last reached the min size", chunks.slice(0, -1).every((c) => c.bytes >= MIN_CHUNK));
ok("chunk names are content addresses", chunks.every((c) => c.name === chunkName(c.sha256) && isChunkName(c.name)));
const back = chunks.flatMap((c) => parseChunk(c.text));
// Field-by-field equality (stable JSON: object key ORDER is not data).
ok("round trip returns every entry, in order, with value and expiry", stableStringify(back) === stableStringify(entries));
ok("each chunk verifies against its own hash", chunks.every((c) => verifyChunk(c.text, c)));
ok("a tampered chunk does not verify", !verifyChunk(chunks[0].text.replace("712020:u", "712020:v"), chunks[0]));
eq("same data → same chunks (deterministic)", build(entries).map((c) => c.sha256), chunks.map((c) => c.sha256));
// Locality: one changed value touches only the chunk holding it (content-defined boundaries).
const changed = entries.map((e, i) => (i === 1500 ? [e[0], { ...e[1], lockedBy: "712020:other" }, e[2]] : e));
const c2 = build(changed);
const diff = c2.filter((c, i) => c.sha256 !== chunks[i]?.sha256).length;
eq("one changed value re-uploads exactly one chunk", diff, 1);
// Insertion near the front must not shift every later chunk (the activity log's newest-first keys).
const inserted = [...entries.slice(0, 10), ["protection-att000009a", { lockedBy: "n" }, null], ...entries.slice(10)];
const c3 = build(inserted);
const reused = c3.filter((c) => chunks.some((o) => o.sha256 === c.sha256)).length;
ok(`an insertion near the front reuses most chunks (${reused}/${c3.length})`, reused >= c3.length - 2);
ok("boundary keys exist at roughly 1 in 32", entries.filter(([k]) => isBoundaryKey(k)).length > 40);

// ── manifest integrity ──
const m = sealManifest({ format: FORMAT, formatVersion: FORMAT_VERSION, generationId: "20261002T080000Z-ab12", createdAt: "2026-10-02T08:00:00.000Z", keys: 3000, bytes: 1, chunks: chunks.map(({ text, ...c }) => c), counts: {} });
eq("a sealed manifest verifies", verifyManifest(m).ok, true);
eq("a changed manifest fails its own hash", verifyManifest({ ...m, keys: 2999 }).ok, false);
eq("a foreign file is refused", verifyManifest({ ...m, format: "other" }).reason, "This is not a Sentinel Vault backup.");
ok("a newer format is refused with an 'update the app' reason", /newer Sentinel Vault/.test(verifyManifest(sealManifest({ ...m, formatVersion: FORMAT_VERSION + 1, manifestSha256: undefined })).reason));
eq("manifest hash ignores the hash field itself", manifestHash({ ...m, manifestSha256: "zz" }), m.manifestSha256);
ok("manifest names round-trip", isManifestName(manifestName("20261002T080000Z-ab12")));
ok("generation ids sort by time", newGenerationId(Date.UTC(2026, 9, 2)) < newGenerationId(Date.UTC(2026, 9, 3)));
eq("fingerprint follows chunk hashes", contentFingerprint(chunks) === contentFingerprint(build(entries)), true);

// ── export file verification (the import gate) ──
const doc = { format: "sentinel-vault-export", formatVersion: 1, manifest: m, chunks: chunks.map((c) => ({ name: c.name, sha256: c.sha256, text: c.text })) };
eq("a whole export verifies", verifyExport(doc).ok, true);
eq("a missing part is refused", verifyExport({ ...doc, chunks: doc.chunks.slice(1) }).ok, false);
eq("a corrupted part is refused", verifyExport({ ...doc, chunks: [{ ...doc.chunks[0], text: doc.chunks[0].text + " " }, ...doc.chunks.slice(1)] }).ok, false);
eq("a non-export file is refused", verifyExport({ hello: 1 }).reason, "This file is not a Sentinel Vault export.");

// ── restore decisions ──
const now = Date.parse("2026-10-02T08:00:00Z");
eq("a config key is written", restoreDecision(["protection-att1", { a: 1 }, null], now).action, "write");
eq("a runtime key is never written", restoreDecision(["page-guard-1", 1, null], now).reason, "not a backed-up family");
eq("a secret is never written", restoreDecision(["api-tokens", [], null], now).reason, "not a backed-up family");
eq("an entry past its TTL is skipped", restoreDecision(["edit-grant-att1-u", {}, "2026-10-01T00:00:00Z"], now).reason, "expired");
eq("an entry with TTL left keeps its expiry", restoreDecision(["edit-grant-att1-u", {}, "2026-10-09T00:00:00Z"], now).expireAt, Date.parse("2026-10-09T00:00:00Z"));

// ── automations come back paused ──
const g = pauseAutomations("admin-settings-global", { autoUnlockEnabled: true, adminUsers: ["a"] }, { pausedAt: 111 });
eq("seal expiry is paused and stamped with the backup time", [g.value.autoUnlockEnabled, g.value.autoUnlockPausedAt, g.value.adminUsers], [false, 111, ["a"]]);
eq("the original value is kept for 'Turn back on'", g.paused[0].original, { autoUnlockEnabled: true });
eq("absent autoUnlockEnabled means ON (engine default) → paused", pauseAutomations("admin-settings-global", {}).paused.length, 1);
eq("already-off seal expiry is left alone", pauseAutomations("admin-settings-global", { autoUnlockEnabled: false }).paused.length, 0);
const v = pauseAutomations("validation-config-space-WFH", { enabled: true, modes: { advisory: true, gate: true, revert: true }, ai: { enabled: true, model: "m" } });
eq("revert mode and AI review are paused; advisory and gate stay", [v.value.modes, v.value.ai.enabled, v.value.ai.model, v.value.enabled], [{ advisory: true, gate: true, revert: false }, false, "m", true]);
eq("validation pauses name the space", v.paused.map((p) => p.where), ["Space WFH", "Space WFH"]);
const w = pauseAutomations("workflow-settings-WFH", { enabled: true, autoAssignNew: true, reviewAfterDaysByState: { approved: 30 } });
eq("workflow auto-assign and review timers paused; the workflow itself stays on", [w.value.enabled, w.value.autoAssignNew, w.value.reviewAfterDaysByState], [true, false, {}]);
eq("seals are never paused", pauseAutomations("protection-att1", { lockedBy: "u", expiresAt: "x" }).paused.length, 0);

// ── secrets: names only ──
const inv = secretsInventory({ apiTokens: [{ id: "1", name: "CI", role: "admin", hash: "SECRET", createdAt: "t" }, { id: "2", name: "old", revokedAt: "t" }], authenticatorAccounts: ["a", "a", "b"] });
eq("live tokens are listed by name and role only", inv.apiTokens, [{ name: "CI", role: "admin", createdAt: "t", createdBy: null }]);
ok("no hash leaves", !JSON.stringify(inv).includes("SECRET"));
eq("authenticator enrolments are counted per person", inv.authenticatorAccounts, ["a", "b"]);

// ── preview grouping ──
const counts = {};
for (const k of ["protection-1", "protection-2", "section-protection-1", "workflow-def-global", "admin-settings-global", "zz-unknown"]) tallyFamily(counts, k);
const groups = previewGroups({ counts });
eq("groups in the admin's order", groups.map((x) => x.group), ["settings", "seals", "workflow", "other"]);
eq("seal group totals", groups.find((x) => x.group === "seals").keys, 3);

// ── generations kept: newest N + the last one of every earlier installation ──
const gens = [];
for (let i = 0; i < 12; i++) gens.push({ generationId: `g${i}`, createdAt: `2026-10-${String(10 + i).padStart(2, "0")}`, installationId: "new" });
gens.push({ generationId: "old-last", createdAt: "2026-09-30", installationId: "old" }, { generationId: "old-first", createdAt: "2026-09-01", installationId: "old" });
const kept = retainGenerations(gens, 10);
eq("ten newest kept", kept.slice(0, 10).map((x) => x.generationId), ["g11", "g10", "g9", "g8", "g7", "g6", "g5", "g4", "g3", "g2"]);
eq("the previous installation's LAST backup is pinned", kept.slice(10).map((x) => [x.generationId, x.pinned]), [["old-last", true]]);

// ── installations and the page title ──
const inst = mergeInstallations([{ installationId: "old", firstSeen: "a", lastSeen: "b" }], { installationId: "new", environmentType: "DEVELOPMENT" }, "c");
eq("a new installation is recorded first, the old one kept", inst.map((r) => r.installationId), ["new", "old"]);
eq("production page title", backupPageTitle("PRODUCTION"), "Sentinel Vault backup");
eq("development page title", backupPageTitle("DEVELOPMENT"), "Sentinel Vault backup (development)");
eq("an install picks its own environment's page", choosePage([{ title: "Sentinel Vault backup" }, { title: "Sentinel Vault backup (development)", pageId: "2" }], "DEVELOPMENT")?.pageId, "2");
report("backup-snapshot");
