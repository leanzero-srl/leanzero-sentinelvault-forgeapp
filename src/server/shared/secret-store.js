/*
 * Secrets in Forge KVS — the ONE shape (Marketplace security requirement 5, 2026-10-04).
 *
 * Atlassian's guidance for Forge is "use storage.setSecret for secrets": a secret row is
 * encrypted at rest and lives in its own namespace, out of reach of `kvs.query`. The app used to
 * write its TOTP seeds with a plain `kvs.set`. This module reads and writes them through the
 * secret API and moves an old plain row across the first time it is read (read-through
 * migration: getSecret → else get → setSecret → delete the plain row). There is no bulk
 * migration job: a seed nobody reads again is never needed again, and the privacy sweep deletes
 * the plain row of a closed account along with everything else it holds.
 *
 * Every function takes the store as an argument (default: @forge/kvs) so the migration can be
 * proven in plain node against an in-memory fake (test/secret-store.test.mjs).
 */
import { kvs } from "@forge/kvs";

/**
 * Read a secret; a legacy plain row under the same key is moved into the secret namespace.
 * `isValid(value)` decides whether a row is a real record (an empty or malformed plain row is
 * left alone and reported as absent). Returns the value or null.
 */
export async function readSecret(key, { store = kvs, isValid = (v) => v != null, onMigrated = null, migrateOptions = undefined } = {}) {
  const s = await store.getSecret(key);
  if (isValid(s)) return s;
  const plain = await store.get(key);
  if (!isValid(plain)) {
    // A concurrent first read may have moved the row between our two reads: look once more
    // before answering "no device" (review 2026-10-04, P6).
    const again = await store.getSecret(key);
    return isValid(again) ? again : null;
  }
  // `migrateOptions` carries a ttl for rows that had one (a pending enrolment keeps its 15 minutes).
  if (migrateOptions) await store.setSecret(key, plain, migrateOptions);
  else await store.setSecret(key, plain);
  await store.delete(key);
  if (onMigrated) await onMigrated(plain);
  return plain;
}

/** Write a secret (optionally with a KVS ttl option, `{ ttl: { value, unit } }`). */
export async function writeSecret(key, value, options = undefined, { store = kvs } = {}) {
  if (options) await store.setSecret(key, value, options);
  else await store.setSecret(key, value);
  // A legacy plain twin must not outlive the secret that replaced it.
  await store.delete(key).catch(() => {});
}

/** Delete a secret AND any legacy plain row under the same key. */
export async function deleteSecretEverywhere(key, { store = kvs } = {}) {
  await store.deleteSecret(key).catch(() => {});
  await store.delete(key).catch(() => {});
}
