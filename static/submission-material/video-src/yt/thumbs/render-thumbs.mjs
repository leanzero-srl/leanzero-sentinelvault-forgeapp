// Render YouTube thumbnails from thumb.html at DSF 2, then downscale to 1280x720 with sharp resampling.
//   node render-thumbs.mjs            (run from static/submission-material/video-src/thumbs)
// Playwright lives in static/_screenshot-harness/node_modules.
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(process.env.PW_HOME || path.join(process.env.HOME, "Projects/forge-live-harness"), "package.json"));
const { chromium } = require("playwright");

// Deep, saturated per-feature backgrounds (never black) + a slightly lighter wedge of the same hue.
const BG = {
  Validator: ["#0B2A8A", "#1740B8"],
  Condition: ["#3B0DA3", "#5222C9"],
  "Post-function": ["#0B5E2E", "#12803F"],
  Listener: ["#9A3412", "#C2410C"],
  "Scheduled job": ["#0B4F5F", "#0E7490"],
  Compilation: ["#7F1D1D", "#B91C1C"],
};

// ≤3 words each (the 2026 CTR research: 3 words or fewer, one yellow highlight, one dominant subject)
export const THUMBS = [
  { out: "validator-1", key: "validator-1", feature: "Validator", title: "|Required| by AI" },
  { out: "validator-2", key: "validator-2", feature: "Validator", title: "|Given-When-Then| enforced" },
  { out: "condition-1", key: "condition-1", feature: "Condition", title: "|Zero-AI| gating" },
  { out: "condition-2", key: "condition-2", feature: "Condition", title: "Condition |+ PDF|" },
  { out: "pf-attachment", key: "pf-attachment", feature: "Post-function", title: "AI-written |PDF|" },
  { out: "listener", key: "listener", feature: "Listener", title: "|Auto-triage| issues" },
  { out: "job", key: "job", feature: "Scheduled job", title: "|Scheduled| jobs" },
  { out: "compilation", key: "job", feature: "Compilation", title: "Everything in |5 min|" },
  { out: "all-tutorials", key: "listener", feature: "Compilation", title: "|Complete| walkthrough" },
];

const outDir = path.join(here, "out");
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
for (const t of THUMBS) {
  const q = new URLSearchParams({ key: t.key, feature: t.feature, title: t.title, bg: BG[t.feature][0], bg2: BG[t.feature][1] });
  await page.goto(pathToFileURL(path.join(here, "thumb.html")).href + "?" + q.toString());
  await page.waitForFunction(() => document.body.dataset.ready === "1" && document.fonts.status === "loaded");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  const big = path.join(outDir, `${t.out}@2x.png`);
  await page.screenshot({ path: big });
  // downscale 2560x1440 → 1280x720 with Lanczos (sharp edges, no blur)
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", big, "-vf", "scale=1280:720:flags=lanczos", path.join(outDir, `sentinel-vault-thumb-${t.out}.png`)]);
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", path.join(outDir, `sentinel-vault-thumb-${t.out}.png`), "-vf", "scale=168:94:flags=lanczos", path.join(outDir, `_phone-${t.out}.png`)]);
  fs.unlinkSync(big);
  console.log("thumb", t.out);
}
await browser.close();
