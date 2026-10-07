// Responsive contract (device matrix 2026-10-06/07): every CLASS of layout defect the 14-device
// walk found on phones, tablets and laptops is pinned here, statically, so it cannot ship again.
// Each check names the finding it guards. The live proof is forge-live-harness's device matrix
// (walks/sentinel.mjs); the desktop pixel proof is scripts/responsive/capture.mjs + diff.py.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, ok, report } from "./_assert.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(resolve(here, "..", p), "utf8");
const TOKENS = "src/ui/tokens/";
const css = (name) => read(TOKENS + name);
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
/** Every rule as { sel, body } (top level and inside @media / @container), comments removed. */
const rules = (text) => {
  const out = [];
  const t = strip(text);
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(t))) out.push({ sel: m[1].trim().replace(/\s+/g, " "), body: m[2] });
  return out;
};
const px = (body, prop) => { const m = new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([0-9.]+)px`).exec(body); return m ? Number(m[1]) : null; };
/** The bodies of every `query` block (e.g. "@media (pointer: coarse)"), brace-matched. */
const mediaBlocks = (text, query) => {
  const t = strip(text);
  const out = [];
  let i = t.indexOf(query);
  while (i >= 0) {
    const open = t.indexOf("{", i);
    let depth = 0, j = open;
    for (; j < t.length; j++) { if (t[j] === "{") depth++; else if (t[j] === "}" && --depth === 0) break; }
    out.push(t.slice(open + 1, j));
    i = t.indexOf(query, j);
  }
  return out;
};

// ── SV-01: one card layout, three copies — byte-identical, and nothing overrides it ────────────
const CARD_FILES = ["realm-console.css", "overlay.css", "inline-panel.css"];
const block = (text) => {
  const a = text.indexOf("/* ── sv-card-responsive:start");
  const b = text.indexOf("/* ── sv-card-responsive:end ── */");
  return a >= 0 && b > a ? text.slice(a, b) : null;
};
const blocks = CARD_FILES.map((f) => block(css(f)));
blocks.forEach((b, i) => ok(`SV-01 ${CARD_FILES[i]} carries the sv-card-responsive block`, !!b));
ok("SV-01 the three sv-card-responsive blocks are byte-identical", blocks.every((b) => b === blocks[0]));
ok("SV-01 the shared block sets a minimum card width (columns are a MAXIMUM)", /--sv-card-min:\s*\d+px/.test(blocks[0] || "") && /repeat\(auto-fill, minmax\(min\(100%, max\(var\(--sv-card-min\)/.test(blocks[0] || ""));
ok("SV-01 the file name has a floor and the actions wrap under it", /\.card-row-primary > \.card-filename \{ flex: 1 1 \d+px; \}/.test(blocks[0] || "") && /\.card-row-primary, \.card-row-secondary \{ flex-wrap: wrap;/.test(blocks[0] || ""));
for (const f of CARD_FILES) {
  const r = rules(css(f)).filter((x) => /(^|,|\s)\.sv-card-list(\[|\s|,|$)/.test(x.sel) && /grid-template-columns/.test(x.body));
  const bad = r.filter((x) => !/auto-fill/.test(x.body));
  eq(`SV-01 ${f}: no other rule sets the card list's columns (fixed counts, !important overrides)`, bad.map((x) => x.sel), []);
  ok(`SV-01 ${f}: the default maximum is set on .sv-card-list`, /\.sv-card-list \{\s*--sv-cards-per-row:\s*\d;/.test(strip(css(f))));
}

// ── SV-01 cause 1: the dialogs' big .action-btn must never reach a card pill again ─────────────
for (const f of ["realm-console.css", "steward-console.css"]) {
  const bigUnscoped = rules(css(f)).filter((x) => x.sel.split(",").some((s) => s.trim() === ".action-btn") && /padding:\s*10px 20px/.test(x.body));
  eq(`SV-01 ${f}: no unscoped .action-btn with dialog padding`, bigUnscoped.map((x) => x.sel), []);
}

// ── SV-04 / SV-08: a rule that hides a table column hides its header AND its cells ─────────────
const hiddenColumnClasses = (text, prefix) => {
  const set = new Set();
  for (const r of rules(text)) if (/display:\s*none/.test(r.body)) for (const m of r.sel.matchAll(new RegExp(`\\.(${prefix}[a-z-]+)`, "g"))) set.add(m[1]);
  return [...set];
};
const columnContract = (cssText, jsxText, prefix, label) => {
  for (const cls of hiddenColumnClasses(cssText, prefix)) {
    const th = new RegExp(`<th[^>]*className="[^"]*\\b${cls}\\b`).test(jsxText);
    const td = new RegExp(`<td[^>]*className="[^"]*\\b${cls}\\b`).test(jsxText);
    ok(`${label}: .${cls} is on the <th> and on the <td>`, th && td);
  }
};
columnContract(css("steward-console.css"), read("src/ui/kit/ClassificationTab.jsx"), "cls-col-", "SV-04 Space defaults");
columnContract(css("realm-console.css"), read("src/ui/kit/ActivityReport.jsx"), "sv-activity-col-", "SV-08 Activity report");
ok("SV-08 the Target td is a table cell (the flex column lives on an inner div)", !rules(css("realm-console.css")).some((x) => x.sel === ".sv-activity-col-target" && /display:\s*flex/.test(x.body)));

// ── SV-02: the banner never scrolls sideways, and its secondary chips drop before they collide ──
const ribbon = css("doc-ribbon.css");
ok("SV-02 .ribbon-bar clips (overflow: clip) — a focused chip cannot scroll the level block away", rules(ribbon).some((x) => x.sel === ".ribbon-bar" && /overflow:\s*clip/.test(x.body)));
ok("SV-02 .rb-body clips its own overflow", rules(ribbon).some((x) => x.sel === ".rb-body" && /overflow:\s*clip/.test(x.body)));
ok("SV-02 under 720 px the review-date chip and the secondary chips are hidden", /@media \(max-width: 720px\)[\s\S]*?\.rb-body \.wf-chip-outline, \.rb-body \.rb-extras \{ display: none; \}/.test(strip(ribbon)));

ok("SV-02 on a phone the state chip gives way with an ellipsis instead of running under Open", (() => { const b = mediaBlocks(ribbon, "@media (max-width: 480px)").join("\n"); return /\.rb-body > \.wf-control \{ min-width: 0; flex: 0 1 auto; \}/.test(b) && /\.rb-body \.wf-chip-label \{ min-width: 0; overflow: hidden; text-overflow: ellipsis; \}/.test(b); })());

ok("SV-02 under 400 px the level glyph drops so the state chip keeps its whole label", mediaBlocks(ribbon, "@media (max-width: 400px)").some((b) => /\.rb-class \.rb-glyph \{ display: none; \}/.test(b)));

// ── SV-03: the seal action's 4-column rows survive the phone rule ───────────────────────────────
const pd = strip(css("page-details.css"));
ok("SV-03 the ≤520 px rule keeps the checkbox rows in their own columns", /@media \(max-width: 520px\)[\s\S]*?\.pd-row-main\.pd-row-check \{ grid-template-columns: 16px 24px minmax\(0, 1fr\); \}/.test(pd));

// ── SV-12: every surface has touch targets for a coarse pointer ─────────────────────────────────
for (const f of ["realm-console.css", "steward-console.css", "overlay.css", "inline-panel.css", "page-details.css", "doc-ribbon.css", "my-work.css", "section-setup.css"]) {
  ok(`SV-12 ${f} has a (pointer: coarse) block`, /@media \(pointer: coarse\)/.test(css(f)));
}

// The coarse blocks themselves: every checkbox they size is at least 24 px (WCAG 2.5.8 — 20 and 22
// were measured under the bar on phones), and the copies of one control agree across sheets (the
// Validations editor's checkbox was 22 px in the space console and 13 px in site settings).
const COARSE = "@media (pointer: coarse)";
for (const f of ["realm-console.css", "steward-console.css", "overlay.css", "inline-panel.css", "page-details.css", "doc-ribbon.css", "my-work.css", "section-setup.css"]) {
  for (const b of mediaBlocks(css(f), COARSE)) {
    for (const r of rules(b)) {
      if (!/\binput\b/.test(r.sel) || /::after/.test(r.sel)) continue;
      const w = px(r.body, "width"), h = px(r.body, "height");
      if (w != null || h != null) ok(`SV-12 ${f} coarse ${r.sel} is at least 24 px (${w}×${h})`, (w == null || w >= 24) && (h == null || h >= 24));
    }
  }
}
ok("SV-12 site settings sizes the Validations editor's checkboxes on touch too", mediaBlocks(css("steward-console.css"), COARSE).some((b) => /\.form-checkbox-inline input\[type="checkbox"\] \{ width: 24px; height: 24px; \}/.test(b)));
// A text link that IS a row's target gets a 24 px hit area on touch, in every sheet that has one.
for (const f of ["realm-console.css", "overlay.css", "inline-panel.css"]) {
  ok(`SV-12 ${f}: card file-name links get a 24 px line on touch`, mediaBlocks(css(f), COARSE).some((b) => /\.card-filename-link, \.card-expand-link \{ line-height: 24px; \}/.test(b)));
}
ok("SV-12 realm tables pad their page links on touch", mediaBlocks(css("realm-console.css"), COARSE).some((b) => /\.sv-activity-table a, \.wf-dash-table a \{ padding-top: 4px; padding-bottom: 4px; \}/.test(b)));
ok("SV-12 My work pads its page links on touch", mediaBlocks(css("my-work.css"), COARSE).some((b) => /\.mw-link \{ padding-top: 5px; padding-bottom: 5px; \}/.test(b)));

// ── SV-20: status lozenges, badges and labels are never below 11 px ─────────────────────────────
const NEVER_BELOW_11 = [".status-lozenge", ".sv-activity-target-kind", ".val-ai-badge", ".sv-card-section-count", ".wf-appr-badge", ".card-meta-type", ".sv-val-badge"];
for (const f of ["realm-console.css", "steward-console.css", "overlay.css", "inline-panel.css", "doc-ribbon.css", "page-details.css"]) {
  for (const r of rules(css(f))) {
    if (!NEVER_BELOW_11.includes(r.sel)) continue;
    const size = px(r.body, "font-size");
    if (size != null) ok(`SV-20 ${f} ${r.sel} font-size ${size}px ≥ 11`, size >= 11);
  }
}

// ── M-03: no white ink on the theme's primary / danger fill (dark mode makes them light) ────────
const WHITE = /(^|;|\s)color:\s*(#fff\b|#ffffff\b|white\b|var\(--sv-text-inverse\))/i;
for (const f of ["realm-console.css", "steward-console.css", "overlay.css", "inline-panel.css", "page-details.css", "doc-ribbon.css", "my-work.css"]) {
  const bad = rules(css(f)).filter((x) => /background(-color)?:\s*var\(--sv-interactive-(primary|danger)/.test(x.body) && WHITE.test(x.body));
  eq(`M-03 ${f}: no white text on a primary/danger fill`, bad.map((x) => x.sel), []);
  ok(`M-03 ${f}: defines --sv-text-on-danger for light and dark`, (css(f).match(/--sv-text-on-danger:/g) || []).length === 2);
}
for (const f of ["src/ui/surfaces/realm-console/index.jsx", "src/ui/surfaces/steward-console/index.jsx", "src/ui/surfaces/overlay/index.jsx"]) {
  ok(`M-03 ${f}: no --sv-text-inverse ink in inline styles`, !/color:\s*"var\(--sv-text-inverse\)"/.test(read(f)));
}

// ── M-01 / SV-07: menus keep to the visible part horizontally ──────────────────────────────────
ok("M-01 the details modal's Move menu uses the placement hook", /const MoveMenu[\s\S]*?useVisiblePlacement\(open, menuRef\)[\s\S]*?is-start/.test(read("src/ui/surfaces/page-details/index.jsx")));
ok("M-01 .pd-menu.is-start opens rightwards", /\.pd-menu\.is-start \{ right: auto; left: 0; \}/.test(pd));
ok("SV-07 the level picker flips to the trigger's right edge", /open-end/.test(read("src/ui/kit/ClassificationTab.jsx")) && /\.mini-select\.open-end \.mini-select-menu \{ left: auto; right: 0; \}/.test(strip(css("steward-console.css"))) && /\.mini-select\.open-end \.mini-select-menu/.test(strip(css("realm-console.css"))));
ok("SV-07 option hints sit under the name (pd-dd-opt is two columns)", /\.pd-dd-opt \{ display: grid; grid-template-columns: 10px minmax\(0, 1fr\);/.test(pd));

// ── SV-09: the states editor stacks inside its own container ───────────────────────────────────
const realm = strip(css("realm-console.css"));
ok("SV-09 the states table is a named container with a stacked layout", /container: wf-def-table \/ inline-size/.test(realm) && /@container wf-def-table \(max-width: 830px\)/.test(realm));

// ── SV-11: the console tab rows never strand one tab ───────────────────────────────────────────
ok("SV-11 realm tabs become an even 4-column grid under 700 px", /@media \(max-width: 700px\)[\s\S]*?\.tab-navigation \{ display: grid; grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); \}/.test(realm));
ok("SV-11 both consoles use 16 px gutters under 900 px", ["realm-console.css", "steward-console.css"].every((f) => /@media \(max-width: 900px\)[\s\S]*?\.tab-content \{ padding: 8px 16px 0; \}/.test(strip(css(f)))));

// ── SV-13: long lists are capped by default ────────────────────────────────────────────────────
ok("SV-13 the workflow dashboard shows DASHBOARD_ROWS rows until Show all", /slice\(0, DASHBOARD_ROWS\)/.test(read("src/ui/kit/WorkflowDashboard.jsx")));
ok("SV-13 revoked API tokens wait behind Show N revoked", /api-tokens-revoked-toggle/.test(read("src/ui/surfaces/steward-console/index.jsx")));
ok("SV-13 a token revoked in this visit stays in the list reading Revoked", /setRevokedHere\(/.test(read("src/ui/surfaces/steward-console/index.jsx")) && /revokedHere\.has\(t\.id\)/.test(read("src/ui/surfaces/steward-console/index.jsx")));
ok("SV-13 the API receipts show the newest JOBS_SHOWN until Show all", /allJobs\.slice\(0, JOBS_SHOWN\)/.test(read("src/ui/surfaces/steward-console/index.jsx")) && /api-jobs-show-all/.test(read("src/ui/surfaces/steward-console/index.jsx")));

// ── SV-17: settings forms keep a measure on wide screens ───────────────────────────────────────
ok("SV-17 settings panels are capped at 1200 px", ["realm-console.css", "steward-console.css"].every((f) => /\.tab-content > \.settings-panel[^{]*\{ max-width: 1200px; \}/.test(strip(css(f)))));

// ── M-02: the role picker's row sizing is on its FIELD, never on the column-flex child ──────────
ok("M-02 .api-role-picker carries no flex basis", !rules(css("steward-console.css")).some((x) => x.sel === ".api-role-picker" && /flex:\s*1 1 \d+px/.test(x.body)));

// ── M-06: a settings row's label has a floor (the control wraps under it) ───────────────────────
for (const f of ["realm-console.css", "steward-console.css"]) {
  ok(`M-06 ${f}: .settings-row-info has a 260 px basis and the row wraps`, rules(css(f)).some((x) => x.sel === ".settings-row-info" && /flex:\s*1 1 260px/.test(x.body)) && rules(css(f)).some((x) => x.sel === ".settings-row" && /flex-wrap:\s*wrap/.test(x.body)));
}

for (const f of ["realm-console.css", "steward-console.css"]) {
  // The trap that bit twice (M-02, then this pass): a flex BASIS in px on a child of a container that
  // turns into a column becomes the child's HEIGHT. The ≤640 stacking rule must reset it.
  ok(`M-06 ${f}: the ≤640 px column rule resets .settings-row-info's basis`, /@media \(max-width: 640px\) \{[^}]*\.settings-row \{ flex-direction: column;[^}]*\}\s*\.settings-row-info \{ flex: 0 0 auto; width: 100%; \}/.test(strip(css(f))));
}

// ── SV-14: a sealed section's NAME never truncates to make room for its sentence ────────────────
const panel = strip(css("inline-panel.css"));
ok("SV-14 section rows wrap and the title has a floor", /\.sv-section-row \{[^}]*flex-wrap: wrap;/.test(panel) && /\.sv-section-row-title \{\s*flex: 1 1 200px;/.test(panel));

ok("SV-14 under 720 px a section's sentence takes its own line (the ⋯ never wraps alone)", mediaBlocks(css("inline-panel.css"), "@media (max-width: 720px)").some((b) => /\.sv-section-row-meta \{ order: 1; flex-basis: 100%; \}/.test(b)));

ok("SV-14 the panel's group headings and sealed-section blocks are inset like the cards (nothing on the frame edge)", rules(css("inline-panel.css")).some((x) => x.sel === ".sv-sealed-group-header, .sv-sealed-group-wait" && /padding-left:\s*14px/.test(x.body)) && rules(css("inline-panel.css")).some((x) => x.sel === ".sv-section-list" && /padding-left:\s*12px/.test(x.body)) && rules(css("inline-panel.css")).some((x) => x.sel === ".sv-group-footer" && /padding:\s*8px 14px 2px/.test(x.body)));

// ── SV-10: the reminder never covers a control — with no free spot it makes room ─────────────────
const float = read("src/ui/kit/UnsavedFloat.jsx");
ok("SV-10 UnsavedFloat opens a gap under the row when every spot is blocked", /spot\.hits === 0/.test(float) && /roomNeeded\(size\)/.test(float) && /roomBelow\(/.test(float) && /closeRoom\(\)/.test(float));
ok("SV-10 UnsavedFloat keeps to the part of the frame on screen", /measureVisibleBand\(\)/.test(float));

// ── SV-01 cause 1, the other side: scoping the dialog rule must not shrink a real call to action ──
ok("SV-01 the space console's 'Request admin access' keeps its full button size", rules(css("realm-console.css")).some((x) => x.sel === ".steward-request-banner .action-btn" && /padding:\s*10px 20px/.test(x.body) && /font-size:\s*14px/.test(x.body)));

// ── SV-05 / SV-15 / SV-16 ───────────────────────────────────────────────────────────────────────
const ov = strip(css("overlay.css"));
ok("SV-05 a short overlay frame scrolls as a whole and the notice sentence drops", /@media \(max-height: 560px\)[\s\S]*?\.modal-container \{ overflow-y: auto; \}[\s\S]*?\.ov-macro-notice-desc \{ display: none; \}/.test(ov));
ok("SV-05 a laptop-short overlay (≤720 px tall) drops the notice sentence but keeps the list scroller", mediaBlocks(css("overlay.css"), "@media (max-height: 720px)").some((b) => /\.ov-macro-notice-desc \{ display: none; \}/.test(b) && !/modal-container/.test(b)));
ok("SV-05 the overlay notice is classed (no padding locked in an inline style)", /className="ov-macro-notice"/.test(read("src/ui/surfaces/overlay/index.jsx")));
ok("SV-15 the seal form pins while files are ticked", /\.pd-seal-form\.is-pinned \{ position: sticky; bottom: 0;/.test(pd) && /pd-seal-form\$\{n > 0 \? " is-pinned" : ""\}/.test(read("src/ui/surfaces/page-details/index.jsx")));
ok("SV-16 the banner's Open picks the modal size by device", /detailsModalSize\(/.test(read("src/ui/surfaces/doc-ribbon/index.jsx")));

report("responsive-css");
