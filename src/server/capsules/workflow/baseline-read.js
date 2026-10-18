/**
 * B2 (2026-10-18): the I/O half of baseline.js — describe an Approved page's baseline for the banner,
 * the details modal and the API. A record written before baselineSource existed gets one read of the
 * page's own activity rows (the revert row filed at the baseline version says what was restored), so a
 * page reverted on 8.10.0 or earlier still says "a copy of approved v7" instead of naming nobody.
 * The caller has already checked that the viewer may read the page.
 */
import { describeBaseline } from "./baseline.js";
import { readActivity, activityPagePrefix } from "../../infra/activity-log.js";

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
