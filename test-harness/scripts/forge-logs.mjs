// Scan the deployed app's forge logs for crash / 5xx / egress / LLM / parse
// signals. Exit non-zero if any are found. Run after exercising features so a
// regression surfaces as a failed check.
import { pollForgeLogs, scanForSignals } from "../lib/forge-logs.mjs";

const { ok, lines, error } = pollForgeLogs();
if (!ok) {
  console.log(`FAIL could not read forge logs${error ? `: ${error}` : ""}. Is the Forge CLI authenticated and the app deployed?`);
  process.exit(1);
}

const signals = scanForSignals(lines);
if (signals.length === 0) {
  console.log(`ok   no error signals in ${lines.length} log lines`);
  process.exit(0);
}

console.log(`FAIL ${signals.length} error signal(s):`);
for (const s of signals) console.log(`  [${s.signal}] ${s.line}`);
process.exit(1);
