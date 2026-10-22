/*
 * Backup — the store: ONE Confluence page per site and environment, restricted to the app.
 *
 * Why this store (measured 2026-10-02 with a throwaway app holding Sentinel Vault's exact scopes,
 * ~/Projects/forge-uninstall-probe-confluence/RESULTS.md): after an uninstall + reinstall, KVS and
 * KVS secrets came back EMPTY, while a page the app created, its attachments, its content
 * properties, its label and its page restrictions were all still there — and the app's account id
 * was the SAME, so a page restricted to the app alone was still readable by the new install, and
 * a CQL label search found it. A site admin (not in the restriction) got 404 on it. That is the
 * store: Atlassian-hosted, no egress (Runs on Atlassian), invisible to people, found again by
 * label after a reinstall.
 *
 *   page       title "Sentinel Vault backup" (+ " (development)" etc. off production), label
 *              `sentinel-vault-backup`, read AND update restricted to the app's own account
 *   attachments manifests and content-addressed chunks (snapshot.js)
 *   property   `sentinel-vault-backup-index` — the generations (newest first, ≤ KEEP) and every
 *              installation id that has written here (the re-link ticket needs the previous one)
 */
import api, { route } from "@forge/api";
import { appConfluence } from "../../shared/confluence-call.js";
import { resolveAppAccountId } from "../../shared/app-account.js";

export const BACKUP_LABEL = "sentinel-vault-backup";
export const INDEX_PROPERTY = "sentinel-vault-backup-index";
export const KEEP_GENERATIONS = 10;
const JSONH = { Accept: "application/json", "Content-Type": "application/json" };

const conf = (r, init) => appConfluence(r, init);

/** An Error carrying the HTTP status (errText prints it; callers branch on it). */
export function statusError(message, status, extra = {}) {
  return Object.assign(new Error(message), { status }, extra);
}

export async function readJson(res) {
  const t = await res.text();
  try { return t ? JSON.parse(t) : null; } catch { return null; }
}

/** PURE. The backup page's title for an environment. */
export const backupPageTitle = (environmentType) => {
  const env = String(environmentType || "PRODUCTION").toUpperCase();
  return env === "PRODUCTION" ? "Sentinel Vault backup" : `Sentinel Vault backup (${env.toLowerCase()})`;
};

// The app's own account ON THIS SITE: the shared resolver keeps it in this site's KVS (per
// installation). Never in module scope: one Forge process serves several sites.
export async function appAccountId() {
  const id = await resolveAppAccountId();
  if (!id) throw new Error("Could not read the app's own account");
  return id;
}

/** Pages carrying the backup label that the app can open (CQL, as the app). */
export async function findBackupPages() {
  const cql = `label = "${BACKUP_LABEL}" and type = page`;
  const res = await conf(route`/wiki/rest/api/content/search?cql=${cql}&limit=50&expand=space,version`);
  if (!res.ok) throw new Error(`Backup search failed (${res.status})`);
  const body = await readJson(res);
  return (body?.results || []).map((p) => ({
    pageId: String(p.id), title: p.title, spaceKey: p.space?.key || null, spaceName: p.space?.name || null,
    spaceId: p.space?.id != null ? String(p.space.id) : null,
  }));
}

/** One page by id as the app; null when it is gone or the app cannot see it. */
export async function readPage(pageId) {
  const res = await conf(route`/wiki/api/v2/pages/${pageId}`);
  if (!res.ok) return null;
  const p = await readJson(res);
  return p?.status === "current" ? { pageId: String(p.id), title: p.title, spaceId: String(p.spaceId), authorId: p.authorId || null } : null;
}

/**
 * Is this page one of OUR backup pages? Created by the app's own account (review 2026-10-02: a
 * person cannot plant a look-alike page for a reinstalled app to adopt), titled as one, and
 * restricted to the app alone. Every door that reads or writes a backup page goes through this.
 */
export async function isBackupPage(pageId) {
  const p = await readPage(pageId);
  if (!p || !/^Sentinel Vault backup/.test(p.title)) return false;
  if (p.authorId !== (await appAccountId())) return false;
  return isRestrictedToApp(p.pageId);
}

/** Throwing form for the doors. Returns the page id. */
export async function assertBackupPage(pageId) {
  const id = String(pageId ?? "").replace(/[^0-9]/g, "");
  if (!id || !(await isBackupPage(id))) throw new Error("That page is not a Sentinel Vault backup page.");
  return id;
}

