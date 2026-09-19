// SEC-1 (UX critique 2026-09-19): a section range never swallows one of Sentinel Vault's own macros,
// and the picker can say where a range ends. Pure rules: describeSectionRange / computeSectionRange
// (server) and describeRange (picker copy).
import { eq, ok, report } from "./_assert.mjs";
import { computeSectionRange, describeSectionRange, isSentinelVaultExtension } from "../src/server/capsules/section-seals/logic.js";
import { describeRange } from "../src/ui/kit/section-range.js";

const APP = "c30bf71e-4287-4872-954d-db49cc68f0ff/17516615-12ef-4790-8ce2-29151b7ee9ac";
const h = (level, text) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
const p = { type: "paragraph" };
const panel = { type: "extension", attrs: { extensionKey: `${APP}/static/sentinel-vault-panel` } };
const sealed = { type: "bodiedExtension", attrs: { extensionKey: `${APP}/static/sentinel-vault-sealed-section` }, content: [p] };
const status = { type: "inlineExtension", attrs: { extensionKey: "com.atlassian.confluence.macro.core/status" } };
const expand = { type: "expand", content: [p] };

// isSentinelVaultExtension
ok("panel is ours", isSentinelVaultExtension(panel));
ok("sealed section is ours", isSentinelVaultExtension(sealed));
ok("another app's macro is not", !isSentinelVaultExtension(status));
ok("a plain block is not", !isSentinelVaultExtension(p));
ok("null is not", !isSentinelVaultExtension(null));

// The bug: last heading + panel at the bottom
{
  const c = [p, h(2, "Scope"), p, h(2, "Last"), p, panel];
  eq("last heading stops BEFORE the panel", computeSectionRange(c, 3), { start: 3, end: 5 });
  eq("describe: stops at the panel, 1 block", describeSectionRange(c, 3), { range: { start: 3, end: 5 }, blocks: 1, stopsAt: { kind: "sentinel-vault", what: "panel" } });
  eq("earlier heading stops at the next heading", describeSectionRange(c, 1), { range: { start: 1, end: 3 }, blocks: 1, stopsAt: { kind: "heading", text: "Last" } });
}
// A sealed section already below the heading ends the range too (never nest ours)
{
  const c = [h(2, "A"), p, sealed, p, h(2, "B")];
  eq("range ends before a sealed section", describeSectionRange(c, 0), { range: { start: 0, end: 2 }, blocks: 1, stopsAt: { kind: "sentinel-vault", what: "sealed-section" } });
}
// Other apps' macros and native containers stay INSIDE the range (they are the section's content)
{
  const c = [h(2, "A"), status, expand, p];
  eq("status + expand stay in the range, to the end of the page", describeSectionRange(c, 0), { range: { start: 0, end: 4 }, blocks: 3, stopsAt: { kind: "end" } });
}
// Deeper headings stay inside; same/higher level ends it
{
  const c = [h(2, "A"), p, h(3, "A.1"), p, h(1, "Top")];
  eq("H3 inside an H2 section, H1 ends it", describeSectionRange(c, 0), { range: { start: 0, end: 4 }, blocks: 3, stopsAt: { kind: "heading", text: "Top" } });
}
// Heading immediately followed by the panel: heading only
{
  const c = [h(2, "Alone"), panel];
  eq("heading only when the panel sits right under it", describeSectionRange(c, 0), { range: { start: 0, end: 1 }, blocks: 0, stopsAt: { kind: "sentinel-vault", what: "panel" } });
}
// Non-heading block seals itself
eq("non-heading = single block", describeSectionRange([p, p], 0), { range: { start: 0, end: 1 }, blocks: 0, stopsAt: { kind: "end" } });

// Picker copy
eq("copy: next heading", describeRange({ blocks: 2, stopsAt: { kind: "heading", text: "Decisions" } }), "Seals heading + 2 blocks · ends before “Decisions”");
eq("copy: one block, panel", describeRange({ blocks: 1, stopsAt: { kind: "sentinel-vault", what: "panel" } }), "Seals heading + 1 block · ends before the Sentinel Vault panel");
eq("copy: sealed section below", describeRange({ blocks: 1, stopsAt: { kind: "sentinel-vault", what: "sealed-section" } }), "Seals heading + 1 block · ends before a sealed section");
eq("copy: other SV macro", describeRange({ blocks: 2, stopsAt: { kind: "sentinel-vault", what: "macro" } }), "Seals heading + 2 blocks · ends before a Sentinel Vault macro");
eq("copy: heading only, end of page", describeRange({ blocks: 0, stopsAt: { kind: "end" } }), "Seals the heading only · to the end of the page");
eq("copy: untitled next heading", describeRange({ blocks: 3, stopsAt: { kind: "heading", text: "  " } }), "Seals heading + 3 blocks · ends before “the next heading”");
eq("copy: old server shape (no blocks) → empty", describeRange({ index: 1, text: "X" }), "");

report("section-range");
