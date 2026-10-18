/**
 * B2 (2026-10-18): the I/O half of baseline.js — describe an Approved page's baseline for the banner,
 * the details modal and the API. A record written before baselineSource existed gets one read of the
 * page's own activity rows (the revert row filed at the baseline version says what was restored), so a
 * page reverted on 8.10.0 or earlier still says "a copy of approved v7" instead of naming nobody.
 * The caller has already checked that the viewer may read the page.
 */
import { describeBaseline, legacySourceFrom } from "./baseline.js";
import { readActivity, activityPagePrefix } from "../../infra/activity-log.js";

/**
 * Review round 2 (D1): a record whose baseline moved before 8.11.0 has no baselineSource, so a revert on
 * 8.11.0 would take the old copy (v9) for the approved content (v7) and lose the history for good. Every
 * writer that reads the source (Pass 0, the sweep's revert, restampApprovedVersion) seeds it first from
 * the page's activity rows — one read, once per legacy page (the next re-stamp stores it). Returns the
 * record itself when there is nothing to seed; never throws.
 */
export async function withLegacySource(pageId, record) {
  if (!record || record.baselineSource?.kind || !describeBaseline(record).moved) return record;
  try {
    const { entries } = await readActivity(activityPagePrefix(String(pageId)), { limit: 100 });
    const src = legacySourceFrom(record, entries);
    return src ? { ...record, baselineSource: src } : record;
  } catch (e) {
    console.warn(`[WORKFLOW] legacy baseline history for ${pageId}:`, e?.message || e);
    return record;
  }
}

export async function baselineFor(pageId, record) {
  const plain = describeBaseline(record);
  if (!plain.moved || record?.baselineSource?.kind) return plain;
  try {
    const { entries } = await readActivity(activityPagePrefix(String(pageId)), { limit: 100 });
    return describeBaseline(record, { activity: entries });
  } catch (e) {
    console.warn(`[WORKFLOW] baseline history for ${pageId}:`, e?.message || e);
    return plain;
  }
}
