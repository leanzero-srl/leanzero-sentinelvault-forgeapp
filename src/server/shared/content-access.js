import { asApp, route } from "@forge/api";

// SV-SEC-1 — content-level entitlement checks for resolver actions.
//
// WHY THIS MODULE EXISTS. A Forge resolver payload is entirely attacker-controlled:
// any logged-in user on the installed site can invoke any registered action key with
// any body they like. req.context, by contrast, is supplied by Forge. Meanwhile the
// app's own doc-surgery helpers (readDocBody / writeDocBody) run as asApp(), which
// holds read:confluence-content.all + write:confluence-content across the WHOLE site.
// So a payload-named pageId that reaches one of those without a check is not a small
// bug — it is a site-wide privilege escalation, because the app performs the read or
// write with its own authority rather than the caller's.
//
// The rule these helpers encode: the caller must be able to perform the operation
// THEMSELVES before the app performs it on their behalf. Confluence already knows
// the answer (site permissions + space permissions + content restrictions, combined),
// so we ask it rather than re-deriving it.

/** Content operations the Confluence permission/check endpoint accepts. */
export const READ = "read";
export const UPDATE = "update";

/**
 * PURE. Turn a permission/check response into an allow/deny decision.
 *
 * Fails CLOSED: only an explicit `hasPermission: true` on a 2xx allows. This matters
 * more than it looks — probed live against Confluence, an accountId the site cannot
 * resolve returns **404 with a NotFoundException body**, not `hasPermission: false`,
 * and an operation name the content type does not support returns 400. Treating any
 * non-2xx as "no answer, therefore no" is what keeps those from reading as an allow.
 */
export function grantsAccess(ok, body) {
  return ok === true && body?.hasPermission === true;
}

/**
 * PURE. Does a payload-supplied content id have to be entitlement-checked, given the
 * id Forge put in the resolver context?
 *
 * A context id is authentic: the client cannot forge it, it is the content the app
 * module is actually rendering inside. For a READ-ONLY use that is enough on its own
 * — to render there at all, the caller could already read it — so the extra REST call
 * is skipped on the page-view hot path. Anything else must be checked: no context to
 * anchor against, or a payload id naming DIFFERENT content than the one we are in.
 *
 * Deliberately NOT used on write paths. Authenticity is not entitlement: holding a
 * page id in context proves the caller can SEE that page, never that they may CHANGE
 * it, so a user with read-but-not-edit would sail straight through. Every privileged
 * write checks unconditionally.
 */
export function mustVerify(payloadId, contextId) {
  if (payloadId == null || payloadId === "") return false; // nothing client-named to verify
  if (contextId == null || contextId === "") return true; // no trusted anchor → verify
  return String(payloadId) !== String(contextId);
}

/**
 * Can `accountId` perform `operation` on this content?
 *
 * Runs as asApp() with the subject named explicitly, mirroring isAccountStewardAsApp
 * in steward-checks.js. Two reasons over asUser(): the app can always resolve the
 * content, so a caller with no access gets a definitive `hasPermission: false` instead
 * of a 404 that would be indistinguishable from "page was deleted"; and the subject is
 * req.context.accountId, which is Forge-supplied and so trustworthy to name.
 *
 * Requires read:confluence-content.permission / read:content.permission:confluence —
 * both already in manifest.yml, so this adds no scope and needs no re-consent.
 *
 * Denies on every failure path: non-2xx, malformed body, thrown error.
 */
export async function accountCanAccessContent(accountId, contentId, operation) {
  if (!accountId || !contentId) return false;
  try {
    const res = await asApp().requestConfluence(
      route`/wiki/rest/api/content/${contentId}/permission/check`,
      {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: { type: "user", identifier: accountId },
          operation,
        }),
      },
    );
    if (!res.ok) {
      console.warn(`[AUTHZ] permission/check ${operation} on ${contentId} → ${res.status}; denying`);
      return false;
    }
    return grantsAccess(true, await res.json());
  } catch (e) {
    console.error("[AUTHZ] permission/check threw; denying:", e);
    return false;
  }
}

/** May this account EDIT this page? The bar for any app write to it. */
export const canEditPage = (accountId, pageId) =>
  accountCanAccessContent(accountId, pageId, UPDATE);

/** May this account READ this page? The bar for returning any of its content. */
export const canReadPage = (accountId, pageId) =>
  accountCanAccessContent(accountId, pageId, READ);

/**
 * Resolve a page's REAL space key from its id.
 *
 * Never authorize against a caller-supplied spaceKey while acting on a caller-supplied pageId:
 * they are two different objects, so a steward of space A ends up cleared to act on a page in
 * space B. Derive the space from the page and authorize against that.
 *
 * B11 (live-verified): the v1 read `/wiki/rest/api/content/{id}?expand=space` now returns
 * **410 Gone** for Forge apps — the v1 content GETs were sunset — which silently made this
 * return null for every page and so denied every steward. It resolves via v2 for that reason:
 * page → spaceId → space key. Returns null on any failure, and null must be treated as deny.
 *
 * Moved here from validations/actions.js so the workflow capsule shares this one copy rather
 * than growing a second that can drift.
 */
export async function resolvePageSpaceKey(pageId) {
  if (!pageId) return null;
  try {
    const pres = await asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}`);
    if (!pres.ok) return null;
    const spaceId = (await pres.json())?.spaceId;
    if (!spaceId) return null;
    const sres = await asApp().requestConfluence(route`/wiki/api/v2/spaces/${spaceId}`);
    if (!sres.ok) return null;
    return (await sres.json())?.key || null;
  } catch (_) { /* deny on failure */ }
  return null;
}
