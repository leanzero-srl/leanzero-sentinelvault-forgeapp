import {
  DEFAULT_LEVELS, PROPERTY_KEY, decideEffective, validateLevels, nativeUnavailable,
  createNativeProvider, createAppProvider, selectProvider, mirrorProperty, isContentId,
  spaceKvsKey, pageKvsKey, LEVELS_KVS_KEY,
} from "../src/server/capsules/classification/logic.js";
import { eq, ok, report } from "./_assert.mjs";

// Part 3.1 + 3.2 — the pure core of the classification capsule. Everything the providers decide
// is exercised here with an injected KVS and an injected fetch-like `request`, the way
// notice-dedup.js is tested: no Forge runtime, no live site. Live, the Native provider is
// unreachable (scope not in the manifest; both test sites answer `[]` / 404 "Feature is disabled"),
// so THIS file is the only proof the Native provider's request shapes are right.

// ── stubs ──────────────────────────────────────────────────────────────────────────────────
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const memKvs = (seed = {}) => {
  const m = new Map(Object.entries(seed));
  return {
    m,
    get: async (k) => (m.has(k) ? m.get(k) : undefined),
    set: async (k, v) => { m.set(k, v); },
    delete: async (k) => { m.delete(k); },
  };
};
// A scripted request: routes are matched by `${method} ${path}`; unmatched → 404. Records calls.
const scripted = (table) => {
  const calls = [];
  const request = async (path, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    calls.push({ method, path, body: init.body ? JSON.parse(init.body) : undefined });
    const hit = table[`${method} ${path}`];
    if (typeof hit === "function") return hit();
    return hit || res(404, { message: "Feature is disabled" });
  };
  return { request, calls };
};

// ── isContentId: the only thing that may reach a route ─────────────────────────────────────
ok("numeric id passes", isContentId("265912321"));
ok("numeric number passes", isContentId(42));
ok("path-shaped id is refused", !isContentId("1/../../admin"));
ok("empty is refused", !isContentId(""));
ok("null is refused", !isContentId(null));

// ── decideEffective: page override > space default > none ─────────────────────────────────
{
  const L = DEFAULT_LEVELS;
  eq("page override wins", decideEffective("restricted", "internal", L).source, "page");
  eq("...and names the page level", decideEffective("restricted", "internal", L).level.id, "restricted");
  eq("no override → space default", decideEffective(null, "internal", L).source, "space");
  eq("...names the space level", decideEffective(null, "internal", L).level.id, "internal");
  eq("neither → none", decideEffective(null, null, L), { level: null, source: "none" });
  eq("a page id that no longer names a level falls through to the space", decideEffective("deleted", "internal", L).source, "space");
  eq("a space id that no longer names a level is none", decideEffective(null, "deleted", L).source, "none");
  eq("undefined is unset", decideEffective(undefined, undefined, L).source, "none");
}

// ── validateLevels ────────────────────────────────────────────────────────────────────────
{
  const v = validateLevels(DEFAULT_LEVELS);
  eq("the seeded default validates", v.ok, true);
  eq("...and comes back sorted by rank", v.levels.map((l) => l.rank), [1, 2, 3, 4]);
  eq("not an array", validateLevels(null).ok, false);
  eq("empty is refused (min 1)", validateLevels([]).ok, false);
  eq("nine levels is refused (max 8)", validateLevels(Array.from({ length: 9 }, (_, i) => ({ id: `l${i}`, name: `L${i}`, color: "#000000", rank: i + 1 }))).ok, false);
  eq("eight levels is allowed", validateLevels(Array.from({ length: 8 }, (_, i) => ({ id: `l${i}`, name: `L${i}`, color: "#000000", rank: i + 1 }))).ok, true);
  const two = (over) => [{ id: "a", name: "A", color: "#111111", rank: 1 }, { id: "b", name: "B", color: "#222222", rank: 2, ...over }];
  eq("duplicate id", validateLevels(two({ id: "a" })).ok, false);
  eq("duplicate name (case-insensitive)", validateLevels(two({ name: "a" })).ok, false);
  eq("duplicate rank", validateLevels(two({ rank: 1 })).ok, false);
  eq("non-hex colour", validateLevels(two({ color: "red" })).ok, false);
  eq("short hex is refused", validateLevels(two({ color: "#fff" })).ok, false);
  eq("rank 0 is refused", validateLevels(two({ rank: 0 })).ok, false);
  eq("fractional rank is refused", validateLevels(two({ rank: 1.5 })).ok, false);
  eq("rank as numeric string is accepted", validateLevels(two({ rank: "3" })).ok, true);
  eq("id must be a slug", validateLevels(two({ id: "Has Space" })).ok, false);
  eq("empty name is refused", validateLevels(two({ name: "  " })).ok, false);
  eq("colour is lower-cased", validateLevels(two({ color: "#ABCDEF" })).levels[1].color, "#abcdef");
  eq("name is trimmed", validateLevels(two({ name: "  Bee " })).levels[1].name, "Bee");
  eq("description is capped at 200", validateLevels(two({ description: "x".repeat(300) })).levels[1].description.length, 200);
  eq("unsorted input comes back by rank", validateLevels([two()[1], two()[0]]).levels.map((l) => l.id), ["a", "b"]);
}

