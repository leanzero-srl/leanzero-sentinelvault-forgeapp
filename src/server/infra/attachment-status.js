import { route } from "@forge/api";
import { appConfluence, userConfluence } from "../shared/confluence-call.js";
import { errText } from "../shared/action-log.js";

/** PURE. Is this restore refusal "a newer file already holds the name"? */
export const isNameTakenConflict = (status, text) => status === 409 && /newer Content exists/i.test(String(text || ""));

/**
 * PUT a trashed attachment back to "current". Returns { ok, status, text, nameTaken }.
 *
 * Measured on wolfaenpak (2026-10-21): the restore keeps the attachment's version number and its
 * fileId; a trashed attachment cannot be updated at all (renaming it in the trash answers 404
 * "Trashed content cannot be updated"). So when a newer file holds its name, Confluence refuses the
 * restore with 409 and there is nothing to retry: `nameTaken` says so and the caller tells the person.
 *
 * `as`: "user" when a PERSON asked for the restore (the panel's Restore): the PUT runs with their own
 * rights, so Confluence's trash rights decide (shared/trash-rights.js). "app" only for a live seal
 * putting its own file back (the seal's enforcement in triggers.js). A thrown asUser call (no user
 * context, or no consent yet) propagates to the caller.
 */
export async function putAttachmentCurrent(pageId, attachmentId, title, version, { as = "app" } = {}) {
  const conf = as === "user" ? userConfluence : appConfluence;
  const res = await conf(route`/wiki/rest/api/content/${pageId}/child/attachment/${attachmentId}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: attachmentId, type: "attachment", status: "current", title, version: { number: version + 1 } }),
  });
  if (res.ok) return { ok: true, status: res.status, title, nameTaken: false };
  const text = await res.text().catch(() => "");
  return { ok: false, status: res.status, text, title, nameTaken: isNameTakenConflict(res.status, text) };
}

/** PURE. The fileId of one attachment version from its v2 GET answer: { fileId, busy }. */
export function fileIdAnswer(status, body) {
  if (status === 429 || status >= 500) return { fileId: null, busy: true };
  if (status >= 200 && status < 300) return { fileId: body?.fileId ? String(body.fileId) : null, busy: false };
  return { fileId: null, busy: false };
}
/** The fileId of version `version` of an attachment, read with the app's identity: { fileId, busy }. */
export async function fileIdAtVersion(attachmentId, version) {
  try {
    const r = await appConfluence(route`/wiki/api/v2/attachments/${attachmentId}?version=${version}`);
    return fileIdAnswer(r.status, r.ok ? await r.json().catch(() => null) : null);
  } catch (_) {
    return { fileId: null, busy: true }; // a thrown read is not an answer
  }
}

/**
 * Attachment existence/status probing + trash restore, shared by the artifact
 * trash handler and the page-body media-restore pass (incident 2026-07-22: the
 * two layers were disconnected — the page pass re-spliced ADF nodes pointing at
 * trashed attachments while the trash handler silently skipped on a version-less
 * event payload).
 *
 * Decision table (probed live against Confluence Cloud, see
 * state/INCIDENT-2026-07-22.md §7):
 *   v2 GET /attachments/{id} → 200 status "current"  ⇒ current
 *   v2 GET                   → 200 status "trashed"  ⇒ trashed (payload carries
 *                              pageId, version.number, title, fileId — every
 *                              input the restore PUT needs)
 *   v2 GET                   → 404                   ⇒ deleted (purged — unrecoverable)
 *   429/5xx after retry      ⇒ unknown (callers fail toward their pre-probe behavior)
 */

/** Pure classifier for a v2 attachment GET outcome — unit-testable. */
export function classifyAttachmentResponse(httpStatus, body) {
  if (httpStatus === 404) {
    return { status: "deleted", version: null, title: null, pageId: null, fileId: null };
  }
  if (httpStatus >= 200 && httpStatus < 300 && body) {
    return {
      status: body.status === "trashed" ? "trashed" : "current",
      version: body.version?.number ?? null,
      title: body.title ?? null,
      pageId: body.pageId ?? null,
      fileId: body.fileId ?? null,
    };
  }
  return { status: "unknown", version: null, title: null, pageId: null, fileId: null, httpStatus };
}

/**
 * Pure decision for what the media-restore pass should do with a violated seal
 * given the attachment's probed status — unit-testable (the Fix-1 decision table).
 *   splice          — re-insert the ADF node (attachment renders)
 *   restore-splice  — un-trash the attachment FIRST, then splice
 *   cleanup         — attachment permanently gone: no dead node; purge seal state
 */
export function decideMediaRestoreAction(probeStatus) {
  switch (probeStatus) {
    case "current": return "splice";
    case "trashed": return "restore-splice";
    case "deleted": return "cleanup";
    default: return "splice"; // unknown — fail toward the pre-probe behavior
  }
}

export async function probeAttachmentStatus(attachmentId) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await appConfluence(
        route`/wiki/api/v2/attachments/${attachmentId}`,
      );
      if (res.ok) {
        return classifyAttachmentResponse(res.status, await res.json());
      }
      if (res.status === 404) return classifyAttachmentResponse(404, null);
      if ((res.status === 429 || res.status >= 500) && attempt < 1) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      return classifyAttachmentResponse(res.status, null);
    } catch (e) {
      if (attempt < 1) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      console.error(`[ATT-STATUS] probe failed for ${attachmentId}:`, errText(e));
      return { status: "unknown", version: null, title: null, pageId: null, fileId: null };
    }
  }
  return { status: "unknown", version: null, title: null, pageId: null, fileId: null };
}

/**
 * Restore a trashed attachment to "current". Probe-first so concurrent callers
 * (trash handler + media pass can both fire for one delete) are idempotent —
 * a second caller sees "current" and no-ops instead of double-bumping/409ing.
 *
 * Returns { ok:true, already?:true, probe } | { ok:false, status, probe? }.
 */
export async function restoreAttachmentFromTrash({ attachmentId, pageId, title, currentVersion }) {
  const probe = await probeAttachmentStatus(attachmentId);
  if (probe.status === "current") return { ok: true, already: true, probe };
  if (probe.status === "deleted") return { ok: false, status: "deleted", probe };

  const version = currentVersion ?? probe.version;
  const effPageId = pageId || probe.pageId;
  // Vet F6: the probe's title is the LIVE truth — an owner may have legitimately renamed the
  // file since sealing; restoring the seal-era name back would be a silent side-effect rename.
  const effTitle = probe.title || title || "Unknown";
  if (!version || !effPageId) {
    console.error(`[ATT-STATUS] cannot restore ${attachmentId} — missing ${!version ? "version" : "pageId"} (event and probe both empty)`);
    return { ok: false, status: "missing-inputs", probe };
  }

  // v1 attachment PUT back to "current" (extracted verbatim from the trash
  // handler, audit C4: bounded 429/5xx retry — a transient blip must not be
  // treated as unrecoverable).
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await putAttachmentCurrent(effPageId, attachmentId, effTitle, version);
    if (r.ok) {
      return { ok: true, probe };
    }
    lastStatus = r.status;
    if ((r.status === 429 || r.status >= 500) && attempt < 2) {
      await new Promise((res) => setTimeout(res, Math.pow(2, attempt) * 500));
      continue;
    }
    console.error(`[ATT-STATUS] restore PUT failed for ${attachmentId}: ${r.status}`);
    break;
  }
  // Adversarial-vet F1: one UI delete fires trashed:attachment AND updated:page — the trash
  // handler and the media pass can race this restore. The loser's PUT 409s (or 4xx-es); before
  // reporting failure, re-probe: if a concurrent caller already restored it, that IS success.
  const recheck = await probeAttachmentStatus(attachmentId);
  if (recheck.status === "current") return { ok: true, already: true, probe: recheck };
  return { ok: false, status: recheck.status === "deleted" ? "deleted" : (lastStatus || "exhausted"), probe: recheck };
}

/** PURE. Attachment ids compare without the "att" prefix (seal records and v2 bodies differ). */
export const sameAttachmentId = (a, b) => String(a ?? "").replace(/^att/, "") === String(b ?? "").replace(/^att/, "") && String(a ?? "") !== "";

/**
 * Corroborate a permanent deletion before any DESTRUCTIVE action (adversarial-vet F1/lens-3:
 * a single transient 404 — trash-transaction propagation, container visibility — must never
 * purge a seal). Two witnesses after a settle delay: the v2 GET must STILL 404, AND the page's
 * own attachment list (current + trashed, a different v2 surface) must answer 200 and not carry
 * the id. Only the INFERRED path needs this — the real deleted:attachment event is authoritative
 * and keeps cleaning up immediately.
 *
 * 2026-10-04: the second witness used to be the v1 GET /content/{id}?status=trashed. Measured live
 * (dev hook endpointProbe) it answers 410 Gone for a current, a trashed AND a purged attachment,
 * so a purge was never confirmed and the inferred cleanup never ran. The page list was measured
 * on the same object: found while current, found while trashed, absent once purged. No page id,
 * or a list that does not answer 200, means the negative is UNPROVEN → false (keep the seal).
 * Hunt F8: settle default is 1.5s — these sleeps serialize per candidate inside a 25s budget.
 */
export async function confirmAttachmentPurged(attachmentId, settleMs = 1500, { pageId = null, containerType = null, containerCurrent = false } = {}) {
  return (await attachmentPurgeVerdict(attachmentId, settleMs, { pageId, containerType, containerCurrent })).verdict === "gone";
}

/** PURE. Which container collections to ask, from what the record or the attachment names. */
export function containerCollections(containerType) {
  if (containerType === "blogpost" || containerType === "blogposts") return ["blogposts"];
  if (containerType === "page" || containerType === "pages") return ["pages"];
  return ["pages", "blogposts"]; // a seal record keeps only the id: try both
}
const isBusy = (status) => status === 429 || status >= 500;

/**
 * The verdict behind confirmAttachmentPurged: { verdict: "gone" | "present" | "unknown", rateLimited }.
 *
 * A 404 is never proof on its own: v2 answers 404 for "not found" AND for "you may not see it". "gone"
 * needs a POSITIVE witness on the file's own container, read with the app's identity:
 *   1. after the settle, the attachment's own v2 GET still 404s (current/trashed → present);
 *   2. its container's attachment list (the page's, or the blog post's: v2 has one per collection)
 *      answers 200 and does not carry the id → gone;
 *   3. otherwise, the container's own GET (every status) answers 200 with status "deleted" → gone.
 * The witness must be the file's CURRENT container (`containerCurrent`): one read from the
 * attachment's own body, from a Confluence event about it, or a tracking row of a file deleted from
 * that page. A container known only from a seal record may be one the file has since left (moved to
 * a page the app cannot see): its list proves nothing, "unknown".
 * Everything else is "unknown" and keeps the records: a container that answers 404 everywhere (a
 * purged page does, and so does a page hidden from the app; `why: "container-unseen"`), one that
 * exists while its list will not answer, a list that never ends. A 429/5xx anywhere is "unknown" with
 * rateLimited set (the caller says "try again").
 */
export async function attachmentPurgeVerdict(attachmentId, settleMs = 1500, { pageId = null, containerType = null, containerCurrent = false } = {}) {
  const sleep = () => new Promise((r) => setTimeout(r, settleMs));
  const unknown = (rateLimited = false, why = null) => ({ verdict: "unknown", rateLimited, why });
  await sleep();
  const again = await probeAttachmentStatus(attachmentId);
  if (again.status === "current" || again.status === "trashed") return { verdict: "present", rateLimited: false };
  if (again.status !== "deleted") return unknown(isBusy(Number(again.httpStatus)));
  if (!pageId) {
    console.warn(`[ATT-STATUS] purge of ${attachmentId} not corroborated — no container id to list; keeping the seal`);
    return unknown();
  }
  try {
    const colls = containerCollections(containerType);
    for (const coll of colls) {
      const base = coll === "blogposts" ? "blogposts" : "pages";
      let res = base === "blogposts"
        ? await appConfluence(route`/wiki/api/v2/blogposts/${pageId}/attachments?status=current&status=trashed&status=archived&limit=250`)
        : await appConfluence(route`/wiki/api/v2/pages/${pageId}/attachments?status=current&status=trashed&status=archived&limit=250`);
      if (res.status === 404) continue; // not this collection, or the container is gone or hidden: step 3
      for (let i = 0; i < 20; i++) {
        if (!res.ok) return unknown(isBusy(res.status)); // the list must be readable (positive control on the same object)
        const body = await res.json();
        if ((body?.results || []).some((a) => sameAttachmentId(a?.id, attachmentId))) return { verdict: "present", rateLimited: false };
        const next = body?._links?.next;
        const cursor = next ? new URL(next, "https://x.invalid").searchParams.get("cursor") : null;
        if (!cursor) return containerCurrent ? { verdict: "gone", rateLimited: false } : unknown(false, "container-not-current");
        res = base === "blogposts"
          ? await appConfluence(route`/wiki/api/v2/blogposts/${pageId}/attachments?status=current&status=trashed&status=archived&limit=250&cursor=${cursor}`)
          : await appConfluence(route`/wiki/api/v2/pages/${pageId}/attachments?status=current&status=trashed&status=archived&limit=250&cursor=${cursor}`);
      }
      return unknown(); // a list that never ended proves nothing
    }
    // Every collection's list answered 404: only the container's own word that it is deleted proves it.
    for (const coll of colls) {
      // Every status, trashed included: a page in the trash still holds its files (not gone).
      const res = coll === "blogposts"
        ? await appConfluence(route`/wiki/api/v2/blogposts/${pageId}?status=current&status=trashed&status=deleted&status=historical`)
        : await appConfluence(route`/wiki/api/v2/pages/${pageId}?status=current&status=archived&status=trashed&status=deleted&status=historical`);
      if (res.status === 404) continue; // not found OR not visible: never proof
      if (res.ok) {
        const body = await res.json().catch(() => null);
        if (body?.status !== "deleted") return unknown();
        return containerCurrent ? { verdict: "gone", rateLimited: false } : unknown(false, "container-not-current");
      }
      return unknown(isBusy(res.status));
    }
    return unknown(false, "container-unseen");
  } catch (e) {
    console.error(`[ATT-STATUS] purge corroboration errored for ${attachmentId} — treating as NOT confirmed:`, errText(e));
    return unknown();
  }
}
