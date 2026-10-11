/*
 * Jira attachment seals — the Forge I/O (docs/JIRA-SEALS.md). Every call shape here was measured
 * on wolfaenpak on 2026-10-11 before it was written down:
 *   - download: GET /rest/api/3/attachment/content/{id}?redirect=false → 200 with the bytes
 *   - copy: Object Store createUploadUrl + a plain fetch PUT → 201, read back byte-identical
 *   - restore: a hand-built multipart body on POST /issue/{id}/attachments → 200, author = the app
 *   - permissions of ANOTHER user cannot be asked as the app (permissions/check → 403), so the
 *     resolvers ask Jira as the caller (mypermissions).
 */
import api, { route } from "@forge/api";
import { kvs, WhereConditions } from "@forge/kvs";
import { objectStore } from "@forge/object-store";
import { createHash } from "node:crypto";

import {
  JIRA_SEAL_PREFIX, jiraSealKey, jiraIssueIndexKey, jiraIssueIndexPrefix, jiraLapseKey, jiraNoticeKey, normId, sealIdOf,
} from "./logic.js";

const asJsonHeaders = { Accept: "application/json", "Content-Type": "application/json" };

export const getSeal = (attachmentId) => kvs.get(jiraSealKey(attachmentId));

/** Write the seal and its per-issue index row. */
export async function putSeal(record) {
  await kvs.set(jiraSealKey(record.attachmentId), record);
  await kvs.set(jiraIssueIndexKey(record.issueId, record.attachmentId), {
    attachmentId: record.attachmentId, lockedBy: record.lockedBy, expiresAt: record.expiresAt,
  });
}

/** Remove the seal, its index row and its bookkeeping; the copy only when asked (a move keeps it). */
export async function dropSeal(record, { keepCopy = false } = {}) {
  const id = record.attachmentId;
  await kvs.delete(jiraSealKey(id));
  const still = await kvs.get(jiraSealKey(id));
  if (still) return { ok: false, reason: "Seal removal could not be confirmed" };
  await kvs.delete(jiraIssueIndexKey(record.issueId, id)).catch((e) => console.warn("[JIRA-SEAL] index row delete failed:", e?.message || e));
  // A MOVE (a restore re-keying the seal onto the re-uploaded file) keeps the seal's bookkeeping and
  // copy: both are keyed by the seal's first attachment id, so they follow the seal, and dropping the
  // notice marker here would reopen the comment window a delete loop must not reopen.
  if (!keepCopy) {
    const sid = sealIdOf(record);
    await kvs.delete(jiraLapseKey(sid)).catch(() => {});
    await kvs.delete(jiraNoticeKey(sid)).catch(() => {});
    if (record.copyKey) await deleteCopy(record.copyKey);
  }
  return { ok: true };
}

export async function deleteCopy(copyKey) {
  try { await objectStore.delete(copyKey); }
  catch (e) { console.warn(`[JIRA-SEAL] copy ${copyKey} delete failed:`, e?.message || e); }
}

/** Every seal row of one issue (the index), confirmed against the seal by key. */
export async function sealsOfIssue(issueId) {
  const out = [];
  let query = kvs.query().where("key", WhereConditions.beginsWith(jiraIssueIndexPrefix(issueId))).limit(100);
  for (let i = 0; i < 20; i++) {
    const { results, nextCursor } = await query.getMany();
    for (const { key, value } of results || []) {
      const rec = value?.attachmentId ? await getSeal(value.attachmentId) : null;
      if (rec && rec.issueId === String(issueId)) out.push(rec);
      else await kvs.delete(key).catch(() => {}); // a stale row: the read that finds it removes it
    }
    if (!nextCursor) break;
    query = kvs.query().where("key", WhereConditions.beginsWith(jiraIssueIndexPrefix(issueId))).limit(100).cursor(nextCursor);
  }
  return out;
}

/** Every Jira seal on the site, paged (the hourly sweep). */
export async function* allSeals(maxPages = 50) {
  let query = kvs.query().where("key", WhereConditions.beginsWith(JIRA_SEAL_PREFIX)).limit(100);
  for (let i = 0; i < maxPages; i++) {
    const { results, nextCursor } = await query.getMany();
    for (const r of results || []) yield r;
    if (!nextCursor) return;
    query = kvs.query().where("key", WhereConditions.beginsWith(JIRA_SEAL_PREFIX)).limit(100).cursor(nextCursor);
  }
}

// ── Jira REST ─────────────────────────────────────────────────────────────────────────────────

/** The issue with its attachments, as the app. null when it does not exist. */
export async function readIssue(issueRef) {
  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${issueRef}?fields=attachment,project,summary`, { headers: { Accept: "application/json" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Jira answered ${res.status} for the issue`);
  const j = await res.json();
  return {
    id: String(j.id),
    key: j.key,
    summary: j.fields?.summary || "",
    project: j.fields?.project ? { id: String(j.fields.project.id), key: j.fields.project.key, name: j.fields.project.name } : null,
    attachments: (j.fields?.attachment || []).map((a) => ({
      id: String(a.id), filename: a.filename, size: Number(a.size) || 0, mimeType: a.mimeType,
      created: a.created, author: a.author ? { accountId: a.author.accountId, name: a.author.displayName } : null,
    })),
  };
}

