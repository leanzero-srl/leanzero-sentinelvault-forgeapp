/*
 * useSignedInvoke — `invoke` plus the authenticator-code prompt (tester report 2026-09-19).
 * With the site setting "Sign seal actions" on, the registry answers a seal action with
 * `{ signatureRequired: true, reason }`; this hook opens the code dialog, retries the SAME action
 * with `code`, and resolves the caller's promise with the final result — so a surface swaps
 * `invoke(action, payload)` for `signedInvoke(action, payload)` and changes nothing else.
 * A refusal no prompt can cure (no signature set up, locked out) is returned as-is so the
 * card's error row shows it.
 */
import React, { useCallback, useState } from "react";
import { invoke, view, router } from "@forge/bridge";
import Dialog from "./Dialog";
import { myWorkPath } from "./my-work-path.js";

const CANNOT_PROMPT = /not set up|refused until|refused for/i;
const NOT_SET_UP = /not set up/i;

export function useSignedInvoke() {
  const [pending, setPending] = useState(null); // { action, payload, reason, resolve }
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Tester report 2026-09-21 (signature): a refusal because NO signature exists opens a dialog with the
  // direct door to the setup on My work, instead of leaving the reason on the card's error row alone.
  const [setup, setSetup] = useState(null); // { result, resolve }

  const signedInvoke = useCallback(async (action, payload) => {
    const r = await invoke(action, payload);
    if (!r) return r;
    if (r.signatureRequired && NOT_SET_UP.test(String(r.reason || ""))) {
      return new Promise((resolve) => setSetup({ result: r, resolve }));
    }
    if (!r.signatureRequired || CANNOT_PROMPT.test(String(r.reason || ""))) return r;
    return new Promise((resolve) => { setCode(""); setError(null); setPending({ action, payload, reason: r.reason, resolve }); });
  }, []);

  const closeSetup = () => { const s = setup; setSetup(null); s?.resolve(s.result); };
  const goSetup = async () => {
    let ctx = null;
    try { ctx = await view.getContext(); } catch (_) { ctx = null; }
    try { router.navigate(myWorkPath(ctx)); } catch (_) { /* the link below is the fallback */ }
    closeSetup();
  };

  const close = (result) => { const p = pending; setPending(null); setCode(""); setError(null); setBusy(false); p?.resolve(result); };
  const submit = async () => {
    if (!pending || busy || code.trim().length < 6) return;
    setBusy(true); setError(null);
    try {
      const r = await invoke(pending.action, { ...(pending.payload || {}), code: code.trim() });
      if (r?.signatureRequired && !CANNOT_PROMPT.test(String(r.reason || ""))) { setError(r.reason || "That code did not match"); setCode(""); setBusy(false); return; }
      close(r);
    } catch (e) { close({ success: false, reason: "Could not reach Sentinel Vault. Try again." }); }
  };
  const cancel = () => close({ success: false, reason: "Cancelled — no code entered", cancelled: true });

  const setupDialog = setup ? (
    <Dialog title="Set up your signature first" onClose={closeSetup} testId="sv-sign-setup" className="sv-sign">
      <div className="sv-dialog-body">
        <p style={{ margin: "0 0 8px" }}>This site signs seal actions with a code from an authenticator app, and your signature is <strong>not set up</strong> yet.</p>
        <p style={{ margin: 0 }}>It takes a minute on your My work page: scan a QR code with Google Authenticator, 1Password or Microsoft Authenticator, type the first code, and come back to this action.</p>
      </div>
      <div className="sv-dialog-actions">
        <button type="button" className="action-btn lock" onClick={goSetup} data-testid="sv-sign-setup-go">Set up on My work</button>
        <button type="button" className="action-btn confirm-no" onClick={closeSetup}>Not now</button>
      </div>
    </Dialog>
  ) : null;

  const signatureDialog = setup ? setupDialog : pending ? (
    <Dialog title="Sign this action" onClose={cancel} busy={busy} testId="sv-sign-dialog" className="sv-sign">
      <div className="sv-dialog-body">{pending.reason || "This site requires a signed decision — enter the current code from your authenticator."}</div>
      <input
        type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={8}
        className="card-reason-input sv-sign-input" placeholder="6-digit code" aria-label="Authenticator code"
        value={code} onChange={(e) => { setCode(e.target.value.replace(/\D/g, "")); setError(null); }}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }} data-testid="sv-sign-code" autoFocus
      />
      {error && <div className="sv-give-error" role="alert" data-testid="sv-sign-error">{error}</div>}
      <div className="sv-dialog-actions">
        <button type="button" className="action-btn lock" onClick={submit} disabled={busy || code.trim().length < 6} data-testid="sv-sign-confirm">{busy ? "Signing…" : "Sign and continue"}</button>
        <button type="button" className="action-btn confirm-no" onClick={cancel} disabled={busy}>Cancel</button>
      </div>
    </Dialog>
  ) : null;

  return { signedInvoke, signatureDialog };
}
