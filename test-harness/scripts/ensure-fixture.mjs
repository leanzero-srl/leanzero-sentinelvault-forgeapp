// Ensures the seal-e2e prerequisite exists: a fixture page with a sealed
// attachment. Black-box except for the dev-gated test hook (harness-test-state
// webtrigger, HARNESS_SECRET-gated), which it uses to seed the same KVS records
// `sealing/actions.js:sealArtifact` writes — REST cannot invoke UI-only resolvers.
// Idempotent: safe to re-run; refreshes an expired/missing seal in place.
//
// Extra env (test-harness/.env or fallback ~/Projects/forge-live-harness/.env):
//   SENTINEL_TESTHOOK_URL  the harness-test-state webtrigger URL (dev env)
//   HARNESS_SECRET         its bearer secret
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { cfg } from "../lib/env.mjs";
import { get, post, put, currentUser, listAttachments } from "../lib/confluence.mjs";

const C = cfg();
const HARNESS_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FIXTURE_TITLE = "SV AQL Seal Fixture (do not delete)";
const FIXTURE_FILE = "sv-aql-sealed-fixture.txt";
const YEAR_S = 365 * 24 * 3600;

const fail = (msg) => { console.log(`FAIL ${msg}`); process.exit(1); };
const ok = (msg) => console.log(`ok   ${msg}`);

// --- hook config (test-harness/.env first, then forge-live-harness/.env) ---
function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}
function hookConfig() {
  const sources = [
    join(HARNESS_ROOT, ".env"),
    join(homedir(), "Projects/forge-live-harness/.env"),
  ];
  const env = { ...process.env };
  for (const p of sources) if (existsSync(p)) {
    const parsed = parseEnv(readFileSync(p, "utf8"));
    for (const [k, v] of Object.entries(parsed)) if (!env[k]) env[k] = v;
  }
  if (!env.SENTINEL_TESTHOOK_URL || !env.HARNESS_SECRET) {
    fail("SENTINEL_TESTHOOK_URL / HARNESS_SECRET not found (test-harness/.env or ~/Projects/forge-live-harness/.env)");
  }
  return { url: env.SENTINEL_TESTHOOK_URL, secret: env.HARNESS_SECRET };
}
const HOOK = hookConfig();

async function hook(params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${HOOK.url}?${qs}`, {
    headers: { Authorization: `Bearer ${HOOK.secret}` },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`test hook ${params.what} → ${res.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return { _raw: text }; }
}

// --- 1. space ---
const spaceKey = C.spaceKey || process.env.SV_SPACE_KEY || "WFH";
const spaces = await get(`/api/v2/spaces?keys=${encodeURIComponent(spaceKey)}`);
const space = spaces?.results?.[0];
if (!space) fail(`space ${spaceKey} not found`);
ok(`space ${spaceKey} (${space.id})`);

// --- 2. fixture page (find by title, else create) ---
const found = await get(`/api/v2/pages?title=${encodeURIComponent(FIXTURE_TITLE)}&space-id=${space.id}&status=current`);
let page = found?.results?.[0];
if (!page) {
  page = await post(`/api/v2/pages`, {
    spaceId: space.id,
    status: "current",
    title: FIXTURE_TITLE,
    body: {
      representation: "storage",
      value: "<p>Fixture page for the Sentinel Vault AQL test harness. The attachment below carries a seeded seal record; seal-e2e asserts against it. Do not delete or unseal manually.</p>",
    },
  });
  ok(`created fixture page ${page.id}`);
} else {
  ok(`fixture page exists ${page.id}`);
}

