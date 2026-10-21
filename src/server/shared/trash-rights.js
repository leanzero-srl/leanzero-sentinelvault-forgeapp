import { route } from "@forge/api";
import { userConfluence, rateLimitOf, busyReason } from "./confluence-call.js";
import { attachmentPurgeVerdict } from "../infra/attachment-status.js";
import { kvs } from "@forge/kvs";
import { setWithTtl } from "./kvs-ttl.js";
import { errText } from "./action-log.js";

// ── The ONE rule for changing a file's TRASH state on someone's behalf (2026-10-21) ─────────────
//
// WHY. Restoring a file from the trash and deleting one permanently ("purge") are Confluence's own
// trash rights, and they are narrower than editing: REST v2 "Delete attachment" requires, to purge a
// trashed attachment, permission to view its container, to delete attachments in the space AND the
// space's `manage/content` permission (developer.atlassian.com/cloud/confluence/rest/v2/
// api-group-attachment/#api-attachments-id-delete); the space trash (restore / purge) is a space-
// admin task (support.atlassian.com/confluence-cloud/docs/delete-restore-or-purge-a-page/). Sentinel
// Vault never lets anyone restore or purge more than Confluence itself would let them.
//
// THE RULE. The Confluence call that changes trash state is made WITH THE CALLER'S OWN RIGHTS
// (asUser), so Confluence decides. Sentinel Vault's own gate (seal owner, its Space admins list, an
// editor of the page) stays in front of it as a floor and can only narrow. Being on Sentinel Vault's
// own lists never grants a trash power Confluence does not give that person; a Confluence space or
// site admin keeps exactly what Confluence gives them. An answer that is not a clear yes changes
// nothing: 401/403 and a 404 for a file the app can still see are Confluence's "no"; 429 is "busy,
// try again"; a thrown call (no user context) is "could not act as you". These answers carry
// `refusedBy`, so registry.js busyAware never rewrites a definite "no" into "try again" just because
// an earlier, already-passed check in the same call met a 429.
//
// Where no user context exists (a queue consumer, a REST job), there is no call to make as the user:
// none of those paths restores or purges a person's file today. If one is ever added, it must check
// the SAME Confluence permission for that account and fail closed on unknown — never fall back to
// the app's identity. `test/trash-rights.test.mjs` holds a source guard for app-identity purges.
//
// The seal's own enforcement (triggers.js: a live seal puts back its file when someone else trashes
// it) is the product's promise to the seal owner and runs as the app; it is not a trash request.

/** The refusals a person sees when Confluence, not Sentinel Vault, said no. */
export const REFUSED = Object.freeze({
  restore: { success: false, refusedBy: "confluence", reason: "Confluence does not let you restore this file." },
  purge: { success: false, refusedBy: "confluence", reason: "Confluence does not let you permanently delete this file." },
});
const NO_USER = Object.freeze({
  restore: { success: false, refusedBy: "context", reason: "Sentinel Vault could not restore this file as you. Nothing was changed." },
  purge: { success: false, refusedBy: "context", reason: "Sentinel Vault could not delete this file as you. Nothing was changed." },
});

/**
 * PURE. Is this the Forge error that means "this person has not given the app access yet"? It is
 * thrown on from the resolver so Forge shows the consent prompt.
 */
export const isNeedsConsent = (err) => err?.name === "NEEDS_AUTHENTICATION_ERR";

/**
 * PURE. The answer when "is the file gone?" could not be settled: never a definite refusal, never
 * a removal. A rate limit seen on the way says so ("try again").
 */
export function unprovenGone({ rateLimited = false, why = null } = {}) {
  if (rateLimited) {
    const rl = rateLimitOf();
    return {
      success: false, busy: true, refusedBy: "confluence", retryAfterSeconds: rl?.retryAfterSeconds ?? null,
      reason: busyReason(rl?.retryAfterSeconds ?? null, { what: "the file could not be checked", nothingChanged: true }),
    };
  }
  if (why === "container-unseen") return { success: false, refusedBy: "confluence", reason: "Confluence no longer shows this file's page (it was deleted, or Sentinel Vault cannot see it), so this record cannot be cleared from here. Nothing was changed." };
  if (why === "container-not-current") return { success: false, refusedBy: "confluence", reason: "Confluence no longer shows this file and Sentinel Vault cannot confirm where it went, so this record cannot be cleared from here. Nothing was changed." };
  return { success: false, refusedBy: "confluence", reason: "Could not confirm in Confluence that the file is gone. Nothing was changed." };
}

