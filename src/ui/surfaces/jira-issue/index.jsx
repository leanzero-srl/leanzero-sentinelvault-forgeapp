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
import { forceReleaseCopy, ownerReleaseCopy } from "../../kit/jira-release-copy.js";

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
  lost: { text: "Not put back", cls: "expired" },
  restoring: { text: "Being put back", cls: "held" },
};
const mb = (bytes) => `${Math.round((Number(bytes) || 0) / 1048576)} MB`;

function DurationPicker({ value, defaultSeconds, onChange, disabled, allowDefault = true }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const menuRef = useRef(null);
  const place = useVisiblePlacement(open, menuRef);
  useEffect(() => (open ? listenOutside({ refs: [ref], onClose: () => setOpen(false) }) : undefined), [open]);
  const options = [
    ...(allowDefault ? [{ label: defaultSeconds ? `${humanSeconds(defaultSeconds)} (default)` : "Default", seconds: null }] : []),
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
        placeholder="Why it is sealed (everyone on the issue sees this)" disabled={busy} data-testid="jv-note" />
      <p className="jv-hint">Sentinel Vault keeps a copy of the file. If anyone but you deletes it, the copy is put back on this issue.</p>
      <div className="jv-form-actions">
        <button type="button" className="jv-btn jv-btn-primary" disabled={busy} onClick={() => onSeal({ duration, note })} data-testid="jv-seal-confirm">
          {busy ? "Sealing…" : "Seal file"}
        </button>
        <button type="button" className="jv-btn jv-btn-quiet" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** The row's one sentence: who holds it, until when, and what that means for this viewer. */
function sealLine(att, viewerId, maxBytes) {
  const s = att.seal;
  if (att.lost && att.row.state === "restoring") {
    // `pending`: the delete is too fresh for the trigger to have said anything yet. The owner may
    // have deleted it themselves (that ends the seal), so the owner's line does not promise it back.
    if (att.pending && s?.lockedBy === viewerId) return "Deleted just now. Sentinel Vault is putting it back from its copy, unless you deleted it yourself.";
    return "Deleted just now. Sentinel Vault is putting it back from its copy.";
  }
  if (att.lost) {
    const i = att.lostInfo;
    if (i?.reason === "loop") return "Deleted again each time it was put back, so Sentinel Vault stopped. It still holds the copy.";
    if (i?.nextAt) return `Deleted and not put back yet${i.error ? ` (${i.error})` : ""}. Sentinel Vault tries again ${when(new Date(i.nextAt).toISOString())} and still holds the copy.`;
    return "Deleted and not put back. Sentinel Vault still holds the copy.";
  }
  if (!s) return att.tooLarge ? `Too large to seal (${mb(maxBytes)} limit)` : "";
  const mine = s.lockedBy === viewerId;
  const owner = s.lockedByName || "its owner";
  if (att.row.state === "expired") return `Expired ${when(s.expiresAt)}, no longer protected${mine ? "" : ` (sealed by ${owner})`}`;
  if (mine) return `until ${when(s.expiresAt)}`;
  return `${owner} · until ${when(s.expiresAt)} · only ${owner} or an admin can release it`;
}

function Row({ att, viewer, defaults, run, busyId, setOpenForm, openForm }) {
  const chip = CHIP[att.row.state] || CHIP.open;
  const LABELS = { extend: "Extend the seal…", "force-release": "Force release…", release: "Let it go (delete the copy)…" };
  const menu = (att.row.menu || []).map((id) => ({ id, label: LABELS[id] || id, danger: id !== "extend" }));
  const busy = busyId === att.id;
  const line = sealLine(att, viewer.accountId, defaults?.maxBytes);
  return (
    <li className={`jv-row is-${chip.cls}`} data-testid={`jv-row-${att.id}`} data-state={att.row.state}>
      <div className="jv-row-main">
        <span className={`jv-chip ${chip.cls}`}>{chip.text}</span>
        <div className="jv-row-text">
          <div className="jv-name" title={att.filename}>{att.filename}</div>
          <div className="jv-meta">{fileSize(att.size)}{line ? ` · ${line}` : ""}</div>
          {att.seal?.note && <div className="jv-note"><span className="jv-note-k">Note:</span> {att.seal.note}</div>}
          {att.seal?.restoreCount > 0 && !att.lost && (
            <div className="jv-restored">Deleted {att.seal.restoreCount === 1 ? "once" : `${att.seal.restoreCount} times`} and put back{att.seal.lastRestoredAt ? ` · last ${when(att.seal.lastRestoredAt)}` : ""}</div>
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
          {att.row.primary === "retry" && (
            <button type="button" className="jv-btn jv-btn-primary" disabled={busy} onClick={() => run("retry", att)} data-testid={`jv-retry-${att.id}`}>
              {busy ? "Working…" : "Put it back"}
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

const fail = "Could not reach Sentinel Vault. Try again.";

function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [openForm, setOpenForm] = useState(null);
  const [flash, setFlash] = useState(null); // { kind: "ok"|"err", text }
  const [confirm, setConfirm] = useState(null); // { att, lost } release confirmation
  const [force, setForce] = useState(null); // { att, reason }
  const [extend, setExtend] = useState(null); // { att, seconds }
  const { signedInvoke, signatureDialog } = useSignedInvoke();

  const load = useCallback(async () => {
    try {
      const r = await invoke("jira-issue-seals", {});
      if (!r?.success) { setError(r?.reason || "Sentinel Vault could not read this issue."); return; }
      setError(null); setData(r);
    } catch (_) { setError("Sentinel Vault could not load this issue's files. Your files may still be sealed."); }
  }, []);

  useEffect(() => {
    enablePaletteSync();
    load();
    let sub = null;
    try { sub = events.on("JIRA_ISSUE_CHANGED", () => { setFlash(null); load(); }); } catch (_) { /* older hosts: the Refresh button */ }
    return () => { Promise.resolve(sub).then((s) => s?.unsubscribe?.()).catch(() => {}); };
  }, [load]);
  // While a put-back is queued or running, re-read every 3 s (for at most two minutes, past the
  // server's 90 s grace for a delete nothing has been recorded about yet) so the row turns into the
  // restored file, or into "Not put back", on its own.
  const restoringCount = (data?.attachments || []).filter((a) => a.row?.state === "restoring").length;
  const polls = useRef(0);
  useEffect(() => {
    if (!restoringCount) { polls.current = 0; return undefined; }
    if (polls.current >= 40) return undefined;
    const t = setTimeout(() => { polls.current += 1; load(); }, 3000);
    return () => clearTimeout(t);
  }, [restoringCount, data, load]);
  // A confirmation is news for a few seconds, not a banner that outlives the next event.
  useEffect(() => {
    if (!flash || flash.kind !== "ok") return undefined;
    const t = setTimeout(() => setFlash(null), 6000);
    return () => clearTimeout(t);
  }, [flash]);

  // The list is re-read BEFORE the confirmation shows, so the flash never sits above a stale row.
  const finish = async (r, okText) => {
    if (r?.success) { setOpenForm(null); await load(); setFlash({ kind: "ok", text: okText }); }
    else if (!r?.cancelled) setFlash({ kind: "err", text: r?.reason || "That did not work. Try again." });
  };
  const act = async (att, fn) => {
    setBusyId(att.id);
    try { await fn(); } catch (_) { setFlash({ kind: "err", text: fail }); } finally { setBusyId(null); }
  };

  const run = async (what, att, opts = {}) => {
    setFlash(null);
    if (what === "release") { setConfirm({ att, lost: !!att.lost }); return; }
    if (what === "force-release") { setForce({ att, reason: "" }); return; }
    if (what === "extend") { setExtend({ att, seconds: 7 * DAY }); return; }
    if (what === "retry") {
      await act(att, async () => finish(await invoke("jira-retry-restore", { attachmentId: att.id }), `“${att.filename}” is back on the issue`));
      return;
    }
    if (what === "seal") {
      await act(att, async () => finish(await signedInvoke("jira-seal-attachment", { attachmentId: att.id, ...(opts.duration ? { lockDuration: opts.duration } : {}), ...(opts.note?.trim() ? { note: opts.note.trim() } : {}) }), `“${att.filename}” is sealed`));
    }
  };

  const doRelease = async () => {
    const { att } = confirm; setConfirm(null);
    await act(att, async () => finish(await signedInvoke("jira-release-attachment", { attachmentId: att.id }), att.lost ? `The copy of “${att.filename}” is deleted` : `“${att.filename}” is released`));
  };
  const doForce = async () => {
    const { att, reason } = force; setForce(null);
    await act(att, async () => finish(await signedInvoke("jira-release-attachment", { attachmentId: att.id, reason }), att.lost ? `The seal is released and the copy of “${att.filename}” is deleted` : `“${att.filename}” is released`));
  };
  const doExtend = async () => {
    const { att, seconds } = extend; setExtend(null);
    await act(att, async () => finish(await signedInvoke("jira-extend-attachment", { attachmentId: att.id, lockDuration: seconds }), `The seal on “${att.filename}” is extended`));
  };

  if (error) {
    return (
      <div className="jv-root">
        <div className="jv-fail" role="alert" data-testid="jv-error">
          <span>{error}</span>
          <button type="button" className="jv-btn jv-btn-onfail" onClick={() => { setError(null); setData(null); load(); }}>Retry</button>
        </div>
      </div>
    );
  }
  if (!data) return <div className="jv-root"><div className="jv-loading" aria-busy="true" data-testid="jv-loading">Loading the issue's files…</div></div>;

  const now = Date.now();
  const files = data.attachments.filter((a) => !a.lost);
  const sealed = files.filter((a) => a.seal && Date.parse(a.seal.expiresAt) > now).length;
  const viewerId = data.viewer.accountId;
  // The viewer's own name in the history reads "You", like the rows.
  const asViewer = (e) => (e?.actor?.accountId && e.actor.accountId === viewerId ? { ...e, actor: { ...e.actor, name: "You" } } : e);
  const newEnd = extend ? new Date(Math.max(now, Date.parse(extend.att.seal?.expiresAt || "") || 0) + extend.seconds * 1000).toISOString() : null;
  return (
    <div className="jv-root" data-testid="jv-ready">
      {files.length > 0 && (
        <div className="jv-head">
          <div>
            <div className="jv-count" data-testid="jv-count">{sealed} of {files.length} file{files.length === 1 ? "" : "s"} sealed</div>
            <div className="jv-sub">Sealed files are put back if anyone else deletes them.</div>
          </div>
          <button type="button" className="jv-link" onClick={() => { setFlash(null); load(); }} data-testid="jv-refresh">Refresh</button>
        </div>
      )}
      {!data.viewer.canEdit && files.length > 0 && (
        <p className="jv-hint jv-hint-top">You can view seals here. Sealing a file needs permission to edit this issue.</p>
      )}
      {flash && <div className={`jv-flash ${flash.kind}`} role={flash.kind === "err" ? "alert" : "status"} data-testid="jv-flash">{flash.text}</div>}
      {data.attachments.length === 0 ? (
        <p className="jv-empty" data-testid="jv-empty">This issue has no files. Attach one, then seal it here so it is put back if anyone else deletes it.</p>
      ) : (
        <ul className="jv-list">
          {data.attachments.map((att) => (
            <Row key={att.id} att={att} viewer={data.viewer} defaults={data.defaults} run={run} busyId={busyId} openForm={openForm} setOpenForm={setOpenForm} />
          ))}
        </ul>
      )}
      {data.history?.length > 0 && (
        <section className="jv-history" aria-label="Recent seal activity" data-testid="jv-history">
          <h3 className="jv-h3">Recent activity</h3>
          <ul>
            {data.history.map((e) => {
              const f = formatActivity(asViewer(e));
              return (
                <li key={e.id} className={`jv-ev tone-${f.tone}`}>
                  <span className="jv-ev-text">{f.sentence}{f.detail ? <span className="jv-ev-detail">{f.detail}</span> : null}</span>
                  <span className="jv-ev-when">{relativeTime(e.ts)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {confirm && (() => {
        const c = ownerReleaseCopy({ fileName: confirm.att.filename, lost: confirm.lost });
        return <ConfirmDialog title={c.title} danger={c.danger} confirmLabel={c.confirmLabel} testId="jv-release-dialog" message={c.message}
          onConfirm={doRelease} onCancel={() => setConfirm(null)} />;
      })()}
      {force && (() => {
        const c = forceReleaseCopy({ fileName: force.att.filename, ownerName: force.att.seal?.lockedByName, lost: !!force.att.lost });
        return (
        <Dialog title={c.title} danger onClose={() => setForce(null)} testId="jv-force-dialog">
          <div className="sv-dialog-body" data-testid="jv-force-message">{c.message}</div>
          <label className="jv-label jv-reason-label" htmlFor="jv-force-reason">Reason (kept in this issue's seal history)</label>
          <textarea id="jv-force-reason" className="jv-input jv-reason" rows={3} maxLength={300} value={force.reason}
            onChange={(e) => setForce({ ...force, reason: e.target.value })} data-testid="jv-force-reason" />
          <span className="jv-hint">At least 3 characters.</span>
          <div className="sv-dialog-actions">
            <button type="button" className="jv-btn jv-btn-danger" disabled={force.reason.trim().length < 3} onClick={doForce} data-testid="jv-force-confirm">{c.confirmLabel}</button>
            <button type="button" className="jv-btn jv-btn-quiet" onClick={() => setForce(null)}>Cancel</button>
          </div>
        </Dialog>
        );
      })()}
      {extend && (
        <Dialog title="Extend the seal" onClose={() => setExtend(null)} testId="jv-extend-dialog">
          <div className="sv-dialog-body">“{extend.att.filename}” is sealed until {when(extend.att.seal?.expiresAt)}. Add:</div>
          <div className="jv-extend-pick"><DurationPicker value={extend.seconds} allowDefault={false} onChange={(s) => setExtend({ ...extend, seconds: s })} /></div>
          <div className="jv-hint" data-testid="jv-extend-result">New end: {when(newEnd)}</div>
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