export async function spaceById(spaceId) {
  const res = await conf(route`/wiki/api/v2/spaces/${spaceId}`);
  if (!res.ok) return null;
  const s = await readJson(res);
  return s ? { spaceId: String(s.id), spaceKey: s.key, spaceName: s.name, type: s.type, status: s.status } : null;
}

/**
 * A space by key as the app; null when it does not exist or the app cannot see it. `strict`: a read
 * Confluence did not answer (429, 5xx) THROWS instead of reading as "no such space" (the backup's
 * paused state must never come from a busy answer).
 */
export async function spaceByKey(spaceKey, { strict = false } = {}) {
  const res = await conf(route`/wiki/api/v2/spaces?keys=${spaceKey}&limit=1`);
  if (!res.ok) {
    if (strict) throw statusError(`Could not read the space (${res.status})`, res.status);
    return null;
  }
  const s = (await readJson(res))?.results?.[0];
  return s ? { spaceId: String(s.id), spaceKey: s.key, spaceName: s.name, type: s.type, status: s.status } : null;
}

/**
 * Global, current spaces the app can see, in Confluence's order — candidates for the backup page's
 * home. Throws when Confluence did not answer: an empty list means "none", a failed one "could not tell".
 */
export async function listGlobalSpaces(limit = 25) {
  const res = await conf(route`/wiki/api/v2/spaces?type=global&status=current&limit=${limit}`);
  if (!res.ok) throw statusError(`Could not list the spaces (${res.status})`, res.status);
  return ((await readJson(res))?.results || []).map((s) => ({ spaceId: String(s.id), spaceKey: s.key, spaceName: s.name }));
}

/** Restrict read AND update of a page to the app's own account. */
export async function restrictToApp(pageId) {
  const me = await appAccountId();
  const users = [{ type: "known", accountId: me }];
  const res = await conf(route`/wiki/rest/api/content/${pageId}/restriction`, {
    method: "PUT", headers: JSONH,
    body: JSON.stringify([
      { operation: "read", restrictions: { user: users, group: [] } },
      { operation: "update", restrictions: { user: users, group: [] } },
    ]),
  });
  if (!res.ok) throw new Error(`Could not restrict the backup page (${res.status})`);
  return true;
}

