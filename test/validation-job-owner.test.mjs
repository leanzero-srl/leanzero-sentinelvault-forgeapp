// An AI review's progress row (which carries the result: title, summary, excerpts of the page) is
// read only by the person who started the review.
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";
import { readFileSync } from "node:fs";

const { resetFake } = await import("./_forge-fake/state.mjs");
const { kvs } = await import("@forge/kvs");
const validations = new Map((await import("../src/server/capsules/validations/actions.js")).actions);
const { aiValidationConsumer } = await import("../src/server/capsules/validations/ai-worker.js");
console.warn = () => {}; console.error = () => {}; console.info = () => {};
console.log = ((log) => (...a) => { if (String(a[0] || "").match(/passed|FAIL/)) log(...a); })(console.log);

const OWNER = "acct-owner";
const OTHER = "acct-other";
const get = (accountId, taskId) => validations.get("get-validation-job")({ payload: { taskId }, context: { accountId, extension: {} } });
const DONE = { status: "done", result: { pageTitle: "Secret plan", summary: "S", findings: [{ excerpt: "quoted text" }] } };

resetFake();
await kvs.set("ai-validation-status-T1", { ...DONE, requestedBy: OWNER });
const peek = await get(OTHER, "T1");
ok("someone else asks for the job: no result", !JSON.stringify(peek).includes("Secret plan"));
eq("someone else asks for the job: the same answer as a job not there yet", peek, { status: "pending" });
ok("someone else asks for the job: the row is left for its owner", !!(await kvs.get("ai-validation-status-T1")));
eq("the owner asks: the result", (await get(OWNER, "T1"))?.result?.pageTitle, "Secret plan");
ok("the owner reads a finished job: the row is cleared", !(await kvs.get("ai-validation-status-T1")));

// A row from before rows carried their requester (at most an hour old) answers as before.
await kvs.set("ai-validation-status-T2", DONE);
eq("a row with no requester: answered", (await get(OWNER, "T2"))?.status, "done");

// The worker keeps the requester on every row it writes (the spend gate refuses here: site AI off).
resetFake();
await aiValidationConsumer({ body: { taskId: "T3", pageId: "42", spaceKey: "HR", realmKey: "HR", requestedBy: OWNER } });
eq("the worker's row keeps the requester", (await kvs.get("ai-validation-status-T3"))?.requestedBy, OWNER);
eq("someone else asks for the worker's row: nothing", (await get(OTHER, "T3"))?.status, "pending");

// The job id is not guessable: no Math.random / clock ids.
const src = readFileSync(new URL("../src/server/capsules/validations/actions.js", import.meta.url), "utf8");
ok("the review's job id is a random UUID", /aival_\$\{randomUUID\(\)\}/.test(src) && !/aival_\$\{Date\.now\(\)\}/.test(src));

report("validation-job-owner");
