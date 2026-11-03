/*
 * Sentinel Vault - the public tracker's credentials lookup.
 * Copyright (c) 2025-2026 LeanZero SRL.
 */

// The leanzero-demo harness admin (JIRA_ADMIN_EMAIL + JIRA_API_TOKEN), never printed. One lookup for tracker.mjs and
// the release door (scripts/deploy-prod.sh). PUBLIC_TRACKER_ENV, when set, is the only file used; otherwise the harness
// .env under each name it has on LeanZero's Macs. 2026-11-03: the door deployed 8.25.0 on Gabee's MacBook, then its
// tracker step failed with "no credentials file at ../CogniRunner/test-harness/.env": the default was relative to the
// repo (so wrong in every worktree) and that checkout is called leanzero-cognirunner-forgeapp there. Same fix as Cost
// Slasher's door (lz-license-manager a2615ecc). Guard: test/tracker-credentials.test.mjs, test/deploy-door.test.mjs.
//
//   node scripts/public-tracker/credentials.mjs   # prints the file it would use (exit 0), or why not and the fix (exit 1)
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const trackerCredentialCandidates = (home = homedir()) => [
  join(home, "Projects", "CogniRunner", "test-harness", ".env"),
  join(home, "Projects", "leanzero-cognirunner-forgeapp", "test-harness", ".env"),
  join(home, "Projects", "forge-live-harness", ".env"),
];

export function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("="); // the API token itself can contain '='
    if (eq === -1) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[line.slice(0, eq).trim()] = val;
  }
  return out;
}

const keysOf = (read, path) => {
  const env = parseEnv(read(path));
  return env.JIRA_ADMIN_EMAIL && env.JIRA_API_TOKEN ? { email: env.JIRA_ADMIN_EMAIL, token: env.JIRA_API_TOKEN } : null;
};
const FIX = "Put the leanzero-demo harness admin's JIRA_ADMIN_EMAIL and JIRA_API_TOKEN in one of those files, or run: export PUBLIC_TRACKER_ENV=<path to a .env that has them>";

/** { path, email, token } or a PUBLIC_TRACKER_CREDENTIALS_MISSING error naming every place looked and the fix. */
export function resolveTrackerCredentials({ env = process.env, home = homedir(), exists = existsSync, read = (p) => readFileSync(p, "utf8") } = {}) {
  // Absolute, so the door's check and the tracker step (run from the repo root) read the same file.
  const named = env.PUBLIC_TRACKER_ENV ? resolve(env.PUBLIC_TRACKER_ENV) : "";
  if (named) {
    if (!exists(named)) throw new Error(`PUBLIC_TRACKER_CREDENTIALS_MISSING: PUBLIC_TRACKER_ENV=${named} does not exist. ${FIX}`);
    const keys = keysOf(read, named);
    if (!keys) throw new Error(`PUBLIC_TRACKER_CREDENTIALS_MISSING: PUBLIC_TRACKER_ENV=${named} lacks JIRA_ADMIN_EMAIL and JIRA_API_TOKEN. ${FIX}`);
    return { path: named, ...keys };
  }
  const looked = trackerCredentialCandidates(home);
  for (const path of looked) {
    if (!exists(path)) continue;
    const keys = keysOf(read, path);
    if (keys) return { path, ...keys };
  }
  throw new Error(`PUBLIC_TRACKER_CREDENTIALS_MISSING: no file with JIRA_ADMIN_EMAIL and JIRA_API_TOKEN at ${looked.join(", ")}. ${FIX}`);
}

const self = (() => { try { return realpathSync(fileURLToPath(import.meta.url)); } catch { return null; } })();
const invoked = (() => { try { return process.argv[1] ? realpathSync(process.argv[1]) : null; } catch { return null; } })();
if (self && self === invoked) {
  try { console.log(resolveTrackerCredentials().path); }
  catch (e) { console.error(e && e.message); process.exit(1); }
}
