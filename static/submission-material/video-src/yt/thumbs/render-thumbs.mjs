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
  "Sealed files": ["#0B4F6C", "#0E7490"],
  "Edit requests": ["#9A3412", "#C2410C"],
  "Auto-restore": ["#7F1D1D", "#B91C1C"],
  "Sealed sections": ["#3B0DA3", "#5222C9"],
  "Content validation": ["#713F12", "#A16207"],
  "Approval workflow": ["#0B2A8A", "#1740B8"],
  "Site settings": ["#312E81", "#4338CA"],
  Authenticator: ["#0B5E2E", "#12803F"],
  "Expiry and alerts": ["#831843", "#BE185D"],
  Classification: ["#701A75", "#A21CAF"],
  Compilation: ["#0B4F6C", "#0E7490"],
};

// ≤3 words each, one |yellow| word, one dominant subject (a tight crop of the payoff).
export const THUMBS = [
  { out: "seal-file", key: "seal-file", feature: "Sealed files", title: "|Seal| any file" },
  { out: "edit-requests", key: "edit-requests", feature: "Edit requests", title: "Approve or |decline|" },
  { out: "auto-restore", key: "auto-restore", feature: "Auto-restore", title: "Overwrite |undone|" },
  { out: "sealed-sections", key: "sealed-sections", feature: "Sealed sections", title: "Lock one |section|" },
  { out: "validations", key: "validations", feature: "Content validation", title: "Rules that |check|" },
  { out: "approval", key: "approval", feature: "Approval workflow", title: "|Approved| means approved" },
  { out: "site-protection", key: "site-protection", feature: "Site settings", title: "Admin |switches|" },
  { out: "authenticator", key: "authenticator", feature: "Authenticator", title: "|Signed| seals" },
  { out: "expiry-alerts", key: "expiry-alerts", feature: "Expiry and alerts", title: "Seals that |expire|" },
  { out: "classification", key: "classification", feature: "Classification", title: "Classify |every| page" },
  { out: "compilation", key: "approval", feature: "Compilation", title: "Everything in |5 min|" },
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