// --- 3. fixture attachment (find by title, else upload) ---
let atts = await listAttachments(page.id);
let att = (atts?.results || []).find((a) => a.title === FIXTURE_FILE);
if (!att) {
  const fd = new FormData();
  fd.append("file", new Blob([`Sentinel Vault AQL seal fixture — baseline content. Created ${new Date().toISOString()}`], { type: "text/plain" }), FIXTURE_FILE);
  fd.append("minorEdit", "true");
  const res = await fetch(`${C.base}/rest/api/content/${page.id}/child/attachment`, {
    method: "POST",
    headers: { Authorization: C.auth, "X-Atlassian-Token": "nocheck" },
    body: fd,
  });
  if (!res.ok) fail(`attachment upload → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  atts = await listAttachments(page.id);
  att = (atts?.results || []).find((a) => a.title === FIXTURE_FILE);
  if (!att) fail("uploaded attachment not visible in v2 listing");
  ok(`uploaded attachment ${att.id}`);
} else {
  ok(`attachment exists ${att.id}`);
}

// --- 4. build the seal payload exactly as sealing/actions.js:sealArtifact does ---
const me = await currentUser();
const attDetail = await get(`/api/v2/attachments/${att.id}`);
const nowIso = new Date().toISOString();
const sealPayload = {
  lockedBy: me.accountId,
  lockedByEmail: me.email || null,
  lockedByName: me.displayName || "Current User",
  timestamp: nowIso,
  expiresAt: new Date(Date.now() + YEAR_S * 1000).toISOString(),
  lockDuration: YEAR_S,
  spaceKey,
  spaceId: space.id,
  contentId: String(page.id),
  attachmentId: att.id,
  attachmentName: attDetail.title || FIXTURE_FILE,
  sealedVersion: attDetail.version?.number ?? null,
  sealedFileId: attDetail.fileId ?? null,
  downloadLink: attDetail.downloadLink || attDetail._links?.download || null,
};

// --- 5. seed KVS via the dev-gated hook (primary record + realm index + stamp) ---
const existing = await hook({ what: "kvs", key: `protection-${att.id}` });
const lapsed = existing?.value?.expiresAt && new Date(existing.value.expiresAt) < new Date();
if (existing?.value && !lapsed) {
  ok(`seal record already present (expires ${existing.value.expiresAt})`);
} else {
  await hook({ what: "set", key: `protection-${att.id}`, value: JSON.stringify(sealPayload) });
  await hook({
    what: "set",
    key: `space-protection-${space.id}-${att.id}`,
    value: JSON.stringify({
      attachmentId: att.id,
      attachmentName: sealPayload.attachmentName,
      lockedBy: sealPayload.lockedBy,
      lockedByName: sealPayload.lockedByName,
      timestamp: sealPayload.timestamp,
      expiresAt: sealPayload.expiresAt,
      contentId: sealPayload.contentId,
      spaceKey,
      pageTitle: FIXTURE_TITLE,
      fileSize: attDetail.fileSize || null,
      downloadLink: sealPayload.downloadLink,
      creatorName: null,
      creatorAccountId: attDetail.version?.authorId || null,
    }),
  });
  await hook({ what: "set", key: "protections-last-modified", value: String(Date.now()) });
  ok(`seeded protection-${att.id} + realm index`);
}

// --- 6. content-property mirror (same shape writeSealContentProp writes) ---
const props = await get(`/api/v2/pages/${page.id}/properties?key=protection-`);
const prop = props?.results?.[0];
if (prop) {
  await put(`/api/v2/pages/${page.id}/properties/${prop.id}`, {
    key: "protection-",
    value: sealPayload,
    version: { number: (prop.version?.number || 1) + 1 },
  });
  ok("content property protection- updated");
} else {
  await post(`/api/v2/pages/${page.id}/properties`, { key: "protection-", value: sealPayload });
  ok("content property protection- created");
}

// --- 7. read-back verification via the hook ---
const readBack = await hook({ what: "kvs", key: `protection-${att.id}` });
if (!readBack?.value?.lockedBy) fail("read-back of seeded seal record failed");
ok("read-back verified");

// --- 8. persist SV_PAGE_ID / SV_SPACE_KEY into test-harness/.env ---
const envPath = join(HARNESS_ROOT, ".env");
let envText = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const setLine = (text, key, value) => {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(text)) return text.replace(re, line);
  return text.replace(/\n*$/, "\n") + line + "\n";
};
envText = setLine(envText, "SV_PAGE_ID", page.id);
envText = setLine(envText, "SV_SPACE_KEY", spaceKey);
writeFileSync(envPath, envText);
ok(`.env updated: SV_PAGE_ID=${page.id} SV_SPACE_KEY=${spaceKey}`);

console.log(`\nensure-fixture: done (page ${page.id}, attachment ${att.id})`);
