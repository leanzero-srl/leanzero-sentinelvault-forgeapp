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

// ---------------------------------------------------------------------------------------------
// The "waiting on ME" indexes behind My work. ONE discipline, three record families:
//   attachments  editreq-owner-{owner}-{attachmentId}-{requester}  → edit-request-{att}-{req}
//   sections     sectionreq-owner-{owner}-{sectionId}-{requester}  → section-edit-request-{sec}-{req}
//   space-admin  stewardreq-space-{spaceKey}                       → steward-request-{space}-{account}
// Written with the record, dropped with it, confirmed by a strong get at read time (the query is
// eventually consistent; the get is not), healed by the read that walks it, backfilled hourly.
// The rule lives ONCE (ownerIndex below) so the section family cannot drift from the attachment
// family the way it did before P1-3 (2026-09-15): sections had the records and no index at all.
// ---------------------------------------------------------------------------------------------

// PURE. A record family's index: `idField` names the object the request is about.
function ownerIndex({ indexPrefix, recordPrefix, idField }) {
  const key = (ownerAccountId, id, requesterAccountId) => `${indexPrefix}-${ownerAccountId}-${id}-${requesterAccountId}`;
  const recordKey = (id, requesterAccountId) => `${recordPrefix}-${id}-${requesterAccountId}`;
  // Only a pending request with an owner belongs in the owner index.
  const wants = (record) => !!(record && record.status === "pending" && record.ownerAccountId && record[idField] && record.requesterAccountId);
  const write = async (record) => {
    if (!wants(record)) return false;
    await kvs.set(key(record.ownerAccountId, record[idField], record.requesterAccountId), {
      [idField]: record[idField], requesterAccountId: record.requesterAccountId, requestedAt: record.requestedAt || null,
    });
    return true;
  };
  const drop = async (record) => {
    if (!record?.ownerAccountId || !record?.[idField] || !record?.requesterAccountId) return;
    await kvs.delete(key(record.ownerAccountId, record[idField], record.requesterAccountId)).catch(() => {});
  };
  // The requests waiting on this owner: read ONLY the owner's prefix, confirm each by key, and
  // drop index rows whose request is gone or no longer pending — the read heals the index it walks.
  const listPending = async (ownerAccountId) => {
    if (!ownerAccountId) return [];
    const out = [];
    const prefix = `${indexPrefix}-${ownerAccountId}-`;
    let query = kvs.query().where("key", WhereConditions.beginsWith(prefix)).limit(100);
    let iterations = 0;
    do {
      const { results, nextCursor } = await query.getMany();
      for (const { key: k, value: row } of results || []) {
        if (!row?.[idField] || !row?.requesterAccountId) { await kvs.delete(k).catch(() => {}); continue; }
        const record = await kvs.get(recordKey(row[idField], row.requesterAccountId));
        if (record?.status === "pending" && record.ownerAccountId === ownerAccountId) { out.push(record); continue; }
        await kvs.delete(k).catch(() => {});
      }
      if (!nextCursor || ++iterations >= 15) break;
      query = kvs.query().where("key", WhereConditions.beginsWith(prefix)).limit(100).cursor(nextCursor);
    } while (true);
    out.sort((a, b) => String(b.requestedAt || "").localeCompare(String(a.requestedAt || "")));
    return out;
  };
  // Hourly: every pending request gets an index row if it lacks one, so requests opened before
  // the index existed reach the owner within an hour of the upgrade.
  const backfill = async () => {
    let backfilled = 0;
    let query = kvs.query().where("key", WhereConditions.beginsWith(`${recordPrefix}-`)).limit(100);
    let iterations = 0;
    do {
      const { results, nextCursor } = await query.getMany();
      for (const { value: rec } of results || []) {
        try {
          if (!wants(rec)) continue;
          if (await kvs.get(key(rec.ownerAccountId, rec[idField], rec.requesterAccountId))) continue;
          await write(rec);
          backfilled++;
        } catch (e) { console.warn(`[EDIT-ACCESS] ${indexPrefix} backfill`, e); }
      }
      if (!nextCursor || ++iterations >= 20) break;
      query = kvs.query().where("key", WhereConditions.beginsWith(`${recordPrefix}-`)).limit(100).cursor(nextCursor);
    } while (true);
    return backfilled;
  };
  return { key, recordKey, wants, write, drop, listPending, backfill };
}

// Attachments (K1, 2026-09-05). The exported names are the ones actions.js and the tests use.
const attachmentIndex = ownerIndex({ indexPrefix: "editreq-owner", recordPrefix: "edit-request", idField: "artifactId" });
export const editreqOwnerKey = attachmentIndex.key;
export const wantsOwnerIndex = attachmentIndex.wants;
export const writeOwnerIndex = attachmentIndex.write;
export const dropOwnerIndex = attachmentIndex.drop;
export const listPendingRequestsForOwner = attachmentIndex.listPending;

