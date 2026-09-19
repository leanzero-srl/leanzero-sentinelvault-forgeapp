import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { useSignedInvoke } from "../../kit/SignedInvoke";
import { invoke, router } from "@forge/bridge";
import { enablePaletteSync } from "../../kit/palette-sync";
import WorkflowInbox from "../../kit/WorkflowInbox";
import logo from "../../assets/icons/icon.png";
import QRCode from "qrcode";

// A7 (ledger #55): one page, every space. Comala's Document Report can be filtered to "my
// pending approvals"; Sentinel Vault had the same answers scattered across each space's console
// and each page's panel. This page composes resolvers that are ALL scoped to the caller
// (req.context.accountId — a payload cannot widen any of them):
//   list-my-approvals              → approvals waiting on me (WorkflowInbox, shared with the console)
//   list-my-edit-requests          → people asking to edit a file I hold sealed
//   list-my-section-edit-requests  → people asking to edit a section I hold sealed (P1-3)
//   list-my-steward-requests       → people asking to become a space admin, in spaces I administer (P1-3)
//   enumerate-operator-seals       → the files I hold sealed, with their clocks
//   count-my-work                  → the numbers behind all of it, for the header (and the ribbon badge)
// P1-3 (UX review 2026-09-14 §5/§6): a lister that FAILS renders an error with Retry — never the
// reassuring empty copy. "Nothing is waiting" is a claim, and a failed read cannot make it.
// Navigation goes through router.navigate: a Custom UI iframe may be sandboxed without
// allow-top-navigation (proven on the page banner), where a target=_top anchor does nothing.

const viewPage = (pageId) => `/wiki/pages/viewpage.action?pageId=${pageId}`;
const go = (path) => (e) => { e.preventDefault(); router.navigate(path); };
// F11: the time as well as the date — "asked Sep 15" is not enough to tell a request made an
// hour ago from one made this morning.
const when = (iso) => {
  const ms = iso ? new Date(iso).getTime() : NaN;
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}, ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
};

// One loader for every card: `items` is null while loading, an array once loaded; `error` is set
// (and items left as they were) when the resolver throws, so the card renders the error state
// with Retry instead of an empty list. `pick` turns the resolver's answer into the array.
const useList = (fn, pick) => {
  const [items, setItems] = useState(null);
  const [extra, setExtra] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await invoke(fn, {});
      const got = pick(r);
      if (!Array.isArray(got)) throw new Error("bad shape");
      setItems(got); setExtra(r);
    } catch (_) { setError(true); }
  }, [fn, pick]);
  useEffect(() => { load(); }, [load]);
  return { items, extra, error, reload: load };
};

// The error state every card shares: solid red block, the plain truth, one Retry button.
const LoadError = ({ what, onRetry, testId }) => (
  <div className="mw-fail" role="alert" data-testid={testId}>
    <span className="mw-fail-text">Sentinel Vault could not load {what}. This list may not be empty.</span>
    <button type="button" className="mw-btn mw-btn-retry" onClick={onRetry} data-testid={`${testId}-retry`}>Retry</button>
  </div>
);

// People asking to edit a file the current user holds sealed. Approve mints a grant for the
// seal's lifetime; Deny closes the request. Both go through the owner-gated resolvers.
const pickRequests = (r) => r?.requests;
const pickAttachments = (r) => r?.attachments;

