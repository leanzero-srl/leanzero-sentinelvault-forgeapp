/*
 * Activity category filter — ONE rule for every chip row (page-details Activity tab, the
 * steward Activity report). Tester report 2026-09-21: every chip started ON, so isolating one
 * category meant switching four others off one by one.
 *
 *   - every chip on + click one   → ONLY that one (isolate);
 *   - otherwise a click toggles that chip;
 *   - `selectAll` / `clearAll` are the two bulk moves; an empty selection is allowed and the
 *     surface says "nothing selected" instead of showing nothing silently.
 *
 * Pure: arrays in, arrays out, order follows `all`.
 */
export function nextSelection(current, clicked, all) {
  const cur = new Set(Array.isArray(current) ? current : []);
  if (!all.includes(clicked)) return all.filter((id) => cur.has(id));
  const everyOn = all.every((id) => cur.has(id));
  if (everyOn) return [clicked];
  if (cur.has(clicked)) cur.delete(clicked); else cur.add(clicked);
  return all.filter((id) => cur.has(id));
}
export const selectAll = (all) => [...all];
export const clearAll = () => [];
export const isAllOn = (current, all) => all.length > 0 && all.every((id) => current.includes(id));
