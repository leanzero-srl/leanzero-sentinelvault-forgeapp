// Compute YouTube chapters in OUTPUT time by replaying the Remotion time-remap (same code the video uses).
//   node --experimental-strip-types remotion/chapters.mts > chapters.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSegments, mapTime, outDuration, windowScript } from "./src/yt/timeline.ts";
const here = path.dirname(fileURLToPath(import.meta.url));
const FPS = 30, INTRO = 105, OUTRO = 150, XFADE = 14;
const keys = ["seal-file", "edit-requests", "auto-restore", "sealed-sections", "validations", "approval", "site-protection", "authenticator", "expiry-alerts", "classification"];
const load = (k: string) => JSON.parse(fs.readFileSync(path.join(here, "src/yt/scripts", k + ".json"), "utf8"));
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const out: Record<string, any> = {};
const pick = (cands: [number, string][], end: number) => {
  const ch: [number, string][] = [[0, "Intro"]];
  for (const c of cands) if (c[0] - ch[ch.length - 1][0] >= 10 && end - c[0] >= 5) ch.push(c);
  return ch;
};
for (const k of keys) {
  const s = load(k);
  const w = windowScript(s, s.from, s.to);
  const segs = buildSegments(w, s.to - s.from, 1);
  const bodyStart = (INTRO - XFADE) / FPS;
  const total = (INTRO - XFADE + Math.round(outDuration(segs) * FPS) - XFADE + OUTRO) / FPS;
  const ch = pick(w.steps.map((st: any) => [Math.max(bodyStart, bodyStart + mapTime(segs, st.t)), st.label] as [number, string]), total);
  if (ch.length < 3) throw new Error(k + " has <3 chapters");
  out[k] = { chapters: ch.map(([t, l]) => [mmss(t), l]), duration: mmss(total), seconds: +total.toFixed(2) };
}
// compilation — mirrors Compilation.tsx + catalog.ts COMPILATION windows
const TITLE = 95, WHY = 130, CH_CARD = 80, COUT = 170;
const comp: [string, number, number, { from: number; to: number; rate?: number }[]][] = [
  ["seal-file", 22, 46, []], ["edit-requests", 46, 102, []], ["auto-restore", 182, 230, []],
  ["sealed-sections", 242, 302, [{ from: 246, to: 258, rate: 6 }]], ["validations", 458, 506, [{ from: 470, to: 494, rate: 4 }]],
  ["approval", 598, 642, []], ["authenticator", 130, 162, []], ["classification", 266, 316, []],
];
let f = TITLE - XFADE + WHY - XFADE;
const cch: [string, string][] = [["00:00", "Intro"]];
for (const [k, a, b, extra] of comp) {
  const s = load(k);
  cch.push([mmss(f / FPS), s.feature]);
  const bf = Math.round(outDuration(buildSegments(windowScript(s, a, b, extra), b - a, 1.35)) * FPS);
  f += CH_CARD - XFADE + bf - XFADE;
}
const ctotal = (f + COUT) / FPS;
out["compilation"] = { chapters: cch, duration: mmss(ctotal), seconds: +ctotal.toFixed(2) };
console.log(JSON.stringify(out, null, 1));
