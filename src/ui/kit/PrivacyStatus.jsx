/*
 * Site settings → Privacy and retention: the weekly privacy sweep's last result and a "Run the
 * check now" button (capsules/privacy, resolvers privacy-status / privacy-run-now, site admin
 * only). Renders inside the group card as one more settings row.
 */
import React, { useState, useEffect, useCallback } from "react";
import { invoke } from "@forge/bridge";
import { describeSweep, whenText as when } from "./privacy-format.js";

export default function PrivacyStatus() {
  const [state, setState] = useState({ loading: true, last: null, queuedAt: null, error: null });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await invoke("privacy-status", {});
      if (!r || r.success === false) { setState({ loading: false, last: null, queuedAt: null, error: r?.reason || "Not available on this version." }); return; }
      setState({ loading: false, last: r.status?.last || null, queuedAt: r.status?.queuedAt || null, error: null });
    } catch (e) {
      setState({ loading: false, last: null, queuedAt: null, error: `The request failed: ${String(e?.message || e).slice(0, 160)}` });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const runNow = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await invoke("privacy-run-now", {});
      setMsg(r?.success === false ? { kind: "error", text: r.reason || "Refused." } : { kind: "ok", text: "The check is queued. It usually finishes within a few minutes; reopen this tab to see the result." });
      await load();
    } catch (e) {
      setMsg({ kind: "error", text: `The request failed: ${String(e?.message || e).slice(0, 160)}` });
    } finally { setBusy(false); }
  };

  return (
    <div className="settings-row" data-testid="sv-row-privacy-sweep">
      <div className="settings-row-info">
        <p className="settings-row-label">Weekly history check</p>
        <p className="settings-row-description">
          Once a week Sentinel Vault deletes the history older than the period above.
        </p>
        <p className="settings-row-default" data-testid="sv-privacy-last" role="status">
          {state.loading ? "Loading…" : state.error ? state.error : describeSweep(state.last)}
          {state.queuedAt && !state.loading && !state.error ? ` A check is queued (${when(state.queuedAt)}).` : ""}
        </p>
        {msg && <p className={msg.kind === "ok" ? "settings-row-default" : "settings-row-reason"} data-testid="sv-privacy-msg">{msg.text}</p>}
      </div>
      <div className="settings-row-control">
        <button type="button" className="btn-secondary" onClick={runNow} disabled={busy || state.loading} data-testid="sv-privacy-run-now">
          {busy ? "Queuing…" : "Run the check now"}
        </button>
      </div>
    </div>
  );
}
