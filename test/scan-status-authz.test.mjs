// check-audit-status: who may read a space scan record is decided by the record's own space.
import "./_forge-fake/install.mjs";
import { eq, report } from "./_assert.mjs";

const { resetFake, onConfluence } = await import("./_forge-fake/state.mjs");
const { kvs } = await import("@forge/kvs");
const realms = await import("../src/server/capsules/realms/actions.js");
const check = new Map(realms.actions).get("check-audit-status");
console.warn = () => {}; console.error = () => {};

const ADMIN_A = "acct-admin-of-A";
const ADMIN_B = "acct-admin-of-B";
const A = { key: "AAA", id: "101" };
const B = { key: "BBB", id: "202" };

async function world() {
  resetFake();
  onConfluence((method, rawPath) => {
    const path = decodeURIComponent(rawPath);
    const [base] = path.split("?");
    let m;
    if (base === "/wiki/rest/api/user") return { body: { groups: { results: [] }, operations: [] } };
    if (base === "/wiki/rest/api/user/memberof") return { body: { results: [] } };
    if ((m = base.match(/^\/wiki\/api\/v2\/spaces\/(\d+)$/))) { const s = [A, B].find((x) => x.id === m[1]); return s ? { body: { id: s.id, key: s.key } } : { status: 404 }; }
    return undefined;
  });
  await kvs.set(`admin-settings-space-${A.key}`, { adminUsers: [{ accountId: ADMIN_A }] });
  await kvs.set(`admin-settings-space-${B.key}`, { adminUsers: [{ accountId: ADMIN_B }] });
  await kvs.set(`space-scan-status-${B.id}`, { jobId: "scan_1", status: "completed", spaceKey: B.key, spaceId: B.id, stats: { artifactsScanned: 9, sealedFound: 3 } });
}
const call = (accountId, payload) => check({ payload, context: { accountId } });

await world();
eq("A's admin, key A + id B: refused", (await call(ADMIN_A, { spaceId: B.id, spaceKey: A.key }))?.status, "none");
eq("A's admin, id B only: refused", (await call(ADMIN_A, { spaceId: B.id }))?.status, "none");
eq("B's admin reads B's record", (await call(ADMIN_B, { spaceId: B.id }))?.status, "completed");
eq("B's admin, key A + id B: allowed", (await call(ADMIN_B, { spaceId: B.id, spaceKey: A.key }))?.status, "completed");
eq("no record → none", (await call(ADMIN_A, { spaceId: A.id, spaceKey: A.key }))?.status, "none");
// A record without a spaceKey is authorized on the key Confluence gives for its space id.
await kvs.set(`space-scan-status-${B.id}`, { jobId: "scan_2", status: "completed", spaceId: B.id });
eq("keyless record: A's admin refused", (await call(ADMIN_A, { spaceId: B.id, spaceKey: A.key }))?.status, "none");
eq("keyless record: B's admin allowed", (await call(ADMIN_B, { spaceId: B.id }))?.status, "completed");
await kvs.set(`space-scan-status-999`, { jobId: "scan_3", status: "completed", spaceId: "999" });
eq("keyless record of an unknown space: refused", (await call(ADMIN_A, { spaceId: "999", spaceKey: A.key }))?.status, "none");
report("scan-status-authz");
