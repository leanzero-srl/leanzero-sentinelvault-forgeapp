/**
 * WHICH ELZI TOURS EXIST - the ONE list, shared by the screens (they draw the tours) and the backend
 * (which refuses a key that is not here, so a page can never grow a person's row).
 *
 * Two consoles, each with a page tour that opens by itself on a person's first visit and one
 * mini-tour per tab:
 *   site   the site settings page (Confluence administration > Apps), tabs in SITE_TABS
 *   space  the space's Sentinel Vault page, tabs in SPACE_TABS
 * A tour's key is its mark: `site`, `space`, `site-<tab>`, `space-<tab>`. Dependency-free (webpack + node).
 */
export const SITE_TABS = Object.freeze(["settings", "validations", "classification", "api", "backup"]);
export const SPACE_TABS = Object.freeze(["my-claims", "locked-attachments", "permissions", "unlock-timeouts", "macro-settings", "validations", "workflow", "activity"]);

export const nuxTabKey = (console_, tab) => `${console_}-${tab}`;
export const NUX_TOUR_KEYS = Object.freeze([
  "site", "space",
  ...SITE_TABS.map((t) => nuxTabKey("site", t)),
  ...SPACE_TABS.map((t) => nuxTabKey("space", t)),
]);

/* "Already shown in this tab" notes (tourSteps.js autoShownHere: sessionStorage, the fallback when a mark write
   fails). Reset clears them with the stored row, or a reload in the same tab would still skip the tour. */
export const NUX_AUTO_PREFIX = "sv-nux-auto:";
export const clearNuxShownHere = (store) => {
  let s = store;
  if (s === undefined) { try { s = window.sessionStorage; } catch (e) { s = null; } }
  if (!s) return 0;
  try {
    const keys = [];
    for (let i = 0; i < s.length; i++) { const k = s.key(i); if (typeof k === "string" && k.startsWith(NUX_AUTO_PREFIX)) keys.push(k); }
    keys.forEach((k) => s.removeItem(k));
    return keys.length;
  } catch (e) { return 0; }
};
