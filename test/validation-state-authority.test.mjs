// A page's validation status comes from the app's own KVS row, never from its page property.
//
// `sentinel-vault-validation` mirrors the status for CQL and the UI; anyone who may edit the page may
// also write that property. So the status the panel shows, the "Approve anyway" attribution and its
// same-version re-check rule, and the "previous" state an activity row records are read from KVS
// `validation-state-{pageId}`. A property with no KVS row (a status written before 8.14.0, or one
// written by hand) reads as not checked yet. The mirror carries no account ids. Real modules, fake.
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";

const { resetFake, onConfluence } = await import("./_forge-fake/state.mjs");
const { createWorld } = await import("./_forge-fake/confluence-world.mjs");
const triggers = await import("../src/server/triggers.js");
const { kvs, WhereConditions } = await import("@forge/kvs");
const vActions = new Map((await import("../src/server/capsules/validations/actions.js")).actions);
const vlogic = await import("../src/server/capsules/validations/logic.js");
const { rulesFingerprint } = await import("../src/server/capsules/validations/recheck.js");

const APP = "app-account", EDITOR = "712020:aaaaaaaa-1111-2222-3333-444444444444", FORGED_ADMIN = "712020:bbbbbbbb-1111-2222-3333-444444444444";
const SPACE = "WF", PAGE = "891";
const RULES = [{ id: "r1", type: "required-heading", severity: "block", enabled: true, config: { text: "Scope" } }];
const para = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const failing = { version: 1, type: "doc", content: [para("no heading here")] };
const PROP = "sentinel-vault-validation";

async function bed() {
  resetFake();
  const w = createWorld({ appAccountId: APP, spaceKey: SPACE });
  w.addUser(APP).addUser(EDITOR, { displayName: "Eve" }).addUser(FORGED_ADMIN, { displayName: "Ada" })
    .addPage(PAGE, { versions: [{ authorId: EDITOR, adf: failing }, { authorId: EDITOR, adf: failing }] });
  w.readers.add("*");
  onConfluence((method, rawPath) => (/\/labels/.test(decodeURIComponent(rawPath)) ? { body: { results: [], _links: {} } } : undefined));
  await kvs.set("app-account-id", APP);
  await kvs.set("admin-settings-global", { enableContentProtection: true });
  await kvs.set("validation-config-global", { enabled: true, modes: { advisory: false, gate: true, revert: false }, rules: RULES });
  // The editor writes the property by hand: "passed, approved by a space admin", for the live version.
  w.pages.get(PAGE).props.set(PROP, { id: "950", version: 1, value: { state: "passed", violations: [], version: 2, approvedBy: FORGED_ADMIN, approvedAt: new Date().toISOString(), checkedAt: new Date().toISOString(), rulesFp: rulesFingerprint(RULES) } });
  return w;
}
const ctx = (accountId) => ({ accountId, extension: { content: { id: PAGE, type: "page", space: { key: SPACE } }, space: { key: SPACE } } });