/** PURE. What a Confluence answer to a trash-state call means: ok | refused | busy | missing | failed. */
export function classifyTrashAnswer(status) {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401 || status === 403) return "refused";
  if (status === 429) return "busy";
  if (status === 404) return "missing"; // the caller cannot see it, OR it is gone: the caller decides which
  return "failed";
}

/** The answer a resolver returns for a trash-state call that did not succeed. */
export function trashRefusal(action, kind, status = null) {
  if (kind === "refused" || kind === "missing") return { ...REFUSED[action] };
  if (kind === "no-user") return { ...NO_USER[action] };
  if (kind === "busy") {
    const rl = rateLimitOf();
    return {
      success: false, busy: true, refusedBy: "confluence", retryAfterSeconds: rl?.retryAfterSeconds ?? null,
      reason: busyReason(rl?.retryAfterSeconds ?? null, { what: action === "restore" ? "the file could not be restored" : "the file could not be deleted", nothingChanged: true }),
    };
  }
  return { success: false, refusedBy: "confluence", reason: action === "restore" ? `Restore failed: ${status ?? "no answer"}` : `Permanent delete failed: ${status ?? "no answer"}` };
}

/** A newer file holds the name: Confluence restores nothing until that file is renamed or removed. */
export const NAME_TAKEN = Object.freeze({ success: false, refusedBy: "confluence", reason: "Could not restore: a newer file with this name is on the page. Rename or remove that file, then restore this one." });

// ── The panel's restore, told apart from a change to the file (2026-10-21) ─────────────────────
// A restore made as the person may fire avi:confluence:updated:attachment with that person's
// account. The seal's enforcement (triggers.js handleSealedArtifactEdit) treats an update to a sealed
// file by someone other than its owner as a change to undo. A restore changes the file's status,
// never its bytes (measured: it keeps the attachment's version number AND its fileId), so the
// enforcement leaves an update alone ONLY when all of these hold:
//   - a marker for this file AND this person exists (one per person: two people's restores never
//     share or clear each other's), written before the restore's PUT, and minutes old at the event;
//   - the event's version is the pre-restore version itself (a restore keeps the version number,
//     measured): any later version is a change and is enforced, even with the same bytes;
//   - that version holds the SAME file (fileId) as the trashed file did before the restore AND as
//     the sealed file (the seal's sealedFileId, or the fileId of its sealedVersion for a seal that
//     predates sealedFileId). The bytes are the real guard; the marker only says who asked.
// A settled marker is not required (a restore can still be in flight when its event lands); an
// UNREADABLE fileId answer (429/5xx) is "unknown": the trigger defers the decision to a re-check
// instead of reverting a legitimate restore, and enforces if it is still unknown after a few tries.
// Any mismatch or definite non-answer is enforced (fail closed).
export const RESTORE_MARK_TTL_MS = 10 * 60 * 1000;
export const RESTORE_SETTLE_WAIT_MS = 2000; // one re-read when the event arrives before the settle
const markKey = (attachmentId, accountId) => `panel-restore-${String(attachmentId).replace(/^att/, "")}-${accountId}`;

/** Before the restore's PUT. `fileId`: the file (bytes) the trashed attachment holds now. */
export async function markPanelRestore(attachmentId, accountId, fromVersion, fileId) {
  await setWithTtl(markKey(attachmentId, accountId), { by: accountId, fromVersion, fileId: fileId || null, at: Date.now(), settled: false }, RESTORE_MARK_TTL_MS);
}
/** After the restore: settled when it went through, gone when it did not. Only this person's marker. */
export async function settlePanelRestore(attachmentId, accountId, restored) {
  const key = markKey(attachmentId, accountId);
  if (!restored) { await kvs.delete(key); return; }
  const cur = await kvs.get(key);
  if (cur && cur.by === accountId) await setWithTtl(key, { ...cur, settled: true }, RESTORE_MARK_TTL_MS);
}
export const readPanelRestoreMark = (attachmentId, accountId) => kvs.get(markKey(attachmentId, accountId));

/** PURE. Do the marker's person, age and version cover this update? (`now`: when the event happened.) */
export function isPanelRestoreWrite(mark, accountId, version, now = Date.now()) {
  if (!mark || !accountId || mark.by !== accountId) return false;
  if (!Number.isFinite(Number(version)) || !Number.isFinite(Number(mark.fromVersion))) return false;
  if (!(now - Number(mark.at) <= RESTORE_MARK_TTL_MS) || now < Number(mark.at) - 60_000) return false;
  return Number(version) === Number(mark.fromVersion);
}

/**
 * Judge one update event against a marker: "restore" (leave it alone), "edit" (enforce) or
 * "unknown" (a fileId answer was busy: decide later). `readFileId(v)` → { fileId, busy }.
 */
