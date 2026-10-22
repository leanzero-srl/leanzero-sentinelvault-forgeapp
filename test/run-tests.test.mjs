// The unit suite runner (scripts/run-tests.mjs, behind `npm test`) must fail exactly when the old
// `node a && node b && ...` chain failed, and more: a failing, crashing, hanging or missing file fails
// the run, every file of test/ runs, and each file's output stays in one block. Planted files in a temp
// dir play the failures; the runner itself runs as a child process.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq, ok, report } from "./_assert.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNNER = path.join(ROOT, "scripts/run-tests.mjs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sv-run-tests-"));
const plant = (name, body) => { const f = path.join(tmp, name); fs.writeFileSync(f, body); return f; };
const run = (files, env = {}) => {
  const r = spawnSync(process.execPath, [RUNNER, ...files], { cwd: ROOT, encoding: "utf8", env: { ...process.env, ...env } });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
};

try {
  const pass = plant("pass.test.mjs", 'console.log("pass-file: 1/1 passed");\n');
  const pass2 = plant("pass2.test.mjs", 'console.log("pass2-file: 1/1 passed");\n');
  const fail = plant("fail.test.mjs", 'console.log("fail-file: 0/1 passed\\n  FAIL planted");\nprocess.exit(1);\n');
  const throws = plant("throws.test.mjs", 'throw new Error("planted crash");\n');
  const killed = plant("killed.test.mjs", 'process.kill(process.pid, "SIGKILL");\n');
  const hangs = plant("hangs.test.mjs", "setTimeout(() => {}, 60000);\n");
  const chatty = (tag) => plant(`chatty-${tag}.test.mjs`, `for (let i = 0; i < 5; i++) { console.log("${tag} line " + i); await new Promise((r) => setTimeout(r, 30)); }\n`);

  let r = run([pass, pass2]);
  eq("all files pass: exit 0", r.code, 0);
  ok("all files pass: the summary counts them", /run-tests: 2\/2 files passed/.test(r.out));
  ok("a passing file's own output is printed", /pass-file: 1\/1 passed/.test(r.out) && /pass2-file: 1\/1 passed/.test(r.out));

  r = run([pass, fail, pass2]);
  eq("one failing file: the run fails", r.code, 1);
  ok("one failing file: it is named with its exit code", /FAILED .*fail\.test\.mjs: exit code 1/.test(r.out));
  ok("one failing file: its FAIL lines are printed", /FAIL planted/.test(r.out));
  ok("one failing file: the other files still ran", /pass-file: 1\/1 passed/.test(r.out) && /pass2-file: 1\/1 passed/.test(r.out));

  r = run([pass, throws]);
  eq("a file that throws: the run fails", r.code, 1);
  ok("a file that throws: its error is printed", /planted crash/.test(r.out));

  r = run([killed, pass]);
  eq("a file killed by a signal: the run fails", r.code, 1);
  ok("a file killed by a signal: the signal is named", /killed\.test\.mjs: killed by SIGKILL/.test(r.out));

  r = run([hangs, pass], { SV_TEST_TIMEOUT_S: "1" });
  eq("a file that hangs past the timeout: the run fails", r.code, 1);
  ok("a file that hangs: the timeout is named", /hangs\.test\.mjs: timed out after 1 s/.test(r.out));

  r = run([path.join(tmp, "missing.test.mjs")]);
  eq("a file that does not exist: the run fails", r.code, 1);

  r = run([pass, fail], { SV_TEST_JOBS: "1" });
  eq("one at a time (SV_TEST_JOBS=1): a failing file still fails the run", r.code, 1);

  r = run([chatty("aaa"), chatty("bbb")], { SV_TEST_JOBS: "2" });
  const lines = r.out.split("\n").filter((l) => /^(aaa|bbb) line/.test(l)).map((l) => l.slice(0, 3));
  eq("two files printing at the same time: ten lines", lines.length, 10);
  const blocks = lines.filter((t, i) => i === 0 || t !== lines[i - 1]).length;
  eq("two files printing at the same time: each file's output is one block", blocks, 2);

  // Every test file of test/ is in the default list (a file left out of a hand-kept chain never ran).
  r = run([], { SV_TEST_LIST: "1" });
  const listed = r.out.trim().split("\n").sort();
  const onDisk = fs.readdirSync(path.join(ROOT, "test")).filter((f) => f.endsWith(".test.mjs")).map((f) => `test/${f}`).sort();
  eq("default list: exactly every test/*.test.mjs", listed, onDisk);
  ok("default list: this file is in it", listed.includes("test/run-tests.test.mjs"));
  eq("default list: the slowest file starts first", r.out.trim().split("\n")[0], "test/responsive-dom.test.mjs");

  // `npm test` is this runner (a hand-kept && chain must not come back).
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  eq("package.json: npm test runs scripts/run-tests.mjs", pkg.scripts.test, "node scripts/run-tests.mjs");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
report("run-tests");
