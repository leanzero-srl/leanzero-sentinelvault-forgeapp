import { asApp, route } from "@forge/api";

/**
 * PURE. The name a trashed file comes back under when a NEWER file with its name is already on
 * the page (Confluence refuses the restore with 409 "newer Content exists … with title X" —
 * tester 2026-09-30). "Test sentinel.docx" → "Test sentinel (restored).docx", then "(restored 2)".
 */
export function restoredTitle(title, n = 1) {
  const t = String(title || "Unknown");
  const dot = t.lastIndexOf(".");
  const hasExt = dot > 0 && dot >= t.length - 8;
  const base = hasExt ? t.slice(0, dot) : t;
  const ext = hasExt ? t.slice(dot) : "";
  return `${base} (restored${n > 1 ? ` ${n}` : ""})${ext}`;
}
/** PURE. Is this restore refusal "a newer file already holds the name"? */
export const isNameTakenConflict = (status, text) => status === 409 && /newer Content exists/i.test(String(text || ""));

/**
 * PUT a trashed attachment back to "current"; when a newer file holds its name, retry under
 * restoredTitle() (up to 3 names). Returns { ok, status, title, renamed, text }.
 */
export async function putAttachmentCurrent(pageId, attachmentId, title, version) {
  const putRoute = route`/wiki/rest/api/content/${pageId}/child/attachment/${attachmentId}`;
  const put = (status, name, ver) => asApp().requestConfluence(putRoute, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: attachmentId, type: "attachment", status, title: name, version: { number: ver + 1 } }),
  });
  const res = await put("current", title, version);
  if (res.ok) return { ok: true, status: res.status, title, renamed: false };
  const text = await res.text().catch(() => "");
  if (!isNameTakenConflict(res.status, text)) return { ok: false, status: res.status, text, title, renamed: false };
  // Confluence checks the TRASHED title before applying one sent with the restore, so the file is
  // renamed while still in the trash (its own version), then restored under the new name.
  let ver = version;
  let last = { status: res.status, text };
  for (let n = 1; n <= 3; n++) {
    const name = restoredTitle(title, n);
    const ren = await put("trashed", name, ver);
    if (!ren.ok) {
      last = { status: ren.status, text: await ren.text().catch(() => "") };
      console.warn(`[RESTORE] rename-in-trash to "${name}" refused: ${last.status} — ${String(last.text).slice(0, 300)}`);
      continue;
    }
    ver += 1;
    const back = await put("current", name, ver);
    if (back.ok) return { ok: true, status: back.status, title: name, renamed: true };
    last = { status: back.status, text: await back.text().catch(() => "") };
    console.warn(`[RESTORE] restore as "${name}" refused: ${last.status} — ${String(last.text).slice(0, 300)}`);
    if (!isNameTakenConflict(last.status, last.text)) break;
  }
  return { ok: false, status: last.status, text: last.text, title, renamed: false };
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
      if (r.renamed) console.warn(`[ATT-STATUS] restored ${attachmentId} as "${r.title}" — a newer file holds "${effTitle}"`);
      return { ok: true, probe, renamedTo: r.renamed ? r.title : null };
    }
    lastStatus = r.status;
    if ((r.status === 429 || r.status >= 500) && attempt < 2) {
      await new Promise((res) => setTimeout(res, Math.pow(2, attempt) * 500));
      continue;
    }
    console.error(`[ATT-STATUS] restore PUT failed for ${attachmentId}: ${r.status} — ${String(r.text || "").slice(0, 200)}`);
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
export async function confirmAttachmentPurged(attachmentId, settleMs = 1500, { pageId = null } = {}) {
  await new Promise((r) => setTimeout(r, settleMs));
  const again = await probeAttachmentStatus(attachmentId);
  if (again.status !== "deleted") return false;
  if (!pageId) {
    console.warn(`[ATT-STATUS] purge of ${attachmentId} not corroborated — no page id to list; keeping the seal`);
    return false;
  }
  try {
    let res = await asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}/attachments?status=current&status=trashed&status=archived&limit=250`);
    for (let i = 0; i < 20; i++) {
      if (!res.ok) return false; // the page's list must be readable (positive control on the same object)
      const body = await res.json();
      if ((body?.results || []).some((a) => sameAttachmentId(a?.id, attachmentId))) return false; // still there
      const next = body?._links?.next;
      const cursor = next ? new URL(next, "https://x.invalid").searchParams.get("cursor") : null;
      if (!cursor) return true;
      res = await asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}/attachments?status=current&status=trashed&status=archived&limit=250&cursor=${cursor}`);
    }
    return false; // a list that never ended proves nothing
  } catch (e) {
    console.error(`[ATT-STATUS] purge corroboration errored for ${attachmentId} — treating as NOT confirmed:`, e);
    return false;
  }
}
