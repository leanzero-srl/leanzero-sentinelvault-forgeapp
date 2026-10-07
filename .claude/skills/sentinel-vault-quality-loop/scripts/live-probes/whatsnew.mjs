// The site console's "What's new" dialog as served: build stamp + the newest note's text. Read-only.
import fs from "node:fs"; import path from "node:path";
import { launch, go, devFrame, STEWARD, sleep, PROBE_OUT } from "./lib.mjs";
const OUT = `${PROBE_OUT}/whatsnew`; fs.mkdirSync(OUT, { recursive: true });
const { page, close } = await launch({ w: 1440, h: 900, tag: "whatsnew" });
try {
  await go(page, STEWARD);
  const s = await devFrame(page, ".admin-title");
  console.log("steward data-sv-build:", await s.locator("[data-sv-build]").first().getAttribute("data-sv-build"));
  await s.getByText(/What.s new in/).first().click(); await sleep(1500);
  const txt = await s.evaluate(() => { const d = document.querySelector('[role="dialog"], .sv-dialog'); return d ? d.innerText : "(no dialog)"; });
  console.log(txt.slice(0, 2500));
  await page.screenshot({ path: path.join(OUT, "whatsnew-1440.png") });
} catch (e) { console.log("ERROR", String(e).slice(0, 300)); } finally { await close(); }
