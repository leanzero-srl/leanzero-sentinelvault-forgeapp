// scripts/check-installed-deps.mjs: the production door refuses when the installed node_modules is not the one
// package-lock.json locks (Forge bundles the root node_modules, so a stale or borrowed install ships other code).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ok, report } from "./_assert.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { installedDepsProblems } = await import(new URL("../scripts/check-installed-deps.mjs", import.meta.url).href);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sv-deps-"));

const LOCK = {
  name: "x", lockfileVersion: 3, packages: {
    "": { name: "x" },
    "node_modules/a": { version: "1.0.0" },
    "node_modules/a/node_modules/b": { version: "2.0.0" },
    "node_modules/@s/c": { version: "3.0.0" },
    "node_modules/devonly": { version: "1.0.0", dev: true },
    "node_modules/devopt": { version: "1.0.0", devOptional: true },
    "node_modules/opt": { version: "1.0.0", optional: true },
  },
};
const fixture = (name, installed, lock = LOCK) => {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, "node_modules"), { recursive: true });
  fs.writeFileSync(path.join(dir, "package-lock.json"), JSON.stringify(lock));
  for (const [p, v] of Object.entries(installed)) {
    fs.mkdirSync(path.join(dir, p), { recursive: true });
    fs.writeFileSync(path.join(dir, p, "package.json"), JSON.stringify({ version: v }));
  }
  return dir;
};
const GOOD = { "node_modules/a": "1.0.0", "node_modules/a/node_modules/b": "2.0.0", "node_modules/@s/c": "3.0.0" };
try {
  ok("every shipped package at its locked version (dev, devOptional and an absent optional are not needed)", installedDepsProblems(fixture("good", GOOD)).length === 0);
  let p = installedDepsProblems((() => { const d = fixture("missing2", GOOD); fs.rmSync(path.join(d, "node_modules/@s/c"), { recursive: true }); return d; })());
  ok("a missing shipped (scoped) package is named", p.length === 1 && /node_modules\/@s\/c: not installed \(locked 3\.0\.0\)/.test(p[0]));
  p = installedDepsProblems(fixture("nested", { ...GOOD, "node_modules/a/node_modules/b": "2.0.1" }));
  ok("a nested package at another version is named with both versions", p.length === 1 && /node_modules\/a\/node_modules\/b: installed 2\.0\.1, locked 2\.0\.0/.test(p[0]));
  p = installedDepsProblems(fixture("optbad", { ...GOOD, "node_modules/opt": "0.9.0" }));
  ok("an optional package that IS installed must match", p.length === 1 && /node_modules\/opt/.test(p[0]));
  ok("dev-only packages at any version (or missing) are ignored", installedDepsProblems(fixture("dev", { ...GOOD, "node_modules/devonly": "9.9.9" })).length === 0);
  const linked = fixture("linked", {});
  fs.rmSync(path.join(linked, "node_modules"), { recursive: true });
  fs.symlinkSync(path.join(fixture("target", GOOD), "node_modules"), path.join(linked, "node_modules"));
  p = installedDepsProblems(linked);
  ok("a symlinked root node_modules is refused even when its versions match", p.length === 1 && /symlink/.test(p[0]));
  const none = fixture("none", {}); fs.rmSync(path.join(none, "node_modules"), { recursive: true });
  ok("no node_modules at all is refused", /not installed/.test(installedDepsProblems(none)[0] || ""));
  let threw = false;
  try { installedDepsProblems(fixture("v1", GOOD, { lockfileVersion: 1, dependencies: {} })); } catch { threw = true; }
  ok("a lockfile with no packages map cannot be checked (throws: the door refuses, exit 2)", threw);
  // the CLI: exit codes and the fix it prints
  const cli = (dir) => { try { return { code: 0, out: execFileSync(process.execPath, [path.join(root, "scripts/check-installed-deps.mjs"), dir], { encoding: "utf8" }) }; } catch (e) { return { code: e.status, out: String(e.stdout) }; } };
  let c = cli(path.join(tmp, "good"));
  ok("CLI: a match exits 0", c.code === 0 && /match package-lock\.json/.test(c.out));
  c = cli(path.join(tmp, "nested"));
  ok("CLI: a mismatch exits 1 and says npm ci", c.code === 1 && /npm ci/.test(c.out) && /locked 2\.0\.0/.test(c.out));
  c = cli(path.join(tmp, "v1"));
  ok("CLI: cannot tell exits 2", c.code === 2);
  ok("this checkout's own install matches its lockfile (CI and the door run on a real npm ci)", installedDepsProblems(root).length === 0);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
report("check-installed-deps");
