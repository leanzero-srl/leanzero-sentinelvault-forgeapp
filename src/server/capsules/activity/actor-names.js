/**
 * PURE (no Forge import; `resolve(accountId)` is injected). Names the actors of activity entries at
 * READ time: an entry whose actor has no name, a placeholder ("Current User"), or an accountId where
 * the name should be gets the account's display name. One lookup per distinct account (≤100); a
 * lookup that fails or answers nothing keeps what was stored, and the UI then says "Someone".
 */
import { accountToName } from "../../shared/account-id.js";

export async function decorateActorNames(entries, resolve) {
  const list = Array.isArray(entries) ? entries : [];
  const ids = [...new Set(list.map((e) => accountToName(e?.actor)).filter(Boolean))].slice(0, 100);
  if (!ids.length) return list;
  const names = new Map();
  await Promise.all(ids.map(async (id) => {
    try { const n = await resolve(id); if (typeof n === "string" && n.trim()) names.set(id, n.trim()); } catch (_) { /* best effort */ }
  }));
  return list.map((e) => {
    const id = accountToName(e?.actor);
    if (!id || !names.has(id)) return e;
    return { ...e, actor: { ...e.actor, accountId: e.actor.accountId || id, name: names.get(id) } };
  });
}