export async function judgeRestoreWrite(mark, accountId, version, { sealedFileId = null, sealedVersion = null, readFileId, now = Date.now() } = {}) {
  if (typeof readFileId !== "function" || !isPanelRestoreWrite(mark, accountId, version, now) || !mark.fileId) return "edit";
  const ev = await readFileId(version);
  if (ev.busy) return "unknown";
  if (!ev.fileId || ev.fileId !== String(mark.fileId)) return "edit";
  let sealed = sealedFileId ? String(sealedFileId) : null;
  if (!sealed) {
    if (!Number.isFinite(Number(sealedVersion))) return "edit"; // nothing to compare the bytes with
    const s = await readFileId(Number(sealedVersion));
    if (s.busy) return "unknown";
    if (!s.fileId) return "edit";
    sealed = s.fileId;
  }
  return ev.fileId === sealed ? "restore" : "edit";
}

/** The trigger's question for one update event: { verdict, mark }. Any error is "edit". */
export async function panelRestoreVerdict(attachmentId, accountId, version, { sealedFileId = null, sealedVersion = null, readFileId, waitMs = RESTORE_SETTLE_WAIT_MS } = {}) {
  if (!accountId) return { verdict: "edit", mark: null };
  try {
    let mark = await readPanelRestoreMark(attachmentId, accountId);
    if (mark && mark.settled !== true) { // in flight: give the restore a moment to finish, then judge either way
      await new Promise((r) => setTimeout(r, waitMs));
      mark = (await readPanelRestoreMark(attachmentId, accountId)) || null;
    }
    return { verdict: await judgeRestoreWrite(mark, accountId, version, { sealedFileId, sealedVersion, readFileId }), mark };
  } catch (e) {
    console.warn(`[TRASH] restore marker for ${attachmentId} unreadable — enforcing:`, errText(e));
    return { verdict: "edit", mark: null };
  }
}

// Deferred decisions: one row per file, person and version, re-judged by the five-minute sweep.
export const RESTORE_RECHECK_PREFIX = "restore-recheck-";
export const RESTORE_RECHECK_MAX_TRIES = 6; // about half an hour of "busy" before the change is enforced
const RECHECK_TTL_MS = 24 * 3600 * 1000;
export async function deferRestoreCheck({ attachmentId, accountId, version, pageId, mark, tries = 0, eventAt = Date.now() }) {
  const key = `${RESTORE_RECHECK_PREFIX}${String(attachmentId).replace(/^att/, "")}-${accountId}-${version}`;
  await setWithTtl(key, { attachmentId: String(attachmentId), accountId, version, pageId: pageId || null, mark, tries, eventAt }, RECHECK_TTL_MS);
  return key;
}

/**
 * Permanently delete a TRASHED attachment with the caller's own rights. The caller has already
 * checked the file is in the trash. Returns { ok:true, gone? } or { ok:false, result } where
 * `result` is the resolver answer to return (nothing was changed).
 *
 * A 404 to the caller is either "you cannot see this" or "someone purged it a moment ago": the
 * app's two-witness check decides — proven gone means the records may go; anything else is
 * Confluence refusing this person.
 */
export async function purgeTrashedAsCaller(attachmentId, { pageId = null, containerType = null, containerCurrent = false, settleMs = 1500 } = {}) {
  let res;
  try {
    res = await userConfluence(route`/wiki/api/v2/attachments/${attachmentId}?purge=true`, { method: "DELETE" });
  } catch (err) {
    if (isNeedsConsent(err)) throw err; // Forge shows the consent prompt
    console.warn(`[TRASH] purge of ${attachmentId} could not run as the caller:`, errText(err));
    return { ok: false, result: trashRefusal("purge", "no-user") };
  }
  const kind = classifyTrashAnswer(res.status);
  if (kind === "ok") return { ok: true };
  // Gone only when proven (attachmentPurgeVerdict: the app's read still 404s AND the container's own
  // list answers without it, or the container itself is proven gone); one 404 is never proof. Still
  // there → Confluence refused this person; unsettled (a 429 on the way) → try again, nothing changed.
  if (kind === "missing") {
    const v = await attachmentPurgeVerdict(attachmentId, settleMs, { pageId, containerType, containerCurrent });
    if (v.verdict === "gone") return { ok: true, gone: true };
    if (v.verdict === "unknown") return { ok: false, result: unprovenGone(v) };
  }
  console.warn(`[TRASH] purge of ${attachmentId} refused for the caller: ${res.status}`);
  return { ok: false, result: trashRefusal("purge", kind, res.status) };
}
