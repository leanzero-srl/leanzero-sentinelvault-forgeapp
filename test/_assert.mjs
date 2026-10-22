// Zero-dependency micro-assertions (one process per test file, so counters are
// isolated). Mirrors the CogniRunner / Altomata harness style.
let total = 0, passed = 0;
const failures = [];

export function eq(label, got, want) {
  total++;
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) passed++;
  else failures.push(`${label}: expected ${w}, got ${g}`);
}

export function ok(label, cond) {
  total++;
  if (cond) passed++;
  else failures.push(`${label}: expected truthy`);
}

export function report(suite) {
  if (failures.length) {
    // Exit once the text is written: stdout is a pipe under scripts/run-tests.mjs, and process.exit()
    // right after console.log can drop the tail of a long FAIL list.
    process.exitCode = 1;
    process.stdout.write(`\n${suite}: ${passed}/${total} passed\n${failures.map((f) => "  FAIL " + f + "\n").join("")}`, () => process.exit(1));
    return;
  }
  console.log(`${suite}: ${passed}/${total} passed`);
}
