// A steward-access request names a real space, and a declined one cannot be filed again until 48
// hours after it was declined — the same rule the screen reads (check-steward-request).
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";

const { resetFake, onConfluence } = await import("./_forge-fake/state.mjs");
const { kvs } = await import("@forge/kvs");
const mod = await import("../src/server/capsules/realms/actions.js");
const realms = new Map(mod.actions);
const cooldownActive = mod.stewardRequestCooldownActive || (() => "no shared cooldown rule");
console.warn = () => {}; console.error = () => {}; console.info = () => {};
console.log = ((log) => (...a) => { if (String(a[0] || "").match(/passed|FAIL/)) log(...a); })(console.log);

const ME = "acct-requester";
const HOUR = 3600 * 1000;
function world() {
  resetFake();
  onConfluence((method, rawPath) => {
    const [base, qs = ""] = decodeURIComponent(rawPath).split("?");
    if (base === "/wiki/rest/api/user") return { body: { accountId: ME, displayName: "Requester" } };
    if (base === "/wiki/api/v2/spaces") { const k = new URLSearchParams(qs).get("keys"); return { body: { results: ["HR", "~personal1"].includes(k) ? [{ id: "1", key: k }] : [] } }; }
    return undefined;
  });
}
const request = (payload, extension = {}) => realms.get("request-steward-access")({ payload, context: { accountId: ME, extension } });
const rowKey = (k) => `steward-request-${k}-${ME}`;

// The pure rule.
const now = Date.parse("2026-10-17T12:00:00Z");
eq("cooldown: declined 1 h ago is active", cooldownActive({ status: "denied", deniedAt: new Date(now - HOUR).toISOString() }, now), true);
eq("cooldown: declined 49 h ago is over", cooldownActive({ status: "denied", deniedAt: new Date(now - 49 * HOUR).toISOString() }, now), false);
eq("cooldown: a pending request is not a cooldown", cooldownActive({ status: "pending" }, now), false);
eq("cooldown: nothing stored", cooldownActive(null, now), false);

// Declined an hour ago: asking again is refused and the decline stays.
world();
const deniedAt = new Date(Date.now() - HOUR).toISOString();
await kvs.set(rowKey("HR"), { accountId: ME, spaceKey: "HR", status: "denied", deniedAt });
const again = await request({ spaceKey: "HR" }, { space: { key: "HR" } });
eq("declined 1 h ago, asked again: refused", again?.success, false);
eq("declined 1 h ago, asked again: the decline stays", (await kvs.get(rowKey("HR")))?.status, "denied");
eq("declined 1 h ago, asked again: the screen gets the date", again?.deniedAt, deniedAt);

// Declined 49 hours ago: a new request is filed.
world();
await kvs.set(rowKey("HR"), { accountId: ME, spaceKey: "HR", status: "denied", deniedAt: new Date(Date.now() - 49 * HOUR).toISOString() });
eq("declined 49 h ago, asked again: filed", (await request({ spaceKey: "HR" }, { space: { key: "HR" } }))?.success, true);
eq("declined 49 h ago, asked again: pending", (await kvs.get(rowKey("HR")))?.status, "pending");

// An open request is not re-filed (it keeps its place in the admins' list).
world();
await kvs.set(rowKey("HR"), { accountId: ME, spaceKey: "HR", status: "pending", requestedAt: "2026-10-01T00:00:00.000Z" });
await request({ spaceKey: "HR" }, { space: { key: "HR" } });
eq("open request, asked again: the original request is kept", (await kvs.get(rowKey("HR")))?.requestedAt, "2026-10-01T00:00:00.000Z");

// A space Confluence does not know is not filed.
world();
const ghost = await request({ spaceKey: "NOSUCHSPACE" });
eq("unknown space: refused", ghost?.success, false);
ok("unknown space: nothing filed", !(await kvs.get(rowKey("NOSUCHSPACE"))) && ![...(await kvs.query().where("key", { beginsWith: "" }).getMany()).results].some((r) => r.key.includes("NOSUCHSPACE")));

// A real space named from elsewhere, and the space the caller stands in: filed (controls).
world();
eq("a real space named in the request: filed", (await request({ spaceKey: "~personal1" }))?.success, true);
world();
eq("the space the caller is in: filed", (await request({}, { space: { key: "HR" } }))?.success, true);

report("steward-request");
