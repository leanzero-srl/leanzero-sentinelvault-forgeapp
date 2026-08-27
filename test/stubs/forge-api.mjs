// @forge/api stub. Every HTTP call funnels into globalThis.__FORGE__.handle(as, url, opts), which
// the test sets per-scenario. Requests are recorded so a test can assert that NO write happened.

export function route(strings, ...values) {
  return strings.reduce(
    (acc, s, i) => acc + s + (i < values.length ? encodeURIComponent(String(values[i])) : ""),
    "",
  );
}

function makeResponse({ status = 200, body = {} }) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(text),
    text: async () => text,
  };
}

function client(as) {
  return {
    requestConfluence: async (url, opts = {}) => {
      const mock = globalThis.__FORGE__;
      const method = (opts.method || "GET").toUpperCase();
      mock.calls.push({ as, method, url, body: opts.body });
      const res = await mock.handle({ as, method, url, opts });
      return makeResponse(res || { status: 500, body: { message: "no stub route" } });
    },
    requestJira: async () => makeResponse({ status: 404, body: {} }),
  };
}

export const asApp = () => client("app");
export const asUser = () => client("user");
export const getAppContext = () => globalThis.__FORGE__.appContext || null;
