/**
 * PURE (no Forge import; `resolve(accountId)` is injected). Names the actors of activity entries at
 * READ time: an entry whose actor has no name, a placeholder ("Current User"), or an accountId where
 * the name should be gets the account's display name. One lookup per distinct account (≤100); a
 * lookup that fails or answers nothing keeps what was stored, and the UI then says "Someone".
 */
import { accountToName, looksLikeAccountId } from "../../shared/account-id.js";

// 8.11.0: rows that name an EDITOR in their details (an Approved page restored or moved back, a sealed
// file put back) store the editor's accountId; it is named here too, or the UI printed the id.
const editorToName = (e) => {
  const d = e?.details;
  if (!d || typeof d !== "object" || (d.editorName && !looksLikeAccountId(d.editorName))) return null;
  return typeof d.editor === "string" && looksLikeAccountId(d.editor) ? d.editor : null;
};

export async function decorateActorNames(entries, resolve) {
  const list = Array.isArray(entries) ? entries : [];
  const ids = [...new Set(list.flatMap((e) => [accountToName(e?.actor), editorToName(e)]).filter(Boolean))].slice(0, 100);
  if (!ids.length) return list;
  const names = new Map();
  await Promise.all(ids.map(async (id) => {
    try { const n = await resolve(id); if (typeof n === "string" && n.trim()) names.set(id, n.trim()); } catch (_) { /* best effort */ }
  }));
  return list.map((e) => {
    let out = e;
    const id = accountToName(e?.actor);
    if (id && names.has(id)) out = { ...out, actor: { ...out.actor, accountId: out.actor.accountId || id, name: names.get(id) } };
    const ed = editorToName(e);
    if (ed && names.has(ed)) out = { ...out, details: { ...out.details, editorName: names.get(ed) } };
    return out;
  });
}
