import React, { useState, useEffect, useCallback } from "react";
import { invoke, view } from "@forge/bridge";

// "Approvals waiting on you" (#43). Self-contained: fetches the current user's pending
// approvals across all pages and lets them Approve/Deny inline or open the page.
// Renders NOTHING when there are none, so it never clutters the console.
export default function WorkflowInbox() {
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
      if (r?.success) { setMsg({ type: "success", text: decision === "approved" ? "Approved." : "Denied." }); await load(); }
      else setMsg({ type: "error", text: r?.reason || "Could not record your decision." });
    } catch (_) {
      setMsg({ type: "error", text: "Could not record your decision." });
    } finally {
      setBusy(null);
    }
  }, [load]);

  if (items === null || items.length === 0) return null;

  return (
    <div className="wf-inbox">
      <div className="wf-inbox-head">
        <span className="wf-inbox-title">Approvals waiting on you</span>
        <span className="wf-inbox-count">{items.length}</span>
      </div>
      {msg && <div role="status" aria-live="polite" className={msg.type === "success" ? "alert-success" : "alert-error"}>{msg.text}</div>}
      <ul className="wf-inbox-list">
        {items.map((it) => (
          <li key={it.pageId} className="wf-inbox-row">
            <div className="wf-inbox-info">
              <a className="wf-inbox-page" href={siteUrl ? `${siteUrl}/wiki/pages/viewpage.action?pageId=${it.pageId}` : "#"} target="_top" rel="noreferrer">{it.pageTitle}</a>
              <span className="wf-inbox-meta">Move to <strong>{it.toStateName}</strong>{it.requestedByName ? ` · requested by ${it.requestedByName}` : ""}</span>
            </div>
            <div className="wf-inbox-actions">
              <button type="button" className="wf-inbox-approve" aria-label={`Approve moving ${it.pageTitle} to ${it.toStateName}`} onClick={() => decide(it.pageId, "approved")} disabled={busy === it.pageId}>Approve</button>
              <button type="button" className="wf-inbox-deny" aria-label={`Deny moving ${it.pageTitle} to ${it.toStateName}`} onClick={() => decide(it.pageId, "denied")} disabled={busy === it.pageId}>Deny</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
