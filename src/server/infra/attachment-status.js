import { asApp, route } from "@forge/api";

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
      const res = await asApp().requestConfluence(
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
      console.error(`[ATT-STATUS] probe failed for ${attachmentId}:`, e);
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
  const effTitle = title || probe.title || "Unknown";
  if (!version || !effPageId) {
    console.error(`[ATT-STATUS] cannot restore ${attachmentId} — missing ${!version ? "version" : "pageId"} (event and probe both empty)`);
    return { ok: false, status: "missing-inputs", probe };
  }

  // v1 attachment PUT back to "current" (extracted verbatim from the trash
  // handler, audit C4: bounded 429/5xx retry — a transient blip must not be
  // treated as unrecoverable).
  const restoreRoute = route`/wiki/rest/api/content/${effPageId}/child/attachment/${attachmentId}`;
  const restoreBody = JSON.stringify({
    id: attachmentId, type: "attachment", status: "current", title: effTitle,
    version: { number: version + 1 },
  });
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await asApp().requestConfluence(restoreRoute, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: restoreBody,
    });
    if (res.ok) return { ok: true, probe };
    lastStatus = res.status;
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 500));
      continue;
    }
    console.error(`[ATT-STATUS] restore PUT failed for ${attachmentId}: ${res.status} — ${(await res.text()).slice(0, 200)}`);
    break;
  }
  return { ok: false, status: lastStatus || "exhausted", probe };
}
