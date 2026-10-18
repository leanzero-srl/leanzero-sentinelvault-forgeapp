import { route } from "@forge/api";
import { appConfluence, isRateLimited, noteAuthzUnknown } from "./confluence-call.js";

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
 * Accepts read:confluence-content.permission (classic, held) or
 * read:content.permission:confluence (granular, dropped in 7.0.0 — docs/SCOPES-7.0.md).
 *
 * Denies on every failure path: non-2xx, malformed body, thrown error.
 */
export async function accountCanAccessContent(accountId, contentId, operation) {
  if (!accountId || !contentId) return false;
  try {
    // A read-only question asked with POST: retried on 429 like a read (confluence-call.js).
    const res = await appConfluence(
      route`/wiki/rest/api/content/${contentId}/permission/check`,
      {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: { type: "user", identifier: accountId },
          operation,
        }),
      },
      { idempotent: true },
    );
    if (isRateLimited(res)) {
      // Still a no (fail closed), but the resolver's answer says "try again", not "not allowed".
      noteAuthzUnknown();
      console.warn(`[AUTHZ] permission/check ${operation} on ${contentId} -> 429; could not check (denying for now)`);
      return false;
    }
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
 * page (or blog post) → spaceId → space key. Returns null on any failure, and null must be
 * treated as deny.
 *
 * Moved here from validations/actions.js so the workflow capsule shares this one copy rather
 * than growing a second that can drift.
 */
export async function resolvePageSpaceKey(pageId) {
  return (await resolvePageSpace(pageId))?.spaceKey || null;
}

/**
 * The same page → space walk, returning both halves: `{ spaceId, spaceKey }`, or null on any
 * failure (deny). For writers that stamp a record with the space it lives in (the index row is
 * keyed by the id, the steward gate by the key) and must take both from the OBJECT.
 */
export async function resolvePageSpace(pageId) {
  const live = await liveContentSpace(pageId);
  return live.status === "found" ? { spaceId: live.spaceId, spaceKey: live.spaceKey } : null;
}

/**
 * Where a piece of content (a page or a blog post) is NOW, with a failed read told apart from
 * content Confluence no longer has: `{ status: "found", spaceId, spaceKey }`, `{ status: "gone" }`
 * (404 as a page AND as a blog post: purged; a trashed page still answers, with its space), or
 * `{ status: "error" }` (anything else). Read as the app, so a restriction never reads as "gone".
 */
export async function liveContentSpace(contentId) {
  if (!contentId) return { status: "error" };
  try {
    // A blog post is content too (seals and attachments live on them): a 404 as a page is asked
    // again as a blog post before giving up. The caller's context used to paper over this for
    // blog posts — the steward stood on the post — and that fallback is gone (objectSpaceKeyOf).
    let pres = await appConfluence(route`/wiki/api/v2/pages/${contentId}`);
    if (pres.status === 404) pres = await appConfluence(route`/wiki/api/v2/blogposts/${contentId}`);
    if (pres.status === 404) return { status: "gone" };
    if (isRateLimited(pres)) { noteAuthzUnknown(); return { status: "error", rateLimited: true }; }
    if (!pres.ok) return { status: "error" };
    const spaceId = (await pres.json())?.spaceId;
    if (!spaceId) return { status: "error" };
    const sres = await appConfluence(route`/wiki/api/v2/spaces/${spaceId}`);
    if (isRateLimited(sres)) { noteAuthzUnknown(); return { status: "error", rateLimited: true }; }
    if (!sres.ok) return { status: "error" };
    const spaceKey = (await sres.json())?.key || null;
    return spaceKey ? { status: "found", spaceId: String(spaceId), spaceKey } : { status: "error" };
  } catch (_) { /* deny on failure */ }
  return { status: "error" };
}

/**
 * The space a seal-shaped record is FILED under — its own `spaceKey`, else the space of the page
 * it names (`contentId` for attachment seals, `pageId` for section seals). For filing (activity
 * rows, the hold-period policy, the panel re-embed), never for deciding who may act on the record:
 * that is isStewardOfRecord below, because a record keeps the space it was made in after its page
 * moves. NEVER the caller's context or payload (the confused deputy CLAUDE.md describes).
 */
export async function objectSpaceKeyOf(record) {
  if (!record || typeof record !== "object") return null;
  if (record.spaceKey) return record.spaceKey;
  const pageId = record.contentId || record.pageId || null;
  return pageId ? resolvePageSpaceKey(pageId) : null;
}

/**
 * Which spaces' admins hold steward power over a RECORD the app keeps for a piece of content (a
 * page's workflow state, its approval request, an attachment or section seal, an edit request).
 *
 * The record carries the space it was made in, and does not follow the page when the page moves to
 * another space (no page-moved event is subscribed). So the authority is BOTH spaces: the one the
 * content is in NOW, and — when it moved — the one the record was made in. The old space's admins
 * no longer run content that left them, and moving content into a space you administer (every
 * personal-space owner administers one) does not hand you its records. The same rule Jira seals
 * apply to an issue moved between projects (jira-seals/actions.js isStewardOfSeal). A site admin
 * passes both.
 *
 * `liveKey` is a space key Confluence itself just gave for THIS content (the resolver context when
 * the caller is on this page, the page event): no lookup then. Content Confluence no longer has
 * keeps the record's own space; a failed lookup is [] — deny. `storedKey` may be a list (an
 * approval request and the workflow record it belongs to each carry one).
 */
