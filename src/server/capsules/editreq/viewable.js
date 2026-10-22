/*
 * Sentinel Vault - which edit requests waiting on a person are theirs to see.
 * Copyright (c) 2025-2026 LeanZero SRL.
 */
import { viewStatus } from "../workflow/approvals.js";

/**
 * 8.16 / SVT-147: THE rule for which requests waiting on the caller are listed AND counted. My work's
 * request lists name the file or section, the proposer and the page; a PROPOSAL row (addressed to the
 * page's approvers) is kept only for someone who can view its page, asked once per page. The seal
 * owner's own requests are unchanged. My work's total and the page banner's count run the same rule
 * (before 8.17 they read the raw index and could be higher than these lists).
 * `knownReadable`: page ids the caller is already proven to view (the banner's own page). A view check
 * Confluence could not answer (429/5xx) leaves the row out and counts it in `stats.unverified` (the
 * approvals rule, workflow/approvals.js waitingApprovals). `memo`: one Map per invocation, shared with
 * the other arms (pageId → view status).
 */
export async function viewableProposals(rows, accountId, { knownReadable = [], stats = null, memo = null } = {}) {
  const proven = new Set((knownReadable || []).map(String));
  const seen = memo || new Map();
  const out = [];
  for (const r of rows || []) {
    if (!r?.proposal) { out.push(r); continue; }
    const pageId = String(r.contentId || r.pageId || "");
    if (!pageId) continue;
    if (proven.has(pageId)) { out.push(r); continue; }
    if (!seen.has(pageId)) seen.set(pageId, viewStatus(accountId, pageId));
    const st = await seen.get(pageId);
    if (st.unknown) { if (stats) stats.unverified = (stats.unverified || 0) + 1; continue; }
    if (st.allowed) out.push(r);
  }
  return out;
}
