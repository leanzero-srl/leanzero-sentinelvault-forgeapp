import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@forge/bridge";
import { MiniSelect } from "./WorkflowSettingsEditor";
import { ActivityGlyph } from "./ActivityFeed";
import {
  ACTIVITY_CATEGORIES, activityToCsv, formatAbsolute, formatActivity, pageTitleOf, relativeTime,
} from "./activity-format";
import { nextSelection, selectAll, clearAll, isAllOn } from "./activity-filter";

// A1 — the space Activity report (realm console, stewards only). Reads `get-space-activity`
// with the category + date filters applied SERVER-SIDE (a fetched page may come back short —
// the cursor still continues), and the "page title contains" filter applied client-side over
// whatever has been loaded. Export walks the cursor to a hard 5,000-row cap and downloads a
// client-side Blob — no egress, same mechanism as WorkflowDashboard.

const PAGE_LIMIT = 50;
const EXPORT_LIMIT = 100;
export const EXPORT_CAP = 5000;

const DATE_PRESETS = [
  { value: "7d", label: "Last 7 days", days: 7 },
  { value: "30d", label: "Last 30 days", days: 30 },
  { value: "90d", label: "Last 90 days", days: 90 },
  { value: "all", label: "All time", days: null },
];

const sinceFor = (preset, nowMs = Date.now()) => {
  const p = DATE_PRESETS.find((d) => d.value === preset);
  return p && p.days ? new Date(nowMs - p.days * 86400000).toISOString() : null;
};

const ALL_CATEGORY_IDS = ACTIVITY_CATEGORIES.map((c) => c.id);

// Server-side `types` filter for a chip selection; undefined when every chip is on (no filter).
const typesFor = (activeIds) => {
  if (activeIds.length === ALL_CATEGORY_IDS.length) return undefined;
  return ACTIVITY_CATEGORIES.filter((c) => activeIds.includes(c.id)).flatMap((c) => c.types);
};

const pageUrl = (siteUrl, pageId) => (siteUrl && pageId ? `${siteUrl}/wiki/pages/viewpage.action?pageId=${encodeURIComponent(pageId)}` : null);

const kindWord = (kind) => (kind === "attachment" ? "File" : kind === "section" ? "Section" : "Page");

const fmtInt = (n) => Number(n || 0).toLocaleString();

