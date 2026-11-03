// The public tracker's credentials lookup (scripts/public-tracker/credentials.mjs). 2026-11-03 (8.25.0 on Gabee's
// MacBook): the door deployed, then its tracker step failed with "no credentials file at ../CogniRunner/test-harness/.env"
// because the default was relative to the repo (wrong in any worktree) and that checkout has another name there. The
// tracker now finds the leanzero-demo harness credentials itself, and the door checks them before it deploys
// (the door half is pinned in test/deploy-door.test.mjs).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { eq, ok, report } from "./_assert.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CRED = path.join(root, "scripts/public-tracker/credentials.mjs");
const { resolveTrackerCredentials, trackerCredentialCandidates } = await import(pathToFileURL(CRED).href);

const home = "/home/fixture";
const good = "JIRA_ADMIN_EMAIL=admin@example.test\nJIRA_API_TOKEN=token=with=equals\n";
const fsWith = (files) => ({ exists: (p) => p in files, read: (p) => files[p] });
const msgOf = (f) => { try { f(); return ""; } catch (e) { return e.message; } };

eq("the known checkout names, in order", trackerCredentialCandidates(home), [
  `${home}/Projects/CogniRunner/test-harness/.env`,
  `${home}/Projects/leanzero-cognirunner-forgeapp/test-harness/.env`,
  `${home}/Projects/forge-live-harness/.env`,
]);
for (const c of trackerCredentialCandidates(home)) {
  eq(`PUBLIC_TRACKER_ENV unset: found at ${c}`, resolveTrackerCredentials({ env: {}, home, ...fsWith({ [c]: good }) }),
    { path: c, email: "admin@example.test", token: "token=with=equals" });
}
const [first, second] = trackerCredentialCandidates(home);
eq("a candidate without the keys is skipped", resolveTrackerCredentials({ env: {}, home, ...fsWith({ [first]: "OTHER=1\n", [second]: good }) }).path, second);
ok("PUBLIC_TRACKER_ENV set: only that file, and a missing one is named",
  /PUBLIC_TRACKER_ENV=\/nowhere\/\.env does not exist/.test(msgOf(() => resolveTrackerCredentials({ env: { PUBLIC_TRACKER_ENV: "/nowhere/.env" }, home, ...fsWith({ [first]: good }) }))));
ok("PUBLIC_TRACKER_ENV set to a file without both keys: refused",
  /lacks JIRA_ADMIN_EMAIL and JIRA_API_TOKEN/.test(msgOf(() => resolveTrackerCredentials({ env: { PUBLIC_TRACKER_ENV: "/x/.env" }, home, ...fsWith({ "/x/.env": "JIRA_ADMIN_EMAIL=a\n" }) }))));
const rel = path.resolve("rel-dir/.env");
eq("a relative PUBLIC_TRACKER_ENV is made absolute (the tracker step runs from the repo root)", resolveTrackerCredentials({ env: { PUBLIC_TRACKER_ENV: "rel-dir/.env" }, home, ...fsWith({ [rel]: good }) }).path, rel);
const none = msgOf(() => resolveTrackerCredentials({ env: {}, home, ...fsWith({}) }));
ok("nothing found: PUBLIC_TRACKER_CREDENTIALS_MISSING, every place looked and the exact fix",
  /^PUBLIC_TRACKER_CREDENTIALS_MISSING/.test(none) && trackerCredentialCandidates(home).every((c) => none.includes(c)) && none.includes("export PUBLIC_TRACKER_ENV="));

// The CLI the door calls: prints the path (never a secret) and exit 0, or the reason and exit 1.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sv-cred-"));
try {
  const run = (env) => spawnSync(process.execPath, [CRED], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: tmp, ...env } });
  let r = run({});
  ok("CLI, empty HOME: exit 1 with the reason on stderr", r.status === 1 && /PUBLIC_TRACKER_CREDENTIALS_MISSING/.test(r.stderr) && r.stdout === "");
  const harness = path.join(tmp, "Projects", "forge-live-harness", ".env");
  fs.mkdirSync(path.dirname(harness), { recursive: true });
  fs.writeFileSync(harness, "JIRA_ADMIN_EMAIL=admin@example.test\nJIRA_API_TOKEN=secret-token-value\n");
  r = run({});
  ok("CLI, forge-live-harness .env present: exit 0, prints its path and not the token", r.status === 0 && r.stdout.trim() === harness && !r.stdout.includes("secret-token-value"));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// One lookup: tracker.mjs uses it and keeps no repo-relative default.
const tracker = fs.readFileSync(path.join(root, "scripts/public-tracker/tracker.mjs"), "utf8");
ok("tracker.mjs reads its credentials through credentials.mjs", tracker.includes("resolveTrackerCredentials(") && !/"CogniRunner", "test-harness"/.test(tracker));

report("tracker-credentials");
