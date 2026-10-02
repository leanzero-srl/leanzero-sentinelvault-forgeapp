/*
 * Site settings → Backup and restore (pillar 12, docs/BACKUP-AND-RESTORE.md), plus the restore
 * banner the console shows above everything else on a site whose backup came from an earlier
 * installation. Every call is a site-admin resolver (capsules/backup/actions.js); a refusal or an
 * older server renders as a failure block with Retry, never a blank pane.
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@forge/bridge";
import Dialog, { ConfirmDialog } from "./Dialog";
import { formatActivity, fmtBytes } from "./activity-format";

const UNAVAILABLE = "Backup and restore is not available on this version";
const call = async (name, payload = {}) => {
  let r;
  // Only an unknown resolver means "older server"; a timeout or a platform error says what it is.
  try { r = await invoke(name, payload); } catch (e) {
    const m = String(e?.message || e || "");
    return { ok: false, reason: /resolver|not found|no function/i.test(m) ? UNAVAILABLE : `The request failed: ${m.slice(0, 200) || "no answer"}. Try again.` };
  }
  if (!r || typeof r !== "object") return { ok: false, reason: UNAVAILABLE };
  if (r.success === false) return { ok: false, reason: r.reason || "Refused." };
  return { ok: true, data: r };
};

const when = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso) : d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
};
const ago = (iso) => {
  const ms = Date.now() - Date.parse(iso || "");
  if (!Number.isFinite(ms)) return "";
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
};
const REASON = { manual: "on request", schedule: "daily", save: "after a change", rest: "over REST", "before-restore": "before a restore", "after-restore": "after a restore", moved: "after a move", import: "imported file" };

/** Poll a backup job until it settles. */
async function waitForJob(jobId, onTick) {
  for (let i = 0; i < 600; i++) {
    const r = await call("backup-job", { id: jobId });
    if (!r.ok) return { status: "failed", error: r.reason };
    const job = r.data.job;
    onTick?.(job);
    if (job.status === "done" || job.status === "failed") return job;
    await new Promise((res) => setTimeout(res, i < 10 ? 1500 : 3000));
  }
  return { status: "failed", error: "Still running after 30 minutes — check back later." };
}

const Card = ({ id, title, text, children, tone }) => (
  <section className={`sv-group bk-card${tone ? ` bk-${tone}` : ""}`} data-testid={`bk-${id}-card`}>
    <header className="sv-group-head">
      <h3 className="sv-group-title">{title}</h3>
      {text && <p className="sv-group-text">{text}</p>}
    </header>
    <div className="sv-group-body bk-card-body">{children}</div>
  </section>
);
const Failure = ({ reason, onRetry, testId }) => (
  <div className="api-failure" role="alert" data-testid={testId}>
    <span className="api-failure-text">{reason}</span>
    {onRetry && <button type="button" className="btn-secondary api-retry" onClick={onRetry}>Retry</button>}
  </div>
);
const Busy = ({ text, testId }) => <div className="bk-busy" role="status" aria-live="polite" data-testid={testId}><span className="loading-spinner bk-spinner" aria-hidden="true" />{text}</div>;

/** Copy one value; the button reads "Copied". */
const Copy = ({ text, testId }) => {
  const [done, setDone] = useState(false);
  useEffect(() => { if (!done) return undefined; const t = setTimeout(() => setDone(false), 2000); return () => clearTimeout(t); }, [done]);
  return (
    <button type="button" className={`btn-secondary bk-copy${done ? " is-copied" : ""}`} data-testid={testId} disabled={!text}
      onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); } catch (_) { /* select-and-copy fallback: the value is on screen */ } }}>
      {done ? "Copied" : "Copy"}
    </button>
  );
};

// ── The preview + restore dialog ───────────────────────────────────────────────────────────

