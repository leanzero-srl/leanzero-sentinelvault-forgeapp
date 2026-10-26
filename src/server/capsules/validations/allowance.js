/*
 * The SITE-WIDE monthly AI allowance (owner decision 2026-10-26). Forge LLM tokens are billed to
 * LeanZero, so every site gets a monthly allowance of one worst-case review per licensed user:
 *
 *   allowance = max(licensed users, 10) x 30,480 micro-dollars        ($0.0305 per user per month)
 *
 * Worst-case review = 10,000 input + 4,096 output tokens at the Haiku 4.5 price on Forge LLM
 * ($1 per 1M input, $5 per 1M output: cost in micro-dollars = in x 1 + out x 5). Only Haiku is ever
 * called (forge-llm.js isForgeLlmModelAllowed), so the price holds for every call.
 *
 * The meter is ONE row per site per UTC month, `ai-allowance-YYYYMM`, changed ONLY under the KVS lock
 * `ai-allowance-lock` (shared/kvs-lock.js). Right before each model call the consumer RESERVES the
 * worst case for that prompt; after the call it SETTLES to the tokens the model reported (a failed
 * call reports zeros). A crashed run leaves its reservation counted; a reservation older than
 * RESERVATION_MAX_MS is charged as spent at its reserved size (fail-safe, and it keeps the row small).
 * A busy lock or a failed KVS read REFUSES the review ("busy"): never a review the meter cannot see.
 * A new month is a new row: rollover needs no job.
 *
 * The user count is read AS THE APP, cached daily (users never supply the number, the client never
 * sends it): first Confluence's licence userCount (unofficial; it answers apps 401 on every site
 * measured, 2026-10-26), then the members of the site's DEFAULT product-access group
 * `confluence-users-<site>` (or the legacy `confluence-users`), people only (accountType atlassian),
 * through read:confluence-groups. The group is a LOWER bound: a site can grant Confluence through
 * other groups. So an ACTIVE PAID licence never gets less than PAID_FLOOR_USERS (250) unless the
 * licence count itself answered: a paying site is never cut to a handful of reviews by a count the
 * app could not read. Worst case of that floor: 250 x $0.03048 = $7.62 per paid site per month.
 * The group scan is BOUNDED per call (COUNT_BUDGET_MS) and RESUMES from its place in the count row,
 * pages on the server's next link (never on a short page), and takes the legacy `confluence-users`
 * only when no `confluence-users-*` group exists (a multi-site org or a renamed site: it may be
 * another site's). A failed read is remembered and retried after COUNT_RETRY_MS.
 * A failed read uses the last good count up to 35 days old, then the fallback (paid: the floor;
 * otherwise 10). A trial or an inactive licence gets the 10-user allowance (a trial is not
 * licence-funded), and so does a production install with no licence object.
 *
 * An admin may LOWER the allowance (the site config's ai.monthlyAllowanceMicro), never raise
 * it: the effective limit is min(stored, default) on every read. The SAVE stores what the admin
 * asked (never clamped against a default that a count outage may have shrunk for a moment).
 */
import { kvs as forgeKvs } from "@forge/kvs";
import { route, getAppContext } from "@forge/api";
import { makeLocks } from "../../shared/kvs-lock.js";
import { appConfluence } from "../../shared/confluence-call.js";
import { errText, emit } from "../../shared/action-log.js";

