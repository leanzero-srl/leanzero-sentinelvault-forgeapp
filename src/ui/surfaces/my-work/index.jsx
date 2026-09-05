import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke, router } from "@forge/bridge";
import { enablePaletteSync } from "../../kit/palette-sync";
import WorkflowInbox from "../../kit/WorkflowInbox";
import logo from "../../assets/icons/icon.png";

// A7 (ledger #55): one page, every space. Comala's Document Report can be filtered to "my
// pending approvals"; Sentinel Vault had the same answers scattered across each space's console
// and each page's panel. This page composes three resolvers that are ALL scoped to the caller
// (req.context.accountId — a payload cannot widen any of them):
//   list-my-approvals        → approvals waiting on me (WorkflowInbox, shared with the console)
//   list-my-edit-requests    → people asking to edit a file I hold sealed
//   enumerate-operator-seals → the files I hold sealed, with their clocks
// Navigation goes through router.navigate: a Custom UI iframe may be sandboxed without
// allow-top-navigation (proven on the page banner), where a target=_top anchor does nothing.

const viewPage = (pageId) => `/wiki/pages/viewpage.action?pageId=${pageId}`;
const go = (path) => (e) => { e.preventDefault(); router.navigate(path); };
const when = (iso) => {
  const ms = iso ? new Date(iso).getTime() : NaN;
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

// People asking to edit a file the current user holds sealed. Approve mints a grant for the
// seal's lifetime; Deny closes the request. Both go through the owner-gated resolvers.
const EditRequests = () => {
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await invoke("list-my-edit-requests", {});
      setItems(Array.isArray(r?.requests) ? r.requests : []);
    } catch (_) { setItems([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const decide = async (req, action) => {
    const key = `${req.artifactId}-${req.requesterAccountId}`;
    setBusy(key); setError(null);
    try {
      const r = await invoke(action === "approve" ? "approve-edit-request" : "deny-edit-request", { attachmentId: req.artifactId, requesterAccountId: req.requesterAccountId });
      if (r?.success) await load();
      else setError(r?.reason || "Could not record your decision.");
    } catch (_) { setError("Could not record your decision."); }
    finally { setBusy(null); }
  };

  const n = items ? items.length : 0;
  return (
    <section className="mw-card" data-testid="mw-requests">
      <div className="mw-card-head">
        <span className="mw-card-title">Edit requests on your sealed files</span>
        <span className={`mw-count ${n ? "mw-count-requests" : "mw-count-zero"}`}>{n}</span>
      </div>
      {error && <p className="mw-error" role="alert">{error}</p>}
      {items === null && <p className="mw-loading">Checking for requests…</p>}
      {items && items.length === 0 && <p className="mw-none" data-testid="mw-requests-empty">Nobody is waiting on you to unlock a file.</p>}
      {items && items.length > 0 && (
        <ul className="mw-list">
          {items.map((req) => {
            const key = `${req.artifactId}-${req.requesterAccountId}`;
            return (
              <li key={key} className="mw-row" data-testid="mw-request-row">
                <div className="mw-row-info">
                  <span className="mw-row-main">
                    {req.requesterName || "Someone"} wants to edit <strong>{req.attachmentName || "a sealed file"}</strong>
                    {req.contentId ? <> on <a href={viewPage(req.contentId)} onClick={go(viewPage(req.contentId))}>this page</a></> : null}
                  </span>
                  {req.reason ? <span className="mw-row-reason">“{req.reason}”</span> : null}
                  <span className="mw-row-meta">{req.requestedAt ? `Asked ${when(req.requestedAt)}` : ""}{req.spaceKey ? ` · ${req.spaceKey}` : ""}</span>
                </div>
                <div className="mw-row-actions">
                  <button type="button" className="mw-btn mw-btn-approve" disabled={busy === key} onClick={() => decide(req, "approve")} aria-label={`Approve ${req.requesterName || "the request"} editing ${req.attachmentName || "the file"}`}>Approve</button>
                  <button type="button" className="mw-btn mw-btn-deny" disabled={busy === key} onClick={() => decide(req, "deny")} aria-label={`Deny ${req.requesterName || "the request"} editing ${req.attachmentName || "the file"}`}>Deny</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

// The files the current user holds sealed, across every space, newest first, paged by the
// resolver's keyset cursor.
const MySeals = () => {
  const [rows, setRows] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (next) => {
    setBusy(true);
    try {
      const r = await invoke("enumerate-operator-seals", { cursor: next || null, limit: 25 });
      const got = Array.isArray(r?.attachments) ? r.attachments : [];
      setRows((prev) => (next ? [...(prev || []), ...got] : got));
      setCursor(r?.nextCursor || null);
      setHasMore(!!r?.hasMore);
      setTotal(typeof r?.total === "number" ? r.total : got.length);
    } catch (_) { setRows((prev) => prev || []); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { load(null); }, [load]);

  const pill = (s) => {
    if (s.isStale) return <span className="mw-pill mw-pill-stale">{s.staleReason === "trashed" ? "In the trash" : "Unavailable"}</span>;
    if (s.isExpired) return <span className="mw-pill mw-pill-overdue">Overdue</span>;
    return <span className="mw-pill mw-pill-live">Sealed</span>;
  };

  return (
    <section className="mw-card" data-testid="mw-seals">
      <div className="mw-card-head">
        <span className="mw-card-title">Files you hold sealed</span>
        <span className={`mw-count ${total ? "mw-count-seals" : "mw-count-zero"}`}>{total}</span>
      </div>
      {rows === null && <p className="mw-loading">Looking up your sealed files…</p>}
      {rows && rows.length === 0 && <p className="mw-none" data-testid="mw-seals-empty">You are not holding any file sealed.</p>}
      {rows && rows.length > 0 && (
        <ul className="mw-list">
          {rows.map((s) => (
            <li key={s.id} className="mw-row" data-testid="mw-seal-row">
              <div className="mw-row-info">
                <span className="mw-row-main">{s.title}</span>
                <span className="mw-row-meta">
                  {s.pageId ? <a className="mw-link" href={viewPage(s.pageId)} onClick={go(viewPage(s.pageId))}>{s.pageTitle || "Open page"}</a> : (s.pageTitle || "")}
                  {s.spaceName || s.spaceKey ? ` · ${s.spaceName || s.spaceKey}` : ""}
                  {s.expiresAt ? ` · ${s.isExpired ? "was due" : "until"} ${when(s.expiresAt)}` : " · no end date"}
                </span>
              </div>
              <div className="mw-row-actions">{pill(s)}</div>
            </li>
          ))}
        </ul>
      )}
      {hasMore && (
        <div className="mw-foot"><button type="button" className="mw-btn mw-btn-more" disabled={busy} onClick={() => load(cursor)}>{busy ? "Loading…" : "Show more"}</button></div>
      )}
    </section>
  );
};

const MyWork = () => {
  useEffect(() => { enablePaletteSync().catch(() => {}); }, []);
  return (
    <div className="mw" data-testid="mw-page">
      <header className="mw-head">
        <img src={logo} alt="" className="mw-logo" />
        <div>
          <h1 className="mw-title">My work</h1>
          <p className="mw-sub">Everything Sentinel Vault is waiting on you for, across every space — and the files you hold sealed.</p>
        </div>
      </header>
      <div className="mw-grid">
        <WorkflowInbox emptyText="Nothing is waiting on your approval." />
        <EditRequests />
        <MySeals />
      </div>
    </div>
  );
};

createRoot(document.getElementById("root")).render(<MyWork />);
