/*
 * Personal data reporting — the PURE half (no imports). The worker (worker.js) finds every
 * account id the app stores, reports them to Atlassian (privacy.reportPersonalData, the Personal
 * Data Reporting API), and on `closed` erases the account; on `updated` it refreshes the stored
 * display names.
 *
 * Atlassian's rules (developer.atlassian.com/platform/forge/user-privacy-guidelines, read
 * 2026-10-04): the cycle is 7 days and an app "should not send reports more frequently than the
 * cycle period for each accountId"; `updatedAt` is when the app retrieved that person's data
 * (the OLDEST such time); up to 90 accounts per request; a 429 carries Retry-After.
 *
 * Finding ids. A modern id (`712020:3f…-…`) is recognised anywhere — keys and string values —
 * because no other id in this app has that shape (section ids and tokens are bare UUIDs). A
 * legacy 24-hex id is recognised only under a field that names a person, so a hash or a random
 * id can never be reported as an account.
 *
 * Erasing. A row whose KEY names the account is that person's own row (their signature, their
 * read confirmation, their edit request, their inbox) and is deleted. In every other row the id
 * is replaced by PSEUDONYM_ID and the display name / email paired with it by PSEUDONYM_NAME / null.
 * Pairing is by field stem, never "every *Name field": `lockedBy` → `lockedByName`,
 * `requesterAccountId` → `requesterName`, `accountId` → `name` / `displayName`; `toName` and
 * `fromName` are workflow STATE names and are never touched.
 *
 * Lists. A closed person is REMOVED only from steward rosters (`adminUsers`) and read-confirmation
 * audiences (`audience`): fewer stewards and fewer readers can only narrow what happens. Every
 * APPROVER list keeps a pseudonymised entry instead (review 2026-10-04): an approval whose list
 * became empty evaluates as "approved" (approvals.js evaluateApproval, total === 0), so removing
 * the last approver would approve a page nobody approved. A request waiting on a former user
 * stays pending until a space admin settles it — the safe failure.
 *
 * Personal spaces. A personal space key is `~` + an account id (sanitised to `_` in KVS keys), so
 * an id preceded by `~` or `_` is a SPACE KEY, not a person reference: it is never matched in a
 * key and never rewritten in a value (review 2026-10-04, L2).
 *
 * Content. Rows that hold PAGE CONTENT (`section-snapshot-` baselines) are never rewritten: a
 * mention inside page content is Confluence's data, and changing a baseline without its hash
 * would make the app "restore" content nobody wrote (CONTENT_PREFIXES).
 */
export const PSEUDONYM_ID = "former-user";
export const PSEUDONYM_NAME = "Former user";
export const REPORT_BATCH = 90;
export const CYCLE_MS = 7 * 86400000;

const MODERN = /^\d{1,8}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODERN_IN = /\d{1,8}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const LEGACY = /^[0-9a-f]{24}$/i;
// Fields whose value (or list elements) name a person.
const PERSON_FIELD = /^(accountId|by|owner|requester|approver|actor|user|grantee|adminUsers|userIds|approverIds|memberIds|allIds|ids)$|AccountId$|By$/;

/** Rows whose rosters / audiences may drop a closed person (see the header: never approver lists). */
export const CONFIG_LIST_PREFIXES = Object.freeze(["admin-settings-", "workflow-settings-"]);
export const removesFromLists = (key) => CONFIG_LIST_PREFIXES.some((p) => String(key || "").startsWith(p));
/** The only list fields an entry is removed from. Everything else is pseudonymised in place. */
export const LIST_REMOVAL_FIELDS = Object.freeze(["adminUsers", "audience"]);
/** Rows holding page content: reported (the ids are stored) but never rewritten or deleted. */
export const CONTENT_PREFIXES = Object.freeze(["section-snapshot-"]);
export const holdsPageContent = (key) => CONTENT_PREFIXES.some((p) => String(key || "").startsWith(p));

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// An occurrence of the id that is a PERSON reference: not part of a personal space key (~id / _id).
const personRe = (accountId) => new RegExp(`(?<![~_A-Za-z0-9])${escapeRe(accountId)}`, "g");

