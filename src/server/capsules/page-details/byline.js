/*
 * Byline chip (5.0, mockup §1) — the `sentinel-byline` content property.
 *
 * Confluence renders the `confluence:contentBylineItem` from a content property — title, icon
 * and tooltip — so the chip costs no resolver call on page view. This module is the ONLY writer
 * of that property. The PURE half (`composeByline`, `bylineIcon`, `bylineStamp`) has no Forge
 * import so `test/byline.test.mjs` pins every state; the I/O half (`refreshByline`,
 * `writeBylineFor`) reads the page's seals and classification and writes the property as the
 * app (create-or-update with a version bump, v2 page properties).
 *
 * States (title):
 *   "{Level} · set on this page"   the page carries its own override
 *   "{Level} · space default"      the level comes from the space default
 *   "Unclassified"                 no provider level for this page
 * Icon: a data: SVG — a disc in the level colour (neutral slate when unclassified) carrying a
 * white LOCK when the page holds at least one live seal, a white dot otherwise. PROVEN LIVE
 * (wolfaenpak, 2026-09-15): Confluence renders the byline as button[data-testid=
 * "byline-forge-app-button"] with img[data-testid="byline-forge-app-image"] whose src is the
 * data: URI verbatim (naturalWidth 16, shown at 18px) — no static PNG needed. `ICON_MODE`
 * keeps the static-PNG fallback path selectable should a host build ever reject it.
 *
 * Refresh policy: every seal / section / page-classification write calls `refreshByline` (one
 * line each, never awaited into the caller's failure path). A SPACE default change is NOT
 * fanned out to every page: `page-details-summary` compares the stored stamp
 * (`byline-stamp-{pageId}`) with what the page should show and rewrites lazily on open, and
 * the page-content trigger refreshes on every save. The stamp is written only after the property
 * write succeeded, so a failed write is retried by the next caller.
 *
 * Per-viewer data (mockup §1's "waiting-on-you" counter, decision 4) CANNOT live here: a content
 * property is one value for every viewer. The modal header carries that count instead.
 */
import { asApp, route } from "@forge/api";
import { kvs } from "@forge/kvs";
import { getClassificationProvider, classificationActiveForPage } from "../classification/provider.js";
import { describeWorkflowForPage } from "../workflow/approvals.js"; // WF-6: the status the chip carries
import { collectPageSeals, readPageMeta } from "./logic.js";
import { sealCountLabel } from "../../../ui/kit/status-language.js"; // SEC-3: "Sealed (2)"

export const BYLINE_PROPERTY_KEY = "sentinel-byline";
export const NEUTRAL_COLOR = "#475569";
export const ICON_MODE = "data"; // "data" (data: SVG URI) | "static" (PNG under static/page-details/)
const STAMP_PREFIX = "byline-stamp-";
const HEX = /^#[0-9a-fA-F]{6}$/;

const stampKey = (pageId) => `${STAMP_PREFIX}${pageId}`;

