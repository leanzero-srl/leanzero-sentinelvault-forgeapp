/*
 * Who may change an Approved page, and which of its versions count (2026-10-21).
 *
 * ONE home for the rule every enforcement path applies to an author: an APPROVER (in the record's
 * snapshot AND in the space's live approver list — the snapshot is trusted alone only while the live
 * group expansion failed) or a STEWARD of the record's spaces (the page's space now and, if it moved,
 * the record's: content-access.js recordAuthority). The trigger's probe, privilege.js, Pass 0's
 * revert target and the hourly sweep all use it.
 *
 * And the rule for a RUN of versions, which the baseline re-stamp needs: the enforcement baseline
 * (record.approvedVersion) decides what is never judged again — a version at or below it "predates
 * the approval", a live version equal to it has "nothing to enforce". So it may only move to a
 * version that was sanctioned (never past the last one):
 *   - a version an approver or steward saved counts (they saved it on top of what came before, so it
 *     is their content — the rule Pass 0's revert target and the sweep already applied);
 *   - a version the APP saved counts only when the version it was made from counts: the app's writes
 *     (a section seal's wrap, a seal restore, an adoption) are made from the live body and carry
 *     whatever it held;
 *   - anyone else, an unlisted version (more than the 50 newest back) or a missing author: no.
 * "Could not tell" (Confluence 429, an unreadable list, a steward check left open) is never a yes:
 * the callers then move nothing this run.
 */
import { route } from "@forge/api";
import { appConfluence, isRateLimited } from "../../shared/confluence-call.js";
import { accountStewardStatusAsApp } from "../../shared/steward-checks.js";
import { recordAuthority, stewardOfSpacesStatus } from "../../shared/content-access.js";
import { resolveAppAccountId } from "../../shared/app-account.js";
import { hookVersionAuthor } from "../../shared/hook-author.js";
import { getSpaceWorkflowSettings, fetchLivePageVersion } from "./logic.js";
import { resolveApproverIds, currentApproverStatus } from "./approvals.js";

/**
 * The privileged-author test for one Approved record. `spaces` is the record's steward spaces
 * (recordAuthority().spaces), or null when where the page is could not be read: then only the
 * approver arm can answer and everyone else is "unknown". One steward check per account.
 * @returns {Promise<{ settings: object, isApprover: (id: string) => boolean, judge: (id: string) => Promise<{ privileged: boolean, unknown: boolean }> }>}
 */
export async function approvedPageJudge(record, { spaces = null, settings = null } = {}) {
  const s = settings || await getSpaceWorkflowSettings(record?.spaceKey);
  const liveSpec = await resolveApproverIds(s?.approval);
  const snapshot = Array.isArray(record?.approvers) ? record.approvers : [];
  // approvals.js currentApproverStatus is the ONE approver rule; an edit trusts the snapshot on "unknown".
  const isApprover = (id) => !!id && currentApproverStatus(snapshot, id, liveSpec) !== "no";
  const stewardOf = new Map();
  return {
    settings: s,
    isApprover,
    async judge(id) {
      if (!id) return { privileged: false, unknown: false };
      if (isApprover(id)) return { privileged: true, unknown: false };
      if (!Array.isArray(spaces)) return { privileged: false, unknown: true };
      if (!stewardOf.has(id)) stewardOf.set(id, stewardOfSpacesStatus(accountStewardStatusAsApp, id, spaces));
      const st = await stewardOf.get(id);
      return { privileged: !!st?.steward, unknown: !!st?.unknown };
    },
  };
}

/**
 * Judge every version in (from, to] of the page (from = the baseline, sanctioned by definition).
 * @returns {Promise<{ status: "ok"|"limited"|"error"|"unknown", byVersion: Map<number, boolean>, authors: Map<number, string|null> }>}
 *   status "limited": Confluence answered 429 for the list; "error": any other failure to read it;
 *   "unknown": a steward check was left open (429). byVersion is filled only for "ok".
 */
export async function judgeVersionsAfter(pageId, from, to, { judge, appAccountId }) {
  const byVersion = new Map();
  const authors = new Map();
  if (!(typeof from === "number" && typeof to === "number") || to <= from) return { status: "ok", byVersion, authors };
  let versions;
  try {
    const res = await appConfluence(route`/wiki/api/v2/pages/${pageId}/versions?limit=50`);
    if (isRateLimited(res)) return { status: "limited", byVersion, authors };
    if (!res.ok) return { status: "error", byVersion, authors };
    versions = (await res.json())?.results || [];
  } catch (_) { return { status: "error", byVersion, authors }; }
  for (const v of versions) if (typeof v?.number === "number") authors.set(v.number, hookVersionAuthor(pageId, v.number) || (v.authorId ?? null)); // hook-author.js: dev seam, null outside it
  let prev = true; // `from`, the baseline itself
  for (let n = from + 1; n <= to; n++) {
    let ok = false;
    if (authors.has(n)) {
      const author = authors.get(n);
      if (appAccountId && author === appAccountId) ok = prev; // the app's write is as good as what it was made from
      else {
        const j = await judge(author);
        if (j.unknown) return { status: "unknown", byVersion: new Map(), authors };
        ok = j.privileged;
      }
    }
    byVersion.set(n, ok);
    prev = ok;
  }
  return { status: "ok", byVersion, authors };
}

/** PURE. The highest sanctioned n in (from, below), or `from` when there is none. */
export function highestSanctionedBelow(byVersion, from, below) {
  let best = from;
  for (let k = from + 1; k < below; k++) if (byVersion.get(k) === true) best = k;
  return best;
}