/** PURE. Is this string an account id, given the field it sits under? */
export function isAccountId(str, field = "") {
  if (typeof str !== "string") return false;
  if (MODERN.test(str)) return true;
  return LEGACY.test(str) && PERSON_FIELD.test(String(field || ""));
}

/** PURE. Every account id in a row (its key and its value). */
export function extractAccountIds(key, value) {
  const out = new Set();
  for (const m of String(key || "").matchAll(MODERN_IN)) out.add(m[0]);
  const walk = (v, field, depth) => {
    if (depth > 40 || v == null) return;
    if (typeof v === "string") {
      if (isAccountId(v, field)) out.add(v);
      else if (v.length > 40) for (const m of v.matchAll(MODERN_IN)) out.add(m[0]); // ids inside text (storage, a reason)
      return;
    }
    if (Array.isArray(v)) { for (const x of v) walk(x, field, depth + 1); return; }
    if (typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k, depth + 1);
  };
  walk(value, "", 0);
  return out;
}

/** PURE. The sibling fields that carry the name / email / picture paired with an id field. */
export function pairedFields(field) {
  const f = String(field || "");
  if (f === "accountId" || f === "id" || f === "") {
    return { names: ["name", "displayName", "publicName"], contact: ["email", "emailAddress", "avatarUrl", "profilePicture", "avatar", "hint"] }; // hint: the approver picker's namesake hint
  }
  const stem = f.replace(/(AccountId|Id)$/, "");
  return {
    names: [`${stem}Name`, `${stem}DisplayName`],
    // A seal's `note` is written by its sealer (lockedBy) — free text that goes with them.
    contact: [`${stem}Email`, `${stem}Avatar`, `${stem}AvatarUrl`, `${stem}Picture`, ...(f === "lockedBy" ? ["note"] : [])],
  };
}

/** PURE. Does a row KEY belong to the account (their own row)? */
export const keyNamesAccount = (key, accountId) => !!accountId && personRe(accountId).test(String(key || ""));

const isPrincipalRef = (o, accountId) => o && typeof o === "object" && !Array.isArray(o) && (o.accountId === accountId || (o.id === accountId && (o.type == null || o.type === "user")));

/**
 * PURE. Rewrite every mention of one account in a value.
 *   mode "erase":  id → PSEUDONYM_ID, paired names → PSEUDONYM_NAME, paired contact → null;
 *                  with `removeFromLists`, list elements that ARE the person are dropped.
 *   mode "rename": paired names → `newName` (ids untouched), paired contact → null.
 * Returns { value, changed } — the input is never mutated.
 */
export function rewriteAccount(value, accountId, { mode = "erase", newName = null, removeFromLists = false } = {}) {
  let changed = false;
  const erase = mode === "erase";
  const walk = (v, field, depth) => {
    if (depth > 40 || v == null) return v;
    if (typeof v === "string") {
      if (!erase || !v.includes(accountId)) return v;
      if (v === accountId) { changed = true; return PSEUDONYM_ID; }
      const next = v.replace(personRe(accountId), PSEUDONYM_ID); // a ~id personal space key stays as it is
      if (next !== v) changed = true;
      return next;
    }
    if (Array.isArray(v)) {
      const out = [];
      const removable = erase && removeFromLists && LIST_REMOVAL_FIELDS.includes(field);
      for (const x of v) {
        if (removable && (x === accountId || isPrincipalRef(x, accountId))) { changed = true; continue; }
        out.push(walk(x, field, depth + 1));
      }
      return out;
    }
    if (typeof v === "object") {
      const o = { ...v };
      const idFields = Object.keys(o).filter((k) => o[k] === accountId);
      for (const f of idFields) {
        const { names, contact } = pairedFields(f);
        for (const n of names) {
          if (typeof o[n] === "string" || o[n] === null) {
            const next = erase ? PSEUDONYM_NAME : newName;
            if (next != null && o[n] !== next) { o[n] = next; changed = true; }
          }
        }
        // A changed (`updated`) person keeps what they wrote; only a closed one loses it.
        for (const c of contact) if (o[c] != null && (erase || c !== "note")) { o[c] = null; changed = true; }
        if (erase) { o[f] = PSEUDONYM_ID; changed = true; }
      }
      for (const k of Object.keys(o)) if (!idFields.includes(k)) o[k] = walk(o[k], k, depth + 1);
      return o;
    }
    return v;
  };
  const out = walk(value, "", 0);
  return { value: out, changed };
}

