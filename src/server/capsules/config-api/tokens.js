/*
 * Config API tokens — the @forge/kvs binding of tokens-core.js. Everything decision-shaped is
 * in the core (unit-tested); this file only supplies the storage.
 */
import { kvs } from "@forge/kvs";
import { createTokenStore } from "./tokens-core.js";

export { TOKEN_ROLES, MAX_TOKENS, tokenRole, tokenRoleAtLeast, extractBearer, publicRow } from "./tokens-core.js";

const storage = {
  get: (k) => kvs.get(k),
  set: (k, v) => kvs.set(k, v),
  delete: (k) => kvs.delete(k),
};

export const tokenStore = createTokenStore(storage);
export const { listApiTokens, createApiToken, revokeApiToken, authenticate } = tokenStore;
