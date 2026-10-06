/**
 * PURE. Display names for the accounts on a list (the API token minter, the job submitter),
 * resolved at READ time and never stored (device matrix 2026-10-06, SV-19: nothing ever wrote
 * createdByName, so every row printed the raw accountId). `resolve(accountId)` → name | null; an
 * unresolvable id (a closed account) gets no name and the UI then prints no "by …" at all rather
 * than the id. One lookup per distinct id; a row that already carries a name keeps it.
 */
export async function withDisplayNames(rows, idKey, nameKey, resolve) {
  const list = Array.isArray(rows) ? rows : [];
  const ids = [...new Set(list.map((r) => r && r[idKey]).filter((v) => typeof v === "string" && v))];
  const names = new Map(await Promise.all(ids.map(async (id) => {
    try { return [id, (await resolve(id)) || null]; } catch (_) { return [id, null]; }
  })));
  return list.map((r) => (r && r[idKey] && !r[nameKey] && names.get(r[idKey]) ? { ...r, [nameKey]: names.get(r[idKey]) } : r));
}
