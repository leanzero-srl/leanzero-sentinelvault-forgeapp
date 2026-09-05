import { kvs, WhereConditions } from "@forge/kvs";

// Edit Requests — shared helpers.
//
// Two sidecar KVS key families (kept off the seal record, which is rewritten by
// many flows):
//   edit-request-{artifactId}-{requesterAccountId}  pending/denied request
//   edit-grant-{artifactId}-{editorAccountId}       active edit authority
// Grants carry a KVS TTL = seal.expiresAt so they self-expire with the seal.
//
// Plus one INDEX (K1 index discipline, 2026-09-05):
//   editreq-owner-{ownerAccountId}-{artifactId}-{requesterAccountId}
// "the requests waiting on ME" used to be a site-wide scan of every edit-request-* record
// filtered client-side (cap ~1,000) — the exact shape that blinded the approvals inbox once
// orphans accumulated. The index is written with the request, deleted with it (approve, deny,
// withdraw, seal teardown), confirmed by a strong get at read time, and backfilled hourly.

export const editreqOwnerKey = (ownerAccountId, artifactId, requesterAccountId) =>
  `editreq-owner-${ownerAccountId}-${artifactId}-${requesterAccountId}`;

// PURE. Only a pending request with an owner belongs in the owner index.
export const wantsOwnerIndex = (record) => !!(record && record.status === "pending" && record.ownerAccountId && record.artifactId && record.requesterAccountId);

export async function writeOwnerIndex(record) {
  if (!wantsOwnerIndex(record)) return false;
  await kvs.set(editreqOwnerKey(record.ownerAccountId, record.artifactId, record.requesterAccountId), {
    artifactId: record.artifactId, requesterAccountId: record.requesterAccountId, requestedAt: record.requestedAt || null,
  });
  return true;
}

export async function dropOwnerIndex(record) {
  if (!record?.ownerAccountId || !record?.artifactId || !record?.requesterAccountId) return;
  await kvs.delete(editreqOwnerKey(record.ownerAccountId, record.artifactId, record.requesterAccountId)).catch(() => {});
}

// The requests waiting on this owner: read ONLY the owner's prefix, confirm each by key
// (the query is eventually consistent; the get is not), and drop index rows whose request is
// gone or no longer pending — the read heals the index it walks.
export async function listPendingRequestsForOwner(ownerAccountId) {
  if (!ownerAccountId) return [];
  const out = [];
  const prefix = `editreq-owner-${ownerAccountId}-`;
  let query = kvs.query().where("key", WhereConditions.beginsWith(prefix)).limit(100);
  let iterations = 0;
  do {
    const { results, nextCursor } = await query.getMany();
    for (const { key, value: row } of results || []) {
      if (!row?.artifactId || !row?.requesterAccountId) { await kvs.delete(key).catch(() => {}); continue; }
      const record = await kvs.get(`edit-request-${row.artifactId}-${row.requesterAccountId}`);
      if (record?.status === "pending" && record.ownerAccountId === ownerAccountId) { out.push(record); continue; }
      await kvs.delete(key).catch(() => {});
    }
    if (!nextCursor || ++iterations >= 15) break;
    query = kvs.query().where("key", WhereConditions.beginsWith(prefix)).limit(100).cursor(nextCursor);
  } while (true);
  out.sort((a, b) => String(b.requestedAt || "").localeCompare(String(a.requestedAt || "")));
  return out;
}

// Hourly (from expirySweepTask): every pending request gets an index row if it lacks one, so
// requests opened before the index existed reach the owner within an hour of the upgrade.
export async function sweepEditRequestIndex() {
  let backfilled = 0;
  let query = kvs.query().where("key", WhereConditions.beginsWith("edit-request-")).limit(100);
  let iterations = 0;
  do {
    const { results, nextCursor } = await query.getMany();
    for (const { value: rec } of results || []) {
      try {
        if (!wantsOwnerIndex(rec)) continue;
        if (await kvs.get(editreqOwnerKey(rec.ownerAccountId, rec.artifactId, rec.requesterAccountId))) continue;
        await writeOwnerIndex(rec);
        backfilled++;
      } catch (e) { console.warn("[EDIT-ACCESS] index backfill", e); }
    }
    if (!nextCursor || ++iterations >= 20) break;
    query = kvs.query().where("key", WhereConditions.beginsWith("edit-request-")).limit(100).cursor(nextCursor);
  } while (true);
  return { backfilled };
}

/**
 * Return the active edit grant for (artifact, account), or null if none / expired.
 * This is the single O(1) read the attachment-edit trigger uses to decide whether
 * an editor's change is authorized.
 */
export async function getActiveEditGrant(attachmentId, accountId) {
  if (!attachmentId || !accountId) return null;
  const grant = await kvs.get(`edit-grant-${attachmentId}-${accountId}`);
  if (!grant) return null;
  if (grant.expiresAt && new Date(grant.expiresAt).getTime() <= Date.now()) return null;
  return grant;
}

/**
 * Delete all edit grants and requests for an artifact. Called on every seal
 * teardown (unseal / steward-unseal / delete / purge) so a later re-seal of the
 * same attachment starts clean.
 */
export async function sweepEditAccess(attachmentId) {
  if (!attachmentId) return;
  for (const prefix of [`edit-grant-${attachmentId}-`, `edit-request-${attachmentId}-`]) {
    try {
      const { results } = await kvs
        .query()
        .where("key", WhereConditions.beginsWith(prefix))
        .limit(100)
        .getMany();
      for (const { key, value } of results || []) {
        await kvs.delete(key);
        if (prefix.startsWith("edit-request-")) await dropOwnerIndex(value); // the owner index row goes with the request
      }
    } catch (e) {
      console.warn(`[EDIT-ACCESS] sweep failed for ${prefix}:`, e);
    }
  }
}

// --- Section variants (Content Sealing) ---
// Keys: section-edit-grant-{sectionId}-{accountId} / section-edit-request-{sectionId}-{accountId}

export async function getActiveSectionEditGrant(sectionId, accountId) {
  if (!sectionId || !accountId) return null;
  const grant = await kvs.get(`section-edit-grant-${sectionId}-${accountId}`);
  if (!grant) return null;
  if (grant.expiresAt && new Date(grant.expiresAt).getTime() <= Date.now()) return null;
  return grant;
}

export async function sweepSectionEditAccess(sectionId) {
  if (!sectionId) return;
  for (const prefix of [`section-edit-grant-${sectionId}-`, `section-edit-request-${sectionId}-`]) {
    try {
      const { results } = await kvs
        .query()
        .where("key", WhereConditions.beginsWith(prefix))
        .limit(100)
        .getMany();
      for (const { key } of results || []) {
        await kvs.delete(key);
      }
    } catch (e) {
      console.warn(`[EDIT-ACCESS] section sweep failed for ${prefix}:`, e);
    }
  }
}
