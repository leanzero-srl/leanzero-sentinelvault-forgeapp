// A config-API receipt settles WITH its mirror outcome (2026-10-21). The live spec polls the job until
// its status leaves queued/running and then reads receiptMirror; the consumer used to store "done"
// first and add receiptMirror in a second write after the Confluence round trips, so a poll landing
// between the two read a settled receipt without it (config-api.spec.ts "sentinel-vault-receipt space
// mirror: expected true, got undefined"). Pinned here: no stored settled receipt lacks receiptMirror.
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";

const { resetFake, onConfluence } = await import("./_forge-fake/state.mjs");
const { kvs } = await import("@forge/kvs");
const { runJob } = await import("../src/server/capsules/config-api/consumer.js");
const realLog = console.log;
console.warn = () => {}; console.error = () => {}; console.log = () => {}; console.info = () => {};

const SPACE = "SPC";
resetFake();
onConfluence((method, rawPath) => {
  const path = decodeURIComponent(rawPath);
  if (method === "GET" && path.startsWith("/wiki/api/v2/spaces?keys=")) return { status: 200, body: { results: [{ id: "77", key: SPACE }] } };
  if (method === "GET" && /\/wiki\/api\/v2\/spaces\/77\/properties/.test(path)) return { status: 200, body: { results: [] } };
  if (method === "POST" && path === "/wiki/api/v2/spaces/77/properties") return { status: 200, body: { id: "p1" } };
  return undefined;
});

const writes = [];
const realSet = kvs.set;
kvs.set = async (key, value, ...rest) => { if (key === "api-job-settle1") writes.push(JSON.parse(JSON.stringify(value))); return realSet(key, value, ...rest); };

await kvs.set("api-job-settle1", { id: "settle1", op: "dry-run", status: "queued", submittedBy: "acct-admin", role: "admin", submittedAt: new Date().toISOString(), bundle: { version: 1, spaces: { [SPACE]: { policy: { defaultLockDuration: 4321 } } } } });
await runJob("settle1");
kvs.set = realSet;

const settled = writes.filter((w) => !["queued", "running"].includes(w.status));
ok("the job settled", settled.length >= 1);
eq("the first settled write already carries the receipt mirror outcome", settled[0]?.receiptMirror?.spaces?.[SPACE], true);
eq("every settled write carries it", settled.every((w) => w.receiptMirror?.spaces?.[SPACE] === true), true);
eq("the stored receipt is done", (await kvs.get("api-job-settle1"))?.status, "done");

console.log = realLog;
report("config-api-receipt-settle");
