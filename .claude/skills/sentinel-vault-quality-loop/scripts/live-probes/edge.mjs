// Edge widths: load the realm/steward console at viewports chosen so the FRAME lands at / around
// each new breakpoint; measure the things the breakpoint governs. Read-only.
import fs from "node:fs"; import path from "node:path";
import { launch, go, devFrame, REALM, STEWARD, sleep, PROBE_OUT, HARNESS } from "./lib.mjs";
const { layoutMetrics } = await import(`${HARNESS}/scripts/device-matrix/metrics.mjs`);
const where = process.argv[2]; // realm|steward
const tabs = process.argv[3].split(","); // tab names (realm) or testids (steward)
const vps = process.argv[4].split(",").map((s) => s.split("x").map(Number));
const touch = process.argv[5] === "touch";
const OUT = `${PROBE_OUT}/edge-${where}`;
fs.mkdirSync(OUT, { recursive: true });
const { page, close } = await launch({ w: vps[0][0], h: vps[0][1], touch, dpr: 1, tag: "edge" });
try {
  for (const [w, h] of vps) {
    await page.setViewportSize({ width: w, height: h });
    await go(page, where === "realm" ? REALM : STEWARD);
    const f = await devFrame(page, where === "realm" ? ".space-admin-title" : ".admin-title");
    await sleep(2500);
    for (const t of tabs) {
      if (where === "realm") await f.locator(".tab-navigation .tab-button", { hasText: t }).first().click();
      else await f.locator(`[data-testid="${t}"]`).first().click();
      await sleep(3500);
      const m = await f.evaluate(layoutMetrics, {}).catch((e) => ({ error: String(e) }));
      const x = await f.evaluate(() => {
        const o = { W: innerWidth };
        const tabsEl = document.querySelector(".tab-navigation"); if (tabsEl) { const ys = new Set([...tabsEl.querySelectorAll(".tab-button")].map((b) => Math.round(b.getBoundingClientRect().top))); o.tabRows = ys.size; }
        const wrap = document.querySelector(".sv-activity-table-wrap"); if (wrap) { o.actScroll = `${wrap.scrollWidth}/${wrap.clientWidth}`; o.actTh = [...document.querySelectorAll(".sv-activity-table th")].filter((e) => e.getBoundingClientRect().width > 2).map((e) => `${e.innerText}:${Math.round(e.getBoundingClientRect().width)}`).join(","); o.actRowDisplay = getComputedStyle(document.querySelector(".sv-activity-table tr.sv-activity-row") || document.body).display; }
        const grid = document.querySelector(".sv-card-list"); if (grid) { o.cols = getComputedStyle(grid).gridTemplateColumns.split(" ").length; o.colW = getComputedStyle(grid).gridTemplateColumns; const names = [...document.querySelectorAll(".card-filename")].map((e) => Math.round(e.getBoundingClientRect().width)); o.minName = Math.min(...names); }
        const wf = document.querySelector(".wf-def-table"); if (wf) o.wfDef = `${wf.scrollWidth}/${wf.clientWidth} row=${getComputedStyle(document.querySelector(".wf-def-row:not(.wf-def-row-head)") || wf).gridTemplateAreas.slice(0, 40)}`;
        const api = document.querySelector(".api-table"); if (api) o.api = `${getComputedStyle(api).display} wrap=${document.querySelector(".api-table-wrap")?.scrollWidth}/${document.querySelector(".api-table-wrap")?.clientWidth}`;
        const rows = [...document.querySelectorAll(".settings-row")].filter((r) => r.getBoundingClientRect().width > 0);
        o.wrappedRows = rows.filter((r) => { const i = r.querySelector(".settings-row-info"), c = r.querySelector(".settings-row-control"); return i && c && c.getBoundingClientRect().top >= i.getBoundingClientRect().bottom - 2; }).length + "/" + rows.length;
        o.docH = document.documentElement.scrollHeight;
        return o;
      });
      const tag = `${w}x${h}-${t.replace(/\W+/g, "")}`;
      console.log(tag, JSON.stringify(x), `overflowX=${m.overflowX} offenders=${m.offenderCount} clipped=${m.clippedCount} overlaps=${(m.overlaps || []).length} textOverlaps=${(m.textOverlaps || []).length} orphans=${(m.orphanWraps || []).length} scrollers=${(m.scrollers || []).length}`);
      fs.writeFileSync(path.join(OUT, `${tag}.json`), JSON.stringify({ x, m }, null, 1));
      const el = await f.frameElement(); await el.scrollIntoViewIfNeeded().catch(() => {});
      await page.screenshot({ path: path.join(OUT, `${tag}.png`) });
    }
  }
} catch (e) { console.log("ERROR", String(e).slice(0, 300)); }
finally { await close(); }
