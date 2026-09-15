/*
 * Config API — the STATIC web trigger handler (manifest `config-api`, docs/REST-CONFIG-API.md).
 *
 * A static trigger can only answer with one of the manifest's fixed outputs (202 accepted,
 * 400 invalid, 401 unauthorized, 403 forbidden, 409 conflict, 429 busy, 405 not-allowed) and
 * never a body of its own — that is what keeps "Runs on Atlassian". So the handler's whole job
 * is: authenticate, admit, store the job, push it to `config-api-queue`. Everything the caller
 * wants to READ (the receipt, the effective config) is on Confluence properties and in KVS.
 *
 * REQUEST ACCESS ON A STATIC TRIGGER — settled empirically on dev, 2026-09-15 (see the
 * [CONFIG-API] request-shape log line and the design doc's "Static trigger request access"
 * section): the handler receives `method`, `headers`, `queryParameters` and `body` exactly as
 * a dynamic trigger does; only the RESPONSE is fixed. `?op=` and `?idempotency-key=` stay as
 * query alternatives; the body is the only carrier of the bundle (the `?b=` base64 fallback
 * was removed once the body was proven to arrive — red-team LOW, 2026-09-15).
 *
 * The job id IS the caller's Idempotency-Key (400 without it), scoped to the token
 * (`api-job-<tokenId>:<key>`): static outputs cannot carry a per-request datum, so the caller
 * must already hold the id it will poll for.
 *
 * ORDER OF THE CHECKS (red-team, 2026-09-15): method → token → the minter is still a site
 * admin (a demoted minter's tokens stop working entirely, whoami included) → op / key shape →
 * admission (409 / 429, and a settled key is a no-op) → ROLE (403) → bundle validation (400).
 * The role is decided before validation so a valid-but-underprivileged token cannot use 400 as
 * a validation oracle for config it may not submit.
 */
import { kvs } from "@forge/kvs";
import { Queue } from "@forge/events";
import { randomBytes } from "crypto";
import { setWithTtl } from "../../shared/kvs-ttl.js";
import { isOperatorSiteAdmin } from "../../shared/steward-checks.js";
import { authenticate, extractBearer, tokenRoleAtLeast, tokenRole } from "./tokens.js";
import { validateBundle, bundleRoleFloor } from "./bundle.js";
import { OUTPUT, OPS, JOB_TTL_MS, decideAdmission, opRoleFloor, jobId, jobKvsKey, activeJobKvsKey, isActiveJob, validIdempotencyKey } from "./admission.js";
import { staleFailureReceipt } from "./pure.js";

export const CONFIG_API_QUEUE_KEY = "config-api-queue";
const ACTIVE_TTL_MS = 15 * 60000; // a stuck consumer must not wedge a token forever

const out = (outputKey) => ({ outputKey });
const first = (v) => (Array.isArray(v) ? v[0] : v);
const header = (req, name) => {
  const h = (req && req.headers) || {};
  return first(h[name] ?? h[name.toLowerCase()] ?? h[name.toUpperCase()] ?? h[name.split("-").map((s) => s[0].toUpperCase() + s.slice(1)).join("-")]);
};
const query = (req, name) => first(req && req.queryParameters && (req.queryParameters[name] ?? req.queryParameters[name.toLowerCase()]));

function readBody(req) {
  // The body only (string, or base64 when the platform flags it).
  let raw = req && req.body;
  if (raw && typeof raw === "string" && req.isBase64Encoded) raw = Buffer.from(raw, "base64").toString("utf8");
  if (raw == null || raw === "") return { raw: "", bundle: null, bytes: 0 };
  if (typeof raw !== "string") return { raw: "", bundle: raw, bytes: Buffer.byteLength(JSON.stringify(raw), "utf8") };
  try { return { raw, bundle: JSON.parse(raw), bytes: Buffer.byteLength(raw, "utf8") }; }
  catch { return { raw, bundle: undefined, bytes: Buffer.byteLength(raw, "utf8") }; }
}

async function writeRefusedReceipt(id, key, token, op, reason) {
  // A valid token gets a receipt even when refused, so the reason is readable somewhere.
  try {
    await setWithTtl(jobKvsKey(id), {
      id: key, status: "refused", op, submittedBy: token.createdBy || null, tokenId: token.id, role: tokenRole(token),
      submittedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), reason,
      summary: { applied: 0, refused: 0, failed: 0 }, results: [],
    }, JOB_TTL_MS);
  } catch (e) { console.warn("[CONFIG-API] refused receipt write failed:", e?.message || e); }
}

