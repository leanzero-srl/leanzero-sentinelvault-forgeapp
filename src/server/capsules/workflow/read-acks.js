// B2: read confirmations — "I have read version N of this page".
//
// Comala sells this as a separate app; here it rides the workflow: while a page sits in an
// ENFORCE state (Approved) a space can require an audience (users + groups) to confirm they
// have read the approved version. One record per reader:
//   read-ack-{pageId}-{accountId}  { version, at, name }   (no TTL — evidence)
// A confirmation is FOR a version: when the approved baseline advances the old ack no longer
// counts, and the reader is asked again. Every confirmation also lands on the activity log
// (workflow.read-confirmed), so the history survives an overwrite of the per-reader record.
import { asApp, route } from "@forge/api";
import { kvs } from "@forge/kvs";
import { extractApprovalConfig, fetchGroupMembers } from "./approvals.js";
import { recordActivity } from "../../infra/activity-log.js";

export const ackKey = (pageId, accountId) => `read-ack-${pageId}-${accountId}`;

// PURE. The version a confirmation must name for the page as it stands now.
export function requiredVersion(record) {
  if (!record?.enforce) return null;
  return typeof record.approvedVersion === "number" && record.approvedVersion >= 1 ? record.approvedVersion : null;
}

// PURE. Does this ack count for the page as it stands now? A page approved without a pinned
// version (approvedVersion null) accepts any ack made after it entered the state.
export function ackCounts(ack, record) {
  if (!ack || !record?.enforce) return false;
  const want = requiredVersion(record);
  if (want != null) return ack.version === want;
  const at = ack.at ? Date.parse(ack.at) : NaN;
  const since = record.approvedAt ? Date.parse(record.approvedAt) : NaN;
  return Number.isFinite(at) && Number.isFinite(since) && at >= since;
}

// PURE. Sanitize the space setting: { enabled, audience: [{type,id,name}] }.
export function sanitizeReadConfirmation(input) {
  if (!input || typeof input !== "object") return null;
  const audience = Array.isArray(input.audience)
    ? input.audience.filter((a) => a && a.id).map((a) => ({ type: a.type === "group" ? "group" : "user", id: String(a.id).slice(0, 200), name: typeof a.name === "string" ? a.name.slice(0, 120) : null })).slice(0, 50)
    : [];
  return { enabled: input.enabled === true, audience };
}

// PURE. Is the setting live for a record in an enforce state?
export function readConfirmationRequired(settings, record) {
  return !!(settings?.readConfirmation?.enabled && record?.enforce);
}

// The audience as account ids (users + expanded groups) plus the names we already know.
export async function resolveAudience(settings) {
  const cfg = extractApprovalConfig({ approvers: settings?.readConfirmation?.audience || [] });
  if (!cfg) return { ids: [], names: new Map(), unresolved: false };
  const names = new Map();
  for (const a of settings.readConfirmation.audience) if (a.type !== "group" && a.name) names.set(a.id, a.name);
  const ids = [...cfg.userIds];
  let unresolved = false;
  for (const g of cfg.groups) {
    const r = await fetchGroupMembers(g);
    ids.push(...r.ids);
    if (!r.ok) unresolved = true;
  }
  return { ids: [...new Set(ids)], names, unresolved };
}

async function displayName(accountId) {
  try {
    const res = await asApp().requestConfluence(route`/wiki/rest/api/user?accountId=${accountId}`);
    if (res.ok) return (await res.json())?.displayName || null;
  } catch (_) { /* best-effort */ }
  return null;
}

// Write the caller's confirmation for the page as it stands. The caller must be able to read
// the page (the resolver checks); the record must be in an enforce state.
export async function confirmRead({ pageId, accountId, name, record }) {
  if (!pageId || !accountId) return { success: false, reason: "Missing page or account" };
  if (!record?.enforce) return { success: false, reason: "This page is not in an approved state — there is nothing to confirm yet" };
  const version = requiredVersion(record);
  const ack = { version, at: new Date().toISOString(), name: name || null, pageId, accountId };
  await kvs.set(ackKey(pageId, accountId), ack);
  await recordActivity({
    type: "workflow.read-confirmed",
    pageId,
    spaceKey: record.spaceKey || null,
    actor: { accountId, name: name || null },
    target: { kind: "page", id: pageId, name: null },
    details: { version, stateId: record.stateId },
    version,
  });
  return { success: true, ack };
}

// Status for one reader + the audience counts. Names are NOT included (that is the report).
export async function readStatus({ pageId, accountId, record, settings }) {
  const required = readConfirmationRequired(settings, record);
  if (!required) return { required: false };
  const version = requiredVersion(record);
  const mine = accountId ? await kvs.get(ackKey(pageId, accountId)) : null;
  const audience = await resolveAudience(settings);
  let acked = 0;
  for (const id of audience.ids) {
    const a = await kvs.get(ackKey(pageId, id));
    if (ackCounts(a, record)) acked++;
  }
  return {
    required: true,
    version,
    myAck: ackCounts(mine, record) ? { version: mine.version, at: mine.at } : null,
    inAudience: !!accountId && audience.ids.includes(accountId),
    audienceCount: audience.ids.length,
    ackedCount: acked,
    unresolved: audience.unresolved,
  };
}

// Who has and has not confirmed — steward only (the resolver gates it).
export async function readReport({ pageId, record, settings }) {
  const status = await readStatus({ pageId, accountId: null, record, settings });
  if (!status.required) return { required: false, readers: [] };
  const audience = await resolveAudience(settings);
  const readers = [];
  for (const id of audience.ids) {
    const a = await kvs.get(ackKey(pageId, id));
    const counts = ackCounts(a, record);
    let name = audience.names.get(id) || (a?.name) || null;
    if (!name) name = await displayName(id);
    readers.push({ accountId: id, name: name || id, confirmed: counts, version: counts ? a.version : null, at: counts ? a.at : null, staleVersion: !counts && a ? a.version : null });
  }
  readers.sort((x, y) => Number(x.confirmed) - Number(y.confirmed) || String(x.name).localeCompare(String(y.name)));
  return { ...status, readers };
}
