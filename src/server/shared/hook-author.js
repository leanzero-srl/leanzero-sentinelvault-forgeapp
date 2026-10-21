import { AsyncLocalStorage } from "node:async_hooks";

/**
 * DEV HARNESS SEAM — who wrote one page version, as the dev test hook names it.
 *
 * The live harness holds one token (a site admin's), so every page version it writes is authored by
 * a privileged account. Its `pageEvent` seam runs the page pipeline "as" a named editor (a real,
 * non-privileged account) for a version the harness wrote. The enforcement rules read who wrote each
 * version from Confluence (workflow/sanctioned.js), so inside that one call the hook names the author
 * of that one version: `withHookVersionAuthor` scopes it to the hook's own async call chain.
 *
 * Inert everywhere else: only src/test-hook.js enters the scope (test/hook-author-seam.test.mjs
 * guards that), the hook answers 404 without the development-only HARNESS_SECRET and is removed from
 * the production manifest (scripts/strip-dev-modules.mjs); outside the scope `hookVersionAuthor`
 * answers null and the real author stands.
 */
const als = new AsyncLocalStorage();

export function withHookVersionAuthor({ pageId, version, accountId }, fn) {
  const v = Number(version);
  if (!pageId || !Number.isInteger(v) || v < 1 || typeof accountId !== "string" || !accountId) return fn();
  return als.run({ pageId: String(pageId), version: v, accountId }, fn);
}

/** The hook-named author of `pageId` version `version`, or null (always null outside the hook's call). */
export function hookVersionAuthor(pageId, version) {
  const s = als.getStore();
  return s && s.pageId === String(pageId) && s.version === version ? s.accountId : null;
}
