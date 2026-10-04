/*
 * The `protection-` page content property — what it may carry (PURE, no imports).
 *
 * The property exists so the page-content trigger can tell cheaply that a page carries a seal
 * (triggers.js collectMediaSealsForPage reads only its presence). It is readable by ANYONE who
 * can read the page over REST, so it used to publish the whole seal record: the sealer's email
 * address (bypassing their profile's email-visibility setting), their display name and the
 * free-text seal note. Since 2026-10-04 it carries the account id and timestamps only; a name is
 * resolved at render time from the KVS record or Confluence, never from this property.
 *
 * Every write goes through `sealPropertyValue`. An existing property written by 6.6.0 or earlier
 * is rewritten on the next seal or extend on its page, and the privacy sweep rewrites the rest
 * (`sealPropertyNeedsScrub`).
 */
export const SEAL_PROPERTY_FIELDS = Object.freeze([
  "lockedBy", "timestamp", "expiresAt", "lockDuration", "spaceKey", "spaceId", "contentId",
  "attachmentId", "sealedVersion", "extensionCount",
]);

/** PURE. The seal record reduced to what the page property may publish. */
export function sealPropertyValue(seal) {
  const out = {};
  if (!seal || typeof seal !== "object") return out;
  for (const k of SEAL_PROPERTY_FIELDS) if (seal[k] !== undefined) out[k] = seal[k];
  return out;
}

/** PURE. Does a stored property value carry anything beyond the whitelist? */
export function sealPropertyNeedsScrub(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).some((k) => !SEAL_PROPERTY_FIELDS.includes(k));
}
