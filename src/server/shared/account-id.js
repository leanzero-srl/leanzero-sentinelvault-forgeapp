/**
 * PURE (no Forge import: the browser bundle uses it too). An Atlassian accountId ("712020:937bc860-…",
 * or a legacy 24-hex id) is never a person's name. Some events were recorded with one in
 * `actor.name`; the Activity report printed it (device matrix SV-08), then hid it as "Someone"
 * client-side — even for accounts the app CAN name (BN-04, 2026-10-07: API access showed the same
 * account as "Mihai Perdum"). One rule, shared by the writer, the reader and the UI.
 */
const ACCOUNT_ID = /^(?:\d+:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^[0-9a-f]{24}$/i;

export const looksLikeAccountId = (v) => typeof v === "string" && ACCOUNT_ID.test(v.trim());

/**
 * The account to look a name up for, or null: an actor with no name, a placeholder name, or a name
 * that is really an accountId (then that id is the account when `accountId` is missing).
 */
const PLACEHOLDER = /^(?:current user|user [0-9a-f]{4})$/i;
export function accountToName(actor) {
  if (!actor || typeof actor !== "object") return null;
  const id = typeof actor.accountId === "string" && actor.accountId ? actor.accountId : null;
  const name = typeof actor.name === "string" ? actor.name.trim() : "";
  if (name && !PLACEHOLDER.test(name) && !looksLikeAccountId(name)) return null; // a real name already
  if (id) return id;
  return looksLikeAccountId(name) ? name.trim() : null;
}