// ── nativeUnavailable ─────────────────────────────────────────────────────────────────────
eq("401 → unavailable (scope not granted)", nativeUnavailable(401), true);
eq("403 → unavailable", nativeUnavailable(403), true);
eq("404 → unavailable (Feature is disabled)", nativeUnavailable(404), true);
eq("500 → unavailable", nativeUnavailable(503), true);
eq("400 is NOT unavailable (a real error, not a missing feature)", nativeUnavailable(400), false);

// ── Native provider: fallback on 403/404 and request shapes ───────────────────────────────
{
  const p = createNativeProvider(scripted({ "GET /wiki/api/v2/classification-levels": res(403, {}) }).request);
  ok("createNativeProvider takes { request }", typeof p !== "undefined");
}
{
  const { request } = scripted({ "GET /wiki/api/v2/classification-levels": res(403, { message: "scope" }) });
  eq("403 on the levels call → null (unavailable)", await createNativeProvider({ request }).listLevels(), null);
}
{
  const { request } = scripted({});
  eq("404 on the levels call → null (unavailable)", await createNativeProvider({ request }).listLevels(), null);
}
{
  const { request } = scripted({ "GET /wiki/api/v2/classification-levels": res(200, []) });
  eq("2xx with [] → [] (the live state on both test sites)", await createNativeProvider({ request }).listLevels(), []);
}
{
  const native = [
    { id: "n1", status: "PUBLISHED", order: 2, name: "Secret", description: "d", guideline: "g", color: "#ff0000" },
    { id: "n0", status: "PUBLISHED", order: 1, name: "Open", color: "#00ff00" },
    { id: "n9", status: "ARCHIVED", order: 9, name: "Old", color: "#000000" },
  ];
  const { request } = scripted({ "GET /wiki/api/v2/classification-levels": res(200, native) });
  const levels = await createNativeProvider({ request }).listLevels();
  eq("native levels are normalised to { id, name, color, rank, description }",
    levels.find((l) => l.id === "n1"), { id: "n1", name: "Secret", color: "#ff0000", rank: 2, description: "d" });
  eq("archived native levels are dropped", levels.map((l) => l.id).sort(), ["n0", "n1"]);
  eq("a `results`-wrapped body is accepted too",
    (await createNativeProvider({ request: scripted({ "GET /wiki/api/v2/classification-levels": res(200, { results: native }) }).request }).listLevels()).length, 2);
}
{
  const t = scripted({
    "PUT /wiki/api/v2/spaces/77/classification-level/default": res(200, {}),
    "DELETE /wiki/api/v2/spaces/77/classification-level/default": res(204, {}),
    "PUT /wiki/api/v2/pages/900/classification-level": res(200, {}),
    "POST /wiki/api/v2/pages/900/classification-level/reset": res(204, {}),
    "GET /wiki/api/v2/pages/900/classification-level": res(200, { id: "n1", name: "Secret" }),
    "GET /wiki/api/v2/spaces/77/classification-level/default": res(200, { id: "n0" }),
  });
  const p = createNativeProvider({ request: t.request });
  await p.setSpaceDefault("77", "n1");
  eq("space default PUT route", t.calls.at(-1).path, "/wiki/api/v2/spaces/77/classification-level/default");
  eq("space default PUT method", t.calls.at(-1).method, "PUT");
  eq("space default PUT body is { id }", t.calls.at(-1).body, { id: "n1" });
  await p.setSpaceDefault("77", null);
  eq("clearing the space default is a DELETE", t.calls.at(-1).method, "DELETE");
  await p.setPageLevel("900", "n1");
  eq("page PUT route", t.calls.at(-1).path, "/wiki/api/v2/pages/900/classification-level");
  eq("page PUT body is { id }", t.calls.at(-1).body, { id: "n1" });
  await p.resetPage("900");
  eq("reset is POST …/classification-level/reset", `${t.calls.at(-1).method} ${t.calls.at(-1).path}`, "POST /wiki/api/v2/pages/900/classification-level/reset");
  await p.setPageLevel("900", null);
  eq("setPageLevel(null) is the reset", t.calls.at(-1).path, "/wiki/api/v2/pages/900/classification-level/reset");
  eq("getPageLevel reads the id", await p.getPageLevel("900"), "n1");
  eq("getSpaceDefault reads the id", await p.getSpaceDefault("77"), "n0");
  eq("getPageLevel on a 404 page is null", await p.getPageLevel("901"), null);
  let threw = false;
  try { await p.setPageLevel("../x", "n1"); } catch (_) { threw = true; }
  ok("a non-numeric id never reaches a route (throws)", threw);
  eq("...and no call was made for it", t.calls.some((c) => c.path.includes("..")), false);
  const refused = scripted({ "PUT /wiki/api/v2/spaces/77/classification-level/default": res(403, {}) });
  let refusedThrew = false;
  try { await createNativeProvider({ request: refused.request }).setSpaceDefault("77", "n1"); } catch (_) { refusedThrew = true; }
  ok("a refused native write throws (the resolver reports it, never claims ok)", refusedThrew);
}
{
  // effectiveLevel on native: page override present → page; absent → space default via the page's spaceId.
  const levels = [{ id: "n0", status: "PUBLISHED", order: 1, name: "Open", color: "#00ff00" }, { id: "n1", status: "PUBLISHED", order: 2, name: "Secret", color: "#ff0000" }];
  const t = scripted({
    "GET /wiki/api/v2/classification-levels": res(200, levels),
    "GET /wiki/api/v2/pages/900/classification-level": res(200, { id: "n1" }),
    "GET /wiki/api/v2/pages/901": res(200, { id: "901", spaceId: "77" }),
    "GET /wiki/api/v2/spaces/77/classification-level/default": res(200, { id: "n0" }),
  });
  const p = createNativeProvider({ request: t.request });
  eq("native effective: page override", (await p.effectiveLevel("900")).source, "page");
  const e = await p.effectiveLevel("901");
  eq("native effective: falls to the space default", `${e.source}:${e.level.id}`, "space:n0");
}

