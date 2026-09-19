import React, { useState, useEffect, useCallback } from "react";
import { invoke, view, router } from "@forge/bridge";

// "Approvals waiting on you" (#43). Self-contained: fetches the current user's pending
// approvals across all pages and lets them Approve/Deny inline or open the page.
// Renders NOTHING when there are none (the space console must not clutter), unless the host
// passes `emptyText` — the My-work page (A7) wants "nothing waiting" said out loud.
// Links go through `router.navigate`: a Custom UI iframe may be sandboxed without
// allow-top-navigation (proven on the page banner, it63), where a target=_top anchor is
// silently dropped.
export default function WorkflowInbox({ emptyText = null, onDecided = null } = {}) {
  const [items, setItems] = useState(null);
  const [siteUrl, setSiteUrl] = useState("");
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await invoke("list-my-approvals", {});
      setItems(r?.approvals || []);
    } catch (_) {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try { const ctx = await view.getContext(); setSiteUrl(ctx?.siteUrl || ""); } catch (_) { /* none */ }
      await load();
    })();
  }, [load]);

  const decide = useCallback(async (pageId, decision) => {
    setBusy(pageId); setMsg(null);
    try {
      const r = await invoke("decide-approval", { pageId, decision });
      // WF-1: `success` is "recorded"; only a completed outcome is good news. A stale close / AI
      // hold / AI block shows the server's reason instead of "Approved."
      const outcome = r?.outcome || decision;
      if (r?.success && (outcome === "approved" || outcome === "denied" || outcome === "pending")) {
        setMsg({ type: "success", text: outcome === "denied" ? "Denied — the requester has been told." : r.transitioned ? "Approved — the page is now Approved." : outcome === "approved" ? "Approved — your sign-off is recorded." : "Your decision is recorded." });
        await load(); onDecided?.();
      } else if (r?.success) { setMsg({ type: "error", text: r.reason || "The request could not be completed." }); await load(); onDecided?.(); }
      else { setMsg({ type: "error", text: r?.reason || "Could not record your decision." }); if (r?.stale) await load(); }
    } catch (_) {
      setMsg({ type: "error", text: "Could not record your decision." });
    } finally {
      setBusy(null);
    }
  }, [load, onDecided]);

  if (items === null) return emptyText ? <div className="wf-inbox wf-inbox-empty" data-testid="wf-inbox-loading">Checking for approvals…</div> : null;
  if (items.length === 0) {
    if (!emptyText) return null;
    return (
      <div className="wf-inbox wf-inbox-empty" data-testid="wf-inbox-empty">
        <div className="wf-inbox-head"><span className="wf-inbox-title">Approvals waiting on you</span><span className="wf-inbox-count wf-inbox-count-zero">0</span></div>
        <p className="wf-inbox-none">{emptyText}</p>
      </div>
    );
  }

  const open = (e, pageId) => { e.preventDefault(); router.navigate(`/wiki/pages/viewpage.action?pageId=${pageId}`); };

  return (
    <div className="wf-inbox" data-testid="wf-inbox">
      <div className="wf-inbox-head">
        <span className="wf-inbox-title">Approvals waiting on you</span>
        <span className="wf-inbox-count">{items.length}</span>
      </div>
      {msg && <div role="status" aria-live="polite" className={msg.type === "success" ? "alert-success" : "alert-error"}>{msg.text}</div>}
      <ul className="wf-inbox-list">
        {items.map((it) => (
          <li key={it.pageId} className="wf-inbox-row">
            <div className="wf-inbox-info">
              <a className="wf-inbox-page" href={siteUrl ? `${siteUrl}/wiki/pages/viewpage.action?pageId=${it.pageId}` : "#"} onClick={(e) => open(e, it.pageId)} data-testid="wf-inbox-page">{it.pageTitle}</a>
              <span className="wf-inbox-meta">Move to <strong>{it.toStateName}</strong>{it.requestedByName ? ` · requested by ${it.requestedByName}` : ""}{it.pinnedVersion != null ? ` · v${it.pinnedVersion}` : ""}</span>
              {it.stale && <span className="wf-inbox-stale" data-testid="wf-inbox-stale">Page changed since the request (now v{it.liveVersion}) — open the page to re-request for the current version.</span>}
            </div>
            <div className="wf-inbox-actions">
              <button type="button" className="wf-inbox-approve" aria-label={`Approve moving ${it.pageTitle} to ${it.toStateName}`} onClick={() => decide(it.pageId, "approved")} disabled={busy === it.pageId || !!it.stale} title={it.stale ? "The page changed after the request — re-request for the current version from the page first." : undefined}>Approve</button>
              <button type="button" className="wf-inbox-deny" aria-label={`Deny moving ${it.pageTitle} to ${it.toStateName}`} onClick={() => decide(it.pageId, "denied")} disabled={busy === it.pageId}>Deny</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