export async function recordAuthoritySpaces(where = {}) {
  return (await recordAuthority(where)).spaces;
}

/**
 * The same answer with what it rests on: `{ known, spaces, live, moved }`. `known: false` when
 * Confluence could not be asked where the content is (spaces is then [] — deny). `moved` when the
 * content is now in a space other than the one the record was made in: the record's own space's
 * settings then no longer describe a space the page is in, so callers that apply those settings
 * hold the page's workflow still (see workflow/actions.js requestTransition, the trigger's probe).
 */
export async function recordAuthority({ contentId = null, storedKey = null, liveKey = null } = {}) {
  const stored = [].concat(storedKey ?? []).filter((k) => typeof k === "string" && k);
  let live = liveKey || null;
  if (!live && contentId) {
    const r = await liveContentSpace(contentId);
    if (r.status === "found") live = r.spaceKey;
    else if (r.status === "error") return { known: false, spaces: [], live: null, moved: false, rateLimited: !!r.rateLimited };
    // "gone": nothing else holds the content now; the record's own space is all there is.
  }
  return { known: true, spaces: [...new Set([live, ...stored].filter(Boolean))], live, moved: !!live && stored.some((k) => k !== live) };
}

/**
 * The page or blog post a seal is about NOW. An attachment seal asks Confluence where its file is
 * (the file can be moved to another page, and a seal made before 8.9.0 could name the page the
 * sealer was viewing instead of the file's own); the record's page answers when that read fails.
 * A section seal names its page.
 */
export async function sealContainerId(seal) {
  if (!seal || typeof seal !== "object") return null;
  if (seal.attachmentId) {
    let res = null;
    try { res = await appConfluence(route`/wiki/api/v2/attachments/${seal.attachmentId}`); } catch (_) { return undefined; }
    if (isRateLimited(res)) noteAuthzUnknown();
    if (res.ok) {
      const a = await res.json().catch(() => null);
      const container = a?.pageId || a?.blogPostId || null;
      if (container) return String(container);
    } else if (res.status !== 404) {
      return undefined; // could not be read: undefined = deny (isStewardOfSeal), never the record's page
    }
    // 404 (file purged) or no container: the record's page below
  }
  return seal.contentId || seal.pageId || null;
}

/** Steward power over a seal: isStewardOfRecord on the seal's page now (sealContainerId). */
export async function isStewardOfSeal(check, accountId, seal) {
  const contentId = await sealContainerId(seal);
  if (contentId === undefined) return false;
  return isStewardOfRecord(check, accountId, { contentId, storedKey: seal?.spaceKey || null });
}

/** Does `check(accountId, spaceKey)` pass for EVERY space in `spaces`? [] never passes. */
export async function isStewardOfSpaces(check, accountId, spaces) {
  if (!accountId || !Array.isArray(spaces) || !spaces.length) return false;
  for (const key of spaces) {
    let yes = false;
    try { yes = (await check(accountId, key)) === true; } catch (_) { yes = false; }
    if (!yes) return false;
  }
  return true;
}

/**
 * isStewardOfSpaces with "could not tell" kept apart (8.12.0). `statusCheck(accountId, spaceKey)`
 * answers `{ steward, unknown }` (steward-checks.js accountStewardStatusAsApp). Steward only when
 * EVERY space says yes; a known no anywhere is a known no; otherwise an unknown is unknown. [] and
 * a thrown check are a known no, as in isStewardOfSpaces. Never grants on unknown.
 */
export async function stewardOfSpacesStatus(statusCheck, accountId, spaces) {
  if (!accountId || !Array.isArray(spaces) || !spaces.length) return { steward: false, unknown: false };
  let unknown = false;
  for (const key of spaces) {
    let s = null;
    try { s = await statusCheck(accountId, key); } catch (_) { s = null; }
    if (s?.steward === true) continue;
    if (s?.unknown === true) { unknown = true; continue; }
    return { steward: false, unknown: false };
  }
  return unknown ? { steward: false, unknown: true } : { steward: true, unknown: false };
}

/**
 * May `accountId` act as a steward on this record? `check` is the steward test the caller would
 * have used for one space (authorizeSteward, isAccountStewardAsApp, …); it must pass for the
 * content's live space and, if the content moved, the record's own (recordAuthoritySpaces).
 */
export async function isStewardOfRecord(check, accountId, where) {
  return isStewardOfSpaces(check, accountId, await recordAuthoritySpaces(where));
}

/**
 * isStewardOfRecord with "could not tell" kept apart (8.12.0): `{ steward, unknown }`. Unknown when a
 * 429 kept Confluence from saying where the content is or whether the account is a steward there.
 * For DISPLAY decisions ("couldn't check right now") and for paths that must not act on a no.
 */
export async function stewardOfRecordStatus(statusCheck, accountId, where) {
  const auth = await recordAuthority(where);
  if (!auth.known) return { steward: false, unknown: !!auth.rateLimited };
  return stewardOfSpacesStatus(statusCheck, accountId, auth.spaces);
}