export const IN_MICRO_PER_TOKEN = 1;
export const OUT_MICRO_PER_TOKEN = 5;
export const MAX_OUTPUT_TOKENS = 4096;
export const OUTPUT_RESERVE_MICRO = MAX_OUTPUT_TOKENS * OUT_MICRO_PER_TOKEN; // 20,480
export const PER_USER_MICRO = 10000 * IN_MICRO_PER_TOKEN + OUTPUT_RESERVE_MICRO; // 30,480
export const FREE_TIER_USERS = 10;
export const PAID_FLOOR_USERS = 250;
export const MAX_GROUP_PAGES = 500;   // pages of groups per scan (100,000 groups at 200 a page)
export const MAX_MEMBER_PAGES = 1000; // pages of members per scan (a bigger group counts as what was read)
export const COUNT_TTL_MS = 24 * 3600 * 1000;
// A failed read is remembered: the next read waits this long, so an outage does not re-list every
// group on every view, precheck and reserve.
export const COUNT_RETRY_MS = 3600 * 1000;
// Work per call on the group scan. A resolver has 25 s in all and the scan runs inline on the
// precheck and settings paths (a 429 retry on one page can add more); the scan stops at this budget, keeps
// its place in the count row and the next call resumes it.
export const COUNT_BUDGET_MS = 4000;
// One caller scans at a time: a scanning caller marks the row with scanUntil; the others serve the
// last good count (or the count so far) instead of reading the same pages again.
export const SCAN_LEASE_MS = COUNT_BUDGET_MS + 21000;
// A half-done scan older than this starts again (its pages may have moved).
export const SCAN_MAX_AGE_MS = 24 * 3600 * 1000;
export const COUNT_STALE_MAX_MS = 35 * 24 * 3600 * 1000;
export const RESERVATION_MAX_MS = 20 * 60 * 1000; // longer than any consumer (120 s) can run
export const LOCK_KEY = "ai-allowance-lock";
export const ROW_PREFIX = "ai-allowance-";
export const COUNT_KEY = "ai-licensed-users";
const LOCK_HOLD_MS = 15000;
// The wait must OUTLAST the hold (kvs-lock.js: a dead holder's row is taken over only after the
// hold), else a burst behind one slow or dead holder is refused "busy" and its settles are dropped
// (each dropped settle is later charged at the full reservation). Both calls run in the 120 s
// ai-validation consumer: 2 x 20 s of waiting plus the model call fits.
const LOCK_WAIT_MS = LOCK_HOLD_MS + 5000;
const ROW_TTL_MS = 120 * 24 * 3600 * 1000;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** PURE. "YYYYMM" of the UTC month containing `ms`. */
export function monthKeyOf(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
/** PURE. The first instant of the UTC month after the one containing `ms`. */
export function nextMonthStart(ms) {
  const d = new Date(ms);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}
export const rowKey = (month) => `${ROW_PREFIX}${month}`;
/** PURE. "October 2026" for "202610". */
export function monthLabel(month) {
  const m = String(month || "");
  return `${MONTHS[Number(m.slice(4, 6)) - 1] || "this month"} ${m.slice(0, 4)}`.trim();
}
/** PURE. "1 November 2026". */
export function resetLabel(ms) {
  const d = nextMonthStart(ms);
  return `1 ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
/** PURE. What the model reported, in micro-dollars. */
export function costMicro(usage) {
  const i = Math.max(0, Number(usage?.inputTokens) || 0);
  const o = Math.max(0, Number(usage?.outputTokens) || 0);
  return i * IN_MICRO_PER_TOKEN + o * OUT_MICRO_PER_TOKEN;
}
/**
 * PURE. An upper bound on the input tokens of `text`. A byte-level tokenizer never makes more tokens
 * than UTF-8 bytes, so every non-ASCII character counts at its full UTF-8 size (CJK = 3: a Chinese
 * or Japanese page is ~1-2 tokens a character, far above the old chars/3). ASCII counts 1 token per
 * 2 characters (English and markup run ~3-4). A number is read as that many ASCII characters.
 */
export function estimateInputTokens(text) {
  if (typeof text === "number") return Math.ceil(Math.max(0, text) / 2);
  let ascii = 0, other = 0;
  for (const ch of String(text || "")) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) ascii++;
    else other += cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return Math.ceil(ascii / 2) + other;
}
/** PURE. The worst case for one review of `text` (the prompt) in micro-dollars. */
export function estimateMicro(text) {
  return estimateInputTokens(text) * IN_MICRO_PER_TOKEN + OUTPUT_RESERVE_MICRO;
}
/** PURE. The default allowance for `users` licensed users (10-user floor). */
export function defaultAllowanceMicro(users) {
  const n = Math.max(FREE_TIER_USERS, Math.floor(Number(users) || 0));
  return n * PER_USER_MICRO;
}
/** PURE. An admin's stored value only ever LOWERS the default. */
export function effectiveLimitMicro(defaultMicro, stored) {
  const s = Math.floor(Number(stored));
  return Number.isFinite(s) && s > 0 ? Math.min(s, defaultMicro) : defaultMicro;
}
/**
 * PURE. Does the licence force the 10-user allowance? `ctx` is getAppContext().
 * A trial (isEvaluation) or an inactive licence: yes. Production with no licence object: yes.
 * Development / staging (no licence object): no, the count applies.
 */
export function licenceForcesFreeTier(ctx) {
  const lic = ctx?.license;
  if (lic) {
    if (lic.isEvaluation === true) return "trial";
    // runtime.d.ts carries both `active` and `isActive`; either one false means no paid licence.
    if (lic.active === false || lic.isActive === false) return "unlicensed";
    return null;
  }
  return String(ctx?.environmentType || "").toUpperCase() === "PRODUCTION" ? "unlicensed" : null;
}
/** PURE. A remaining amount below one review's output reserve cannot run a review. */
export const isExhausted = (limit, spent, reserved) => limit - spent - reserved <= OUTPUT_RESERVE_MICRO;

/**
 * PURE. The CARD's view of "used up" (never the precheck's: see precheck): the arithmetic, OR a review was refused this month and
 * what is left is still below the smallest refused one. Raising the limit (or a new month) clears it.
 */
export function viewExhausted(limit, row) {
  const remaining = limit - (row?.spentMicro || 0) - (row?.reservedMicro || 0);
  if (isExhausted(limit, row?.spentMicro || 0, row?.reservedMicro || 0)) return true;
  const need = Number(row?.refusedNeedMicro);
  return Boolean(row?.reachedAt) && need > 0 && remaining < need;
}
const emptyRow = () => ({ spentMicro: 0, reservedMicro: 0, runs: 0, reservations: {}, reachedAt: null });

/** PURE. Charge reservations older than RESERVATION_MAX_MS as spent (a run that died). Mutates `row`. */
export function expireReservations(row, nowMs) {
  for (const [id, r] of Object.entries(row.reservations || {})) {
    const at = Date.parse(r?.at || "");
    if (!Number.isFinite(at) || nowMs - at >= RESERVATION_MAX_MS) {
      row.spentMicro += Number(r?.micro) || 0;
      delete row.reservations[id];
    }
  }
  row.reservedMicro = Object.values(row.reservations || {}).reduce((s, r) => s + (Number(r?.micro) || 0), 0);
  return row;
}

export function allowanceMessage(nowMs) {
  return `This site has used its AI review allowance for ${monthLabel(monthKeyOf(nowMs))}. AI review starts again on ${resetLabel(nowMs)}. Other Sentinel Vault features keep working.`;
}
export const ALLOWANCE_BUSY_REASON = "AI review is busy right now. Please try again in a minute.";
export const COUNT_FALLBACK_NOTE = "Could not read the licensed user count; using the 10-user allowance.";
export const PAID_FLOOR_NOTE = "Could not read the full licensed user count; a paid licence gets at least the 250-user allowance.";

const logCountError = (status, step) => emit({ via: "job", action: "ai.licensed-user-count", surface: "ai-allowance", outcome: "error", status: Number(status) || 0, step });

/** PURE. The site's default Confluence group names, most specific first, from the wiki base URL. */
export function defaultGroupNames(baseUrl) {
  let host = "";
  try { host = new URL(String(baseUrl || "")).hostname.toLowerCase(); } catch (_) { host = ""; }
  const m = /^([a-z0-9][a-z0-9-]*)\.(atlassian\.net|jira\.com|jira-dev\.com)$/.exec(host);
  return m ? [`confluence-users-${m[1]}`, "confluence-users"] : ["confluence-users"];
}

/** PURE. People in one members page (app and customer accounts are not licensed users). */
export const peopleIn = (results) => (Array.isArray(results) ? results : [])
  .filter((u) => u?.accountType === "atlassian" && (u?.accountStatus == null || u.accountStatus === "active")).length;

async function readLicenceCount() {
  // Unofficial endpoint (no documented count API, CONFCLOUD-82766). A refusal is LOGGED (action log:
  // status only, no site or user data).
  const res = await appConfluence(route`/wiki/rest/license/1.0/license/userCount`);
  if (!res?.ok) { logCountError(res?.status, "user-count"); return null; }
  const body = await res.json().catch(() => null);
  const n = Number(body?.count);
  if (!(Number.isFinite(n) && n > 0)) { logCountError(res.status || 200, "user-count-body"); return null; }
  return Math.floor(n);
}

/**
 * PURE. Where the next page starts, or null when there is none. The server's own `_links.next` is
 * the only "more" signal: a page shorter than the asked limit is NOT the end (a server that caps the
 * limit lower would otherwise stop after one page and undercount). The step is what was returned.
 */
export function nextStart(body, start) {
  const r = Array.isArray(body?.results) ? body.results : [];
  if (!body?._links?.next || r.length === 0) return null;
  const m = /[?&]start=(\d+)/.exec(String(body._links.next));
  const n = m ? Number(m[1]) : start + r.length;
  return n > start ? n : start + r.length;
}

/**
 * PURE. Which group is the site's default one, once the group list is read. The site-named group
 * (`confluence-users-<site>`, from THIS site's own base URL) when it exists. The legacy
 * `confluence-users` only when NO `confluence-users-*` group exists at all: in an org with several
 * sites (or a renamed site, whose own group keeps the old name) the legacy group may be another
 * site's, so then nothing is picked and the caller uses its fallback.
 */
export function pickDefaultGroup({ exactId, legacyId, anySuffixed }) {
  if (exactId) return exactId;
  if (legacyId && !anySuffixed) return legacyId;
  return null;
}

/**
 * People in the site's default product-access group, read as the app (read:confluence-groups),
 * BOUNDED: it stops when `now() >= deadline` and returns its place, so a caller can resume it.
 * Returns { status:"done", count } | { status:"partial", state } | { status:"fail" }.
 * `state` (from an earlier partial) resumes the scan; it carries no names, only ids and counters.
 */
export async function readDefaultGroupCount(call = appConfluence, { deadline = Infinity, now = () => Date.now(), state = null } = {}) {
  const s = state && typeof state === "object" ? { ...state } : { phase: "groups", next: 0, pages: 0, startedAt: now() };
  const fail = (status, step) => { logCountError(status, step); return { status: "fail" }; };
  while (s.phase === "groups") {
    // Capped before the end of the list: "not seen" is not "absent", so pick nothing.
    if (s.pages >= MAX_GROUP_PAGES) return fail(507, "user-count-groups-capped");
    if (s.next == null) {
      const id = pickDefaultGroup(s);
      if (!id) return fail(404, s.exactId || s.legacyId ? "user-count-group-ambiguous" : "user-count-group-missing");
      Object.assign(s, { phase: "members", groupId: String(id), next: 0, pages: 0, people: 0, listed: 0, total: null });
      break;
    }
    if (now() >= deadline) return { status: "partial", state: s };
    const res = await call(route`/wiki/rest/api/group?limit=200&start=${s.next}`);
    if (!res?.ok) return fail(res?.status, "user-count-groups");
    const b = await res.json().catch(() => null);
    if (!Array.isArray(b?.results)) return fail(res.status || 200, "user-count-groups-body");
    if (!s.name && b?._links?.base) s.name = defaultGroupNames(b._links.base)[0];
    for (const g of Array.isArray(b?.results) ? b.results : []) {
      const n = String(g?.name || "").toLowerCase();
      if (!g?.id) continue;
      if (n.startsWith("confluence-users-")) s.anySuffixed = true;
      if (s.name && s.name !== "confluence-users" && n === s.name) s.exactId = String(g.id);
      // (a custom-domain base gives no site name: then only a lone legacy group is safe; KNOWN LIMIT,
      // such a site in a multi-site org gets the fallback / the paid floor, logged as -ambiguous)
      if (n === "confluence-users") s.legacyId = String(g.id);
    }
    s.pages++;
    s.next = s.exactId ? null : nextStart(b, s.next); // the site's own group found: stop listing
  }
  while (s.next != null && s.pages < MAX_MEMBER_PAGES) {
    if (now() >= deadline) return { status: "partial", state: s };
    const res = await call(route`/wiki/rest/api/group/${s.groupId}/membersByGroupId?limit=200&start=${s.next}`);
    if (!res?.ok) return fail(res?.status, "user-count-members");
    const b = await res.json().catch(() => null);
    if (!Array.isArray(b?.results)) return fail(res.status || 200, "user-count-members-body");
    const r = b.results;
    s.people += peopleIn(r);
    s.listed += r.length;
    const total = Number(b?.totalSize);
    if (Number.isFinite(total) && total > 0) s.total = total;
    s.pages++;
    s.next = nextStart(b, s.next);
  }
  // Totals check: the server said how many members there are and fewer were read (a cap or a short
  // page). The people counted stay a lower bound; the shortfall is logged (counts only).
  if (s.total && s.listed < s.total) logCountError(206, "user-count-short");
  return s.people > 0 ? { status: "done", count: s.people } : fail(204, "user-count-no-people");
}

/**
 * { count, kind } | { partial: state, count } | null. kind "licence" is the licensed count; "group"
 * is a lower bound. A resumed scan skips the licence call (it already answered no this round).
 */
async function readUserCount({ state = null, deadline = Infinity, now = () => Date.now() } = {}) {
  if (!state) {
    const licence = await readLicenceCount();
    if (licence > 0) return { count: licence, kind: "licence" };
  }
  const g = await readDefaultGroupCount(appConfluence, { state, deadline, now });
  if (g.status === "done") return { count: g.count, kind: "group" };
  if (g.status === "partial") return { partial: g.state, count: g.state.people || 0 };
  return null;
}

/** PURE. A fetchCount answer as { count, kind } (a bare number is the licence count). */
function normCount(v) {
  if (typeof v === "number") return v > 0 ? { count: Math.floor(v), kind: "licence" } : null;
  const n = Math.floor(Number(v?.count));
  return Number.isFinite(n) && n > 0 ? { count: n, kind: v.kind === "licence" ? "licence" : "group" } : null;
}

/** Bind the allowance to a KVS (the real one by default; tests pass fakes and a clock). */
export function makeAllowance({
  kvs = forgeKvs,
  locks = makeLocks(kvs),
  now = () => Date.now(),
  fetchCount = readUserCount,
  appContext = () => { try { return getAppContext(); } catch (_) { return null; } },
  lockWaitMs = LOCK_WAIT_MS,
} = {}) {
  /**
   * { users, source, counted } — source: "count" | "group" | "cached" | "stale-cache" | "fallback" |
   * "paid-floor" | "trial" | "unlicensed". `counted` is what was read (null when nothing was).
   */
  async function countedUsers() {
    let cached = null;
    try { cached = await kvs.get(COUNT_KEY); } catch (_) { cached = null; }
    const at = Date.parse(cached?.at || "");
    const age = Number.isFinite(at) ? now() - at : Infinity;
    // A cached row without a kind predates the group count: treat it as a lower bound.
    const cachedKind = cached?.kind === "licence" ? "licence" : "group";
    if (cached?.count > 0 && age < COUNT_TTL_MS) return { users: cached.count, source: "cached", kind: cachedKind };
    const stale = () => (cached?.count > 0 && age < COUNT_STALE_MAX_MS ? { users: cached.count, source: "stale-cache", kind: cachedKind } : null);
    const fallback = { users: FREE_TIER_USERS, source: "fallback", kind: null };
    // The last good count stays in the row through a failure or a half-done scan.
    const keep = cached?.count > 0 ? { count: cached.count, kind: cached.kind, at: cached.at } : {};
    const save = async (row) => { try { await kvs.set(COUNT_KEY, row); } catch (_) { /* next read retries */ } };
    // A failure or a half-done scan never overwrites a fresh count another caller saved meanwhile.
    const saveUnlessFresh = async (row) => {
      let cur = null;
      try { cur = await kvs.get(COUNT_KEY); } catch (_) { cur = null; }
      const curAt = Date.parse(cur?.at || "");
      if (cur?.count > 0 && Number.isFinite(curAt) && curAt > (Number.isFinite(at) ? at : -Infinity) && now() - curAt < COUNT_TTL_MS) return false;
      await save(row);
      return true;
    };
    const soFar = (n) => {
      const st = stale();
      return n > 0 && !(st && st.users >= n) ? { users: n, source: "group", kind: "group" } : st || fallback;
    };
    const failedAt = Date.parse(cached?.failedAt || "");
    if (Number.isFinite(failedAt) && now() - failedAt < COUNT_RETRY_MS) return stale() || fallback;
    const leaseUntil = Date.parse(cached?.scanUntil || "");
    if (Number.isFinite(leaseUntil) && now() < leaseUntil) return soFar(Math.floor(Number(cached?.scan?.people)) || 0);
    const scanAt = Number(cached?.scan?.startedAt);
    const resume = cached?.scan && Number.isFinite(scanAt) && now() - scanAt < SCAN_MAX_AGE_MS ? cached.scan : null;
    await save({ ...keep, ...(resume ? { scan: resume } : {}), scanUntil: new Date(now() + SCAN_LEASE_MS).toISOString() });
    let raw = null;
    try { raw = await fetchCount({ state: resume, deadline: now() + COUNT_BUDGET_MS, now }); } catch (e) {
      console.warn("[AI-ALLOWANCE] user count read failed:", errText(e));
      emit({ via: "job", action: "ai.licensed-user-count", surface: "ai-allowance", outcome: "error", errorType: String(e?.name || "Error"), step: "user-count" });
      raw = null;
    }
    if (raw && typeof raw === "object" && raw.partial) {
      // Out of time for this call: keep the place, resume on the next call. Until it finishes, the
      // last good count, else the people counted so far (a lower bound), else the fallback.
      await saveUnlessFresh({ ...keep, scan: raw.partial });
      return soFar(Math.floor(Number(raw.count)) || 0);
    }
    const got = normCount(raw);
    if (got) {
      await save({ count: got.count, kind: got.kind, at: new Date(now()).toISOString() });
      return { users: got.count, source: got.kind === "licence" ? "count" : "group", kind: got.kind };
    }
    await saveUnlessFresh({ ...keep, failedAt: new Date(now()).toISOString() });
    return stale() || fallback;
  }

  async function licensedUsers() {
    const ctx = appContext();
    const forced = licenceForcesFreeTier(ctx);
    if (forced) return { users: FREE_TIER_USERS, source: forced, counted: null };
    const r = await countedUsers();
    const counted = r.kind ? r.users : null;
    // An active paid licence (forced is null and a licence object exists): never below the floor
    // unless the licence count itself answered.
    // A context that could not be read at all (null) fails toward the customer: the floor too.
    if ((ctx?.license || ctx == null) && r.kind !== "licence" && r.users < PAID_FLOOR_USERS) {
      return { users: PAID_FLOOR_USERS, source: "paid-floor", counted };
    }
    return { users: r.users, source: r.source, counted };
  }

  /** The limit for this site now: { limitMicro, defaultMicro, lowered, users, userSource }. */
  async function limits(globalAi) {
    const { users, source, counted } = await licensedUsers();
    const defaultMicro = defaultAllowanceMicro(users);
    const limitMicro = effectiveLimitMicro(defaultMicro, globalAi?.monthlyAllowanceMicro);
    return { limitMicro, defaultMicro, lowered: limitMicro < defaultMicro, users, userSource: source, countedUsers: counted };
  }

  /** The admin's view (read only). Throws when the meter row cannot be read. */
  async function view(globalAi) {
    const t = now();
    const month = monthKeyOf(t);
    const lim = await limits(globalAi);
    const row = expireReservations({ ...emptyRow(), ...((await kvs.get(rowKey(month))) || {}) }, t);
    const remainingMicro = Math.max(0, lim.limitMicro - row.spentMicro - row.reservedMicro);
    return {
      month, monthLabel: monthLabel(month), resetsOn: nextMonthStart(t).toISOString(), resetLabel: resetLabel(t),
      ...lim, spentMicro: row.spentMicro, reservedMicro: row.reservedMicro, remainingMicro, runs: row.runs,
      exhausted: viewExhausted(lim.limitMicro, row), reachedAt: row.reachedAt || null,
      ...(lim.userSource === "fallback" ? { note: COUNT_FALLBACK_NOTE } : lim.userSource === "paid-floor" ? { note: PAID_FLOOR_NOTE } : {}),
    };
  }

  /** Cheap, non-reserving check for the request paths: { ok } or { ok:false, why, reason }. */
  async function precheck(globalAi) {
    try {
      const v = await view(globalAi);
      // The plain arithmetic only (8.22.1 review H1): the card's "used up" also counts the smallest
      // REFUSED review, and using that here would refuse every smaller review for the rest of the
      // month after one large refusal. reserve() is the authority for each review's own size.
      return isExhausted(v.limitMicro, v.spentMicro, v.reservedMicro) ? { ok: false, why: "allowance", reason: allowanceMessage(now()) } : { ok: true };
    } catch (e) {
      console.error("[AI-ALLOWANCE] precheck failed:", errText(e));
      return { ok: false, why: "busy", reason: ALLOWANCE_BUSY_REASON };
    }
  }

  async function underLock(fn) {
    return locks.withLock(LOCK_KEY, LOCK_HOLD_MS, fn, { waitMs: lockWaitMs, stepMs: 150 });
  }

  /**
   * Reserve `micro` for run `id` right before the model call. Returns
   * { ok:true, month, id, micro } or { ok:false, why:"allowance"|"busy", reason, firstTrip }.
   */
  async function reserve(id, micro, globalAi) {
    let lim;
    try { lim = await limits(globalAi); } catch (e) { return { ok: false, why: "busy", reason: ALLOWANCE_BUSY_REASON }; }
    try {
      return await underLock(async () => {
        const t = now();
        const month = monthKeyOf(t);
        const row = expireReservations({ ...emptyRow(), ...((await kvs.get(rowKey(month))) || {}) }, t);
        if (row.spentMicro + row.reservedMicro + micro > lim.limitMicro) {
          const firstTrip = !row.reachedAt;
          // Remember the smallest review refused this month, so the admin CARD says
          // "used up" while the arithmetic alone (remaining > one output reserve) still looks open.
          const need = Math.min(Number(row.refusedNeedMicro) > 0 ? Number(row.refusedNeedMicro) : Infinity, micro);
          if (firstTrip || need !== row.refusedNeedMicro) {
            if (firstTrip) row.reachedAt = new Date(t).toISOString();
            row.refusedNeedMicro = need;
            await kvs.set(rowKey(month), row, { ttl: { value: Math.ceil(ROW_TTL_MS / 1000), unit: "SECONDS" } });
          }
          return { ok: false, why: "allowance", reason: allowanceMessage(t), firstTrip, month, limitMicro: lim.limitMicro };
        }
        row.reservations[id] = { micro, at: new Date(t).toISOString() };
        row.reservedMicro += micro;
        await kvs.set(rowKey(month), row, { ttl: { value: Math.ceil(ROW_TTL_MS / 1000), unit: "SECONDS" } });
        return { ok: true, month, id, micro, limitMicro: lim.limitMicro };
      });
    } catch (e) {
      console.warn("[AI-ALLOWANCE] reserve refused:", errText(e));
      return { ok: false, why: "busy", reason: ALLOWANCE_BUSY_REASON };
    }
  }

  /**
   * Settle a reservation to what the model reported, in the month it was RESERVED in. Returns
   * { settled, firstTrip, month, limitMicro }. If the lock cannot be had, the reservation stays and
   * is charged at its reserved (larger) size when it expires: never under-counted.
   */
  async function settle(reservation, usage) {
    if (!reservation?.ok) return { settled: false };
    const { month, id, limitMicro } = reservation;
    for (let attempt = 0; ; attempt++) {
      try {
        return await underLock(async () => {
          const row = { ...emptyRow(), ...((await kvs.get(rowKey(month))) || {}) };
          row.reservations = row.reservations || {};
          // A reservation that already expired was charged at its reserved size (>= what the model
          // can report for that prompt): charging the actual on top would bill it twice.
          if (row.reservations[id]) {
            delete row.reservations[id];
            row.spentMicro += costMicro(usage);
          }
          row.runs = (row.runs || 0) + 1;
          expireReservations(row, now());
          let firstTrip = false;
          if (!row.reachedAt && isExhausted(limitMicro, row.spentMicro, row.reservedMicro)) {
            row.reachedAt = new Date(now()).toISOString();
            firstTrip = true;
          }
          await kvs.set(rowKey(month), row, { ttl: { value: Math.ceil(ROW_TTL_MS / 1000), unit: "SECONDS" } });
          return { settled: true, firstTrip, month, limitMicro };
        });
      } catch (e) {
        // One retry: a dropped settle is charged at the full reservation when it expires.
        if (attempt === 0) continue;
        console.warn("[AI-ALLOWANCE] settle deferred:", errText(e));
        return { settled: false };
      }
    }
  }

  return { licensedUsers, limits, view, precheck, reserve, settle };
}

const real = makeAllowance();
export const aiAllowance = real;
