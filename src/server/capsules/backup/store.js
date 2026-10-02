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

export const BACKUP_LABEL = "sentinel-vault-backup";
export const INDEX_PROPERTY = "sentinel-vault-backup-index";
export const KEEP_GENERATIONS = 10;
const JSONH = { Accept: "application/json", "Content-Type": "application/json" };

const conf = (r, init) => api.asApp().requestConfluence(r, init);

export async function readJson(res) {
  const t = await res.text();
  try { return t ? JSON.parse(t) : null; } catch { return null; }
}

/** PURE. The backup page's title for an environment. */
export const backupPageTitle = (environmentType) => {
  const env = String(environmentType || "PRODUCTION").toUpperCase();
  return env === "PRODUCTION" ? "Sentinel Vault backup" : `Sentinel Vault backup (${env.toLowerCase()})`;
};

let appAccountCache = null;
export async function appAccountId() {
  if (appAccountCache) return appAccountCache;
  const res = await conf(route`/wiki/rest/api/user/current`);
  if (!res.ok) throw new Error(`Could not read the app's own account (${res.status})`);
  appAccountCache = (await readJson(res))?.accountId || null;
  if (!appAccountCache) throw new Error("The app's own account id is empty");
  return appAccountCache;
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

export async function spaceByKey(spaceKey) {
  const res = await conf(route`/wiki/api/v2/spaces?keys=${spaceKey}&limit=1`);
  if (!res.ok) return null;
  const s = (await readJson(res))?.results?.[0];
  return s ? { spaceId: String(s.id), spaceKey: s.key, spaceName: s.name, type: s.type, status: s.status } : null;
}

/** Global, current spaces in Confluence's order — candidates for the backup page's home. */
export async function listGlobalSpaces(limit = 25) {
  const res = await conf(route`/wiki/api/v2/spaces?type=global&status=current&limit=${limit}`);
  if (!res.ok) return [];
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
    throw new Error(`Could not create the backup page in space ${spaceId} (${res.status}${t ? `: ${t.slice(0, 160)}` : ""})`);
  }
  const page = await readJson(res);
  const pageId = String(page.id);
  try {
    await restrictToApp(pageId);
  } catch (e) {
    // Never leave an unrestricted backup page behind.
    await conf(route`/wiki/api/v2/pages/${pageId}`, { method: "DELETE" }).catch(() => {});
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
export async function listAttachments(pageId) {
  const out = [];
  let res = await conf(route`/wiki/api/v2/pages/${pageId}/attachments?limit=250`);
  for (let i = 0; i < 40; i++) {
    if (!res.ok) throw new Error(`Could not list the backup files (${res.status})`);
    const body = await readJson(res);
    for (const a of body?.results || []) out.push({ id: String(a.id), title: a.title, fileSize: a.fileSize ?? null });
    const next = body?._links?.next;
    if (!next) break;
    const cursor = new URL(next, "https://x.invalid").searchParams.get("cursor");
    if (!cursor) break;
    res = await conf(route`/wiki/api/v2/pages/${pageId}/attachments?limit=250&cursor=${cursor}`);
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

/** Delete one attachment for good (trash, then purge). */
export async function deleteFile(attachmentId) {
  const res = await conf(route`/wiki/api/v2/attachments/${attachmentId}`, { method: "DELETE" });
  if (res.ok || res.status === 404) await conf(route`/wiki/api/v2/attachments/${attachmentId}?purge=true`, { method: "DELETE" }).catch(() => {});
  return res.ok || res.status === 404;
}

/** Move the whole page to the trash (the "delete my backup" action). */
export async function deletePage(pageId) {
  const res = await conf(route`/wiki/api/v2/pages/${pageId}`, { method: "DELETE" });
  return res.ok || res.status === 404;
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
