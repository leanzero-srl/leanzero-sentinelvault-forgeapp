/*
 * "Give edit access…" — the seal owner (or a space admin) names a person and grants them edit
 * access without waiting for a request (tester report 2026-09-17: a declined requester who then
 * explained themselves on Teams had no way forward for 48 hours, and neither had the owner).
 *
 * One dialog for both seal kinds: `target` is { attachmentId } or { sectionId }. People come
 * from `search-grantees` (owner/steward gated); the grant is `grant-edit-access` /
 * `grant-section-edit`, and every refusal reason the server gives is shown as-is.
 */
import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@forge/bridge";
import Dialog from "./Dialog";

export default function GiveAccessDialog({ target, name, onClose, onGranted, testId = "sv-give-access" }) {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const seq = useRef(0);
  const section = !!target?.sectionId;

  useEffect(() => {
    const q = query.trim();
    if (picked || q.length < 2) { setUsers([]); setSearching(false); return undefined; }
    const mine = ++seq.current;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const r = await invoke("search-grantees", { ...target, query: q });
        if (mine !== seq.current) return;
        setUsers(r?.users || []);
        if (r?.reason) setError(r.reason);
      } catch (_) {
        if (mine === seq.current) setError("Could not reach Sentinel Vault. Try again.");
      } finally {
        if (mine === seq.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, picked, target]);

  const give = async () => {
    if (!picked || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await invoke(section ? "grant-section-edit" : "grant-edit-access", { ...target, editorAccountId: picked.accountId });
      if (r?.success) { onGranted?.(r.grant); onClose(); return; }
      setError(r?.reason || "Could not give edit access");
    } catch (_) {
      setError("Could not reach Sentinel Vault. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={`Give edit access to ${name}`} onClose={onClose} busy={busy} testId={testId} className="sv-give-access">
      <div className="sv-dialog-body">
        The person you pick can edit this {section ? "section" : "file"} until the seal ends. You can revoke it at any time under “Editors with access”.
      </div>
      {picked ? (
        <div className="sv-give-picked" data-testid={`${testId}-picked`}>
          <span className="sv-give-picked-name">{picked.displayName}</span>
          <button type="button" className="sv-give-clear" onClick={() => { setPicked(null); setError(null); }} aria-label={`Choose someone other than ${picked.displayName}`} disabled={busy}>Change</button>
        </div>
      ) : (
        <>
          <input
            type="text"
            className="card-reason-input sv-give-input"
            placeholder="Search for a person by name"
            aria-label="Search for a person by name"
            value={query}
            maxLength={80}
            onChange={(e) => { setQuery(e.target.value); setError(null); }}
            data-testid={`${testId}-search`}
          />
          <div className="sv-give-results" role="listbox" aria-label="People">
            {searching && <div className="sv-give-note">Searching…</div>}
            {!searching && query.trim().length >= 2 && users.length === 0 && <div className="sv-give-note">No one found by that name.</div>}
            {users.map((u) => (
              <button type="button" key={u.accountId} role="option" aria-selected="false" className="sv-give-option" onClick={() => { setPicked(u); setUsers([]); }} data-testid={`${testId}-option`}>
                {u.displayName}
              </button>
            ))}
          </div>
        </>
      )}
      {error && <div className="sv-give-error" role="alert" data-testid={`${testId}-error`}>{error}</div>}
      <div className="sv-dialog-actions">
        <button type="button" className="action-btn lock" onClick={give} disabled={!picked || busy} data-testid={`${testId}-confirm`}>{busy ? "Giving access…" : "Give edit access"}</button>
        <button type="button" className="action-btn confirm-no" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </Dialog>
  );
}
