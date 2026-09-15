// audit A2: produce a production manifest WITHOUT the dev-only harness webtrigger.
// The `webtrigger` module (harness-test-state → test-hook.js) is what makes the app
// ineligible for the "Runs on Atlassian" program (a webtrigger CAN egress data), and it is
// a latent state-mutation backdoor if HARNESS_SECRET were ever set in prod. It is gated to
// 404 at runtime in prod, but its mere PRESENCE in the manifest blocks eligibility — so it
// must be removed from the deployed manifest for production.
//
// Usage: node scripts/strip-dev-modules.mjs <src-manifest> <out-manifest>
import { readFileSync, writeFileSync } from "node:fs";
import yaml from "js-yaml";

const [, , src = "manifest.yml", out = "manifest.prod.yml"] = process.argv;
const doc = yaml.load(readFileSync(src, "utf8"));

const modules = doc?.modules || {};
let removed = [];

// 1. Drop the DYNAMIC webtrigger module(s) only. A webtrigger whose response is `static`
// (config-api, docs/REST-CONFIG-API.md) cannot egress anything the manifest did not spell
// out and stays eligible for Runs on Atlassian — proven on staging 2026-09-15. Dropping all
// of them (the rule until today) would have shipped production without the config API.
if (Array.isArray(modules.webtrigger)) {
  const isStatic = (w) => w?.response?.type === "static";
  removed.push(...modules.webtrigger.filter((w) => !isStatic(w)).map((w) => `webtrigger:${w.key}`));
  modules.webtrigger = modules.webtrigger.filter(isStatic);
  if (!modules.webtrigger.length) delete modules.webtrigger;
}

// 2. Drop the function that backs the harness (boot.testStateTrigger).
if (Array.isArray(modules.function)) {
  const before = modules.function.length;
  modules.function = modules.function.filter((f) => f.handler !== "boot.testStateTrigger");
  if (modules.function.length !== before) removed.push("function:testStateFn (boot.testStateTrigger)");
}

writeFileSync(out, yaml.dump(doc, { lineWidth: -1, noRefs: true }));
console.log(`Wrote ${out} — removed: ${removed.length ? removed.join(", ") : "(nothing found)"}`);
if (!removed.length) { console.error("WARNING: no dev modules removed — check the manifest structure."); process.exit(1); }