const log = { info: console.info, warn: console.warn, error: console.error, log: console.log };
console.info = console.warn = console.error = console.log = () => {};
try {
  // 1. The panel's status.
  {
    await bed();
    const r = await vActions.get("get-validation-state")({ payload: { pageId: PAGE }, context: ctx(EDITOR) });
    ok("[1] a forged property is not shown as the page's status", r?.state?.state !== "passed");
    ok("[1] ...and never carries the forged approver", !JSON.stringify(r || {}).includes(FORGED_ADMIN));
    eq("[1] the panel is told the page has not been checked yet (it checks it now)", r?.applies, true);
  }
  // 2. Re-check of the same version: the forged "approved" does not shield it.
  {
    await bed();
    const r = await vActions.get("recheck-page-validation")({ payload: { pageId: PAGE }, context: ctx(EDITOR) });
    eq("[2] the re-check is stored (no 'approved' shield from the property)", r?.persisted, true);
    eq("[2] ...as failed, in KVS", (await kvs.get(`validation-state-${PAGE}`))?.state, "failed");
  }
  // 3. The activity row's "previous".
  {
    const w = await bed();
    w.pages.get(PAGE).versions.push({ number: 3, authorId: EDITOR, adf: failing });
    await triggers.pageContentTrigger({ eventType: "avi:confluence:updated:page", atlassianId: EDITOR, content: { id: PAGE, version: { number: 3 } }, space: { key: SPACE } });
    const { results } = await kvs.query().where("key", WhereConditions.beginsWith(`activity-page-${PAGE}-`)).limit(100).getMany();
    const row = (results || []).map((x) => x.value).find((v) => v?.type === "validation.gate");
    ok("[3] the gate change was recorded", !!row);
    ok("[3] ...with no 'previous: passed' taken from the property", row?.details?.previous !== "passed");
  }
  // 4. Once written, KVS is what counts; the mirror carries no account ids.
  {
    const w = await bed();
    await vlogic.writeValidationState(PAGE, { state: "passed", violations: [], version: 2, approvedBy: FORGED_ADMIN, approvedAt: "t", checkedBy: EDITOR, checkedAt: "t", rulesFp: rulesFingerprint(RULES) });
    const mirror = w.prop(PAGE, PROP);
    ok("[4] the page mirror carries no account id", !JSON.stringify(mirror).includes(FORGED_ADMIN) && !JSON.stringify(mirror).includes(EDITOR));
    eq("[4] ...but says it was approved", mirror?.approved, true);
    w.pages.get(PAGE).props.get(PROP).value = { state: "failed", version: 2 }; // the property is changed by hand afterwards
    eq("[4] a later change to the property does not change the status", (await vlogic.readValidationState(PAGE))?.state, "passed");
  }
  // 6. The KVS row cannot be read: a space admin's "Approve anyway" is never written over.
  {
    await bed();
    const approved = { state: "passed", violations: [], version: 2, approvedBy: FORGED_ADMIN, approvedAt: "t", checkedAt: "t", rulesFp: rulesFingerprint(RULES) };
    await kvs.set(`validation-state-${PAGE}`, approved);
    const realGet = kvs.get;
    kvs.get = async (k) => { if (String(k).startsWith("validation-state-")) throw new Error("kvs down"); return realGet(k); };
    let re, st;
    try {
      re = await vActions.get("recheck-page-validation")({ payload: { pageId: PAGE }, context: ctx(EDITOR) });
      st = await vActions.get("get-validation-state")({ payload: { pageId: PAGE }, context: ctx(EDITOR) });
    } finally { kvs.get = realGet; }
    eq("[6] unreadable status: the re-check stores nothing", re?.persisted, false);
    ok("[6] ...and says the status could not be read", /could not read this page's validation status/i.test(re?.failureReason || ""));
    eq("[6] the Approve anyway row is untouched", (await kvs.get(`validation-state-${PAGE}`))?.approvedBy, FORGED_ADMIN);
    ok("[6] the panel is told the status could not be read (not 'not checked')", st?.unknown === true && st?.applies !== true);
  }
  // 7. Pass/fail status off: an unreadable row is not reported as "could not read" (there is no status to show).
  {
    await bed();
    await kvs.set("validation-config-global", { enabled: true, modes: { advisory: true, gate: false, revert: false }, rules: RULES });
    const realGet = kvs.get;
    kvs.get = async (k) => { if (String(k).startsWith("validation-state-")) throw new Error("kvs down"); return realGet(k); };
    let st;
    try { st = await vActions.get("get-validation-state")({ payload: { pageId: PAGE }, context: ctx(EDITOR) }); } finally { kvs.get = realGet; }
    eq("[7] gate off: no status and no 'could not read'", [st?.state ?? null, st?.unknown === true], [null, false]);
  }
} finally { Object.assign(console, log); }
// 5. The status row is backed up, and erasure reaches its page mirror.
{
  const { familyOf } = await import("../src/server/capsules/backup/families.js");
  eq("[5] validation-state- is backed-up configuration", familyOf("validation-state-123").cls, "config");
  const src = (await import("node:fs")).readFileSync(new URL("../src/server/capsules/privacy/worker.js", import.meta.url), "utf8");
  ok("[5] an erasure rewrites the page mirror from the erased status", /validation-state-[\s\S]{0,400}mirrorValidationState/.test(src));
}
report("validation-state-authority");
