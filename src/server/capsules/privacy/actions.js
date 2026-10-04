/*
 * Privacy capsule — resolvers (Site settings → Privacy and retention). Site admin only, the same
 * floor as Backup and restore: the sweep deletes history across every space.
 *
 *   privacy-status    {}   → { status, retentionDays }   the last sweep's summary
 *   privacy-run-now   {}   → { queued: true }            queue a sweep now
 */
import { kvs } from "@forge/kvs";
import { isOperatorSiteAdmin } from "../../shared/steward-checks.js";
import { readEffective } from "../policies/settings-schema.js";
import { STATUS_KEY, queuePrivacySweep } from "./worker.js";
import { effectiveRetentionDays } from "./retention.js";

const DENY = { success: false, reason: "Not authorized — site admin access required." };
const siteAdmin = async (req) => { const a = req?.context?.accountId; return !!a && (await isOperatorSiteAdmin(a)); };
const fail = (e) => ({ success: false, reason: String(e?.message || e).slice(0, 300) });

const status = async (req) => {
  if (!(await siteAdmin(req))) return DENY;
  try {
    const [st, settings] = await Promise.all([kvs.get(STATUS_KEY), kvs.get("admin-settings-global")]);
    return { success: true, status: st || {}, retentionDays: effectiveRetentionDays(
      readEffective("historyRetentionEnabled", settings?.historyRetentionEnabled),
      readEffective("historyRetentionDays", settings?.historyRetentionDays)) };
  } catch (e) { return fail(e); }
};

const runNow = async (req) => {
  if (!(await siteAdmin(req))) return DENY;
  try { await queuePrivacySweep("manual"); return { success: true, queued: true }; } catch (e) { return fail(e); }
};

export const actions = [
  ["privacy-status", status],
  ["privacy-run-now", runNow],
];
