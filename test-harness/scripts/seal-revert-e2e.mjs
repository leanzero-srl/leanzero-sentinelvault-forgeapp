// audit A5 (the meta-fix): a REAL attachment seal → tamper → assert-revert test. The old
// seal-lifecycle-e2e only smoke-checks a pre-existing seal (property present, no log errors)
// and never asserts a revert actually happens — so the flagship feature was uncovered and a
// green grade certified nothing. This creates a seal, tampers the attachment as a real user,
// and asserts the app reverts it to the sealed bytes (and doesn't loop).
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { cfg } from "../lib/env.mjs";
import { get, post, del, currentUser } from "../lib/confluence.mjs";

const C = cfg();
const HR = "/Users/mihaiperdum/Projects/Sentinel Vault/test-harness";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let total = 0, passed = 0;
const check = (l, c) => { total++; if (c) { passed++; console.log(`ok   ${l}`); } else { console.log(`FAIL ${l}`); } };
function parseEnv(t){const o={};for(const l of t.split(/\r?\n/)){const s=l.trim();if(!s||s.startsWith("#"))continue;const i=s.indexOf("=");if(i>0)o[s.slice(0,i).trim()]=s.slice(i+1).trim();}return o;}
const env = { ...process.env };
for (const p of [join(HR, ".env"), join(homedir(), "Projects/forge-live-harness/.env")]) if (existsSync(p)) for (const [k,v] of Object.entries(parseEnv(readFileSync(p,"utf8")))) if(!env[k]) env[k]=v;
const HOOK = { url: env.SENTINEL_TESTHOOK_URL, secret: env.HARNESS_SECRET };
const hook = async (params) => { const r = await fetch(`${HOOK.url}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${HOOK.secret}` } }); const t = await r.text(); if (!r.ok) throw new Error(`hook ${params.what} ${r.status}`); return JSON.parse(t); };

// Raw multipart helpers (attachments can't go through the JSON helpers).
async function uploadAttachment(pageId, filename, content, isUpdate, attId) {
  const fd = new FormData();
  fd.append("file", new Blob([content], { type: "text/plain" }), filename);
  fd.append("minorEdit", "true");
  const url = isUpdate
    ? `${C.base}/rest/api/content/${pageId}/child/attachment/${attId}/data`
    : `${C.base}/rest/api/content/${pageId}/child/attachment`;
  const res = await fetch(url, { method: "POST", headers: { Authorization: C.auth, "X-Atlassian-Token": "nocheck" }, body: fd });
  if (!res.ok) throw new Error(`attachment ${isUpdate ? "update" : "create"} → ${res.status}: ${(await res.text()).slice(0,200)}`);
  return res.json();
}
async function downloadText(pageId, attId) {
  const res = await fetch(`${C.base}/rest/api/content/${pageId}/child/attachment/${attId}/download`, { headers: { Authorization: C.auth }, redirect: "follow" });
  if (!res.ok) return null;
  return res.text();
}
const attVersion = async (attId) => (await get(`/api/v2/attachments/${attId}`))?.version?.number;

const spaceKey = env.SV_SPACE_KEY || "WFH";
const space = (await get(`/api/v2/spaces?keys=${spaceKey}`))?.results?.[0];
const me = await currentUser();
const stamp = Date.now();
const ORIGINAL = `SEALED-ORIGINAL-${stamp}`;
const TAMPERED = `TAMPERED-CONTENT-${stamp}`;
let page = null, attId = null;

try {
  page = await post(`/api/v2/pages`, { spaceId: space.id, status: "current", title: `HARNESS seal-revert ${stamp}`, body: { representation: "storage", value: "<p>seal revert probe</p>" } });
  const up = await uploadAttachment(page.id, `sealed-${stamp}.txt`, ORIGINAL, false);
  attId = up?.results?.[0]?.id;
  check("attachment created", !!attId);
  const attDetail = await get(`/api/v2/attachments/${attId}`);
  const sealedVersion = attDetail.version?.number;

  // Seed the seal owned by a SYNTHETIC account (not the harness user) — the harness has only
  // one real account, so to exercise the NON-OWNER revert path the tamper (by the harness
  // user) must be an edit of someone ELSE's seal. Owner-edits-own-seal is allowed by design.
  const seal = {
    lockedBy: `synthetic-owner-${stamp}`, lockedByName: "Synthetic Owner", timestamp: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 365 * 86400000).toISOString(), lockDuration: 365 * 86400,
    spaceKey, spaceId: space.id, contentId: String(page.id), attachmentId: attId,
    attachmentName: attDetail.title, sealedVersion, sealedFileId: attDetail.fileId ?? null,
  };
  await hook({ what: "set", key: `protection-${attId}`, value: JSON.stringify(seal) });
  await hook({ what: "set", key: `space-protection-${space.id}-${attId}`, value: JSON.stringify({ attachmentId: attId, contentId: String(page.id), lockedBy: me.accountId, expiresAt: seal.expiresAt }) });
  check("seal record seeded", true);
  await sleep(2000);

  // TAMPER: upload a new version as the real user → fires avi:confluence:updated:attachment.
  await uploadAttachment(page.id, `sealed-${stamp}.txt`, TAMPERED, true, attId);
  const tamperedVersion = await attVersion(attId);
  check("tamper uploaded a new attachment version", tamperedVersion > sealedVersion);

  // Poll for the app to revert the tamper back to the sealed bytes (the artifact trigger is
  // async and can lag under full-suite load — poll generously, up to ~2 min).
  let body = "";
  for (let i = 0; i < 30; i++) {
    await sleep(4000);
    body = (await downloadText(page.id, attId)) || "";
    if (body.includes(ORIGINAL)) break;
  }
  check("SEAL ENFORCED — tampered attachment reverted to the sealed content", body.includes(ORIGINAL) && !body.includes(TAMPERED));
  check("revert published a new version (the app's restore)", (await attVersion(attId)) > tamperedVersion);

  // Loop-safety: after the revert settles, the version must be STABLE (no runaway churn).
  const vStable = await attVersion(attId);
  await sleep(6000);
  check("no revert loop — attachment version is stable after enforcement", (await attVersion(attId)) === vStable);
} finally {
  if (page) await del(`/api/v2/pages/${page.id}`).catch(() => {});
  if (attId) {
    await hook({ what: "delete", key: `protection-${attId}` }).catch(() => {});
    await hook({ what: "delete", key: `space-protection-${space.id}-${attId}` }).catch(() => {});
  }
  console.log("     cleaned up page + seal keys");
}

console.log(`\nseal-revert-e2e: ${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