/**
 * The CALLER's permissions on one issue, asked of Jira as the caller (a resolver only — a trigger or
 * queue consumer has no user). Fails closed: any non-200 reads as "no permission".
 */
export async function callerPermissions(issueId) {
  const keys = "BROWSE_PROJECTS,EDIT_ISSUES,ADMINISTER_PROJECTS,ADMINISTER";
  try {
    const res = await api.asUser().requestJira(route`/rest/api/3/mypermissions?issueId=${issueId}&permissions=${keys}`, { headers: { Accept: "application/json" } });
    if (!res.ok) { console.warn(`[JIRA-SEAL] mypermissions answered ${res.status}`); return {}; }
    return (await res.json())?.permissions || {};
  } catch (e) {
    console.warn("[JIRA-SEAL] mypermissions failed:", e?.message || e);
    return {};
  }
}

export async function userName(accountId) {
  if (!accountId) return null;
  try {
    const res = await api.asApp().requestJira(route`/rest/api/3/user?accountId=${accountId}`, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const j = await res.json();
    return j?.displayName || null;
  } catch (_) { return null; }
}

export async function downloadAttachment(attachmentId) {
  const res = await api.asApp().requestJira(route`/rest/api/3/attachment/content/${attachmentId}?redirect=false`);
  if (!res.ok) throw new Error(`Jira answered ${res.status} for the file`);
  return Buffer.from(await res.arrayBuffer());
}

/** PURE-ish. A multipart/form-data body with one `file` part — no FormData support assumed. */
export function multipartFile(bytes, filename, mimeType = "application/octet-stream") {
  const boundary = `----sentinelvault${createHash("sha1").update(String(Date.now()) + Math.random()).digest("hex").slice(0, 16)}`;
  const safeName = String(filename).replace(/["\r\n\\]/g, "_");
  const safeType = /^[\w.+-]+\/[\w.+-]+$/.test(mimeType || "") ? mimeType : "application/octet-stream";
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\nContent-Type: ${safeType}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, bytes, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}

/** Upload bytes to an issue as the app. Returns the created attachment. */
export async function uploadToIssue(issueId, bytes, filename, mimeType) {
  const { body, contentType } = multipartFile(bytes, filename, mimeType);
  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${issueId}/attachments`, {
    method: "POST",
    headers: { "X-Atlassian-Token": "no-check", "Content-Type": contentType, Accept: "application/json" },
    body,
  });
  const t = await res.text();
  if (!res.ok) throw new Error(`Jira refused the upload (${res.status}): ${t.slice(0, 200)}`);
  const created = JSON.parse(t)?.[0];
  if (!created?.id) throw new Error("Jira did not return the uploaded file");
  return { id: String(created.id), filename: created.filename, size: Number(created.size) || 0 };
}

/** Post an ADF comment on an issue as the app. Never throws. */
export async function postIssueComment(issueId, adf) {
  try {
    const res = await api.asApp().requestJira(route`/rest/api/3/issue/${issueId}/comment`, {
      method: "POST", headers: asJsonHeaders, body: JSON.stringify({ body: adf }),
    });
    if (!res.ok) {
      const t = await res.text();
      console.warn(`[JIRA-SEAL] comment on ${issueId} refused ${res.status}: ${t.slice(0, 200)}`);
      return { ok: false, status: res.status };
    }
    return { ok: true };
  } catch (e) {
    console.warn("[JIRA-SEAL] comment failed:", e?.message || e);
    return { ok: false };
  }
}

// ── Object Store copy ─────────────────────────────────────────────────────────────────────────

export const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Store the copy; verify the store holds exactly these bytes before the seal may rely on it. */
export async function storeCopy(copyKey, bytes) {
  const checksum = createHash("sha256").update(bytes).digest("base64");
  const up = await objectStore.createUploadUrl({ key: copyKey, length: bytes.length, checksum, checksumType: "SHA256", overwrite: true });
  if (!up?.url) throw new Error("The copy store gave no upload address");
  const put = await fetch(up.url, { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: bytes });
  if (put.status >= 300) throw new Error(`The copy store refused the file (${put.status})`);
  const meta = await objectStore.get(copyKey);
  if (!meta || Number(meta.size) !== bytes.length || meta.checksum !== checksum) throw new Error("The copy could not be confirmed");
  return { size: bytes.length };
}

/** Read the copy back and check it against the hash taken at seal time. */
export async function readCopy(copyKey, expectedSha256) {
  const d = await objectStore.createDownloadUrl(copyKey);
  if (!d?.url) throw new Error("The copy is missing");
  const res = await fetch(d.url);
  if (!res.ok) throw new Error(`The copy store answered ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (expectedSha256 && sha256Hex(bytes) !== expectedSha256) throw new Error("The copy does not match the sealed file");
  return bytes;
}

/** The app's own account id (cached by the Confluence side under the same key). */
export async function appAccountId() {
  try {
    const cached = await kvs.get("app-account-id");
    if (typeof cached === "string" && cached) return cached;
    const res = await api.asApp().requestJira(route`/rest/api/3/myself`, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const id = (await res.json())?.accountId || null;
    if (id) await kvs.set("app-account-id", id).catch(() => {});
    return id;
  } catch (_) { return null; }
}

export { normId };
