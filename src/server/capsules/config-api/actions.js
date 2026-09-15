/*
 * Config API capsule — resolvers (Site settings → API access; docs/REST-CONFIG-API.md).
 *
 *   list-api-tokens      {}               → { success, tokens:[publicRow], url }   site admin
 *   create-api-token     { name, role }   → { success, token, row }                 site admin (plaintext once)
 *   revoke-api-token     { id }           → { success, revoked }                    site admin
 *   list-api-jobs        { limit }        → { success, jobs:[receipt] }             site admin, newest first
 *   get-api-job          { id }           → { success, job }                        site admin
 *   export-space-config  { spaceKey }     → { success, config }                     steward of that space
 *   export-site-config   {}               → { success, config }                     site admin
 *
 * Authorization (CLAUDE.md): tokens act as the account that minted them, so minting is a
 * site-admin act and nothing here takes an id from the payload that reaches content.
 */
import { kvs, WhereConditions } from "@forge/kvs";
import { webTrigger } from "@forge/api";
import { isOperatorSiteAdmin, isOperatorSteward } from "../../shared/steward-checks.js";
import { listApiTokens, createApiToken, revokeApiToken } from "./tokens.js";
import { exportSpaceConfig, exportSiteConfig } from "./export.js";

export const WEBTRIGGER_KEY = "config-api";
export const WEBTRIGGER_URL_KVS_KEY = "webtrigger-url:config-api";
const DENY = { success: false, reason: "Not authorized — site admin access required." };
const JOB_PREFIX = "api-job-";
const MAX_JOBS = 50;

const siteAdmin = async (req) => { const a = req?.context?.accountId; return !!a && (await isOperatorSiteAdmin(a)); };

/** The endpoint URL, resolved once and cached in KVS (the installation-specific v2 URL never changes). */
export async function resolveConfigApiUrl() {
  const cached = await kvs.get(WEBTRIGGER_URL_KVS_KEY);
  if (cached?.url) return cached.url;
  try {
    const url = await webTrigger.getUrl(WEBTRIGGER_KEY);
    if (url) { await kvs.set(WEBTRIGGER_URL_KVS_KEY, { url, at: new Date().toISOString() }); return url; }
  } catch (e) { console.warn("[CONFIG-API] webTrigger.getUrl failed:", e?.message || e); }
  return null;
}

const listTokens = async (req) => {
  if (!(await siteAdmin(req))) return DENY;
  const [tokens, url] = await Promise.all([listApiTokens(), resolveConfigApiUrl()]);
  return { success: true, tokens, url };
};

const createToken = async (req) => {
  if (!(await siteAdmin(req))) return DENY;
  try {
    const { token, row } = await createApiToken({ name: req.payload?.name, role: req.payload?.role, accountId: req.context.accountId });
    return { success: true, token, row };
  } catch (e) { return { success: false, reason: e?.message || "Could not create the token" }; }
};

const revokeToken = async (req) => {
  if (!(await siteAdmin(req))) return DENY;
  const id = String(req.payload?.id || "");
  if (!id) return { success: false, reason: "id required" };
  const { revoked } = await revokeApiToken(id);
  return { success: true, revoked };
};

/** Strip the stored bundle from a queued/running row — the list is a summary surface. */
const receiptRow = (v) => { if (!v || typeof v !== "object") return v; const { bundle, ...rest } = v; return bundle ? { ...rest, hasBundle: true } : rest; };

const listJobs = async (req) => {
  if (!(await siteAdmin(req))) return DENY;
  const limit = Math.max(1, Math.min(MAX_JOBS, Number(req.payload?.limit) || MAX_JOBS));
  const jobs = [];
  // Cursor-paginated: a single getMany() silently drops everything past the first page.
  let q = kvs.query().where("key", WhereConditions.beginsWith(JOB_PREFIX)).limit(100);
  for (let i = 0; i < 20; i++) {
    const { results, nextCursor } = await q.getMany();
    for (const { key, value } of results || []) {
      if (key.startsWith("api-job-active:")) continue;
      jobs.push(receiptRow(value));
    }
    if (!nextCursor) break;
    q = kvs.query().where("key", WhereConditions.beginsWith(JOB_PREFIX)).limit(100).cursor(nextCursor);
  }
  jobs.sort((a, b) => String(b?.submittedAt || "").localeCompare(String(a?.submittedAt || "")));
  return { success: true, jobs: jobs.slice(0, limit) };
};

const getJob = async (req) => {
  if (!(await siteAdmin(req))) return DENY;
  const id = String(req.payload?.id || "").replace(/[^A-Za-z0-9:._-]/g, "");
  if (!id) return { success: false, reason: "id required" };
  const job = await kvs.get(`${JOB_PREFIX}${id}`);
  return job ? { success: true, job } : { success: false, reason: "No such job" };
};

const exportSpace = async (req) => {
  const accountId = req?.context?.accountId;
  const spaceKey = String(req.payload?.spaceKey || "");
  if (!accountId || !spaceKey || !(await isOperatorSteward(accountId, spaceKey))) return { success: false, reason: "Not authorized — space admin access required." };
  try { return { success: true, config: await exportSpaceConfig(spaceKey, accountId) }; }
  catch (e) { return { success: false, reason: e?.message || "Export failed" }; }
};

const exportSite = async (req) => {
  if (!(await siteAdmin(req))) return DENY;
  try { return { success: true, config: await exportSiteConfig(req.context.accountId) }; }
  catch (e) { return { success: false, reason: e?.message || "Export failed" }; }
};

export const actions = [
  ["list-api-tokens", listTokens],
  ["create-api-token", createToken],
  ["revoke-api-token", revokeToken],
  ["list-api-jobs", listJobs],
  ["get-api-job", getJob],
  ["export-space-config", exportSpace],
  ["export-site-config", exportSite],
];
