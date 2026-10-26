// Review findings 1, 2 and 3 on the site-wide AI allowance (allowance.js), through the real
// resolvers: a save during a licence-count outage must not shrink a big site's stored setting
// (finding 1), a refused count read is LOGGED in the action log with no user data (finding 3), and
// the admin's dollar field keeps what is typed until it is left (finding 2, pure helpers + source).
import "./_forge-fake/install.mjs";
import { readFileSync } from "node:fs";
import { eq, ok, report } from "./_assert.mjs";

const { resetFake, onConfluence } = await import("./_forge-fake/state.mjs");
const { kvs } = await import("@forge/kvs");
const validations = new Map((await import("../src/server/capsules/validations/actions.js")).actions);
const { COUNT_KEY, PER_USER_MICRO } = await import("../src/server/capsules/validations/allowance.js");
const { acceptDraft, commitDraft, draftOf } = await import("../src/ui/kit/allowance-input.js");

const SITE_ADMIN = "acct-site-admin";
const lines = [];
const keep = (...a) => lines.push(a.map(String).join(" "));
console.error = keep; console.warn = keep; console.log = ((log) => (...a) => { keep(...a); if (/passed|FAIL/.test(String(a[0] || ""))) log(...a); })(console.log);

let count = { status: 500, body: {} };
resetFake();
onConfluence((method, rawPath) => {
  const [base, q = ""] = decodeURIComponent(rawPath).split("?");
  if (base === "/wiki/rest/api/user") {
    const acct = new URLSearchParams(q).get("accountId");
    return { body: { accountId: acct, groups: { results: [] }, operations: acct === SITE_ADMIN ? [{ operation: "administer", targetType: "application" }] : [] } };
  }
  if (base === "/wiki/rest/license/1.0/license/userCount") return count;
  return undefined;
});
await kvs.set("validation-config-global", { enabled: true, rules: [], modes: { advisory: true }, ai: { enabled: true } });
const store = validations.get("store-validation-config");
const load = validations.get("load-validation-config");
const asAdmin = { accountId: SITE_ADMIN, extension: {} };

// Finding 1: the count read is refused (outage -> 10-user fallback, $0.30) while the admin saves
// $5.00 on a 500-user site ($15.24 default).
const asked = 5_000_000;
const r = await store({ payload: { scope: "global", data: { enabled: true, rules: [], modes: { advisory: true }, ai: { enabled: true, monthlyAllowanceMicro: asked } } }, context: asAdmin });
eq("save during a count outage succeeds", r?.success, true);
eq("finding 1: the stored value is what the admin asked, not the outage default", (await kvs.get("validation-config-global"))?.ai?.monthlyAllowanceMicro, asked);

// Finding 3: the admin's view during the outage reads the count, is refused, falls back to 10 users
// and prints ONE action-log line: status, no site, page or account data.
const during = await load({ payload: { scope: "global" }, context: asAdmin });
eq("outage: the view says fallback, 10 users, limit capped at the 10-user default", [during?.aiAllowance?.userSource, during?.aiAllowance?.users, during?.aiAllowance?.limitMicro], ["fallback", 10, 10 * PER_USER_MICRO]);
const logLine = lines.find((l) => l.includes('"action":"ai.licensed-user-count"'));
ok("finding 3: a refused userCount read is in the action log", !!logLine);
const parsed = JSON.parse(logLine || "{}");
eq("finding 3: the line names the status and step", [parsed.lz, parsed.outcome, parsed.status, parsed.step], ["action", "error", 500, "user-count"]);
ok("finding 3: no account id or site data on the line", !/acct-|wolfaenpak|atlassian\.net/.test(logLine || ""));

// The count is back: the read side gives the lowered $5.00 (below the 500-user default).
count = { status: 200, body: { count: 500 } };
await kvs.delete(COUNT_KEY);
const cfg = await load({ payload: { scope: "global" }, context: asAdmin });
eq("count back: limit = the admin's $5.00, lowered", [cfg?.aiAllowance?.limitMicro, cfg?.aiAllowance?.lowered, cfg?.aiAllowance?.userSource], [asked, true, "count"]);
eq("…default is 500 users", cfg?.aiAllowance?.defaultMicro, 500 * PER_USER_MICRO);
// Never raises: a stored value above the default reads as the default.
await store({ payload: { scope: "global", data: { enabled: true, rules: [], modes: { advisory: true }, ai: { enabled: true, monthlyAllowanceMicro: 999_000_000 } } }, context: asAdmin });
const hi = await load({ payload: { scope: "global" }, context: asAdmin });
eq("a stored value above the default reads as the default (never raises)", [hi?.aiAllowance?.limitMicro, hi?.aiAllowance?.lowered], [500 * PER_USER_MICRO, false]);

// Finding 2: the field keeps the typed text; it converts and clamps only when left.
let t = "";
for (const k of ["0", "0.", "0.0", "0.05"]) t = acceptDraft(t, k);
eq("finding 2: '0.05' can be typed key by key", t, "0.05");
eq("…and commits as 50,000 micro", commitDraft(t, 304800), 50000);
eq("'1' is kept while typing", acceptDraft("", "1"), "1");
eq("…and on leaving, at or above the default it means the default (0)", commitDraft("1", 304800), 0);
eq("letters are refused", acceptDraft("0.1", "0.1x"), "0.1");
eq("empty = default", commitDraft("", 304800), 0);
eq("stored micro shows as dollars", draftOf(50000), "0.05");
const card = readFileSync(new URL("../src/ui/kit/AiAllowanceCard.jsx", import.meta.url), "utf8");
const onChange = (card.match(/onChange=\{([\s\S]*?)\}\s*\n/) || [])[1] || "";
ok("finding 2: the card's onChange only edits the draft (no onLower per keystroke)", onChange.includes("setDraft") && !onChange.includes("onLower"));
ok("finding 2: the card commits on blur", /onBlur=\{[\s\S]*commitDraft[\s\S]*onLower/.test(card));
ok("finding 2: not a native number input (type=number rewrites '0.' to empty)", !/type="number"/.test(card));

report("ai-allowance-store");