// ── App provider ──────────────────────────────────────────────────────────────────────────
{
  const kvs = memKvs();
  const t = scripted({});
  const p = createAppProvider({ kvs, request: t.request });
  eq("empty KVS → the seeded default levels", (await p.listLevels()).map((l) => l.id), ["public", "internal", "confidential", "restricted"]);
  ok("seeded colours are solid hex", (await p.listLevels()).every((l) => /^#[0-9a-f]{6}$/i.test(l.color)));
  eq("no data → none", await p.effectiveLevel("1"), { level: null, source: "none" });
}
{
  const kvs = memKvs({ [LEVELS_KVS_KEY]: { levels: [{ id: "x", name: "X", color: "#123456", rank: 1 }] } });
  const p = createAppProvider({ kvs, request: scripted({}).request });
  eq("stored levels win over the default", (await p.listLevels()).map((l) => l.id), ["x"]);
  const bad = memKvs({ [LEVELS_KVS_KEY]: { levels: [{ id: "bad id" }] } });
  eq("a corrupt stored set falls back to the default rather than an empty scheme",
    (await createAppProvider({ kvs: bad, request: scripted({}).request }).listLevels()).length, 4);
}
{
  // Precedence with a stubbed KVS + fetch: page override > space default (resolved from the page) > none.
  const kvs = memKvs({ [spaceKvsKey("77")]: { levelId: "internal" }, [pageKvsKey("900")]: { levelId: "restricted" } });
  const t = scripted({
    "GET /wiki/api/v2/pages/900": res(200, { id: "900", spaceId: "77" }),
    "GET /wiki/api/v2/pages/901": res(200, { id: "901", spaceId: "77" }),
    "GET /wiki/api/v2/pages/902": res(200, { id: "902", spaceId: "78" }),
  });
  const p = createAppProvider({ kvs, request: t.request });
  const a = await p.effectiveLevel("900");
  eq("page override wins", `${a.source}:${a.level.id}`, "page:restricted");
  eq("...and the page read is NOT made when the override answers (no wasted round-trip)",
    t.calls.some((c) => c.path === "/wiki/api/v2/pages/900"), false);
  const b = await p.effectiveLevel("901");
  eq("no override → the page's space default", `${b.source}:${b.level.id}`, "space:internal");
  eq("space resolved from the PAGE via v2 pages/{id}", t.calls.some((c) => c.path === "/wiki/api/v2/pages/901"), true);
  eq("a page in a space with no default → none", (await p.effectiveLevel("902")).source, "none");
  eq("a page the app cannot read → none (not a throw)", (await p.effectiveLevel("999")).source, "none");
  eq("getPageLevel returns only the page's own override", await p.getPageLevel("901"), null);
}
{
  // Writes: KVS is written first (the read path), then the property mirror; a mirror that is
  // refused (403 — write:space:confluence is not granted live) does NOT undo the decision.
  const kvs = memKvs();
  const t = scripted({
    "GET /wiki/api/v2/spaces/77/properties?key=sentinel-classification": res(403, {}),
    "GET /wiki/api/v2/pages/900/properties?key=sentinel-classification": res(200, { results: [] }),
    "POST /wiki/api/v2/pages/900/properties": res(200, { id: "p1" }),
  });
  const logs = [];
  const p = createAppProvider({ kvs, request: t.request, log: (m) => logs.push(m) });
  await p.setSpaceDefault("77", "confidential");
  eq("space default lands in KVS", (await kvs.get(spaceKvsKey("77"))).levelId, "confidential");
  ok("the refused space-property mirror is logged, not thrown", logs.some((m) => m.includes("spaces/77") && m.includes("403")));
  await p.setPageLevel("900", "restricted");
  eq("page override lands in KVS", (await kvs.get(pageKvsKey("900"))).levelId, "restricted");
  const post = t.calls.find((c) => c.method === "POST" && c.path === "/wiki/api/v2/pages/900/properties");
  eq("content property is created with key + { levelId }", post.body, { key: PROPERTY_KEY, value: { levelId: "restricted" } });
  let threw = false;
  try { await p.setPageLevel("900", "no-such-level"); } catch (_) { threw = true; }
  ok("an unknown level id is refused at the provider, not only in the resolver", threw);
  eq("...and the stored override is untouched", (await kvs.get(pageKvsKey("900"))).levelId, "restricted");
  threw = false;
  try { await p.setSpaceDefault("77", "no-such-level"); } catch (_) { threw = true; }
  ok("same for the space default", threw);
  await p.resetPage("900");
  eq("reset deletes the KVS override", await kvs.get(pageKvsKey("900")), undefined);
  await p.setSpaceDefault("77", null);
  eq("null clears the space default", await kvs.get(spaceKvsKey("77")), undefined);
}
{
  // mirrorProperty: update path bumps the version; delete path removes the existing property.
  const t = scripted({
    "GET /wiki/api/v2/pages/5/properties?key=sentinel-classification": res(200, { results: [{ id: "pp", version: { number: 3 } }] }),
    "PUT /wiki/api/v2/pages/5/properties/pp": res(200, {}),
    "DELETE /wiki/api/v2/pages/5/properties/pp": res(204, {}),
  });
  await mirrorProperty(t.request, "/wiki/api/v2/pages/5", { levelId: "internal" });
  eq("existing property is PUT with version+1", t.calls.at(-1).body, { key: PROPERTY_KEY, value: { levelId: "internal" }, version: { number: 4 } });
  await mirrorProperty(t.request, "/wiki/api/v2/pages/5", null);
  eq("null deletes the existing property", `${t.calls.at(-1).method} ${t.calls.at(-1).path}`, "DELETE /wiki/api/v2/pages/5/properties/pp");
  const none = scripted({ "GET /wiki/api/v2/pages/6/properties?key=sentinel-classification": res(200, { results: [] }) });
  eq("null with no existing property is a no-op that reports true", await mirrorProperty(none.request, "/wiki/api/v2/pages/6", null), true);
  eq("...and makes no write", none.calls.length, 1);
}

// ── selectProvider ────────────────────────────────────────────────────────────────────────
{
  const app = createAppProvider({ kvs: memKvs(), request: scripted({}).request });
  const unavailable = createNativeProvider({ request: scripted({ "GET /wiki/api/v2/classification-levels": res(403, {}) }).request });
  eq("native 403 → app", (await selectProvider({ native: unavailable, app })).provider.name, "app");
  const empty = createNativeProvider({ request: scripted({ "GET /wiki/api/v2/classification-levels": res(200, []) }).request });
  eq("native [] (live state) → app", (await selectProvider({ native: empty, app })).provider.name, "app");
  eq("...with the app's levels", (await selectProvider({ native: empty, app })).levels.length, 4);
  const throwing = createNativeProvider({ request: async () => { throw new Error("network"); } });
  eq("native throwing → app", (await selectProvider({ native: throwing, app })).provider.name, "app");
  const live = createNativeProvider({ request: scripted({ "GET /wiki/api/v2/classification-levels": res(200, [{ id: "n0", order: 1, name: "Open", color: "#00ff00" }]) }).request });
  const sel = await selectProvider({ native: live, app });
  eq("native with levels → native", sel.provider.name, "native");
  eq("...carrying the native levels", sel.levels.map((l) => l.id), ["n0"]);
}

report("classification");
