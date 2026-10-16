// Shared state of the fake Forge runtime: one KVS map and one Confluence route table, reset per
// scenario with resetFake(). Lives on globalThis so every fake module (and the test) sees the same
// instance whichever URL it was loaded through.
const G = globalThis;
if (!G.__svForgeFake) G.__svForgeFake = { kvs: new Map(), handlers: [], calls: [], unhandled: [] };
export const fake = G.__svForgeFake;

export function resetFake() {
  fake.kvs = new Map();
  fake.handlers = [];
  fake.calls = [];
  fake.unhandled = [];
}

/** Register a Confluence route: `match(method, path, body)` returns a response spec or undefined. */
export function onConfluence(match) { fake.handlers.push(match); }

export function respond(status, body) {
  const text = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(),
    json: async () => (text ? JSON.parse(text) : null),
    text: async () => text,
  };
}

export async function dispatchConfluence(path, init = {}) {
  const method = (init.method || "GET").toUpperCase();
  let body = null;
  try { body = init.body ? JSON.parse(init.body) : null; } catch (_) { body = init.body; }
  fake.calls.push({ method, path, body });
  for (let i = fake.handlers.length - 1; i >= 0; i--) {
    const r = await fake.handlers[i](method, path, body);
    if (r) return respond(r.status ?? 200, r.body);
  }
  fake.unhandled.push(`${method} ${path}`);
  return respond(404, { message: "fake: no handler" });
}
