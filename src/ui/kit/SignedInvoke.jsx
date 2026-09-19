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
import { invoke } from "@forge/bridge";
import Dialog from "./Dialog";

const CANNOT_PROMPT = /not set up|refused until|refused for/i;

export function useSignedInvoke() {
  const [pending, setPending] = useState(null); // { action, payload, reason, resolve }
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const signedInvoke = useCallback(async (action, payload) => {
    const r = await invoke(action, payload);
    if (!r || !r.signatureRequired || CANNOT_PROMPT.test(String(r.reason || ""))) return r;
    return new Promise((resolve) => { setCode(""); setError(null); setPending({ action, payload, reason: r.reason, resolve }); });
  }, []);

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

  const signatureDialog = pending ? (
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