export function RestoreDialog({ pageId, generationId, onClose, onRestored }) {
  const [state, setState] = useState({ phase: "loading" });
  useEffect(() => {
    let live = true;
    (async () => {
      const r = await call("backup-preview", { pageId, generationId });
      if (!live) return;
      setState(r.ok ? { phase: "preview", preview: r.data.preview } : { phase: "error", reason: r.reason });
    })();
    return () => { live = false; };
  }, [pageId, generationId]);

  const restore = async () => {
    setState((s) => ({ ...s, phase: "running", progress: "Queued…" }));
    const r = await call("backup-restore", { pageId, generationId });
    if (!r.ok) { setState((s) => ({ ...s, phase: "preview", error: r.reason })); return; }
    const job = await waitForJob(r.data.jobId, (j) => setState((s) => ({ ...s, progress: j.status === "running" ? "Checking every file, then writing your setup back…" : "Queued…" })));
    if (job.status === "done") { setState((s) => ({ ...s, phase: "done", result: job.result })); onRestored?.(job.result); }
    else setState((s) => ({ ...s, phase: "preview", error: job.error || "The restore failed — nothing was written." }));
  };

  const p = state.preview;
  const busy = state.phase === "running";
  return (
    <Dialog title={state.phase === "done" ? "Setup restored" : "Restore your setup"} onClose={onClose} busy={busy} testId="bk-restore-dialog" className="bk-dialog">
      <div className="sv-dialog-body bk-dialog-body">
        {state.phase === "loading" && <Busy text="Reading the backup…" testId="bk-preview-loading" />}
        {state.phase === "error" && <Failure reason={state.reason} testId="bk-preview-error" />}
        {(state.phase === "preview" || busy) && p && (
          <>
            <p className="bk-lead" data-testid="bk-preview-lead">
              Backup of <strong>{when(p.createdAt)}</strong>{p.reason === "import" && p.importedFrom ? ` (an imported file, taken ${when(p.importedFrom.createdAt)})` : ""}: {p.keys.toLocaleString()} items, {fmtBytes(p.bytes)}.
            </p>
            <ul className="bk-groups" data-testid="bk-preview-groups">
              {p.groups.map((g) => (
                <li key={g.group}><span className="bk-count">{g.keys.toLocaleString()}</span> <span className="bk-group-name">{g.label}</span>
                  <span className="bk-group-parts">{g.families.map((f) => `${f.label} ${f.keys.toLocaleString()}`).join(" · ")}</span></li>
              ))}
            </ul>
            {p.indexKeys > 0 && <p className="bk-small" data-testid="bk-preview-index">Plus {p.indexKeys.toLocaleString()} lookup entries the app keeps to find these quickly.</p>}
            <div className="bk-integrity" data-testid="bk-preview-integrity">{p.reason === "import" ? "Imported file: every part matched its fingerprint, and these counts were taken from the data itself." : "Index verified."} Every data file is checked again before anything is written; if one does not match, nothing is restored.</div>
            {p.paused?.length > 0 && (
              <div className="bk-block" data-testid="bk-preview-paused">
                <h4>Comes back paused</h4>
                <p className="bk-small">These act on their own, so they stay off until you turn them back on (Backup and restore → Paused after a restore). Seals and approved pages stay protected.</p>
                <ul>{p.paused.map((x) => <li key={x.id}>{x.label} — {x.where}</li>)}</ul>
              </div>
            )}
            <div className="bk-block" data-testid="bk-preview-secrets">
              <h4>Not in the backup — re-enter after the restore</h4>
              <ul>
                <li>{p.secrets?.apiTokens?.length ? `REST API tokens: ${p.secrets.apiTokens.map((t) => `${t.name} (${t.role})`).join(", ")}. Create new ones in API access.` : "REST API tokens: none existed."}</li>
                <li>{p.secrets?.authenticatorAccounts?.length ? `Authenticator codes for signed actions: ${p.secrets.authenticatorAccounts.length} ${p.secrets.authenticatorAccounts.length === 1 ? "person enrolls" : "people enroll"} again.` : "Authenticator codes: nobody had enrolled."}</li>
              </ul>
            </div>
            <p className="bk-small" data-testid="bk-preview-live-note">On a site already in use, every item in the backup goes back to how it was on that date — settings, seals and their saved section content, approvals — and items created since stay. A backup of the current state is taken first, so you can go back.</p>
            {state.error && <div className="api-inline-error" role="alert" data-testid="bk-restore-error">{state.error}</div>}
            {busy && <Busy text={state.progress} testId="bk-restore-progress" />}
          </>
        )}
        {state.phase === "done" && (
          <div data-testid="bk-restore-done">
            <p className="bk-lead"><strong>{state.result?.written ?? 0} items</strong> written back{state.result?.expired ? `, ${state.result.expired} had run out and were left out` : ""}.</p>
            {state.result?.failed?.length > 0 && <div className="api-inline-error" role="alert">{state.result.failed.length} items could not be written: {state.result.failed.map((f) => f.key).slice(0, 5).join(", ")}</div>}
            {state.result?.paused?.length > 0 && <p>{state.result.paused.length} automation{state.result.paused.length === 1 ? " is" : "s are"} paused — turn {state.result.paused.length === 1 ? "it" : "them"} back on in Backup and restore when you are ready.</p>}
          </div>
        )}
      </div>
      <div className="sv-dialog-actions">
        {state.phase === "preview" && <button type="button" className="btn-primary bk-restore-go" onClick={restore} data-testid="bk-restore-go">Restore this setup</button>}
        <button type="button" className="action-btn confirm-no" onClick={onClose} disabled={busy} data-testid="bk-restore-close">{state.phase === "done" ? "Done" : "Cancel"}</button>
      </div>
    </Dialog>
  );
}

