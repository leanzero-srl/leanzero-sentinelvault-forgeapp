// 5.0 byline chip — the pure composer behind the `sentinel-byline` content property.
// Four states (page override / space default / unclassified / custom colour) × sealed / unsealed.
// byline.js binds @forge/api and @forge/kvs at import (both load in plain node, as the
// activity-log and editreq-index tests already rely on); the composer never touches them.
import { eq, ok, report } from "./_assert.mjs";

import { composeByline, bylineIcon, bylineStamp, NEUTRAL_COLOR } from "../src/server/capsules/page-details/byline.js";

const decode = (icon) => decodeURIComponent(icon.replace(/^data:image\/svg\+xml;utf8,/, ""));
const restricted = { id: "restricted", name: "Restricted", color: "#DC2626" };
const custom = { id: "board", name: "Board only", color: "#7c3aed" };

// ── titles ──────────────────────────────────────────────────────────────────────────────────
eq("page override title", composeByline({ level: restricted, source: "page", sealCount: 0 }).title, "Restricted · set on this page");
eq("space default title", composeByline({ level: restricted, source: "space", sealCount: 0 }).title, "Restricted · space default");
eq("unclassified title", composeByline({ level: null, source: "none", sealCount: 0 }).title, "Unclassified");
eq("unclassified title even with seals", composeByline({ level: null, source: "none", sealCount: 3 }).title, "Unclassified");
eq("custom level title", composeByline({ level: custom, source: "page", sealCount: 1 }).title, "Board only · set on this page");
eq("an unknown source reads as the space default", composeByline({ level: restricted, source: "weird", sealCount: 0 }).title, "Restricted · space default");

// ── icons: colour ───────────────────────────────────────────────────────────────────────────
ok("icon is a data: SVG URI", composeByline({ level: restricted, source: "page", sealCount: 0 }).icon.startsWith("data:image/svg+xml;utf8,"));
ok("icon carries the level colour", decode(composeByline({ level: restricted, source: "page", sealCount: 0 }).icon).includes('fill="#DC2626"'));
ok("custom colour is used as-is (uppercased)", decode(composeByline({ level: custom, source: "space", sealCount: 0 }).icon).includes('fill="#7C3AED"'));
ok("unclassified uses the neutral colour", decode(composeByline({ level: null, source: "none", sealCount: 0 }).icon).includes(`fill="${NEUTRAL_COLOR}"`));
ok("a malformed colour falls back to neutral", decode(bylineIcon({ color: "red", sealed: false })).includes(`fill="${NEUTRAL_COLOR}"`));
ok("a colour with a fragment/quote cannot escape the attribute", !decode(bylineIcon({ color: '#fff" onload="x', sealed: false })).includes("onload"));

// ── icons: lock vs dot ──────────────────────────────────────────────────────────────────────
for (const [label, level, source] of [["page", restricted, "page"], ["space", restricted, "space"], ["none", null, "none"], ["custom", custom, "page"]]) {
  const unsealed = decode(composeByline({ level, source, sealCount: 0 }).icon);
  const sealed = decode(composeByline({ level, source, sealCount: 2 }).icon);
  ok(`${label}: unsealed icon is a dot (no lock)`, unsealed.includes('r="3"') && !unsealed.includes("<rect"));
  ok(`${label}: sealed icon carries the lock`, sealed.includes("<rect") && !sealed.includes('r="3"'));
}
ok("a negative / NaN seal count is unsealed", !decode(composeByline({ level: restricted, source: "page", sealCount: -1 }).icon).includes("<rect") && !decode(composeByline({ level: restricted, source: "page", sealCount: "x" }).icon).includes("<rect"));

// ── tooltips ────────────────────────────────────────────────────────────────────────────────
eq("tooltip, page override, no seals", composeByline({ level: restricted, source: "page", sealCount: 0 }).tooltip, "Restricted (set on this page) · No seals on this page · Open Sentinel Vault");
eq("tooltip, space default, one seal", composeByline({ level: restricted, source: "space", sealCount: 1 }).tooltip, "Restricted (space default) · 1 seal on this page · Open Sentinel Vault");
eq("tooltip, unclassified, many seals", composeByline({ level: null, source: "none", sealCount: 4 }).tooltip, "No classification level · 4 seals on this page · Open Sentinel Vault");

// ── shape + stamp ───────────────────────────────────────────────────────────────────────────
eq("property carries exactly title/icon/tooltip", Object.keys(composeByline({ level: restricted, source: "page", sealCount: 1 })).sort(), ["icon", "title", "tooltip"]);
ok("stamp differs when the seal count crosses zero", bylineStamp(composeByline({ level: restricted, source: "page", sealCount: 0 })) !== bylineStamp(composeByline({ level: restricted, source: "page", sealCount: 1 })));
ok("stamp differs between 1 and 2 seals (tooltip counts)", bylineStamp(composeByline({ level: restricted, source: "page", sealCount: 1 })) !== bylineStamp(composeByline({ level: restricted, source: "page", sealCount: 2 })));
ok("stamp is stable for the same inputs", bylineStamp(composeByline({ level: custom, source: "space", sealCount: 2 })) === bylineStamp(composeByline({ level: { ...custom }, source: "space", sealCount: 2 })));
eq("stamp of nothing is empty", bylineStamp(null), "");

// ── static fallback naming (kept selectable) ────────────────────────────────────────────────
eq("static: seeded colour maps to its png", bylineIcon({ color: "#DC2626", sealed: true }, "static"), "icons/restricted-lock.png");
eq("static: custom colour maps to neutral", bylineIcon({ color: "#7C3AED", sealed: false }, "static"), "icons/neutral-dot.png");

report("byline");