/** PURE. The chip icon for a colour + sealed flag. */
export function bylineIcon({ color, sealed }, mode = ICON_MODE) {
  const fill = HEX.test(String(color || "")) ? String(color).toUpperCase() : NEUTRAL_COLOR;
  if (mode === "static") {
    // Static fallback: one PNG per seeded level colour, a neutral disc for any other colour.
    const known = { "#059669": "public", "#0891B2": "internal", "#D97706": "confidential", "#DC2626": "restricted",
      "#15803D": "public", "#1D4ED8": "internal", "#B45309": "confidential", "#B91C1C": "restricted" };
    const base = known[fill] || "neutral";
    return `icons/${base}-${sealed ? "lock" : "dot"}.png`;
  }
  const glyph = sealed
    ? '<rect x="4.5" y="7.5" width="7" height="5" rx="1" fill="#fff"/><path d="M6 7.5V6a2 2 0 0 1 4 0v1.5" fill="none" stroke="#fff" stroke-width="1.4"/>'
    : '<circle cx="8" cy="8" r="3" fill="#fff"/>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="8" fill="${fill}"/>${glyph}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * PURE. { title, icon, tooltip } for a page.
 * @param {{ level: {name:string,color:string}|null, source: "page"|"space"|"none", sealCount: number,
 *           classificationEnabled?: boolean }} s
 * CLS-1: with classification OFF (`classificationEnabled === false`) the chip never mentions a
 * level — the title is the seal count ("2 seals on this page") or the app's name, and the icon is
 * the neutral disc (lock when sealed). The level passed in is ignored on purpose: a stored level is
 * kept in KVS but must not show.
 */
export function composeByline({ level, source, sealCount, classificationEnabled, workflow } = {}) {
  const n = Number.isFinite(Number(sealCount)) && Number(sealCount) > 0 ? Math.floor(Number(sealCount)) : 0;
  const sealed = n > 0;
  const sealsText = n === 0 ? "No seals on this page" : n === 1 ? "1 seal on this page" : `${n} seals on this page`;
  // SEC-3: the byline is the one surface every page shows without the ribbon, so the seal count
  // is in the TITLE ("Sealed (2)"), never only in the tooltip. The classification source moves to
  // the tooltip whenever the title carries a status or a count.
  const sealsTitle = sealCountLabel(n);
  // WF-6: a page with a workflow carries its status (workflow/status.js — state + ONE qualifier)
  // as `Level · Status` when classification is on, the status alone when it is off; the disc takes
  // the status tone (a reader must tell approved from unapproved without the ribbon). The
  // classification source moves to the tooltip.
  if (workflow && workflow.text) {
    const off = classificationEnabled === false;
    const levelName = off ? null : level?.name ? level.name : "Unclassified";
    const src = !off && level?.name ? (source === "page" ? "set on this page" : "space default") : null;
    const levelTip = off ? null : level?.name ? `${level.name} (${src})` : "No classification level";
    return {
      title: [levelName, workflow.text, sealsTitle].filter(Boolean).join(" · "),
      icon: bylineIcon({ color: workflow.color || NEUTRAL_COLOR, sealed }),
      tooltip: [levelTip, `Workflow: ${workflow.stateName || workflow.text}${workflow.qualifier ? ` — ${workflow.qualifier}` : ""}`, sealsText, "Open Sentinel Vault"].filter(Boolean).join(" · "),
    };
  }
  if (classificationEnabled === false) {
    return {
      title: sealed ? sealsTitle : "Sentinel Vault",
      icon: bylineIcon({ color: NEUTRAL_COLOR, sealed }),
      tooltip: `${sealsText} · Open Sentinel Vault`,
    };
  }
  if (!level || !level.name) {
    return {
      title: sealed ? `Unclassified · ${sealsTitle}` : "Unclassified",
      icon: bylineIcon({ color: NEUTRAL_COLOR, sealed }),
      tooltip: `No classification level · ${sealsText} · Open Sentinel Vault`,
    };
  }
  const src = source === "page" ? "set on this page" : "space default";
  return {
    title: sealed ? `${level.name} · ${sealsTitle}` : `${level.name} · ${src}`,
    icon: bylineIcon({ color: level.color, sealed }),
    tooltip: `${level.name} (${src}) · ${sealsText} · Open Sentinel Vault`,
  };
}

/** PURE. What makes two bylines the same for the lazy-refresh comparison. */
export function bylineStamp(b) {
  return b ? `${b.title}|${b.icon}|${b.tooltip}` : "";
}

/** Live: create-or-update the v2 page property, bumping the version. Returns true on success. */
async function writeProperty(pageId, value) {
  const getRes = await asApp().requestConfluence(
    route`/wiki/api/v2/pages/${pageId}/properties?key=${BYLINE_PROPERTY_KEY}`,
    { headers: { Accept: "application/json" } },
  );
  if (!getRes.ok) { console.warn(`[BYLINE] property read on ${pageId} → ${getRes.status}`); return false; }
  const existing = (await getRes.json())?.results?.[0];
  const headers = { Accept: "application/json", "Content-Type": "application/json" };
  const res = existing
    ? await asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}/properties/${existing.id}`, {
      method: "PUT", headers,
      body: JSON.stringify({ key: BYLINE_PROPERTY_KEY, value, version: { number: (existing.version?.number || 1) + 1 } }),
    })
    : await asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}/properties`, {
      method: "POST", headers, body: JSON.stringify({ key: BYLINE_PROPERTY_KEY, value }),
    });
  if (!res.ok) console.warn(`[BYLINE] property write on ${pageId} → ${res.status} ${await res.text().catch(() => "")}`);
  return !!res.ok;
}

/**
 * Write the byline for KNOWN inputs (the summary resolver already has them). Skips the write when
 * the stored stamp already matches, unless `force`. Never throws.
 * @returns {Promise<{ byline: object, wrote: boolean }>}
 */
export async function writeBylineFor(pageId, { level, source, sealCount, classificationEnabled, workflow }, { force = false } = {}) {
  const byline = composeByline({ level, source, sealCount, classificationEnabled, workflow });
  const stamp = bylineStamp(byline);
  try {
    if (!force) {
      const stored = await kvs.get(stampKey(pageId)).catch(() => null);
      if (stored?.stamp === stamp) return { byline, wrote: false };
    }
    const ok = await writeProperty(pageId, byline);
    if (ok) await kvs.set(stampKey(pageId), { stamp, updatedAt: new Date().toISOString() }).catch(() => {});
    return { byline, wrote: ok };
  } catch (e) {
    console.warn(`[BYLINE] write for ${pageId} failed:`, e?.message || e);
    return { byline, wrote: false };
  }
}

/**
 * Recompute the byline for a page from its seals and classification and write it. Called with
 * ONE line from every seal / section / classification writer and the page-content trigger;
 * always `.catch`-wrapped by the caller and never part of the caller's success.
 */
export async function refreshByline(pageId, opts = {}) {
  if (!pageId) return { byline: null, wrote: false };
  const id = String(pageId);
  const meta = await readPageMeta(id);
  if (!meta) return { byline: null, wrote: false, reason: "page unreadable" };
  // CLS-1: the switch decides whether the level is even read (off = no provider call, no level).
  // WF-6: the workflow status rides the same property (one read of the page's workflow — the
  // record, the open request and, where it matters, the last decision).
  const [seals, sw, wf] = await Promise.all([
    collectPageSeals(id, meta.type).catch((e) => { console.warn("[BYLINE] seals:", e?.message || e); return { attachments: [], sections: [] }; }),
    classificationActiveForPage(id).catch(() => ({ active: false, reason: "site" })),
    describeWorkflowForPage(id).catch((e) => { console.warn("[BYLINE] workflow:", e?.message || e); return null; }),
  ]);
  const classification = sw.active
    ? await getClassificationProvider().then(({ provider }) => provider.effectiveLevel(id)).catch((e) => { console.warn("[BYLINE] classification:", e?.message || e); return { level: null, source: "none" }; })
    : { level: null, source: "none" };
  const sealCount = seals.attachments.filter((a) => !a.trashed).length + seals.sections.length;
  return writeBylineFor(id, { level: classification.level, source: classification.source, sealCount, classificationEnabled: sw.active, workflow: wf?.status || null }, opts);
}