// ── The banner: a backup from an earlier installation is waiting ──────────────────────────────

/** PURE. The generation the banner offers: the newest one an EARLIER installation wrote. */
export function offerFrom(discovered, decision) {
  if (decision?.decision) return null;
  const me = discovered?.installationId || null;
  let best = null;
  for (const b of discovered?.backups || []) {
    if (!b.restricted || !b.sameEnvironment) continue;
    for (const g of b.generations || []) {
      if (!g.keys || (me && g.installationId === me)) continue;
      if (!best || String(g.createdAt) > String(best.generation.createdAt)) best = { pageId: b.pageId, spaceKey: b.spaceKey, generation: g };
    }
  }
  return best;
}

export function RestoreBanner({ onChanged }) {
  const [offer, setOffer] = useState(null);
  const [open, setOpen] = useState(false);
  const [confirmFresh, setConfirmFresh] = useState(false);
  const load = useCallback(async () => {
    const [s, d] = await Promise.all([call("backup-status"), call("backup-discover")]);
    if (!s.ok || !d.ok) return;
    setOffer(offerFrom(d.data, s.data.decision));
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!offer) return null;
  const g = offer.generation;
  return (
    <div className="bk-banner" role="region" aria-label="Restore your setup" data-testid="bk-banner">
      <div className="bk-banner-text">
        <strong>Restore your setup from {when(g.createdAt)}</strong>
        <span>Sentinel Vault found the backup an earlier installation kept on this site: {Number(g.keys).toLocaleString()} items — settings, seals, workflows, rules and history.</span>
      </div>
      <div className="bk-banner-actions">
        <button type="button" className="bk-banner-go" onClick={() => setOpen(true)} data-testid="bk-banner-restore">Preview and restore</button>
        <button type="button" className="bk-banner-skip" onClick={() => setConfirmFresh(true)} data-testid="bk-banner-fresh">Start fresh</button>
      </div>
      {open && <RestoreDialog pageId={offer.pageId} generationId={g.generationId} onClose={() => { setOpen(false); load(); onChanged?.(); }} onRestored={() => onChanged?.()} />}
      {confirmFresh && (
        <ConfirmDialog title="Start fresh?" danger={false} confirmLabel="Start fresh" testId="bk-fresh-confirm"
          message={<p>The banner goes away and you set Sentinel Vault up again. The backup stays where it is: you can still restore it from Backup and restore at any time.</p>}
          onCancel={() => setConfirmFresh(false)}
          onConfirm={async () => { await call("backup-decline"); setConfirmFresh(false); setOffer(null); onChanged?.(); }} />
      )}
    </div>
  );
}

// ── The tab ─────────────────────────────────────────────────────────────────────────────────

export default function BackupTab() {
  const [status, setStatus] = useState({ phase: "loading" });
  const [found, setFound] = useState({ phase: "loading" });
  const [history, setHistory] = useState({ phase: "loading" });
  const [job, setJob] = useState(null); // { label, text }
  const [msg, setMsg] = useState(null); // { kind: "ok"|"error", text }
  const [restoreOf, setRestoreOf] = useState(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveKey, setMoveKey] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    const [s, d, h] = await Promise.all([call("backup-status"), call("backup-discover"), call("backup-history")]);
    setStatus(s.ok ? { phase: "ok", ...s.data } : { phase: "error", reason: s.reason });
    setFound(d.ok ? { phase: "ok", ...d.data } : { phase: "error", reason: d.reason });
    setHistory(h.ok ? { phase: "ok", entries: h.data.entries || [] } : { phase: "error", reason: h.reason });
  }, []);
  useEffect(() => { load(); }, [load]);

  const runJob = async (label, start, after) => {
    setMsg(null);
    setJob({ label, text: "Queued…" });
    const r = await start();
    if (!r.ok) { setJob(null); setMsg({ kind: "error", text: r.reason }); return null; }
    const done = await waitForJob(r.data.jobId, (j) => setJob({ label, text: j.status === "running" ? "Working…" : "Queued…" }));
    setJob(null);
    if (done.status !== "done") { setMsg({ kind: "error", text: done.error || `${label} failed.` }); await load(); return null; }
    await load();
    if (after) after(done.result);
    return done.result;
  };

  const backupNow = () => runJob("Backing up", () => call("backup-now"), (r) => setMsg({ kind: "ok", text: r?.unchanged ? "Nothing changed since the last backup — it is current." : `Backed up ${r?.keys ?? ""} items.` }));

  const exportFile = async () => {
    const fresh = await runJob("Preparing a fresh backup to export", () => call("backup-now"));
    if (!fresh) return;
    setJob({ label: "Exporting", text: "Collecting the backup files…" });
    const head = await call("backup-export", { generationId: fresh.generationId });
    if (!head.ok) { setJob(null); setMsg({ kind: "error", text: head.reason }); return; }
    const chunks = [];
    for (let i = 0; i < head.data.parts.length; i++) {
      setJob({ label: "Exporting", text: `File ${i + 1} of ${head.data.parts.length}…` });
      const part = await call("backup-export-part", { generationId: head.data.manifest.generationId, name: head.data.parts[i] });
      if (!part.ok) { setJob(null); setMsg({ kind: "error", text: part.reason }); return; }
      const c = head.data.manifest.chunks.find((x) => x.name === part.data.name);
      chunks.push({ name: part.data.name, sha256: c.sha256, text: part.data.text });
    }
    const doc = { format: "sentinel-vault-export", formatVersion: 1, exportedAt: new Date().toISOString(), manifest: head.data.manifest, chunks };
    const blob = new Blob([JSON.stringify(doc)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `sentinel-vault-export-${head.data.manifest.generationId}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setJob(null);
    setMsg({ kind: "ok", text: `Export downloaded: ${head.data.manifest.keys} items, ${fmtBytes(blob.size)}.` });
    load();
  };

  const importFile = async (file) => {
    if (!file) return;
    setMsg(null);
    let text;
    try { text = await file.text(); } catch (_) { setMsg({ kind: "error", text: "Could not read that file." }); return; }
    let doc;
    try { doc = JSON.parse(text); } catch (_) { setMsg({ kind: "error", text: "That file is not JSON." }); return; }
    if (doc?.format !== "sentinel-vault-export") { setMsg({ kind: "error", text: "That file is not a Sentinel Vault export." }); return; }
    const importId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const size = 50000; // re-escaped inside a KVS value: 200,000 overran the 240 KiB limit live
    const total = Math.max(1, Math.ceil(text.length / size));
    for (let i = 0; i < total; i++) {
      setJob({ label: "Importing", text: `Uploading part ${i + 1} of ${total}…` });
      const r = await call("backup-import-part", { importId, index: i, total, text: text.slice(i * size, (i + 1) * size) });
      if (!r.ok) { setJob(null); setMsg({ kind: "error", text: r.reason }); return; }
    }
    const res = await runJob("Importing", () => call("backup-import-commit", { importId, total }));
    if (res?.generationId) { setMsg({ kind: "ok", text: `Imported as a backup of ${res.keys} items. Review it and restore below.` }); setRestoreOf({ pageId: res.pageId, generationId: res.generationId }); }
  };

  // One call per automation: turning seal expiry back on extends every seal, which can take a
  // while on a big site; one item per call keeps each well inside the 25 s resolver limit.
  const resume = async (ids) => {
    setMsg(null);
    const list = ids || paused.map((x) => x.id);
    const failedReasons = [];
    for (let i = 0; i < list.length; i++) {
      setJob({ label: "Turning back on", text: `${i + 1} of ${list.length}…` });
      const r = await call("backup-resume-automations", { ids: [list[i]] });
      if (!r.ok) failedReasons.push(r.reason);
      else for (const f of r.data.failed || []) failedReasons.push(f.reason);
    }
    setJob(null);
    setMsg(failedReasons.length ? { kind: "error", text: `Could not turn back on: ${failedReasons.join("; ")}` } : { kind: "ok", text: "Turned back on." });
    load();
  };

  if (status.phase === "loading") return <div className="settings-panel"><Busy text="Loading the backup…" testId="bk-loading" /></div>;
  if (status.phase === "error") return <div className="settings-panel"><Failure reason={status.reason} onRetry={load} testId="bk-status-error" /></div>;

  const st = status.status || {};
  const last = st.lastBackup;
  const install = status.install || {};
  const paused = status.paused?.items || [];
  const backups = found.phase === "ok" ? found.backups : [];
  const generations = backups.flatMap((b) => (b.generations || []).map((g) => ({ ...g, pageId: b.pageId, spaceKey: b.spaceKey, sameEnvironment: b.sameEnvironment, restricted: b.restricted, title: b.title })));
  generations.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const previousInstalls = [...new Map(backups.flatMap((b) => b.installations || []).filter((i) => i.installationId !== install.installationId).map((i) => [i.installationId, i])).values()];
  const surv = status.survival || { survives: [], secrets: [], rebuilt: [] };

  return (
    <div className="settings-panel sv-groups bk-tab" data-testid="bk-tab">
      {msg && <div className={msg.kind === "ok" ? "alert-success" : "alert-error"} role={msg.kind === "ok" ? "status" : "alert"} data-testid="bk-msg">{msg.text}</div>}
      {job && <Busy text={`${job.label} — ${job.text}`} testId="bk-job" />}

      <Card id="status" title="Your backup" text="Sentinel Vault backs up your setup after every change and once a day, to a Confluence page only the app can open. It is what brings your setup back after an uninstall.">
        {last ? (
          <div className="bk-status-band" data-testid="bk-last">
            <span className="bk-status-when"><strong>Last backup {ago(last.createdAt)}</strong> · {when(last.createdAt)}</span>
            <span className="bk-status-size">{Number(last.keys).toLocaleString()} items · {fmtBytes(last.bytes)}{last.reason ? ` · ${REASON[last.reason] || last.reason}` : ""}</span>
          </div>
        ) : <p className="api-empty" data-testid="bk-none">No backup yet. The first one is taken after the next change, within the hour, or now.</p>}
        {st.waiting === "restore-pending" && <p className="api-explain" data-testid="bk-waiting">Automatic backups wait until you restore the earlier setup or choose to start fresh, so they cannot crowd out the backup you came back for.</p>}
        {st.lastError && (!last || String(st.lastError.at) > String(st.lastCheckAt || "")) && <div className="api-inline-error" role="alert" data-testid="bk-last-error">The last backup failed ({when(st.lastError.at)}): {st.lastError.message}</div>}
        {status.settings?.spaceKey && (
          <p className="api-explain" data-testid="bk-where">Kept on the page "{status.settings.title}" in space <strong>{status.settings.spaceName || status.settings.spaceKey}</strong> ({status.settings.spaceKey}). The page is restricted to the app: no person can open it, and it does not appear in the page tree. Deleting it deletes the backup.</p>
        )}
        <div className="bk-actions">
          <button type="button" className="btn-primary" onClick={backupNow} disabled={!!job} data-testid="bk-now">Back up now</button>
          <button type="button" className="btn-secondary" onClick={() => setMoveOpen(true)} disabled={!!job} data-testid="bk-move">Move to another space</button>
          <button type="button" className="btn-secondary bk-danger" onClick={() => setDeleteOpen(true)} disabled={!!job || !status.settings} data-testid="bk-delete">Delete the backup</button>
        </div>
      </Card>

      {paused.length > 0 && (
        <Card id="paused" title="Paused after a restore" text={`Restored ${when(status.paused.restoredAt)}. These act on their own, so they came back off. Turn each back on when you are ready.`} tone="amber">
          <ul className="bk-paused" data-testid="bk-paused-list">
            {paused.map((x) => (
              <li key={x.id}><span><strong>{x.label}</strong> — {x.where}</span>
                <button type="button" className="btn-secondary" onClick={() => resume([x.id])} data-testid={`bk-resume-${x.rule}`}>Turn back on</button></li>
            ))}
          </ul>
          {paused.length > 1 && <button type="button" className="btn-primary" onClick={() => resume(null)} data-testid="bk-resume-all">Turn all back on</button>}
        </Card>
      )}

      <Card id="restore" title="Restore" text="Every backup the app can find on this site, newest first. A restore shows what comes back before anything is written.">
        {found.phase === "loading" && <Busy text="Looking for backups…" />}
        {found.phase === "error" && <Failure reason={found.reason} onRetry={load} testId="bk-found-error" />}
        {found.phase === "ok" && generations.length === 0 && <p className="api-empty">No backups found on this site yet.</p>}
        {generations.length > 0 && (
          <div className="api-table-wrap">
            <table className="api-table bk-table" data-testid="bk-generations">
              <thead><tr><th>Taken</th><th>Items</th><th>Size</th><th>Source</th><th /></tr></thead>
              <tbody>
                {generations.map((g) => (
                  <tr key={`${g.pageId}-${g.generationId}`} data-testid="bk-generation">
                    <td>{when(g.createdAt)}<span className="api-by">{REASON[g.reason] || g.reason}{g.pinned ? " · kept from an earlier installation" : ""}</span></td>
                    <td className="api-count">{Number(g.keys).toLocaleString()}</td>
                    <td>{fmtBytes(g.bytes)}</td>
                    <td>{g.installationId === install.installationId ? "This installation" : "An earlier installation"}{!g.sameEnvironment ? ` · ${String(g.environmentType || "").toLowerCase()}` : ""}</td>
                    <td className="api-row-actions"><button type="button" className="btn-secondary" onClick={() => setRestoreOf({ pageId: g.pageId, generationId: g.generationId })} disabled={!g.restricted || !!job} data-testid="bk-preview">Preview</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card id="file" title="Export and import" text="One JSON file holds the whole setup. Keep a copy anywhere, or import it on another site.">
        <div className="bk-actions">
          <button type="button" className="btn-primary" onClick={exportFile} disabled={!!job} data-testid="bk-export">Download export</button>
          <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()} disabled={!!job} data-testid="bk-import">Import a file</button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="bk-import-input"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; importFile(f); }} />
        </div>
        <p className="api-explain">An import becomes a backup on this site; nothing changes until you preview and restore it. REST API tokens and authenticator codes are never in an export.</p>
        <p className="api-explain" data-testid="bk-export-warning">The file is a full copy of the setup, like a Confluence site export: it holds the content of sealed sections, approval records and the activity history, including from pages you may not be able to open. Keep it where only admins can reach it. An import is trusted the same way: whatever the file holds is written back as the app.</p>
      </Card>

      <Card id="survives" title="What survives an uninstall" text="Removing Sentinel Vault, or losing it to a lapsed subscription, does not lose your setup.">
        <div className="bk-survival">
          <div className="bk-col bk-yes" data-testid="bk-survives">
            <h4>Comes back with a restore</h4>
            <ul>{surv.survives.map((g) => <li key={g.group}><strong>{g.label}</strong><span>{g.items.join(", ")}</span></li>)}</ul>
          </div>
          <div className="bk-col bk-no" data-testid="bk-not-survives">
            <h4>Does not come back</h4>
            <ul>{[...surv.secrets, ...surv.rebuilt].map((t) => <li key={t}>{t}</li>)}</ul>
            <h4>Comes back paused</h4>
            <ul><li>Seals expiring, validation revert mode, AI review, workflow auto-assign and review timers — until you turn them back on</li></ul>
          </div>
        </div>
      </Card>

      <Card id="relink" title="If the app was removed without a backup" text="Backups exist from this version on. For an uninstall before that, Atlassian keeps the app's data for 28 days and can re-link it to a new installation.">
        <ol className="bk-steps" data-testid="bk-relink">
          <li>Act within 21 days of the uninstall.</li>
          <li>Contact LeanZero at <a href="https://leanzero.net/contact" target="_blank" rel="noreferrer">leanzero.net/contact</a> and say you agree to the restore.</li>
          <li>Send the Site ID and the installation ids below. LeanZero asks Atlassian to re-link the old data; it replaces what the new installation has stored since.</li>
        </ol>
        <dl className="bk-ids">
          <dt>Site ID</dt><dd><code data-testid="bk-cloud-id">{install.cloudId || "—"}</code> <Copy text={install.cloudId || ""} testId="bk-copy-cloud" /></dd>
          <dt>This installation</dt><dd><code data-testid="bk-install-id">{install.installationId || "—"}</code> <Copy text={install.installationId || ""} testId="bk-copy-install" /></dd>
          {previousInstalls.map((i) => (
            <React.Fragment key={i.installationId}><dt>Earlier installation</dt><dd><code>{i.installationId}</code> <span className="api-by">last backup {when(i.lastSeen)}</span></dd></React.Fragment>
          ))}
        </dl>
      </Card>

      <Card id="history" title="History" text="Every backup, restore, export and import, and who did it.">
        {history.phase === "error" && <Failure reason={history.reason} onRetry={load} />}
        {history.phase === "ok" && history.entries.length === 0 && <p className="api-empty">Nothing yet.</p>}
        {history.phase === "ok" && history.entries.length > 0 && (
          <ul className="bk-history" data-testid="bk-history">
            {history.entries.map((e) => { const f = formatActivity(e); return (
              <li key={e.id}><span className="bk-history-when">{when(e.ts)}</span><span><strong>{f.label}</strong> — {f.sentence}{f.detail ? ` (${f.detail})` : ""}</span></li>
            ); })}
          </ul>
        )}
      </Card>

      {restoreOf && <RestoreDialog pageId={restoreOf.pageId} generationId={restoreOf.generationId} onClose={() => { setRestoreOf(null); load(); }} onRestored={() => load()} />}
      {moveOpen && (
        <Dialog title="Move the backup to another space" onClose={() => setMoveOpen(false)} testId="bk-move-dialog">
          <div className="sv-dialog-body">
            <p>The app creates a new restricted page in that space, copies every kept backup to it, then deletes the old page.</p>
            <label className="bk-field">Space key<input type="text" value={moveKey} onChange={(e) => setMoveKey(e.target.value.trim())} placeholder="e.g. ADMIN" data-testid="bk-move-key" /></label>
          </div>
          <div className="sv-dialog-actions">
            <button type="button" className="btn-primary" disabled={!moveKey} data-testid="bk-move-go"
              onClick={() => { setMoveOpen(false); runJob("Moving the backup", () => call("backup-set-location", { spaceKey: moveKey }), (r) => setMsg({ kind: "ok", text: `Moved to ${r?.spaceKey}.` })); }}>Move</button>
            <button type="button" className="action-btn confirm-no" onClick={() => setMoveOpen(false)}>Cancel</button>
          </div>
        </Dialog>
      )}
      {deleteOpen && (
        <ConfirmDialog title="Delete the backup?" confirmLabel="Delete the backup" testId="bk-delete-confirm"
          message={<p>The backup page goes to the space trash with every kept backup. If Sentinel Vault is then uninstalled, nothing can bring the setup back. A new backup is taken after the next change unless you uninstall first.</p>}
          onCancel={() => setDeleteOpen(false)}
          onConfirm={async () => { setDeleteOpen(false); const r = await call("backup-delete"); setMsg(r.ok ? { kind: "ok", text: "Backup deleted." } : { kind: "error", text: r.reason }); load(); }} />
      )}
    </div>
  );
}
