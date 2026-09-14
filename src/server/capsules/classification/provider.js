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
import { createAppProvider, createNativeProvider, selectProvider } from "./logic.js";

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
