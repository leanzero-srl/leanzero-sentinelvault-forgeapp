/*
 * Sentinel Vault - which edit requests waiting on a person are theirs to see.
 * Copyright (c) 2025-2026 LeanZero SRL.
 */
import { canReadPage } from "../../shared/content-access.js";

/**
 * 8.16 / SVT-147: THE rule for which requests waiting on the caller are listed AND counted. My work's
 * request lists name the file or section, the proposer and the page; a PROPOSAL row (addressed to the
 * page's approvers) is kept only for someone who can view its page, asked once per page. The seal
 * owner's own requests are unchanged. My work's total and the page banner's count run the same rule
 * (before 8.17 they read the raw index and could be higher than these lists).
 * `knownReadable`: page ids the caller is already proven to view (the banner's own page).
 */
export async function viewableProposals(rows, accountId, { knownReadable = [] } = {}) {
  const proven = new Set((knownReadable || []).map(String));
  const seen = new Map();
  const out = [];
  for (const r of rows || []) {
    if (!r?.proposal) { out.push(r); continue; }
    const pageId = String(r.contentId || r.pageId || "");
    if (!pageId) continue;
    if (proven.has(pageId)) { out.push(r); continue; }
    if (!seen.has(pageId)) seen.set(pageId, canReadPage(accountId, pageId));
    if (await seen.get(pageId)) out.push(r);
  }
  return out;
}
