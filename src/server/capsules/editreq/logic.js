import { kvs, WhereConditions } from "@forge/kvs";

// Edit Requests — shared helpers.
//
// Two sidecar KVS key families (kept off the seal record, which is rewritten by
// many flows):
//   edit-request-{artifactId}-{requesterAccountId}  pending/denied request
//   edit-grant-{artifactId}-{editorAccountId}       active edit authority
// Grants carry a KVS TTL = seal.expiresAt so they self-expire with the seal.

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
      for (const { key } of results || []) {
        await kvs.delete(key);
      }
    } catch (e) {
      console.warn(`[EDIT-ACCESS] sweep failed for ${prefix}:`, e);
    }
  }
}
