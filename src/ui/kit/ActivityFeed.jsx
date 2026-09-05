import React, { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@forge/bridge";
import { formatActivity, formatAbsolute, relativeTime } from "./activity-format";

// A1 — Document Activity feed. One list, three homes (inline panel group, overlay section, and
// — through ActivityReport — the realm console). Reads `get-page-activity` when it has a pageId,
// `get-space-activity` when it only has a spaceKey; both answer { entries[], nextCursor }.
//
// The first query carries NO cursor (the server rejects an empty one); "Show more" sends back
// exactly the cursor the last page returned. Entries are appended, never re-sorted: the server
// already hands them newest-first.

const SVG = ({ children }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

// Icon keys come from activity-format.js `glyph`; anything unknown falls back to a dot.
export const ActivityGlyph = ({ name }) => {
  switch (name) {
    case "lock": return <SVG><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></SVG>;
    case "unlock": return <SVG><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 017.5-2" /></SVG>;
    case "clock": return <SVG><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></SVG>;
    case "hourglass": return <SVG><path d="M6 3h12M6 21h12M8 3v4l4 5 4-5V3M8 21v-4l4-5 4 5v4" /></SVG>;
    case "undo": return <SVG><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 010 10h-3" /></SVG>;
    case "trash": return <SVG><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></SVG>;
    case "image": return <SVG><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M21 16l-5-5-9 9" /></SVG>;
    case "layout": return <SVG><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M10 10v10" /></SVG>;
    case "section": return <SVG><path d="M4 6h16M4 12h10M4 18h16" /></SVG>;
    case "key": return <SVG><circle cx="8" cy="14" r="4" /><path d="M11 11l9-9M16 6l3 3M14 8l2 2" /></SVG>;
    case "check": return <SVG><path d="M5 12l5 5L20 7" /></SVG>;
    case "cross": return <SVG><path d="M6 6l12 12M18 6L6 18" /></SVG>;
    case "arrow": return <SVG><path d="M4 12h16M14 6l6 6-6 6" /></SVG>;
    case "shield": return <SVG><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" /><path d="M9 12l2 2 4-4" /></SVG>;
    case "alert": return <SVG><path d="M12 3l10 18H2L12 3z" /><path d="M12 10v4M12 17.5v.5" /></SVG>;
    default: return <SVG><circle cx="12" cy="12" r="3" fill="currentColor" /></SVG>;
  }
};

export const ActivityRow = ({ entry, compact }) => {
  const f = formatActivity(entry);
  const actor = entry?.actor?.name || (entry?.actor?.accountId ? "Someone" : "Sentinel Vault");
  return (
    <li className={`sv-activity-row ${compact ? "is-compact" : ""}`} data-testid="sv-activity-row" data-type={entry?.type || ""}>
      <span className={`sv-activity-glyph sv-activity-tone-${f.tone}`}>
        <ActivityGlyph name={f.glyph} />
      </span>
      <div className="sv-activity-body">
        <div className="sv-activity-sentence">{f.sentence}</div>
        <div className="sv-activity-meta">
          <span className="sv-activity-actor">{actor}</span>
          <span className="sv-activity-dot" aria-hidden="true">·</span>
          <time className="sv-activity-when" dateTime={entry?.ts || ""} title={formatAbsolute(entry?.ts)}>
            {relativeTime(entry?.ts)}
          </time>
          {f.detail && (
            <>
              <span className="sv-activity-dot" aria-hidden="true">·</span>
              <span className="sv-activity-detail">{f.detail}</span>
            </>
          )}
        </div>
      </div>
    </li>
  );
};

const Skeleton = ({ rows }) => (
  <ul className="sv-activity-list sv-activity-skeleton" aria-hidden="true">
    {Array.from({ length: rows }).map((_, i) => (
      <li key={i} className="sv-activity-row">
        <span className="sv-activity-glyph sv-activity-skel-glyph" />
        <div className="sv-activity-body">
          <span className="sv-activity-skel-bar" style={{ width: `${62 + ((i * 17) % 30)}%` }} />
          <span className="sv-activity-skel-bar is-short" />
        </div>
      </li>
    ))}
  </ul>
);

export const ACTIVITY_ERROR_COPY = "Couldn’t load activity right now. Reload the page to try again.";
export const ACTIVITY_EMPTY_PAGE_COPY = "No activity recorded yet on this page.";
export const ACTIVITY_EMPTY_SPACE_COPY = "No activity recorded yet in this space.";

/**
 * @param {object} props
 * @param {string} [props.pageId]    page feed (preferred when present)
 * @param {string} [props.spaceKey]  space feed, used only when there is no pageId
 * @param {number} [props.pageSize]  rows per fetch, default 10 (server caps at 100)
 * @param {boolean} [props.compact]  tighter rows for the inline panel
 * @param {number} [props.reloadKey] bump to refetch from the top (after an action on the page)
 */
export default function ActivityFeed({ pageId = null, spaceKey = null, pageSize = 10, compact = false, reloadKey = 0 }) {
  const [entries, setEntries] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const fetchPage = useCallback(async (cursor) => {
    const action = pageId ? "get-page-activity" : "get-space-activity";
    const payload = pageId ? { pageId, limit: pageSize } : { spaceKey, limit: pageSize };
    if (cursor) payload.cursor = cursor;
    const r = await invoke(action, payload);
    return { entries: Array.isArray(r?.entries) ? r.entries : [], nextCursor: r?.nextCursor || null };
  }, [pageId, spaceKey, pageSize]);

  useEffect(() => {
    if (!pageId && !spaceKey) { setLoading(false); return undefined; }
    let cancelled = false;
    setLoading(true); setError(false);
    fetchPage(null)
      .then((r) => { if (!cancelled && alive.current) { setEntries(r.entries); setNextCursor(r.nextCursor); setLoading(false); } })
      .catch((e) => { console.warn("Activity load failed:", e); if (!cancelled && alive.current) { setError(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [fetchPage, pageId, spaceKey, reloadKey]);

  const showMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true); setError(false);
    try {
      const r = await fetchPage(nextCursor);
      if (!alive.current) return;
      setEntries((prev) => [...prev, ...r.entries]);
      setNextCursor(r.nextCursor);
    } catch (e) {
      console.warn("Activity load-more failed:", e);
      if (alive.current) setError(true);
    } finally {
      if (alive.current) setLoadingMore(false);
    }
  };

  const status = error
    ? ACTIVITY_ERROR_COPY
    : loading ? "Loading activity…"
    : entries.length === 0 ? (pageId ? ACTIVITY_EMPTY_PAGE_COPY : ACTIVITY_EMPTY_SPACE_COPY)
    : "";

  return (
    <div className={`sv-activity-feed ${compact ? "is-compact" : ""}`} data-testid="sv-activity-feed">
      {loading && <Skeleton rows={Math.min(pageSize, 3)} />}
      {!loading && entries.length > 0 && (
        <ul className="sv-activity-list">
          {entries.map((e, i) => <ActivityRow key={e.id || `${e.ts}-${i}`} entry={e} compact={compact} />)}
        </ul>
      )}
      <div className={`sv-activity-status ${error ? "is-error" : ""}`} role="status" aria-live="polite">{status}</div>
      {!loading && nextCursor && (
        <div className="sv-activity-footer">
          <button type="button" className="sv-activity-more" data-testid="sv-activity-more" onClick={showMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Show more"}
          </button>
        </div>
      )}
    </div>
  );
}