/** Create the backup page in a space; restricted before anything is attached to it. */
export async function createBackupPage(spaceId, environmentType) {
  const title = backupPageTitle(environmentType);
  const body = [
    "<p>This page holds the backup of Sentinel Vault's setup on this site: settings, seals, workflows, validation rules,",
    " classification and history. It is restricted to the Sentinel Vault app. It is what lets the app bring your setup back",
    " after an uninstall and reinstall.</p>",
    "<p>Manage it in Confluence settings, Sentinel Vault — Site settings, Backup and restore. Deleting this page deletes the backup.</p>",
  ].join("");
  const res = await conf(route`/wiki/api/v2/pages`, {
    method: "POST", headers: JSONH,
    body: JSON.stringify({ spaceId: String(spaceId), status: "current", title, body: { representation: "storage", value: body } }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw statusError(`Could not create the backup page in space ${spaceId} (${res.status}${t ? `: ${t.slice(0, 160)}` : ""})`, res.status, { createRefused: res.status === 403 });
  }
  const page = await readJson(res);
  const pageId = String(page.id);
  try {
    await restrictToApp(pageId);
  } catch (e) {
    // Never leave an unrestricted backup page behind — and say so loudly when that fails. It holds
    // no backup data yet (nothing is attached before the restriction), only the explanatory body.
    const d = await deletePage(pageId).catch((err) => ({ ok: false, state: "unknown", error: err }));
    if (!d.ok) {
      throw new Error(`${e?.message || e}. The unrestricted page ${pageId} ("${title}") could not be removed (${d.state}); it holds no backup data — delete it in Confluence.`);
    }
    throw e;
  }
  await conf(route`/wiki/rest/api/content/${pageId}/label`, {
    method: "POST", headers: JSONH, body: JSON.stringify([{ prefix: "global", name: BACKUP_LABEL }]),
  }).catch(() => {});
  return { pageId, title, spaceId: String(spaceId) };
}

/** The page's restrictions name ONLY the app (a precondition for writing anything to it). */
export async function isRestrictedToApp(pageId) {
  const me = await appAccountId();
  const res = await conf(route`/wiki/rest/api/content/${pageId}/restriction`);
  if (!res.ok) return false;
  const rows = (await readJson(res))?.results || [];
  const readRow = rows.find((r) => r.operation === "read");
  const users = (readRow?.restrictions?.user?.results || []).map((u) => u.accountId);
  const groups = readRow?.restrictions?.group?.results || [];
  return users.length === 1 && users[0] === me && groups.length === 0;
}

/** Every attachment on the page: [{ id, title, fileSize }] (cursor-paged). */
export async function listAttachments(pageId, { trashed = false } = {}) {
  const out = [];
  let res = trashed
    ? await conf(route`/wiki/api/v2/pages/${pageId}/attachments?limit=250&status=trashed`)
    : await conf(route`/wiki/api/v2/pages/${pageId}/attachments?limit=250`);
  for (let i = 0; i < 40; i++) {
    if (!res.ok) throw new Error(`Could not list the backup files (${res.status})`);
    const body = await readJson(res);
    for (const a of body?.results || []) out.push({ id: String(a.id), title: a.title, fileSize: a.fileSize ?? null });
    const next = body?._links?.next;
    if (!next) break;
    const cursor = new URL(next, "https://x.invalid").searchParams.get("cursor");
    if (!cursor) break;
    res = trashed
      ? await conf(route`/wiki/api/v2/pages/${pageId}/attachments?limit=250&status=trashed&cursor=${cursor}`)
      : await conf(route`/wiki/api/v2/pages/${pageId}/attachments?limit=250&cursor=${cursor}`);
  }
  return out;
}

/** Upload (create or replace) one file on the page; returns the attachment id. */
export async function putFile(pageId, filename, text) {
  const fd = new FormData();
  fd.append("file", new Blob([text], { type: "application/json" }), filename);
  fd.append("minorEdit", "true");
  fd.append("comment", "Sentinel Vault backup");
  const res = await conf(route`/wiki/rest/api/content/${pageId}/child/attachment`, {
    method: "PUT", headers: { "X-Atlassian-Token": "no-check", Accept: "application/json" }, body: fd,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Could not store ${filename} (${res.status}${t ? `: ${t.slice(0, 160)}` : ""})`);
  }
  const body = await readJson(res);
  return String(body?.results?.[0]?.id || body?.id || "");
}

/** Download one attachment's content as text. */
export async function getFile(pageId, attachmentId) {
  const res = await conf(route`/wiki/rest/api/content/${pageId}/child/attachment/${attachmentId}/download`);
  if (!res.ok) throw new Error(`Could not read backup file ${attachmentId} (${res.status})`);
  return res.text();
}

/**
 * Delete one attachment for good (trash, then purge). True only when the PURGE succeeded (or the
 * file is already gone): a file left in the trash of an app-restricted page is invisible to every
 * admin, so a trash-only delete must count as a failure (review 2026-10-04, D6).
 */
export async function deleteFile(attachmentId) {
  const res = await conf(route`/wiki/api/v2/attachments/${attachmentId}`, { method: "DELETE" });
  if (!(res.ok || res.status === 404)) return false;
  return purgeFile(attachmentId);
}

/** Purge one attachment that is already in the trash. True on success or when it is gone. */
export async function purgeFile(attachmentId) {
  const p = await conf(route`/wiki/api/v2/attachments/${attachmentId}?purge=true`, { method: "DELETE" }).catch(() => null);
  return !!p && (p.ok || p.status === 404);
}

/**
 * PURE. What a page read says about a delete: "gone" (404), "trashed", "current" or "unknown".
 */
export function pageDeleteState(httpStatus, body) {
  if (httpStatus === 404) return "gone";
  if (httpStatus >= 200 && httpStatus < 300) return body?.status === "trashed" ? "trashed" : body?.status === "current" ? "current" : "unknown";
  return "unknown";
}

/**
 * Move the whole page to the trash (the "delete my backup" action, and the cleanups).
 *
 * Measured live 2026-10-04 (dev hook `endpointProbe`, wolfaenpak), with this app's scopes:
 *   v2 DELETE /wiki/api/v2/pages/{id}            401 "scope does not match" (needs delete:page:confluence,
 *                                                which the manifest does not hold — adding it is a major)
 *   v1 DELETE /wiki/rest/api/content/{id}        410 Gone (retired for Forge)
 *   v1 DELETE /wiki/rest/api/content/{id}/pageTree  202 + a long task; the page reads "trashed" seconds later
 * The pageTree door is in Atlassian's current v1 spec under write:confluence-content, which the app
 * holds. A backup page has no children, so its tree is the page. Purging from the trash needs
 * delete:page:confluence too, so the page stays in the space's trash until Confluence or a space
 * admin empties it.
 *
 * Returns { ok, state, status } — `ok` only when a read AFTER the call shows the page trashed or gone.
 * Callers must check it: before this, the v2 call failed and every caller reported success.
 */
export async function deletePage(pageId, { waitMs = 8000, stepMs = 1000 } = {}) {
  const res = await conf(route`/wiki/rest/api/content/${pageId}/pageTree`, { method: "DELETE" });
  if (res.status === 404) return { ok: true, state: "gone", status: 404 };
  if (!res.ok) {
    console.error(`[BACKUP] delete of page ${pageId} refused: ${res.status}`);
    return { ok: false, state: "current", status: res.status };
  }
  // 202: a long task. Confirm from the page itself rather than trusting the accept.
  let state = "unknown";
  for (let waited = 0; waited <= waitMs; waited += stepMs) {
    if (waited) await new Promise((r) => setTimeout(r, stepMs));
    // A plain v2 GET answers 200 with status "trashed" for a trashed page (measured, same probe).
    const g = await conf(route`/wiki/api/v2/pages/${pageId}`);
    state = pageDeleteState(g.status, g.ok ? await readJson(g) : null);
    if (state === "trashed" || state === "gone") return { ok: true, state, status: res.status };
  }
  console.error(`[BACKUP] page ${pageId} still reads "${state}" ${waitMs} ms after the delete was accepted`);
  return { ok: false, state, status: res.status };
}

/**
 * Remove a backup page for good as far as this app's scopes allow: purge every attachment (the
 * backup data — delete:attachment:confluence, purge measured 204), delete the index property,
 * then move the emptied page to the trash (deletePage). Measured 2026-10-04: a trashed page
 * restricted to the app answers 404 to a site admin and is not in the space-trash listing they
 * get, so nobody could purge what it held; emptied first, the trash keeps only the page's
 * explanatory text. Returns deletePage's { ok, state } plus { purged, failed }; ok is false when
 * any file could not be removed (the page is then NOT trashed, so the backup stays usable).
 */
export async function emptyAndTrashBackupPage(pageId) {
  let purged = 0;
  let failed = 0;
  for (const a of await listAttachments(pageId)) {
    if (await deleteFile(a.id).catch(() => false)) purged += 1; else failed += 1;
  }
  // Files an earlier, interrupted delete moved to the trash but never purged (a retry must finish them).
  for (const a of await listAttachments(pageId, { trashed: true }).catch(() => [])) {
    if (await purgeFile(a.id).catch(() => false)) purged += 1; else failed += 1;
  }
  if (failed) return { ok: false, state: "current", status: null, purged, failed };
  const idx = await readIndex(pageId).catch(() => null);
  if (idx?.id) await conf(route`/wiki/api/v2/pages/${pageId}/properties/${idx.id}`, { method: "DELETE" }).catch(() => {});
  return { ...(await deletePage(pageId)), purged, failed };
}

export async function readIndex(pageId) {
  const res = await conf(route`/wiki/api/v2/pages/${pageId}/properties?key=${INDEX_PROPERTY}`);
  if (!res.ok) return null;
  const row = (await readJson(res))?.results?.[0];
  return row ? { id: String(row.id), version: row.version?.number || 1, value: row.value || null } : null;
}

export async function writeIndex(pageId, value) {
  const existing = await readIndex(pageId);
  const res = existing
    ? await conf(route`/wiki/api/v2/pages/${pageId}/properties/${existing.id}`, { method: "PUT", headers: JSONH, body: JSON.stringify({ key: INDEX_PROPERTY, value, version: { number: existing.version + 1 } }) })
    : await conf(route`/wiki/api/v2/pages/${pageId}/properties`, { method: "POST", headers: JSONH, body: JSON.stringify({ key: INDEX_PROPERTY, value }) });
  if (!res.ok) throw new Error(`Could not update the backup index (${res.status})`);
  return true;
}

/** Page-level read gate for an IMPORT from an attachment the caller named (REST). */
export async function attachmentOnPage(pageId, attachmentId) {
  const res = await conf(route`/wiki/api/v2/attachments/${attachmentId}`);
  if (!res.ok) return null;
  const a = await readJson(res);
  if (String(a?.pageId || "") !== String(pageId)) return null;
  return { id: String(a.id), title: a.title, fileSize: a.fileSize ?? null };
}
