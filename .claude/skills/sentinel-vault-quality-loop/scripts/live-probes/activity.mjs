// BN-04 live: does the space Activity report name the accounts it used to call "Someone"? Read-only.
import fs from "node:fs"; import path from "node:path";
import { launch, go, devFrame, REALM, sleep, PROBE_OUT } from "./lib.mjs";
const OUT = `${PROBE_OUT}/activity`; fs.mkdirSync(OUT, { recursive: true });
const { page, close } = await launch({ w: 1440, h: 900, tag: "activity" });
try {
  await go(page, REALM); const f = await devFrame(page, ".space-admin-title");
  await f.locator(".tab-navigation .tab-button", { hasText: "Activity" }).first().click(); await sleep(6000);
  const r = await f.evaluate(() => {
    const rows = [...document.querySelectorAll(".sv-activity-table tbody tr, .sv-activity-row")].map((tr) => tr.innerText.replace(/\s+/g, " ").trim());
    return { rows: rows.length, someone: rows.filter((t) => /\bSomeone\b/.test(t)).length, ids: rows.filter((t) => /\d+:[0-9a-f]{8}-/.test(t)).length, mihai: rows.filter((t) => /Mihai Perdum/.test(t)).length, sample: rows.slice(0, 12) };
  });
  console.log(JSON.stringify(r, null, 1));
  const el = await f.frameElement(); await el.scrollIntoViewIfNeeded().catch(() => {}); await page.screenshot({ path: path.join(OUT, "realm-activity-1440.png") });
} catch (e) { console.log("ERROR", String(e).slice(0, 300)); } finally { await close(); }