const EditRequests = ({ onChange }) => {
  const { items, error: loadError, reload } = useList("list-my-edit-requests", pickRequests);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => { await reload(); if (onChange) onChange(); }, [reload, onChange]);

  const { signedInvoke, signatureDialog } = useSignedInvoke();
  const decide = async (req, action) => {
    const key = `${req.artifactId}-${req.requesterAccountId}`;
    setBusy(key); setError(null);
    try {
      const r = await signedInvoke(action === "approve" ? "approve-edit-request" : "deny-edit-request", { attachmentId: req.artifactId, requesterAccountId: req.requesterAccountId });
      if (r?.success) await load();
      else setError(r?.reason || "Could not record your decision.");
    } catch (_) { setError("Could not record your decision."); }
    finally { setBusy(null); }
  };

  const n = items ? items.length : 0;
  return (
    <section className="mw-card" data-testid="mw-requests">
      {signatureDialog}
      <div className="mw-card-head">
        <span className="mw-card-title">Edit requests on your sealed files</span>
        <span className={`mw-count ${n ? "mw-count-requests" : "mw-count-zero"}`}>{n}</span>
      </div>
      {error && <p className="mw-error" role="alert">{error}</p>}
      {loadError && <LoadError what="the edit requests on your sealed files" onRetry={reload} testId="mw-requests-error" />}
      {!loadError && items === null && <p className="mw-loading">Checking for requests…</p>}
      {!loadError && items && items.length === 0 && <p className="mw-none" data-testid="mw-requests-empty">Nobody is waiting on you to unlock a file.</p>}
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

// P1-3: people asking to edit a SECTION the current user holds sealed. Same loop as the files
// card, against the section resolvers (approve mints a section grant for the seal's lifetime).
const SectionRequests = ({ onChange }) => {
  const { items, error: loadError, reload } = useList("list-my-section-edit-requests", pickRequests);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => { await reload(); if (onChange) onChange(); }, [reload, onChange]);

  const { signedInvoke, signatureDialog } = useSignedInvoke();
  const decide = async (req, action) => {
    const key = `${req.sectionId}-${req.requesterAccountId}`;
    setBusy(key); setError(null);
    try {
      const r = await signedInvoke(action === "approve" ? "approve-section-edit" : "deny-section-edit", { sectionId: req.sectionId, requesterAccountId: req.requesterAccountId });
      if (r?.success) await load();
      else setError(r?.reason || "Could not record your decision.");
    } catch (_) { setError("Could not record your decision."); }
    finally { setBusy(null); }
  };

  const n = items ? items.length : 0;
  return (
    <section className="mw-card" data-testid="mw-section-requests">
      {signatureDialog}
      <div className="mw-card-head">
        <span className="mw-card-title">Edit requests on your sealed sections</span>
        <span className={`mw-count ${n ? "mw-count-sections" : "mw-count-zero"}`}>{n}</span>
      </div>
      {error && <p className="mw-error" role="alert">{error}</p>}
      {loadError && <LoadError what="the edit requests on your sealed sections" onRetry={reload} testId="mw-section-requests-error" />}
      {!loadError && items === null && <p className="mw-loading">Checking for requests…</p>}
      {!loadError && items && items.length === 0 && <p className="mw-none" data-testid="mw-section-requests-empty">Nobody is waiting on you to unlock a section.</p>}
      {items && items.length > 0 && (
        <ul className="mw-list">
          {items.map((req) => {
            const key = `${req.sectionId}-${req.requesterAccountId}`;
            return (
              <li key={key} className="mw-row" data-testid="mw-section-request-row">
                <div className="mw-row-info">
                  <span className="mw-row-main">
                    {req.requesterName || "Someone"} wants to edit <strong>{req.sectionTitle || "a sealed section"}</strong>
                    {req.contentId ? <> on <a href={viewPage(req.contentId)} onClick={go(viewPage(req.contentId))}>this page</a></> : null}
                  </span>
                  {req.reason ? <span className="mw-row-reason">“{req.reason}”</span> : null}
                  <span className="mw-row-meta">{req.requestedAt ? `Asked ${when(req.requestedAt)}` : ""}{req.spaceKey ? ` · ${req.spaceKey}` : ""}</span>
                </div>
                <div className="mw-row-actions">
                  <button type="button" className="mw-btn mw-btn-approve" disabled={busy === key} onClick={() => decide(req, "approve")} aria-label={`Approve ${req.requesterName || "the request"} editing ${req.sectionTitle || "the section"}`}>Approve</button>
                  <button type="button" className="mw-btn mw-btn-deny" disabled={busy === key} onClick={() => decide(req, "deny")} aria-label={`Deny ${req.requesterName || "the request"} editing ${req.sectionTitle || "the section"}`}>Deny</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

// P1-3: people asking to become a space admin, in the spaces the current user administers (or
// everywhere, for a site admin). The resolver decides eligibility per space on the server; the
// card is hidden for a caller who decides no such requests, and rendered — empty state, list or
// error — for one who does.
const AccessRequests = ({ onChange }) => {
  const { items, extra, error: loadError, reload } = useList("list-my-steward-requests", pickRequests);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => { await reload(); if (onChange) onChange(); }, [reload, onChange]);

  const decide = async (req, action) => {
    const key = `${req.spaceKey}-${req.accountId}`;
    setBusy(key); setError(null);
    try {
      const r = await invoke(action === "approve" ? "approve-steward-request" : "deny-steward-request", { spaceKey: req.spaceKey, requestAccountId: req.accountId });
      if (r?.success) await load();
      else setError(r?.reason || "Could not record your decision.");
    } catch (_) { setError("Could not record your decision."); }
    finally { setBusy(null); }
  };

  if (!loadError && items !== null && extra && extra.eligible === false) return null; // not a space admin anywhere that matters
  if (!loadError && items === null) return null; // hidden until the server says whether it applies
  const n = items ? items.length : 0;
  return (
    <section className="mw-card" data-testid="mw-access-requests">
      <div className="mw-card-head">
        <span className="mw-card-title">Requests to become a space admin</span>
        <span className={`mw-count ${n ? "mw-count-access" : "mw-count-zero"}`}>{n}</span>
      </div>
      {error && <p className="mw-error" role="alert">{error}</p>}
      {loadError && <LoadError what="the space admin access requests" onRetry={reload} testId="mw-access-requests-error" />}
      {!loadError && items && items.length === 0 && <p className="mw-none" data-testid="mw-access-requests-empty">Nobody is asking to become a space admin in a space you administer.</p>}
      {items && items.length > 0 && (
        <ul className="mw-list">
          {items.map((req) => {
            const key = `${req.spaceKey}-${req.accountId}`;
            return (
              <li key={key} className="mw-row" data-testid="mw-access-request-row">
                <div className="mw-row-info">
                  <span className="mw-row-main">{req.displayName || "Someone"} wants to become a space admin of <strong>{req.spaceKey}</strong></span>
                  <span className="mw-row-meta">{req.requestedAt ? `Asked ${when(req.requestedAt)}` : ""}</span>
                </div>
                <div className="mw-row-actions">
                  <button type="button" className="mw-btn mw-btn-approve" disabled={busy === key} onClick={() => decide(req, "approve")} aria-label={`Approve ${req.displayName || "the request"} as a space admin of ${req.spaceKey}`}>Approve</button>
                  <button type="button" className="mw-btn mw-btn-deny" disabled={busy === key} onClick={() => decide(req, "deny")} aria-label={`Deny ${req.displayName || "the request"} as a space admin of ${req.spaceKey}`}>Deny</button>
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
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async (next) => {
    setBusy(true); setLoadError(null);
    try {
      const r = await invoke("enumerate-operator-seals", { cursor: next || null, limit: 25 });
      const got = pickAttachments(r);
      if (!Array.isArray(got)) throw new Error("bad shape");
      setRows((prev) => (next ? [...(prev || []), ...got] : got));
      setCursor(r?.nextCursor || null);
      setHasMore(!!r?.hasMore);
      setTotal(typeof r?.total === "number" ? r.total : got.length);
    } catch (_) { setLoadError(true); }
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
      {loadError && <LoadError what="the files you hold sealed" onRetry={() => load(null)} testId="mw-seals-error" />}
      {!loadError && rows === null && <p className="mw-loading">Looking up your sealed files…</p>}
      {!loadError && rows && rows.length === 0 && <p className="mw-none" data-testid="mw-seals-empty">You are not holding any file sealed.</p>}
      {rows && rows.length > 0 && (
        <ul className="mw-list">
          {rows.map((s) => (
            <li key={s.id} className="mw-row" data-testid="mw-seal-row">
              <div className="mw-row-info">
                <span className="mw-row-main">{s.title}</span>
                <span className="mw-row-meta">
                  {s.pageId ? <a className="mw-link" href={viewPage(s.pageId)} onClick={go(viewPage(s.pageId))}>{s.pageTitle || "Open page"}</a> : (s.pageTitle || "")}
                  {s.spaceName || s.spaceKey ? ` · ${s.spaceName || s.spaceKey}` : ""}
                  {s.workflowHeld ? " · held by the approval of the page (expiry paused)" : s.expiresAt ? ` · ${s.isExpired ? "was due" : "until"} ${when(s.expiresAt)}` : " · no end date"}
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

// The header total comes from count-my-work — the same resolver the ribbon badge will call — so
// what the badge says and what the page shows are one number. Re-counted after every decision.
const MyWork = () => {
  useEffect(() => { enablePaletteSync().catch(() => {}); }, []);
  const [count, setCount] = useState(null);
  const recount = useCallback(async () => {
    try { const r = await invoke("count-my-work", {}); setCount(typeof r?.total === "number" ? r : null); }
    catch (_) { setCount(null); }
  }, []);
  useEffect(() => { recount(); }, [recount]);
  return (
    <div className="mw" data-testid="mw-page">
      <header className="mw-head">
        <img src={logo} alt="" className="mw-logo" />
        <div>
          <h1 className="mw-title">My work</h1>
          <p className="mw-sub">Everything Sentinel Vault is waiting on you for, across every space — and the files you hold sealed.</p>
        </div>
        {count && (
          <span className={`mw-total ${count.total ? "" : "mw-total-zero"}`} data-testid="mw-total" data-total={count.total} title={`${count.approvals} approvals · ${count.fileRequests} file requests · ${count.sectionRequests} section requests · ${count.accessRequests} access requests`}>
            {count.total} waiting on you
          </span>
        )}
      </header>
      <div className="mw-grid">
        <WorkflowInbox emptyText="Nothing is waiting on your approval." />
        <EditRequests onChange={recount} />
        <SectionRequests onChange={recount} />
        <AccessRequests onChange={recount} />
        <MySeals />
        <SignatureCard />
      </div>
    </div>
  );
};

createRoot(document.getElementById("root")).render(<MyWork />);
