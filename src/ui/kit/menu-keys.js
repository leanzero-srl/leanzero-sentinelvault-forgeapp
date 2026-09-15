/*
 * The PURE keyboard models behind kit/ActionMenu.jsx (a menu is a ring: the arrows wrap) and
 * kit/RovingList.jsx (a list has ends: the arrows clamp). Zero imports, no JSX, so
 * test/action-menu.test.mjs runs them in plain node. One rule, one place — the components
 * import from here rather than carrying their own copy.
 */

/**
 * Where a key moves the active MENU item. Null when the key is not navigation (the caller
 * leaves the event alone: Escape closes, Enter clicks, Tab moves on).
 * @param {string} key  e.key
 * @param {number} active  current index
 * @param {number} n  item count
 */
export function nextMenuIndex(key, active, n) {
  if (!n || n < 1) return null;
  const cur = Number.isInteger(active) && active >= 0 && active < n ? active : 0;
  switch (key) {
    case "ArrowDown": return (cur + 1) % n;
    case "ArrowUp": return (cur - 1 + n) % n;
    case "Home": return 0;
    case "End": return n - 1;
    default: return null;
  }
}

/** Where a key moves the active CARD in a list: clamped at both ends, never wraps. */
export function nextCardIndex(key, active, n) {
  if (!n || n < 1) return null;
  const cur = Number.isInteger(active) && active >= 0 ? Math.min(active, n - 1) : 0;
  switch (key) {
    case "ArrowDown": return Math.min(cur + 1, n - 1);
    case "ArrowUp": return Math.max(cur - 1, 0);
    case "Home": return 0;
    case "End": return n - 1;
    default: return null;
  }
}
