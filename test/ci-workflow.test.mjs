// Pins .github/workflows/ci.yml (2026-10-11). The repo is PUBLIC and CI runs on a SELF-HOSTED
// runner (the workhorse Mac Studio): a fork must never be able to run code on it, and a job moved
// back to a GitHub-hosted runner dies in ~3 s because Actions billing is off on leanzero-srl.
// Runs as a step of the workflow itself (not in `npm test`, so package.json stays untouched).
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { ok, eq, report } from "./_assert.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = resolve(root, ".github/workflows");
const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
ok("ci.yml exists", files.includes("ci.yml"));

for (const f of files) {
  const text = readFileSync(resolve(dir, f), "utf8");
  const wf = yaml.load(text);
  const on = wf.on ?? wf[true]; // js-yaml 4 keeps `on` as a string key; guard anyway
  const triggers = typeof on === "string" ? [on] : Array.isArray(on) ? on : Object.keys(on || {});
  for (const t of triggers) ok(`${f}: trigger ${t} is push/workflow_dispatch only`, t === "push" || t === "workflow_dispatch");
  ok(`${f}: no pull_request_target anywhere`, !/pull_request_target/.test(text.replace(/^\s*#.*$/gm, "")));
  if (on?.push) eq(`${f}: push only to main`, on.push.branches, ["main"]);
  eq(`${f}: permissions contents: read`, wf.permissions, { contents: "read" });
  for (const [id, job] of Object.entries(wf.jobs || {})) {
    const runsOn = [].concat(job["runs-on"]);
    ok(`${f}/${id}: runs on [self-hosted, sentinelvault]`, runsOn[0] === "self-hosted" && runsOn.includes("sentinelvault"));
    ok(`${f}/${id}: fork guard (repo + actor)`, /github\.repository == 'leanzero-srl\/leanzero-sentinelvault-forgeapp'/.test(job.if || "") && /github\.actor == 'leanzero-srl'/.test(job.if || ""));
    for (const s of job.steps || []) {
      if (!s.uses) continue;
      ok(`${f}/${id}: ${s.uses} pinned to a full commit SHA`, /@[0-9a-f]{40}$/.test(s.uses));
      ok(`${f}/${id}: ${s.uses} is not cache/upload-artifact (GitHub storage)`, !/actions\/(cache|upload-artifact)/.test(s.uses));
      if (/actions\/checkout/.test(s.uses)) eq(`${f}/${id}: checkout does not persist the token`, s.with?.["persist-credentials"], false);
    }
  }
}
const ci = yaml.load(readFileSync(resolve(dir, "ci.yml"), "utf8"));
const runs = Object.values(ci.jobs).flatMap((j) => (j.steps || []).map((s) => s.run || ""));
ok("ci.yml: npm audit --omit=dev --audit-level=high is a gate (GHSA-c8x8-7fp4-3x9w, 2026-10-11)", runs.some((r) => /npm audit --omit=dev --audit-level=high\b/.test(r)));
report("ci-workflow");