/** PURE. The author of the first version in (from, to] that does not count (for the notices), or null. */
export function firstUnsanctionedAuthor(walk, from, to, appAccountId = null) {
  for (let k = from + 1; k <= to; k++) {
    if (walk.byVersion.get(k) !== true) {
      const a = walk.authors.get(k) ?? null;
      return a && a !== appAccountId ? a : null;
    }
  }
  return null;
}

/**
 * How far the baseline of an enforced record may move forward right now: the newest version since
 * the baseline that counts (the live version when it counts; the baseline itself when none does).
 * A version after it that does not count stays to be judged. `known: false` = could not tell: move nothing.
 * `opts.live`, `opts.spaces` (recordAuthority().spaces, or null = unknown) and `opts.appAccountId`
 * are looked up when not given.
 * @returns {Promise<{ known: boolean, version: number|null, live: number|null, walk?: object }>}
 */
export async function sanctionedRestampTarget(pageId, record, opts = {}) {
  const av = record?.approvedVersion;
  if (!(typeof av === "number" && av >= 1)) return { known: false, version: null, live: null };
  const live = opts.live ?? (await fetchLivePageVersion(pageId));
  if (!(typeof live === "number")) return { known: false, version: null, live: null };
  if (live <= av) return { known: true, version: av, live };
  let spaces = opts.spaces;
  if (spaces === undefined) {
    const auth = await recordAuthority({ contentId: pageId, storedKey: record.spaceKey || null });
    spaces = auth.known ? auth.spaces : null;
  }
  const appAccountId = opts.appAccountId ?? (await resolveAppAccountId());
  const { judge } = opts.judge ? { judge: opts.judge } : await approvedPageJudge(record, { spaces });
  const walk = await judgeVersionsAfter(pageId, av, live, { judge, appAccountId });
  if (walk.status !== "ok") return { known: false, version: null, live };
  return { known: true, version: highestSanctionedBelow(walk.byVersion, av, live + 1), live, walk };
}

/**
 * Before a seal is made on an Approved page: the seal records the LIVE body (a section's snapshot, a
 * file's on-page layout), so the seal waits until the live version counts. Returns a refusal
 * `{ success: false, reason }`, or null when the page is clean.
 *
 * The refusal says "try again in a few minutes" ONLY where something will deal with that version: the
 * page event, the five-minute guard or the hourly sweep reverting it (to a readable approved version)
 * or moving the page back for review. Where nothing will — Approved-page protection switched off, or
 * an approved version that cannot be read — waiting would never end, so the reason names what blocks
 * the seal and the way out. A seal only ever records content that counts; the way out is one step the
 * sealer can always take (the sealer is an approver or space admin, and a version they publish counts —
 * it accepts the page's current content).
 */
export async function refuseSealOverPendingChange(pageId, record) {
  if (!(typeof record?.approvedVersion === "number")) return null;
  const busy = { success: false, busy: true, reason: "Could not check this page's latest changes right now. Nothing was changed. Try again in a minute." };
  let t;
  try { t = await sanctionedRestampTarget(pageId, record); } catch (_) { t = { known: false }; }
  if (!t.known) return busy;
  if (!(t.version < t.live)) return null;
  let handled;
  try { handled = await pendingChangeWillBeHandled(pageId, record, t); } catch (_) { handled = "unknown"; }
  if (handled === "unknown") return busy;
  if (handled === "protection-off") return { success: false, reason: "Changes by someone outside the approvers are not undone while “Protect Sealed Attachments in Page Body” is off. Publish the page yourself to accept them, then seal." };
  if (handled === "baseline-unreadable") return { success: false, reason: "Changes by someone outside the approvers cannot be undone: the approved version could not be read. Publish the page yourself to accept them, then seal." };
  return { success: false, reason: "This page has a change that is not approved yet. Try again in a few minutes, once Sentinel Vault has dealt with it." };
}

/**
 * Will an enforcement pass deal with the pending version? "yes", "protection-off", "baseline-unreadable"
 * or "unknown" (Confluence 429: passing). The same plan the page event and the sweep follow
 * (enforce-rules.js): a demote that this workflow can make needs no approved body; a revert (chosen,
 * a moved page, or a demote it cannot make) needs the version it would restore to be readable and
 * not empty (Pass 0 and the sweep never blank a page, so they stand down on it forever).
 */
async function pendingChangeWillBeHandled(pageId, record, t) {
  const { contentProtectionEnabled, enforcementPlan } = await import("./enforce-rules.js");
  const { kvs } = await import("@forge/kvs");
  if (!contentProtectionEnabled(await kvs.get("admin-settings-global"))) return "protection-off";
  const { resolveWorkflowDef } = await import("./logic.js");
  const auth = await recordAuthority({ contentId: pageId, storedKey: record.spaceKey || null });
  if (!auth.known) return "unknown";
  const def = await resolveWorkflowDef(record.spaceKey, record.workflowId);
  const settings = await getSpaceWorkflowSettings(record.spaceKey);
  const plan = enforcementPlan(settings, { moved: auth.moved, def, stateId: record.stateId });
  if (plan.mode === "demote") return "yes";
  const target = highestSanctionedBelow(t.walk.byVersion, record.approvedVersion, t.live);
  const res = await appConfluence(route`/wiki/api/v2/pages/${pageId}?body-format=atlas_doc_format&version=${target}`);
  if (isRateLimited(res)) return "unknown";
  if (!res.ok) return "baseline-unreadable";
  let content = null;
  try { content = JSON.parse((await res.json())?.body?.atlas_doc_format?.value || "null")?.content; } catch (_) { content = null; }
  return Array.isArray(content) && content.length ? "yes" : "baseline-unreadable";
}
