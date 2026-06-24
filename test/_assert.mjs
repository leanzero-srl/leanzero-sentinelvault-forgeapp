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
    console.log(`\n${suite}: ${passed}/${total} passed`);
    for (const f of failures) console.log("  FAIL " + f);
    process.exit(1);
  }
  console.log(`${suite}: ${passed}/${total} passed`);
}
