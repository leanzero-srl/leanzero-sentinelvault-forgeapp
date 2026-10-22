/*
 * Sentinel Vault - does the installed node_modules match package-lock.json? (the production door's dependency check)
 * Copyright (c) 2025-2026 LeanZero SRL.
 */

// Forge bundles the app's backend from the checkout's ROOT node_modules, so a production deploy ships whatever is
// installed there, not what package-lock.json says. A checkout that was never `npm ci`-ed after a lockfile change, or a
// worktree whose node_modules is a symlink to another checkout's, ships other dependencies than the commit being
// released. Run by scripts/deploy-prod.sh before anything is written or built:
//
//   node scripts/check-installed-deps.mjs [repo dir]     # exit 0 = matches, 1 = does not (each problem printed), 2 = cannot tell
//
// Every non-dev package in the lockfile's `packages` (lockfile v2/v3) must be installed at its path with exactly the
// locked version; an optional package may be absent (a platform-specific build), but if present it must match.
// Dev-only packages (dev / devOptional) are not shipped and are not checked. A root node_modules that is a symlink is
// refused outright: it belongs to another checkout.

import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The problems with `repo`'s installed dependencies; [] when they match the lockfile. Throws when it cannot tell. */
export function installedDepsProblems(repo) {
  const lockFile = join(repo, "package-lock.json");
  if (!existsSync(lockFile)) throw new Error("package-lock.json is missing");
  const lock = JSON.parse(readFileSync(lockFile, "utf8"));
  if (!lock.packages || typeof lock.packages !== "object" || !(lock.lockfileVersion >= 2)) {
    throw new Error(`package-lock.json has no "packages" map (lockfileVersion ${lock.lockfileVersion}); the installed tree cannot be checked`);
  }
  const nm = join(repo, "node_modules");
  let st = null;
  try { st = lstatSync(nm); } catch { st = null; }
  if (!st) return ["node_modules is not installed"];
  if (st.isSymbolicLink()) return ["node_modules is a symlink (another checkout's dependencies)"];
  const problems = [];
  for (const [path, meta] of Object.entries(lock.packages)) {
    if (!path.startsWith("node_modules/") || !meta || meta.dev || meta.devOptional) continue;
    if (meta.link) {
      if (!existsSync(join(repo, path))) problems.push(`${path}: the linked package is missing`);
      continue;
    }
    const pj = join(repo, path, "package.json");
    let installed = null;
    try { installed = JSON.parse(readFileSync(pj, "utf8")); } catch { installed = null; }
    if (!installed) {
      if (!meta.optional) problems.push(`${path}: not installed (locked ${meta.version})`);
      continue;
    }
    if (meta.version && installed.version !== meta.version) problems.push(`${path}: installed ${installed.version}, locked ${meta.version}`);
  }
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repo = resolve(process.argv[2] || join(fileURLToPath(import.meta.url), "..", ".."));
  let problems;
  try { problems = installedDepsProblems(repo); } catch (e) {
    console.log(`ABORT: cannot check the installed dependencies against package-lock.json (${e.message}).`);
    process.exit(2);
  }
  if (problems.length) {
    console.log(`ABORT: the installed node_modules does not match package-lock.json; Forge would ship these dependencies, not the locked ones (${problems.length} problem(s)):`);
    for (const p of problems.slice(0, 20)) console.log(`  ${p}`);
    if (problems.length > 20) console.log(`  ... and ${problems.length - 20} more`);
    console.log("Run `npm ci` in this checkout (a real install, never a symlinked node_modules), then run the door again.");
    process.exit(1);
  }
  console.log("==> Installed dependencies match package-lock.json (non-dev packages)");
}
