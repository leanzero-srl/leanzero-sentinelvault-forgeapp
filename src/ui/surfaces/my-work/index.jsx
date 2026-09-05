import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke, router } from "@forge/bridge";
import { enablePaletteSync } from "../../kit/palette-sync";
import WorkflowInbox from "../../kit/WorkflowInbox";
import logo from "../../assets/icons/icon.png";
import QRCode from "qrcode";

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

// B3: the approver's signature device. Enrol once (scan the QR, or type the key, into any
// authenticator app), confirm with the first code, and spaces that require signed decisions
// accept your approvals. The QR is drawn HERE from the otpauth URI — nothing leaves Atlassian.
const SignatureCard = () => {
  const [status, setStatus] = useState(null);
  const [enrol, setEnrol] = useState(null); // { secret, uri, qr }
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    try { setStatus(await invoke("signature-status", {})); } catch (_) { setStatus({ enrolled: false }); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const start = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await invoke("enroll-signature", {});
      if (!r?.success) { setMsg({ type: "error", text: r?.reason || "Could not start the setup." }); return; }
      let qr = null;
      try { qr = await QRCode.toDataURL(r.uri, { margin: 1, width: 168 }); } catch (_) { qr = null; }
      setEnrol({ secret: r.secret, uri: r.uri, qr });
    } catch (_) { setMsg({ type: "error", text: "Could not start the setup." }); }
    finally { setBusy(false); }
  };
  const confirm = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await invoke("confirm-signature-enrollment", { code });
      if (r?.success) { setEnrol(null); setCode(""); setMsg({ type: "ok", text: "Your signature is set up. Spaces that require signed decisions will ask for a code when you approve." }); await load(); }
      else setMsg({ type: "error", text: r?.reason || "That code did not match." });
    } catch (_) { setMsg({ type: "error", text: "Could not confirm the code." }); }
    finally { setBusy(false); }
  };
  // Removing (or replacing) the device needs its current code: whoever holds the session must
  // still hold the device, or the second factor is not one.
  const [revoking, setRevoking] = useState(false);
  const [revokeCode, setRevokeCode] = useState("");
  const revoke = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await invoke("revoke-signature", { code: revokeCode });
      if (r?.success) { setRevoking(false); setRevokeCode(""); setMsg({ type: "ok", text: "Signature removed. Set it up again any time." }); await load(); }
      else setMsg({ type: "error", text: r?.reason || "Could not remove the signature." });
    } catch (_) { setMsg({ type: "error", text: "Could not remove the signature." }); }
    finally { setBusy(false); }
  };

  return (
    <section className="mw-card" data-testid="mw-signature">
      <div className="mw-card-head">
        <span className="mw-card-title">Your approval signature</span>
        {status && <span className={`mw-pill ${status.enrolled ? "mw-pill-live" : "mw-pill-stale"}`} data-testid="mw-signature-state">{status.enrolled ? "Set up" : "Not set up"}</span>}
      </div>
      <p className="mw-none">Some spaces require a signed decision: the current code from an authenticator app you enrol here (Google Authenticator, 1Password, Microsoft Authenticator…). It proves the approval came from you and your device.</p>
      {msg && <p className={msg.type === "ok" ? "mw-ok" : "mw-error"} role="status" data-testid="mw-signature-msg">{msg.text}</p>}
      {status && !status.enrolled && !enrol && (
        <div className="mw-foot"><button type="button" className="mw-btn mw-btn-more" disabled={busy} onClick={start} data-testid="mw-signature-start">Set up signature</button></div>
      )}
      {enrol && (
        <div className="mw-enrol" data-testid="mw-signature-enrol">
          {enrol.qr && <img className="mw-qr" src={enrol.qr} alt="QR code for your authenticator app" />}
          <div className="mw-enrol-steps">
            <p className="mw-row-main">1. Scan this with your authenticator app, or type the key:</p>
            <code className="mw-secret" data-testid="mw-signature-secret">{enrol.secret.replace(/(.{4})/g, "$1 ").trim()}</code>
            <p className="mw-row-main">2. Enter the 6-digit code it shows to finish:</p>
            <div className="mw-row-actions">
              <input className="mw-code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} placeholder="123 456" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Authenticator code" data-testid="mw-signature-code" />
              <button type="button" className="mw-btn mw-btn-approve" disabled={busy || !code.trim()} onClick={confirm} data-testid="mw-signature-confirm">Confirm</button>
              <button type="button" className="mw-btn mw-btn-more" disabled={busy} onClick={() => { setEnrol(null); setCode(""); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {status?.enrolled && !enrol && !revoking && (
        <div className="mw-foot">
          <span className="mw-row-meta">Enrolled {status.enrolledAt ? when(status.enrolledAt) : ""}.</span>
          <button type="button" className="mw-btn mw-btn-deny" disabled={busy} onClick={() => setRevoking(true)} data-testid="mw-signature-revoke">Remove signature</button>
        </div>
      )}
      {status?.enrolled && !enrol && revoking && (
        <div className="mw-foot" data-testid="mw-signature-revoke-confirm">
          <span className="mw-row-meta">Enter the current code from your authenticator to remove it.</span>
          <input className="mw-code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} placeholder="123 456" value={revokeCode} onChange={(e) => setRevokeCode(e.target.value)} aria-label="Authenticator code" data-testid="mw-signature-revoke-code" />
          <button type="button" className="mw-btn mw-btn-deny" disabled={busy || !revokeCode.trim()} onClick={revoke} data-testid="mw-signature-revoke-go">Remove</button>
          <button type="button" className="mw-btn mw-btn-more" disabled={busy} onClick={() => { setRevoking(false); setRevokeCode(""); }}>Cancel</button>
        </div>
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
        <SignatureCard />
      </div>
    </div>
  );
};

createRoot(document.getElementById("root")).render(<MyWork />);
