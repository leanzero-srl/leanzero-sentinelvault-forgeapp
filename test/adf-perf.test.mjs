// Perf regression guard for the ADF enforce/restore hot path (quality_gates.heavy_recompute_ms_max
// = 400ms at large_dataset_size = 200 sealed sections). These pure functions run on EVERY page save
// via triggers.js. it38 measured ~3-9ms at N=200 and confirmed LINEAR scaling (~0.013ms/section up
// to N=2000). This guard fails if a future change makes the recompute super-linear (e.g. a quadratic
// ADF walk) BEFORE it reaches the production 400ms gate. Threshold 250ms = huge margin over actual,
// well under the gate — catches a real regression without timing flakiness.
import { SEALED_SECTION_KEY_SUFFIX, buildSealedSectionNode, canonicalizeAdf, hashAdf, locateBodiedSectionNodes, collectHeadings, extractPlainText } from "../src/server/infra/doc-surgery.js";
import { ok, report } from "./_assert.mjs";

const N = 200; // = quality_gates.large_dataset_size
const BUDGET_MS = 250; // < the 400ms heavy_recompute gate; early-warning guard
const KEY = `c30bf71e/17516615${SEALED_SECTION_KEY_SUFFIX}`;
const section = (i) => buildSealedSectionNode({ sectionId: `sec-${i}`, extensionKey: KEY, bodyContent: [
  { type: "paragraph", content: [{ type: "text", text: `Body ${i}. `.repeat(12) }] },
  { type: "table", attrs: {}, content: [{ type: "tableRow", content: [{ type: "tableCell", attrs: {}, content: [{ type: "paragraph", content: [{ type: "text", text: `cell ${i}` }] }] }] }] },
]});
const content = [];
for (let i = 0; i < N; i++) { content.push({ type: "paragraph", content: [{ type: "text", text: `Filler ${i}. `.repeat(20) }] }); content.push(section(i)); }
const doc = { type: "doc", version: 1, content };

const recompute = () => { canonicalizeAdf(doc); hashAdf(doc); const s = locateBodiedSectionNodes(doc); for (const x of s) hashAdf(canonicalizeAdf(x.node.content)); collectHeadings(doc); extractPlainText(doc); return s.length; };

recompute(); // warm (JIT + GC)
const t0 = performance.now();
const located = recompute();
const ms = performance.now() - t0;

ok(`locates all ${N} sealed sections (fixture sane)`, located === N);
ok(`enforce/restore recompute ${ms.toFixed(1)}ms < ${BUDGET_MS}ms guard (gate 400ms)`, ms < BUDGET_MS);

report("adf-perf");