// Sections (P1-3, 2026-09-15). Same discipline, the record names its section as `sectionId`.
const sectionIndex = ownerIndex({ indexPrefix: "sectionreq-owner", recordPrefix: "section-edit-request", idField: "sectionId" });
export const sectionreqOwnerKey = sectionIndex.key;
export const wantsSectionOwnerIndex = sectionIndex.wants;
export const writeSectionOwnerIndex = sectionIndex.write;
export const dropSectionOwnerIndex = sectionIndex.drop;
export const listPendingSectionRequestsForOwner = sectionIndex.listPending;

// Space-admin access requests ("steward requests"): the approver is not one account but a ROLE
// (site admin, space ADMINISTER, the configured admin users/groups), which cannot be indexed per
// approver. The index is per SPACE — "which spaces have someone waiting" — one bounded prefix
// the lister walks, applying the per-space role gate on each (SV-SEC-1: the caller is checked
// against every space it aggregates; a payload never names the spaces).
//   stewardreq-space-{spaceKey}  → { spaceKey }
export const stewardreqSpaceKeyOf = (spaceKey) => `stewardreq-space-${String(spaceKey).replace(/[^a-zA-Z0-9:._\s-#]/g, "_")}`;
// PURE. Only a pending request puts its space in the index.
export const wantsSpaceIndex = (record) => !!(record && record.status === "pending" && record.spaceKey && record.accountId);
export async function writeSpaceIndex(record) {
  if (!wantsSpaceIndex(record)) return false;
  await kvs.set(stewardreqSpaceKeyOf(record.spaceKey), { spaceKey: record.spaceKey });
  return true;
}
export async function dropSpaceIndex(spaceKey) {
  if (!spaceKey) return;
  await kvs.delete(stewardreqSpaceKeyOf(spaceKey)).catch(() => {});
}
// The spaces with (as far as the index knows) someone waiting. Bounded: a site with more than
// 200 spaces awaiting a decision has a different problem.
export async function listSpacesWithPendingStewardRequests() {
  const out = [];
  let query = kvs.query().where("key", WhereConditions.beginsWith("stewardreq-space-")).limit(100);
  let iterations = 0;
  do {
    const { results, nextCursor } = await query.getMany();
    for (const { key, value } of results || []) {
      if (!value?.spaceKey) { await kvs.delete(key).catch(() => {}); continue; }
      out.push(value.spaceKey);
    }
    if (!nextCursor || ++iterations >= 2) break;
    query = kvs.query().where("key", WhereConditions.beginsWith("stewardreq-space-")).limit(100).cursor(nextCursor);
  } while (true);
  return out;
}
// The pending requests of ONE space, each confirmed by key. Heals the space row when none remain
// (approve deleted the last one, deny turned it, the cooldown reaped it).
export async function listPendingStewardRequestsInSpace(spaceKey) {
  const prefix = `steward-request-${String(spaceKey).replace(/[^a-zA-Z0-9:._\s-#]/g, "_")}-`;
  const { results } = await kvs.query().where("key", WhereConditions.beginsWith(prefix)).limit(100).getMany();
  const out = [];
  for (const { key } of results || []) {
    const record = await kvs.get(key);
    if (record?.status === "pending") out.push(record);
  }
  if (out.length === 0) await dropSpaceIndex(spaceKey);
  out.sort((a, b) => String(b.requestedAt || "").localeCompare(String(a.requestedAt || "")));
  return out;
}
async function backfillSpaceIndex() {
  let backfilled = 0;
  let query = kvs.query().where("key", WhereConditions.beginsWith("steward-request-")).limit(100);
  let iterations = 0;
  do {
    const { results, nextCursor } = await query.getMany();
    for (const { value: rec } of results || []) {
      try {
        if (!wantsSpaceIndex(rec)) continue;
        if (await kvs.get(stewardreqSpaceKeyOf(rec.spaceKey))) continue;
        await writeSpaceIndex(rec);
        backfilled++;
      } catch (e) { console.warn("[EDIT-ACCESS] stewardreq-space backfill", e); }
    }
    if (!nextCursor || ++iterations >= 20) break;
    query = kvs.query().where("key", WhereConditions.beginsWith("steward-request-")).limit(100).cursor(nextCursor);
  } while (true);
  return backfilled;
}

// Hourly (from expirySweepTask): all three My work indexes. `backfilled` stays the total so the
// sweep's existing log line needs no change; the per-family counts sit beside it.
export async function sweepEditRequestIndex() {
  const attachments = await attachmentIndex.backfill();
  const sections = await sectionIndex.backfill();
  const spaces = await backfillSpaceIndex();
  return { backfilled: attachments + sections + spaces, attachments, sections, spaces };
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
      for (const { key, value } of results || []) {
        await kvs.delete(key);
        if (prefix.startsWith("section-edit-request-")) await dropSectionOwnerIndex(value); // the owner index row goes with the request
      }
    } catch (e) {
      console.warn(`[EDIT-ACCESS] section sweep failed for ${prefix}:`, e);
    }
  }
}
