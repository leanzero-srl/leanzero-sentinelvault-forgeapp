// Fake @forge/kvs: an in-memory Map with the slice of the query API the server uses
// (where key beginsWith, limit, cursor, getMany). TTL options are accepted and ignored.
import { fake } from "./state.mjs";

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export const WhereConditions = { beginsWith: (prefix) => ({ beginsWith: prefix }) };
export const MetadataField = { CREATED_AT: "CREATED_AT", UPDATED_AT: "UPDATED_AT", EXPIRE_TIME: "EXPIRE_TIME" };

function query() {
  const q = { prefix: "", limit: 100, cursor: 0 };
  const api = {
    where: (_field, cond) => { q.prefix = cond?.beginsWith || ""; return api; },
    limit: (n) => { q.limit = n; return api; },
    cursor: (c) => { q.cursor = Number(c) || 0; return api; },
    getMany: async () => {
      const keys = [...fake.kvs.keys()].filter((k) => k.startsWith(q.prefix)).sort();
      const slice = keys.slice(q.cursor, q.cursor + q.limit);
      const next = q.cursor + q.limit < keys.length ? String(q.cursor + q.limit) : undefined;
      return { results: slice.map((key) => ({ key, value: clone(fake.kvs.get(key)) })), nextCursor: next };
    },
  };
  return api;
}

export const kvs = {
  get: async (key) => clone(fake.kvs.get(key)),
  set: async (key, value) => { fake.kvs.set(key, clone(value)); },
  delete: async (key) => { fake.kvs.delete(key); },
  query,
  batchSet: async (items) => { for (const { key, value } of items || []) fake.kvs.set(key, clone(value)); return { successfulKeys: (items || []).map((i) => ({ key: i.key })), failedKeys: [] }; },
  getSecret: async (key) => clone(fake.kvs.get(`secret:${key}`)),
  setSecret: async (key, value) => { fake.kvs.set(`secret:${key}`, clone(value)); },
  deleteSecret: async (key) => { fake.kvs.delete(`secret:${key}`); },
  transact: () => { throw new Error("fake kvs: transact not implemented"); },
};
