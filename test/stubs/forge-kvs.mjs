// @forge/kvs stub backed by a plain Map on globalThis, so a test can inspect exactly which keys a
// resolver wrote — the whole point of the negative case is that it writes NOTHING.

export const WhereConditions = {
  beginsWith: (prefix) => ({ op: "beginsWith", prefix }),
};

const store = () => globalThis.__FORGE__.kvs;

export const kvs = {
  get: async (key) => {
    const v = store().get(key);
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  },
  set: async (key, value) => {
    globalThis.__FORGE__.kvsWrites.push(key);
    store().set(key, JSON.parse(JSON.stringify(value)));
  },
  delete: async (key) => {
    globalThis.__FORGE__.kvsDeletes.push(key);
    store().delete(key);
  },
  query: () => {
    const state = { cond: null, limit: 100 };
    const builder = {
      where: (_field, cond) => { state.cond = cond; return builder; },
      limit: (n) => { state.limit = n; return builder; },
      cursor: () => builder,
      getMany: async () => {
        const results = [];
        for (const [key, value] of store().entries()) {
          if (state.cond?.op === "beginsWith" && !key.startsWith(state.cond.prefix)) continue;
          results.push({ key, value: JSON.parse(JSON.stringify(value)) });
          if (results.length >= state.limit) break;
        }
        return { results, nextCursor: null };
      },
    };
    return builder;
  },
};