export default function ActivityReport({ spaceKey, siteUrl = null }) {
  const [activeCats, setActiveCats] = useState(ALL_CATEGORY_IDS);
  const [preset, setPreset] = useState("30d");
  const [titleQuery, setTitleQuery] = useState("");
  const [entries, setEntries] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [exporting, setExporting] = useState(null); // { loaded } while walking
  const [exportNote, setExportNote] = useState("");
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const fetchPage = useCallback(async (cursor, limit) => {
    const payload = { spaceKey, limit };
    const types = typesFor(activeCats);
    if (types) payload.types = types;
    const since = sinceFor(preset);
    if (since) payload.since = since;
    if (cursor) payload.cursor = cursor;
    const r = await invoke("get-space-activity", payload);
    return { entries: Array.isArray(r?.entries) ? r.entries : [], nextCursor: r?.nextCursor || null };
  }, [spaceKey, activeCats, preset]);

  // Filters changed → start over from the newest entry.
  useEffect(() => {
    if (!spaceKey) { setLoading(false); return undefined; }
    // An empty chip selection means "show nothing" — say so without a server round-trip (an empty
    // `types` list would read as "no filter" on the server and show everything).
    if (activeCats.length === 0) { setEntries([]); setNextCursor(null); setLoading(false); setError(false); return undefined; }
    let cancelled = false;
    setLoading(true); setError(false); setExportNote("");
    fetchPage(null, PAGE_LIMIT)
      .then((r) => { if (!cancelled && alive.current) { setEntries(r.entries); setNextCursor(r.nextCursor); setLoading(false); } })
      .catch((e) => { console.warn("Activity report load failed:", e); if (!cancelled && alive.current) { setError(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [fetchPage, spaceKey, activeCats.length]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true); setError(false);
    try {
      const r = await fetchPage(nextCursor, PAGE_LIMIT);
      if (!alive.current) return;
      setEntries((prev) => [...prev, ...r.entries]);
      setNextCursor(r.nextCursor);
    } catch (e) {
      console.warn("Activity report load-more failed:", e);
      if (alive.current) setError(true);
    } finally {
      if (alive.current) setLoadingMore(false);
    }
  };

  // activity-filter.js: all on + click one → isolate; else toggle; All / None are the bulk moves.
  const toggleCat = (id) => setActiveCats((prev) => nextSelection(prev, id, ALL_CATEGORY_IDS));
  const allOn = isAllOn(activeCats, ALL_CATEGORY_IDS);

  const q = titleQuery.trim().toLowerCase();
  const matchesTitle = useCallback((e) => !q || pageTitleOf(e).toLowerCase().includes(q) || String(e.pageId || "").includes(q), [q]);
  const visible = useMemo(() => entries.filter(matchesTitle), [entries, matchesTitle]);

  const exportCsv = async () => {
    if (exporting) return;
    setExporting({ loaded: 0 }); setExportNote("");
    const rows = [];
    let cursor = null;
    try {
      // Walk from the top with the same server-side filters, up to the cap.
      do {
        const r = await fetchPage(cursor, Math.min(EXPORT_LIMIT, EXPORT_CAP - rows.length));
        if (!alive.current) return;
        for (const e of r.entries) { if (rows.length < EXPORT_CAP && matchesTitle(e)) rows.push(e); }
        cursor = r.nextCursor;
        setExporting({ loaded: rows.length });
      } while (cursor && rows.length < EXPORT_CAP);
      const blob = new Blob([activityToCsv(rows)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `activity-${spaceKey || "space"}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExportNote(cursor && rows.length >= EXPORT_CAP
        ? `Exported the newest ${fmtInt(EXPORT_CAP)} rows — narrow the filters to reach older activity.`
        : `Exported ${fmtInt(rows.length)} row${rows.length === 1 ? "" : "s"}.`);
    } catch (e) {
      console.warn("Activity export failed:", e);
      setExportNote("Couldn’t export activity right now. Reload the page to try again.");
    } finally {
      if (alive.current) setExporting(null);
    }
  };

  const status = error
    ? "Couldn’t load activity right now. Reload the page to try again."
    : loading ? "Loading activity…"
    : activeCats.length === 0 ? "No category selected — pick one above, or Select all."
    : entries.length === 0 ? "No activity recorded yet in this space for these filters."
    : visible.length === 0 ? "No loaded rows match that page title. Try “Load more” or clear the title filter."
    : "";

  return (
    <div className="sv-activity-report" data-testid="sv-activity-report">
      <div className="sv-activity-report-head">
        <div>
          <h3 className="sv-activity-report-title">Activity</h3>
          <p className="sv-activity-report-sub">Everything Sentinel Vault did or was asked to do on pages in this space — seals, sections, edit access, workflow and validation.</p>
        </div>
        <button type="button" className="sv-activity-export" data-testid="sv-activity-export" onClick={exportCsv} disabled={!!exporting || loading}>
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </div>

      <div className="sv-activity-filters" role="group" aria-label="Activity filters">
        <div className="sv-activity-chips" role="group" aria-label="Categories">
          {ACTIVITY_CATEGORIES.map((c) => {
            const on = activeCats.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                className={`sv-activity-chip-btn sv-activity-chip-${c.id} ${on ? "is-active" : ""}`}
                aria-pressed={on}
                data-testid={`sv-activity-filter-${c.id}`}
                onClick={() => toggleCat(c.id)}
              >
                {c.label}
              </button>
            );
          })}
          <span className="sv-activity-chip-bulk">
            <button type="button" className="sv-activity-chip-link" disabled={allOn} onClick={() => setActiveCats(selectAll(ALL_CATEGORY_IDS))} data-testid="sv-activity-filter-all">Select all</button>
            <button type="button" className="sv-activity-chip-link" disabled={activeCats.length === 0} onClick={() => setActiveCats(clearAll())} data-testid="sv-activity-filter-none">Clear all</button>
          </span>
          <span className="sv-activity-chip-hint" aria-live="polite">{allOn ? "Showing everything — click a category to see only that one" : activeCats.length === 0 ? "No category selected" : `Showing ${activeCats.length} of ${ALL_CATEGORY_IDS.length} categories`}</span>
        </div>
        <div className="sv-activity-filter-controls">
          <MiniSelect ariaLabel="Time range" value={preset} options={DATE_PRESETS} onChange={setPreset} />
          <input
            type="text"
            className="form-input sv-activity-title-input"
            placeholder="Page title contains…"
            aria-label="Page title contains"
            value={titleQuery}
            onChange={(e) => setTitleQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="sv-activity-status" role="status" aria-live="polite">
        {exporting ? `Loading ${fmtInt(exporting.loaded)} of up to ${fmtInt(EXPORT_CAP)}…` : exportNote || status}
      </div>

      {!loading && visible.length > 0 && (
        <div className="sv-activity-table-wrap">
          <table className="sv-activity-table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Event</th>
                <th scope="col">Page</th>
                <th scope="col">Who</th>
                <th scope="col">Target</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e, i) => {
                const f = formatActivity(e);
                const href = pageUrl(siteUrl, e.pageId);
                const title = pageTitleOf(e) || "—";
                const who = e.actor?.name || (e.actor?.accountId ? "Someone" : "Sentinel Vault");
                return (
                  <tr key={e.id || `${e.ts}-${i}`} className="sv-activity-row" data-testid="sv-activity-row" data-type={e.type || ""}>
                    <td className="sv-activity-col-when">
                      <time dateTime={e.ts || ""} title={relativeTime(e.ts)}>{formatAbsolute(e.ts)}</time>
                    </td>
                    <td className="sv-activity-col-event">
                      <span className={`sv-activity-chip sv-activity-tone-${f.tone}`}>
                        <ActivityGlyph name={f.glyph} />
                        {f.label}
                      </span>
                    </td>
                    <td className="sv-activity-col-page">
                      {href ? <a href={href} target="_blank" rel="noreferrer">{title}</a> : title}
                    </td>
                    <td className="sv-activity-col-who">{who}</td>
                    <td className="sv-activity-col-target">
                      <span className="sv-activity-target-kind">{kindWord(e.target?.kind)}</span>
                      {e.target?.name ? <span className="sv-activity-target-name">{e.target.name}</span> : null}
                    </td>
                    <td className="sv-activity-col-details">
                      <div className="sv-activity-sentence">{f.sentence}</div>
                      {f.detail && <div className="sv-activity-detail">{f.detail}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && nextCursor && (
        <div className="sv-activity-footer">
          <button type="button" className="sv-activity-more" data-testid="sv-activity-more" onClick={loadMore} disabled={loadingMore || !!exporting}>
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
