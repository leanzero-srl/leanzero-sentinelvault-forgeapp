#!/usr/bin/env node
/*
 * Sentinel Vault - the unit suite runner behind `npm test`.
 * Copyright (c) 2025-2026 LeanZero SRL.
 */

// `npm test` used to be one `node a && node b && ...` chain of 119 files: 260 s, serial, and a file that was not added
// to the chain never ran. This runner keeps what the chain checked and nothing less:
//  - every test/*.test.mjs runs, each in its OWN node process (the _assert.mjs counters are per process), so a new
//    test file runs without editing package.json;
//  - a file FAILS when its process exits non-zero, dies on a signal, cannot be started, or runs past the per-file
//    timeout; the runner exits 1 when any file failed (the chain stopped at the first failure; this runs all of them
//    and lists every failure at the end);
//  - each file's output is printed in one block when it finishes, never interleaved with another file's.
// Files run N at a time (SV_TEST_JOBS, default: the machine's cores, at most 8); the slow ones start first.
//
//   npm test                                   # every file
//   node scripts/run-tests.mjs test/a.test.mjs test/b.test.mjs   # only these
//   SV_TEST_JOBS=1 npm test                    # one at a time, as the old chain ran
//   SV_TEST_TIMEOUT_S=900                      # per-file timeout (default 900 s)
//   SV_TEST_LIST=1 npm test                    # print the files it would run, run nothing
// test/run-tests.test.mjs proves a failing, crashing or hanging file fails the run.

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEST_DIR = path.join(ROOT, "test");
// Measured 2026-10-22 (serial, Mac Studio): the long files, started first so they do not end the run alone.
const SLOW_FIRST = ["test/responsive-dom.test.mjs", "test/deploy-door.test.mjs", "test/release-autopilot.test.mjs", "test/tracker-release-gate.test.mjs", "test/log-privacy.test.mjs", "test/action-log.test.mjs"];

const positive = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : d; };
const JOBS = positive(process.env.SV_TEST_JOBS, Math.min(8, typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length));
const TIMEOUT_MS = positive(process.env.SV_TEST_TIMEOUT_S, 900) * 1000;

const args = process.argv.slice(2);
let files;
if (args.length) {
  files = args.map((a) => path.relative(ROOT, path.resolve(ROOT, a)));
  const missing = files.filter((f) => !existsSync(path.join(ROOT, f)));
  if (missing.length) { console.log(`run-tests: no such file: ${missing.join(", ")}`); process.exit(1); }
} else {
  files = readdirSync(TEST_DIR).filter((f) => f.endsWith(".test.mjs")).sort().map((f) => `test/${f}`);
  files.sort((a, b) => ((SLOW_FIRST.indexOf(a) + 1 || 1e9) - (SLOW_FIRST.indexOf(b) + 1 || 1e9)));
}
if (!files.length) { console.log("run-tests: FAIL - no test files found"); process.exit(1); }
if (process.env.SV_TEST_LIST === "1") { console.log(files.join("\n")); process.exit(0); }

const children = new Set();
const runOne = (file) => new Promise((resolve) => {
  const started = Date.now();
  const chunks = [];
  let child, timedOut = false, settled = false;
  const done = (r) => { if (settled) return; settled = true; children.delete(child); resolve({ file, ms: Date.now() - started, out: Buffer.concat(chunks).toString("utf8"), ...r }); };
  try {
    child = spawn(process.execPath, [file], { cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) { done({ ok: false, why: `could not start (${e && e.code || e})` }); return; }
  children.add(child);
  child.stdout.on("data", (d) => chunks.push(d));
  child.stderr.on("data", (d) => chunks.push(d));
  const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, TIMEOUT_MS);
  child.on("error", (e) => { clearTimeout(timer); done({ ok: false, why: `could not start (${e && e.code || e})` }); });
  child.on("close", (code, signal) => {
    clearTimeout(timer);
    if (timedOut) done({ ok: false, why: `timed out after ${TIMEOUT_MS / 1000} s` });
    else if (signal) done({ ok: false, why: `killed by ${signal}` });
    else if (code !== 0) done({ ok: false, why: `exit code ${code}` });
    else done({ ok: true });
  });
});

const stop = (sig) => { for (const c of children) { try { c.kill("SIGTERM"); } catch { /* gone */ } } process.exit(sig === "SIGINT" ? 130 : 143); };
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

const t0 = Date.now();
const results = [];
let next = 0;
async function worker() {
  while (next < files.length) {
    const r = await runOne(files[next++]);
    results.push(r);
    const out = r.out.endsWith("\n") || !r.out ? r.out : `${r.out}\n`;
    process.stdout.write(`── ${r.file} ${r.ok ? "ok" : `FAILED (${r.why})`} ${(r.ms / 1000).toFixed(1)} s\n${out}`);
  }
}
await Promise.all(Array.from({ length: Math.min(JOBS, files.length) }, worker));

const failed = results.filter((r) => !r.ok);
const slowest = [...results].sort((a, b) => b.ms - a.ms).slice(0, 5).map((r) => `${path.basename(r.file)} ${(r.ms / 1000).toFixed(1)} s`).join(", ");
console.log(`\nrun-tests: ${results.length - failed.length}/${files.length} files passed in ${((Date.now() - t0) / 1000).toFixed(1)} s (${Math.min(JOBS, files.length)} at a time; slowest: ${slowest})`);
if (results.length !== files.length) { console.log(`run-tests: FAIL - ${files.length - results.length} file(s) never ran`); process.exit(1); }
if (failed.length) {
  for (const r of failed) console.log(`  FAILED ${r.file}: ${r.why}`);
  process.exit(1);
}