/** PURE. A 6.6.0-era seal record still carrying the sealer's email → the record without it. */
export function stripLegacyEmail(key, value) {
  const k = String(key || "");
  if (!(k.startsWith("protection-") || k.startsWith("section-protection-"))) return { value, changed: false };
  if (!value || typeof value !== "object" || !("lockedByEmail" in value)) return { value, changed: false };
  const { lockedByEmail, ...rest } = value;
  void lockedByEmail;
  return { value: rest, changed: true };
}

/**
 * PURE. A steward roster (`admin-settings-*` → adminUsers) keeps { accountId, displayName } only;
 * an entry saved with an email, avatar or anything else (a REST bundle could carry them) is
 * reduced. Mirrors policies/settings-schema.js minimiseRoster, which guards every new write.
 */
export function stripRosterContact(key, value) {
  if (String(key || "").startsWith("workflow-settings-")) return stripApproverEmailHints(value);
  if (!String(key || "").startsWith("admin-settings-") || !value || typeof value !== "object" || !Array.isArray(value.adminUsers)) return { value, changed: false };
  let changed = false;
  const adminUsers = value.adminUsers.map((u) => {
    if (!u || typeof u !== "object") return u;
    const extra = Object.keys(u).some((k) => k !== "accountId" && k !== "displayName");
    if (!extra) return u;
    changed = true;
    return { accountId: u.accountId, displayName: typeof u.displayName === "string" ? u.displayName : null };
  });
  return changed ? { value: { ...value, adminUsers }, changed } : { value, changed: false };
}

/**
 * PURE. Approver lists (`workflow-settings-*` -> approval.approvers[].hint) saved before
 * 2026-10-04 may carry the approver's email as the namesake hint; it is dropped (the entry keeps
 * its id and name). Mirrors workflow/logic.js, which drops an email hint on every new save.
 */
export function stripApproverEmailHints(value) {
  const list = value?.approval?.approvers;
  if (!Array.isArray(list) || !list.some((a) => typeof a?.hint === "string" && a.hint.includes("@"))) return { value, changed: false };
  const approvers = list.map((a) => {
    if (!(typeof a?.hint === "string" && a.hint.includes("@"))) return a;
    const { hint: _h, ...rest } = a;
    return rest;
  });
  return { value: { ...value, approval: { ...value.approval, approvers } }, changed: true };
}

/**
 * PURE. Which accounts to report now, and with what updatedAt.
 * `index` is { [accountId]: { u: updatedAtIso, r: reportedAtIso|null } }; `seen` the ids found.
 * Every seen id gets an entry (first seen → u = now). An id is DUE when it was never reported or
 * its last report is a full cycle old. Ids no longer stored drop out of the index.
 */
export function planReport(index, seen, nowMs) {
  const nowIso = new Date(nowMs).toISOString();
  const next = {};
  const due = [];
  for (const id of seen) {
    const prev = index?.[id];
    const entry = { u: prev?.u || nowIso, r: prev?.r || null };
    next[id] = entry;
    const last = Date.parse(entry.r || "");
    if (!Number.isFinite(last) || nowMs - last >= CYCLE_MS) due.push({ accountId: id, updatedAt: entry.u });
  }
  return { index: next, due };
}

/** PURE. Split a list into batches of at most `size`. */
export function batches(list, size = REPORT_BATCH) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
