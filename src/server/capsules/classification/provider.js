/**
 * Classification provider selector — the ONLY file in the capsule that touches Forge.
 *
 * Binds the pure providers in logic.js to @forge/kvs and asApp().requestConfluence, probes the
 * native scheme once per invocation (module-level Map, which lives exactly as long as the Forge
 * invocation's module instance) and falls back to the App provider.
 *
 * Live (2026-09-14): read:configuration:confluence is not in manifest.yml, so the native levels
 * call answers 401/403 → null → App provider. When the owner ships the scope in a later major,
 * a site that defines native levels flips to native with no code change; a site that answers `[]`
 * (both test sites today) stays on App, because an empty scheme has nothing to assign.
 */
import { asApp, assumeTrustedRoute } from "@forge/api";
import { kvs } from "@forge/kvs";
import { createAppProvider, createNativeProvider, selectProvider, classificationActive } from "./logic.js";
import { resolvePageSpaceKey } from "../../shared/content-access.js";

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
    console.warn("[CLASSIFICATION] switch read failed:", e?.message || e);
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
const request = (path, init) => asApp().requestConfluence(assumeTrustedRoute(path), init);
const log = (m) => console.warn(m);

const cache = new Map();

export async function getClassificationProvider() {
  if (cache.has("selected")) return cache.get("selected");
  const native = createNativeProvider({ request });
  const app = createAppProvider({ kvs, request, log });
  const selected = await selectProvider({ native, app });
  cache.set("selected", selected);
  return selected;
}

/** Tests and the manage-levels resolver need the App provider regardless of what is selected. */
export function getAppProvider() {
  return createAppProvider({ kvs, request, log });
}

/** After a level edit the cached level list is stale. */
export function resetProviderCache() {
  cache.clear();
}

export { request as confluenceRequest };
