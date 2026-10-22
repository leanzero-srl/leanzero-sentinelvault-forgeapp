/**
 * Classification provider selector — the ONLY file in the capsule that touches Forge.
 *
 * Binds the pure providers in logic.js to @forge/kvs and asApp().requestConfluence, probes the
 * native scheme and falls back to the App provider. The choice is remembered per invocation and for
 * a minute in the site's own KVS, never in module scope: a module instance is NOT per invocation —
 * one warm Forge process serves several sites, and until 8.20.0 a module-level Map here handed one
 * site's scheme and level list to the next site the process served.
 *
 * Live (2026-09-14): read:configuration:confluence is not in manifest.yml, so the native levels
 * call answers 401/403 → null → App provider. When the owner ships the scope in a later major,
 * a site that defines native levels flips to native with no code change; a site that answers `[]`
 * (both test sites today) stays on App, because an empty scheme has nothing to assign.
 */
import { asApp, assumeTrustedRoute } from "@forge/api";
import { appConfluence, invocationMemo, forgetInvocationMemo } from "../../shared/confluence-call.js";
import { kvs } from "@forge/kvs";
import { createAppProvider, createNativeProvider, selectProvider, classificationActive } from "./logic.js";
import { resolvePageSpaceKey } from "../../shared/content-access.js";
import { errText } from "../../shared/action-log.js";

// ── CLS-1: the switch, bound to the two policy records ──────────────────────────────────────
// The same sanitisation policies/actions.js applies to the space key (the KVS key charset).
const spaceRecordKey = (spaceKey) => `admin-settings-space-${String(spaceKey).replace(/[^a-zA-Z0-9:._\s-#]/g, "_")}`;

/** { active, reason } for a space key (null/unknown key = the site switch alone). Fails CLOSED: a KVS error reads as off. */
export async function resolveClassificationActive(spaceKey) {
  try {
    const [site, space] = await Promise.all([
      kvs.get("admin-settings-global"),
      spaceKey ? kvs.get(spaceRecordKey(spaceKey)) : Promise.resolve(null),
    ]);
    return classificationActive({ site, space });
  } catch (e) {
    console.warn("[CLASSIFICATION] switch read failed:", errText(e));
    return { active: false, reason: "site" };
  }
}

/** The same, for a page (its space is resolved from the page, never from a payload). */
export async function classificationActiveForPage(pageId) {
  const site = await kvs.get("admin-settings-global").catch(() => null);
  if (site?.classificationEnabled !== true) return { active: false, reason: "site" };
  const spaceKey = await resolvePageSpaceKey(pageId);
  return resolveClassificationActive(spaceKey);
}

// Every path handed to this function is built in logic.js from ids that passed isContentId()
// (digits only) or from constants, so assumeTrustedRoute is exactly that: trusted by construction.
const request = (path, init) => appConfluence(assumeTrustedRoute(path), init);
const log = (m) => console.warn(m);

// Which scheme this SITE uses and its levels. Never in module scope (see the header). Once per
// invocation, and the choice is kept for a minute in this site's own KVS (KVS is per installation), so
// the banner, byline and page details do not ask Confluence for the native levels on every view.
//   - The App scheme's levels are always read from KVS (they live there; an edit or a restore shows at
//     once). Only the native choice and Confluence's own level list ride the minute.
//   - A 429 on the levels call is "could not tell": the site's last stored choice (up to a day old) is
//     used (accepted: a site that switched schemes within that day shows the old one until Confluence
//     answers again), else the call fails; never the App levels on a site that uses Confluence's own just because
//     Confluence was busy. Nothing is stored from a 429.
//   - A 5xx uses the site's last stored choice (up to a day old); with none, it keeps the old fallback
//     for this one request (the app keeps classifying). Nothing is stored from a 5xx.
const PROVIDER_MEMO = "classification-provider";
export const SCHEME_CACHE_KEY = "classification-scheme-cache";
export const SCHEME_CACHE_MS = 60_000;
export const SCHEME_STALE_OK_MS = 24 * 3_600_000;
const LEVELS_PATH = "/wiki/api/v2/classification-levels";

/** PURE. A stored selection usable at `now`: younger than `maxAgeMs`, not from the future. */
export function freshScheme(row, now = Date.now(), maxAgeMs = SCHEME_CACHE_MS) {
  if (!row || (row.name !== "native" && row.name !== "app") || !Array.isArray(row.levels)) return null;
  const at = Number(row.at);
  return Number.isFinite(at) && at <= now && now - at < maxAgeMs ? row : null;
}

async function fromStored(row) {
  if (row.name === "native") return { provider: createNativeProvider({ request }), levels: row.levels };
  const app = createAppProvider({ kvs, request, log });
  return { provider: app, levels: await app.listLevels() };
}

async function selectForSite() {
  const now = Date.now();
  const stored = await kvs.get(SCHEME_CACHE_KEY).catch(() => null);
  if (freshScheme(stored, now)) return fromStored(stored);
  let levelsStatus = null;
  const watched = async (path, init) => {
    const res = await request(path, init);
    if (path === LEVELS_PATH) levelsStatus = res?.status ?? null;
    return res;
  };
  const native = createNativeProvider({ request: watched });
  const app = createAppProvider({ kvs, request, log });
  const selected = await selectProvider({ native, app });
  // A 5xx keeps the App fallback only when the site has no stored choice from the last day; with one,
  // that choice is used (a site on Confluence's own levels does not flip to the App's for an outage).
  if (levelsStatus != null && levelsStatus >= 500 && freshScheme(stored, now, SCHEME_STALE_OK_MS)) return fromStored(stored);
  if (levelsStatus === 429) {
    if (freshScheme(stored, now, SCHEME_STALE_OK_MS)) return fromStored(stored);
    const e = new Error("Confluence is limiting requests; the classification scheme could not be read");
    e.code = "RATE_LIMITED";
    throw e;
  }
  const name = selected.provider.name;
  if (levelsStatus != null && levelsStatus < 500) {
    await kvs.set(SCHEME_CACHE_KEY, { name, levels: name === "native" ? selected.levels : [], at: now }).catch(() => {});
  }
  return { provider: name === "native" ? createNativeProvider({ request }) : selected.provider, levels: selected.levels };
}

export async function getClassificationProvider() {
  return invocationMemo(PROVIDER_MEMO, selectForSite);
}

/** Tests and the manage-levels resolver need the App provider regardless of what is selected. */
export function getAppProvider() {
  return createAppProvider({ kvs, request, log });
}

/** After a level edit the remembered level list is stale (this invocation's and the site's minute). */
export async function resetProviderCache() {
  forgetInvocationMemo(PROVIDER_MEMO);
  await kvs.delete(SCHEME_CACHE_KEY).catch(() => {});
}

export { request as confluenceRequest };
