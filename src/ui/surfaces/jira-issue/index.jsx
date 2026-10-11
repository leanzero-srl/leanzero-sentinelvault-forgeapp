/*
 * 8.0 — Sentinel Vault on a Jira issue (jira:issueContext). docs/JIRA-SEALS.md is the design record.
 *
 * One list: the issue's files, each with its seal state as a solid chip and ONE primary action
 * (Seal / Release), Extend and Force release under ⋯. Everything comes from `jira-issue-seals`, which
 * reads Jira's answer about THIS viewer on THIS issue (mypermissions) — the buttons shown are the
 * ones the server will accept, and every write re-checks on its own. Writes go through
 * useSignedInvoke so a site that signs seal actions asks for the authenticator code here too.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { events } from "@forge/bridge";
import { enablePaletteSync } from "../../kit/palette-sync";
import { useSignedInvoke } from "../../kit/SignedInvoke";
import { invoke } from "@forge/bridge";
import Dialog, { ConfirmDialog } from "../../kit/Dialog";
import ActionMenu from "../../kit/ActionMenu";
import { listenOutside } from "../../kit/outside-close.js";
import { useVisiblePlacement } from "../../kit/visible-placement.js";
import { when } from "../../kit/status-language.js";
import { formatActivity, relativeTime } from "../../kit/activity-format.js";

const DAY = 86400;
const DURATIONS = [
  { label: "1 day", seconds: DAY }, { label: "3 days", seconds: 3 * DAY }, { label: "1 week", seconds: 7 * DAY },
  { label: "2 weeks", seconds: 14 * DAY }, { label: "30 days", seconds: 30 * DAY }, { label: "90 days", seconds: 90 * DAY },
  { label: "1 year", seconds: 365 * DAY },
];
const humanSeconds = (s) => {
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n % DAY === 0) { const d = n / DAY; return d === 1 ? "1 day" : d % 7 === 0 && d >= 14 ? `${d / 7} weeks` : `${d} days`; }
  const h = Math.round(n / 3600);
  return h <= 1 ? "1 hour" : `${h} hours`;
};
const fileSize = (b) => (b == null ? "" : b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`);

const CHIP = {
  open: { text: "Not sealed", cls: "open" },
  mine: { text: "Sealed by you", cls: "mine" },
  held: { text: "Sealed", cls: "held" },
  expired: { text: "Expired", cls: "expired" },
};

function DurationPicker({ value, defaultSeconds, onChange, disabled, allowDefault = true }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const menuRef = useRef(null);
  const place = useVisiblePlacement(open, menuRef);
  useEffect(() => (open ? listenOutside({ refs: [ref], onClose: () => setOpen(false) }) : undefined), [open]);
  const options = [
    ...(allowDefault ? [{ label: `Site default${defaultSeconds ? ` (${humanSeconds(defaultSeconds)})` : ""}`, seconds: null }] : []),
    ...DURATIONS,
  ];
  const current = options.find((o) => o.seconds === value) || options[0];
  const pick = (o) => { setOpen(false); onChange(o.seconds); };
  return (
    <div className="jv-dd-wrap" ref={ref}>
      <button type="button" className="jv-dd" onClick={() => setOpen((o) => !o)} disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} aria-label="How long the seal holds" data-testid="jv-duration">
        <span>{current.label}</span><span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div ref={menuRef} className={`jv-dd-menu${place.up ? " is-up" : ""}`} role="listbox" aria-label="Seal duration"
          style={{ ...(place.ready ? null : { opacity: 0, pointerEvents: "none" }), ...(place.maxHeight ? { maxHeight: `${place.maxHeight}px` } : null) }}>
          {options.map((o) => (
            <div key={String(o.seconds)} role="option" aria-selected={o.seconds === value} tabIndex={0}
              className={`jv-dd-opt${o.seconds === value ? " sel" : ""}`} data-testid={`jv-duration-${o.seconds == null ? "default" : o.seconds}`}
              onClick={() => pick(o)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(o); } }}>
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SealForm({ att, defaults, onSeal, onCancel, busy }) {
  const [duration, setDuration] = useState(null);
  const [note, setNote] = useState("");
  return (
    <div className="jv-form" data-testid={`jv-form-${att.id}`}>
      <label className="jv-label">Seal holds for</label>
      <DurationPicker value={duration} defaultSeconds={defaults?.holdSeconds} onChange={setDuration} disabled={busy} />
      <label className="jv-label" htmlFor={`jv-note-${att.id}`}>Note (optional)</label>
      <input id={`jv-note-${att.id}`} className="jv-input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)}
        placeholder="Why this file is sealed" disabled={busy} data-testid="jv-note" />
      <div className="jv-form-actions">
        <button type="button" className="jv-btn jv-btn-primary" disabled={busy} onClick={() => onSeal({ duration, note })} data-testid="jv-seal-confirm">
          {busy ? "Sealing…" : "Seal file"}
        </button>
        <button type="button" className="jv-btn jv-btn-quiet" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
      <p className="jv-hint">Sentinel Vault keeps a copy of the file. If anyone but you deletes it, the copy is put back on this issue.</p>
    </div>
  );
}

function sealLine(att, viewerId) {
  const s = att.seal;
  if (!s) return att.tooLarge ? "Too large to seal (the copy is limited)" : "Anyone who can edit the issue can delete it";
  const who = s.lockedBy === viewerId ? "you" : (s.lockedByName || "someone");
  const expired = att.row.state === "expired";
  return expired ? `Sealed by ${who} · expired ${when(s.expiresAt)}` : `Sealed by ${who} · until ${when(s.expiresAt)}`;
}

function Row({ att, viewer, defaults, run, busyId, setOpenForm, openForm }) {
  const chip = CHIP[att.row.state] || CHIP.open;
  const menu = (att.row.menu || []).map((id) => (id === "extend"
    ? { id, label: "Extend the seal…" }
    : { id, label: "Force release…", danger: true }));
  const busy = busyId === att.id;
  return (
    <li className={`jv-row is-${chip.cls}`} data-testid={`jv-row-${att.id}`} data-state={att.row.state}>
      <div className="jv-row-main">
        <span className={`jv-chip ${chip.cls}`} role="status" aria-label={chip.text}>{chip.text}</span>
        <div className="jv-row-text">
          <div className="jv-name" title={att.filename}>{att.filename}</div>
          <div className="jv-meta">{fileSize(att.size)} · {sealLine(att, viewer.accountId)}</div>
          {att.seal?.note && <div className="jv-note">“{att.seal.note}”</div>}
          {att.seal?.restoreCount > 0 && (
            <div className="jv-restored">Put back {att.seal.restoreCount === 1 ? "once" : `${att.seal.restoreCount} times`} after a delete{att.seal.lastRestoredAt ? ` · last ${when(att.seal.lastRestoredAt)}` : ""}</div>
          )}
        </div>
        <div className="jv-row-actions">
          {att.row.primary === "seal" && !att.tooLarge && openForm !== att.id && (
            <button type="button" className="jv-btn jv-btn-primary" disabled={busy} onClick={() => setOpenForm(att.id)} data-testid={`jv-seal-${att.id}`}>Seal</button>
          )}
          {att.row.primary === "release" && (
            <button type="button" className="jv-btn jv-btn-quiet" disabled={busy} onClick={() => run("release", att)} data-testid={`jv-release-${att.id}`}>
              {busy ? "Working…" : "Release"}
            </button>
          )}
          <ActionMenu items={menu} label={`More actions for ${att.filename}`} testId={`jv-kebab-${att.id}`} onPick={(id) => run(id, att)} />
        </div>
      </div>
      {openForm === att.id && (
        <SealForm att={att} defaults={defaults} busy={busy} onCancel={() => setOpenForm(null)} onSeal={(o) => run("seal", att, o)} />
      )}
    </li>
  );
}

function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [openForm, setOpenForm] = useState(null);
  const [flash, setFlash] = useState(null); // { kind: "ok"|"err", text }
  const [confirm, setConfirm] = useState(null); // release confirmation
  const [force, setForce] = useState(null); // { att, reason }
  const [extend, setExtend] = useState(null); // { att, seconds }
  const { signedInvoke, signatureDialog } = useSignedInvoke();

  const load = useCallback(async () => {
    try {
      const r = await invoke("jira-issue-seals", {});
      if (!r?.success) { setError(r?.reason || "Sentinel Vault could not read this issue."); return; }
      setError(null); setData(r);
    } catch (_) { setError("Sentinel Vault could not load this issue's files. The list may not be empty."); }
  }, []);

  useEffect(() => {
    enablePaletteSync();
    load();
    let sub = null;
    try { sub = events.on("JIRA_ISSUE_CHANGED", () => load()); } catch (_) { /* older hosts: the Refresh button */ }
    return () => { Promise.resolve(sub).then((s) => s?.unsubscribe?.()).catch(() => {}); };
  }, [load]);

  const finish = async (r, okText) => {
    if (r?.success) { setFlash({ kind: "ok", text: okText }); setOpenForm(null); await load(); }
    else if (!r?.cancelled) setFlash({ kind: "err", text: r?.reason || "That did not work. Try again." });
  };

  const run = async (what, att, opts = {}) => {
    setFlash(null);
    if (what === "release") { setConfirm(att); return; }
    if (what === "force-release") { setForce({ att, reason: "" }); return; }
    if (what === "extend") { setExtend({ att, seconds: 7 * DAY }); return; }
    if (what === "seal") {
      setBusyId(att.id);
      try {
        const r = await signedInvoke("jira-seal-attachment", { attachmentId: att.id, ...(opts.duration ? { lockDuration: opts.duration } : {}), ...(opts.note?.trim() ? { note: opts.note.trim() } : {}) });
        await finish(r, `“${att.filename}” is sealed`);
      } catch (_) { setFlash({ kind: "err", text: "Could not reach Sentinel Vault. Try again." }); }
      finally { setBusyId(null); }
    }
  };

  const doRelease = async () => {
    const att = confirm; setConfirm(null); setBusyId(att.id);
    try { await finish(await signedInvoke("jira-release-attachment", { attachmentId: att.id }), `“${att.filename}” is released`); }
    catch (_) { setFlash({ kind: "err", text: "Could not reach Sentinel Vault. Try again." }); }
    finally { setBusyId(null); }
  };
  const doForce = async () => {
    const { att, reason } = force; setForce(null); setBusyId(att.id);
    try { await finish(await signedInvoke("jira-release-attachment", { attachmentId: att.id, reason }), `The seal on “${att.filename}” is removed`); }
    catch (_) { setFlash({ kind: "err", text: "Could not reach Sentinel Vault. Try again." }); }
    finally { setBusyId(null); }
  };
  const doExtend = async () => {
    const { att, seconds } = extend; setExtend(null); setBusyId(att.id);
    try { await finish(await signedInvoke("jira-extend-attachment", { attachmentId: att.id, lockDuration: seconds }), `The seal on “${att.filename}” is extended`); }
    catch (_) { setFlash({ kind: "err", text: "Could not reach Sentinel Vault. Try again." }); }
    finally { setBusyId(null); }
  };

  if (error) {
    return (
      <div className="jv-root">
        <div className="jv-fail" role="alert" data-testid="jv-error">
          <span>{error}</span>
          <button type="button" className="jv-btn jv-btn-quiet" onClick={() => { setError(null); setData(null); load(); }}>Retry</button>
        </div>
      </div>
    );
  }
  if (!data) return <div className="jv-root"><div className="jv-loading" aria-busy="true" data-testid="jv-loading">Loading the issue's files…</div></div>;

  const sealed = data.attachments.filter((a) => a.seal).length;
  return (
    <div className="jv-root" data-testid="jv-ready">
      <div className="jv-head">
        <span className="jv-count" data-testid="jv-count">{sealed} of {data.attachments.length} file{data.attachments.length === 1 ? "" : "s"} sealed</span>
        <button type="button" className="jv-link" onClick={load} data-testid="jv-refresh">Refresh</button>
      </div>
      {flash && <div className={`jv-flash ${flash.kind}`} role={flash.kind === "err" ? "alert" : "status"} data-testid="jv-flash">{flash.text}</div>}
      {data.attachments.length === 0 ? (
        <p className="jv-empty" data-testid="jv-empty">This issue has no files. Attach one, then seal it here to protect it from being deleted.</p>
      ) : (
        <ul className="jv-list">
          {data.attachments.map((att) => (
            <Row key={att.id} att={att} viewer={data.viewer} defaults={data.defaults} run={run} busyId={busyId} openForm={openForm} setOpenForm={setOpenForm} />
          ))}
        </ul>
      )}
      {!data.viewer.canEdit && data.attachments.length > 0 && (
        <p className="jv-hint">You can see these seals; sealing a file needs permission to edit the issue.</p>
      )}
      {data.history?.length > 0 && (
        <section className="jv-history" aria-label="Recent seal activity" data-testid="jv-history">
          <h3 className="jv-h3">Recent activity</h3>
          <ul>
            {data.history.map((e) => {
              const f = formatActivity(e);
              return <li key={e.id} className={`jv-ev tone-${f.tone}`}><span className="jv-ev-text">{f.sentence}</span><span className="jv-ev-when">{relativeTime(e.ts)}</span></li>;
            })}
          </ul>
        </section>
      )}
      {confirm && (
        <ConfirmDialog title="Release this seal?" danger={false} confirmLabel="Release" testId="jv-release-dialog"
          message={`Anyone who can edit the issue will be able to delete “${confirm.filename}”, and Sentinel Vault will no longer put it back. Its copy is deleted.`}
          onConfirm={doRelease} onCancel={() => setConfirm(null)} />
      )}
      {force && (
        <Dialog title="Force release" danger onClose={() => setForce(null)} testId="jv-force-dialog">
          <div className="sv-dialog-body">“{force.att.filename}” is sealed by {force.att.seal?.lockedByName || "someone else"}. They are told nothing automatically; the reason is kept in the history.</div>
          <textarea className="jv-input jv-reason" rows={3} maxLength={300} placeholder="Why the seal must go (required)" value={force.reason}
            onChange={(e) => setForce({ ...force, reason: e.target.value })} aria-label="Reason" data-testid="jv-force-reason" />
          <div className="sv-dialog-actions">
            <button type="button" className="jv-btn jv-btn-danger" disabled={force.reason.trim().length < 3} onClick={doForce} data-testid="jv-force-confirm">Remove the seal</button>
            <button type="button" className="jv-btn jv-btn-quiet" onClick={() => setForce(null)}>Cancel</button>
          </div>
        </Dialog>
      )}
      {extend && (
        <Dialog title="Extend the seal" onClose={() => setExtend(null)} testId="jv-extend-dialog">
          <div className="sv-dialog-body">“{extend.att.filename}” is sealed until {when(extend.att.seal?.expiresAt)}. Add:</div>
          <div className="jv-extend-pick"><DurationPicker value={extend.seconds} allowDefault={false} onChange={(s) => setExtend({ ...extend, seconds: s })} /></div>
          <div className="sv-dialog-actions">
            <button type="button" className="jv-btn jv-btn-primary" onClick={doExtend} data-testid="jv-extend-confirm">Extend</button>
            <button type="button" className="jv-btn jv-btn-quiet" onClick={() => setExtend(null)}>Cancel</button>
          </div>
        </Dialog>
      )}
      {signatureDialog}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
