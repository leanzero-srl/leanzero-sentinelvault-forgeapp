import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

// Reads real `forge logs` and scans for backend-bug signatures. Ported from the
// Altomata harness. Run from the app root so the Forge CLI picks up the app.
const PROJECT_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

export function pollForgeLogs(extraArgs = []) {
  try {
    const r = spawnSync("forge", ["logs", ...extraArgs], {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      timeout: 90000,
      maxBuffer: 32 * 1024 * 1024,
    });
    const text = (r.stdout || "") + (r.stderr ? "\n" + r.stderr : "");
    return { ok: r.status === 0, lines: text.split(/\r?\n/).filter((l) => l.trim().length), raw: text };
  } catch (e) {
    return { ok: false, error: e.message, lines: [], raw: "" };
  }
}

const SIGNALS = [
  { re: /unhandled (promise )?(rejection|exception)|uncaught (exception|error)|\b(Type|Reference|Range|Syntax)Error\b|cannot read propert|is not a function|is not defined|function timed out/i, signal: "crash" },
  { re: /"?status(Code)?"?\s*[:=]\s*5\d\d|→ 5\d\d:/i, signal: "http5xx" },
  { re: /\b4\d\d\b.*(forge|requestConfluence|fetch)|REQUEST_EGRESS|BLOCKED_EGRESS/i, signal: "http4xx/egress" },
  { re: /\[FORGE-LLM\] error|Forge LLM error/i, signal: "llm-error" },
  { re: /malformed json|failed to parse|JSON\.parse|unexpected token/i, signal: "parse" },
];

export function scanForSignals(lines) {
  const out = [];
  for (const l of lines) {
    for (const s of SIGNALS) {
      if (s.re.test(l)) { out.push({ line: l.slice(0, 240), signal: s.signal }); break; }
    }
  }
  return out;
}