export async function configApiTrigger(req) {
  try {
    if (String(req?.method || "").toUpperCase() !== "POST") return out(OUTPUT.notAllowed);

    const token = await authenticate(extractBearer(req));
    if (!token) return out(OUTPUT.unauthorized);
    // The token acts as its minter; a minter who is no longer a site admin lends nothing.
    if (!(await isOperatorSiteAdmin(token.createdBy))) {
      console.warn(`[CONFIG-API] token ${token.id} refused: minter ${token.createdBy} is not a site admin`);
      return out(OUTPUT.unauthorized);
    }

    const op = String(query(req, "op") || "bundle").toLowerCase();
    const key = header(req, "idempotency-key") || query(req, "idempotency-key") || query(req, "key") || null;
    if (!OPS.includes(op)) return out(OUTPUT.invalid);
    if (!validIdempotencyKey(key)) return out(OUTPUT.invalid);
    const id = jobId(token.id, key);
    const rowKey = jobKvsKey(id);

    // Admission — the pure decision over what KVS says right now.
    const existingJob = await kvs.get(rowKey);
    let runningForToken = false;
    const activeKey = activeJobKvsKey(token.id);
    const active = await kvs.get(activeKey);
    if (active?.jobId && active.jobId !== key) {
      const other = await kvs.get(jobKvsKey(jobId(token.id, active.jobId)));
      runningForToken = isActiveJob(other);
      if (!runningForToken) await kvs.delete(activeKey).catch(() => {});
    }
    const decision = decideAdmission({ existingJob, runningForToken, key });
    if (decision.outputKey !== OUTPUT.accepted) return out(decision.outputKey);
    if (decision.noop) {
      if (decision.stale) {
        // A wedged `running` row: settle it as failed so the receipt says why, and free the slot.
        await setWithTtl(rowKey, staleFailureReceipt(existingJob, new Date().toISOString()), JOB_TTL_MS).catch(() => {});
        if (active?.jobId === key) await kvs.delete(activeKey).catch(() => {});
      }
      return out(OUTPUT.accepted); // settled job with this key: the receipt already exists
    }

    // Role floor BEFORE validation: the parsed shape decides the floor; its validity is judged
    // only for a token that may submit it at all.
    const { bundle, bytes } = readBody(req);
    const floor = opRoleFloor(op, bundleRoleFloor(bundle));
    if (!tokenRoleAtLeast(token, floor)) {
      await writeRefusedReceipt(id, key, token, op, `Token role "${tokenRole(token)}" may not submit this (needs ${floor})`);
      return out(OUTPUT.forbidden);
    }

    let validation = { ok: true, errors: [], plan: [] };
    if (op !== "whoami") {
      if (bundle === undefined || bundle === null) return out(OUTPUT.invalid);
      validation = validateBundle(bundle, { rawBytes: bytes });
      if (!validation.ok) { console.warn(`[CONFIG-API] invalid bundle key=${key}: ${validation.errors.slice(0, 5).join(" | ")}`); return out(OUTPUT.invalid); }
    }

    // Write only if absent: two submissions racing on one key each re-read and keep only the
    // one whose nonce landed; the loser answers 409 (it never queued anything).
    const nonce = randomBytes(8).toString("hex");
    const job = {
      id: key, nonce, status: "queued", op,
      submittedBy: token.createdBy || null, tokenId: token.id, tokenName: token.name || null, role: tokenRole(token),
      bundle: op === "whoami" ? null : bundle,
      submittedAt: new Date().toISOString(),
    };
    const present = await kvs.get(rowKey);
    if (isActiveJob(present)) return out(OUTPUT.conflict);
    await setWithTtl(rowKey, job, JOB_TTL_MS);
    const landed = await kvs.get(rowKey);
    if (!landed || landed.nonce !== nonce) { console.warn(`[CONFIG-API] lost the write race on key=${key}`); return out(OUTPUT.conflict); }
    await setWithTtl(activeKey, { jobId: key, at: job.submittedAt }, ACTIVE_TTL_MS);
    // it17: build the Queue at push time, never at module load.
    await new Queue({ key: CONFIG_API_QUEUE_KEY }).push({ body: { jobId: id } });
    console.log(`[CONFIG-API] queued job=${id} op=${op} token=${token.id} steps=${validation.plan.length}`);
    return out(OUTPUT.accepted);
  } catch (e) {
    console.error("[CONFIG-API] trigger error:", e);
    return out(OUTPUT.invalid);
  }
}
