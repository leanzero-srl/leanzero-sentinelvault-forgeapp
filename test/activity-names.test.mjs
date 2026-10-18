// BN-04 (2026-10-07): the Activity report said "Someone" for accounts the app CAN name — the stored
// actor.name was the accountId itself, the client hid it, and the reader never looked it up. The
// reader now resolves no-name / placeholder / id-as-name actors; the writer never stores an id as a
// name. One accountId rule (server/shared/account-id.js) for the writer, the readers and the UI.
import { accountToName, looksLikeAccountId } from "../src/server/shared/account-id.js";
import { decorateActorNames } from "../src/server/capsules/activity/actor-names.js";
import { actorName, looksLikeAccountId as uiLooks } from "../src/ui/kit/activity-format.js";
import { readFileSync } from "node:fs";
import { eq, ok, report } from "./_assert.mjs";

const MIHAI = "712020:937bc860-eec2-4294-a65d-8e0fe7c45086";
const LEGACY = "5b10ac8d82e05b22cc7d4ef5";

ok("a 712020:uuid id is an account id", looksLikeAccountId(MIHAI));
ok("a legacy 24-hex id is an account id", looksLikeAccountId(LEGACY));
ok("a name is not", !looksLikeAccountId("Mihai Perdum"));
ok("the UI uses the same rule", uiLooks === looksLikeAccountId);

eq("no name → look up the accountId", accountToName({ accountId: MIHAI, name: null }), MIHAI);
eq("placeholder 'Current User' → look up", accountToName({ accountId: MIHAI, name: "Current User" }), MIHAI);
eq("the id stored as the name → look up the account", accountToName({ accountId: MIHAI, name: MIHAI }), MIHAI);
eq("…even when accountId is missing, the name IS the account", accountToName({ accountId: null, name: MIHAI }), MIHAI);
eq("a real name → nothing to look up", accountToName({ accountId: MIHAI, name: "Gabriela" }), null);
eq("no actor (the app) → nothing", accountToName(null), null);
eq("no id and no name → nothing", accountToName({ accountId: null, name: null }), null);

const calls = [];
const resolve = async (id) => { calls.push(id); if (id === "boom") throw new Error("x"); return id === MIHAI ? "Mihai Perdum" : null; };
const entries = [
  { id: 1, actor: { accountId: MIHAI, name: MIHAI } },         // the breaker's row
  { id: 2, actor: { accountId: null, name: MIHAI } },
  { id: 3, actor: { accountId: MIHAI, name: null } },
  { id: 4, actor: { accountId: "gone", name: null } },         // Atlassian names nothing → kept
  { id: 5, actor: { accountId: "boom", name: null } },         // lookup throws → kept
  { id: 6, actor: { accountId: MIHAI, name: "Kept Name" } },   // a real name is never replaced
  { id: 7, actor: null },
];
const out = await decorateActorNames(entries, resolve);
eq("rows 1-3 are named, 4-5 keep what was stored, 6 keeps its name, 7 is the app", out.map((e) => e.actor?.name ?? null), ["Mihai Perdum", "Mihai Perdum", "Mihai Perdum", null, null, "Kept Name", null]);
eq("…and the report then reads the name, not 'Someone'", out.slice(0, 3).map(actorName), ["Mihai Perdum", "Mihai Perdum", "Mihai Perdum"]);
eq("an unresolvable account still reads 'Someone' (never the id)", actorName(out[3]), "Someone");
eq("row 2 gains its accountId", out[1].actor.accountId, MIHAI);
eq("one lookup per distinct account", [...calls].sort(), ["boom", "gone", MIHAI].sort());
eq("nothing to resolve → no lookups, same list", (await decorateActorNames([{ actor: { accountId: "a", name: "A" } }], async () => { throw new Error("must not be called"); })).length, 1);

// 8.12.0 (found by the revert-record live spec, 2026-10-18): the EDITOR named in a row's details (an
// Approved page restored or moved back, a sealed file put back) was printed as the raw accountId —
// "712020:6c8d… edited the Approved page" in the page's Activity — because only the actor was looked
// up. The reader names the details' editor the same way, and the UI never prints an id as a name.
{
  const { formatActivity } = await import("../src/ui/kit/activity-format.js");
  const rows = [
    { id: "r1", type: "workflow.enforced", actor: { accountId: null, name: null }, details: { mode: "revert", editor: MIHAI, restoredTo: 1 }, version: 3 },
    { id: "r2", type: "workflow.enforced", actor: { accountId: null, name: null }, details: { mode: "demote", editor: MIHAI, editorName: "Kept Editor" }, version: 3 },
    { id: "r3", type: "seal.edit-reverted", actor: { accountId: null, name: null }, details: { editor: MIHAI, restoredTo: 2 }, version: 4 },
  ];
  const named = await decorateActorNames(rows, async (id) => (id === MIHAI ? "Mihai Perdum" : null));
  eq("the details' editor is named at read time", named.map((e) => e.details?.editorName ?? null), ["Mihai Perdum", "Kept Editor", "Mihai Perdum"]);
  ok("the restored-page row reads the editor's name", /^Mihai Perdum edited the Approved page/.test(formatActivity(named[0]).sentence));
  const unnamed = await decorateActorNames(rows, async () => null);
  for (const e of unnamed) ok(`an editor nobody can name is never printed as an id (${e.type})`, !String(formatActivity(e).sentence).includes(MIHAI));
}

// The writer guard and both readers are wired (a pure helper nobody calls fixes nothing).
const log = readFileSync(new URL("../src/server/infra/activity-log.js", import.meta.url), "utf8");
ok("recordActivity resolves a no-name / id-as-name actor before storing", /const lookup = accountToName\(actor\);/.test(log) && /else if \(looksLikeAccountId\(actor\.name\)\) actor\.name = null;/.test(log));
const act = readFileSync(new URL("../src/server/capsules/activity/actions.js", import.meta.url), "utf8");
ok("get-page-activity decorates names", /entries: await decorateActorNames\(entries\)/.test(act));
ok("get-space-activity decorates names", /decorateActorNames\(await decoratePageTitles\(/.test(act));
ok("the reader uses the shared resolver", /decorateNames\(entries, resolveActorName\)/.test(act));

report("activity-names");
