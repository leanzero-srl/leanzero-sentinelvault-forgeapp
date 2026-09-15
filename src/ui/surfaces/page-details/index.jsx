import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke, view, router, Modal } from "@forge/bridge";
import { enablePaletteSync } from "../../kit/palette-sync";
import ActivityFeed, { ActivityRow } from "../../kit/ActivityFeed";
import { ACTIVITY_CATEGORIES, categoryOf } from "../../kit/activity-format";
import { primaryActionFor, menuActionsFor } from "../../../server/capsules/page-details/row-state.js";

// 5.0 — the page-details modal (mockup §4), the page-level hub behind the byline chip. ONE
// resource serves two modules: the byline item (`sentinel-vault-byline`, mode "details") and
// the "Seal attachments…" content action (`sentinel-vault-seal-action`, mode "seal" — the other
// agent's entry point; see renderForModule + SealActionSeam). Everything the modal reads comes
// from ONE resolver, page-details-summary; every mutation goes through the existing action keys.
// Vocabulary in copy: space, space admin, user, group, attachment, seal (never realm / steward /
// operator / guild / artifact / reservation). No native select / alert / confirm anywhere here.

const APP_ID = "c30bf71e-4287-4872-954d-db49cc68f0ff";
const MY_WORK_PATH = `/wiki/apps/${APP_ID}/my-work`;
const NEUTRAL = "#475569";

// "until Mon 09:00" inside the coming week, "until Sep 20, 17:00" beyond it.
const when = (iso) => {
  const ms = iso ? new Date(iso).getTime() : NaN;
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const within = Math.abs(ms - Date.now()) < 7 * 24 * 3600 * 1000;
  return within
    ? `${d.toLocaleDateString(undefined, { weekday: "short" })} ${time}`
    : `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
};

const Lock = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
);
const Dot = () => <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" aria-hidden="true"><circle cx="12" cy="12" r="8" /></svg>;

// ── Level pill + picker (custom listbox, never a native <select>) ────────────────────────────
const LevelPill = ({ level, sealed, testId }) => (
  <span className="pd-pill" style={{ background: level?.color || NEUTRAL }} data-testid={testId} data-level={level?.id || ""}>
    <span className="pd-glyph">{sealed ? <Lock /> : <Dot />}</span>
    {level?.name || "Unclassified"}
  </span>
);

const LevelPicker = ({ levels, value, onPick, disabled }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = levels.find((l) => l.id === value) || null;
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <div className="pd-dd-wrap" ref={ref}>
      <button type="button" className="pd-dd" onClick={() => setOpen((o) => !o)} disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-label="Classification level for this page" data-testid="pd-level-picker">
        <span className="pd-dd-cur"><span className="pd-sw" style={{ background: current?.color || NEUTRAL }} />{current ? current.name : "Space default"}</span>
        <span className="pd-dd-arrow" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="pd-dd-menu" role="listbox" aria-label="Classification levels">
          {levels.map((l) => (
            <div key={l.id} role="option" aria-selected={l.id === value} tabIndex={0} className={`pd-dd-opt ${l.id === value ? "sel" : ""}`} data-testid={`pd-level-option-${l.id}`}
              onClick={() => { setOpen(false); onPick(l.id); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(false); onPick(l.id); } }}>
              <span className="pd-sw" style={{ background: l.color }} /><span className="pd-dd-name">{l.name}</span>
              {l.description && <span className="pd-dd-hint">{l.description}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const ClassificationBlock = ({ c, sealed, pageId, onChanged }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const level = c?.effective?.level || null;
  const source = c?.effective?.source || "none";
  const canChange = !!c?.canChange;
  const setLevel = async (levelId) => {
    setBusy(true); setError(null);
    try {
      const r = await invoke("classification-set-page", { pageId, levelId });
      if (r?.ok) await onChanged();
      else setError(r?.reason || "Could not change the classification.");
    } catch (_) { setError("Could not change the classification."); }
    finally { setBusy(false); }
  };
  let desc;
  if (c?.error) desc = c.error;
  else if (!level) desc = canChange ? "No classification level on this page. Choose one, or ask a space admin to set a space default." : "No classification level on this page. Ask a space admin to set a space default.";
  else {
    const src = source === "page"
      ? `Set on this page.${c.spaceDefault ? ` The space default is ${c.spaceDefault.name}.` : " The space has no default."}`
      : "Space default.";
    desc = `${src}${level.description ? ` ${level.description}` : ""}${canChange ? "" : " Only space admins and page editors can change it."}`;
  }
  return (
    <section className="pd-sec" data-testid="pd-classification">
      <h4>Classification</h4>
      <div className="pd-cls-row">
        <LevelPill level={level} sealed={sealed} testId="pd-level-pill" />
        <span className="pd-desc" data-testid="pd-level-desc">{desc}</span>
        {canChange && c?.levels?.length > 0 && (
          <span className="pd-override">
            <LevelPicker levels={c.levels} value={c.pageLevelId} onPick={setLevel} disabled={busy} />
            <button type="button" className="pd-btn quiet" disabled={busy || c.pageLevelId == null} onClick={() => setLevel(null)} data-testid="pd-use-space-default">Use space default</button>
          </span>
        )}
      </div>
      {error && <p className="pd-error" role="alert">{error}</p>}
    </section>
  );
};

// ── ⋯ menu (custom, keyboard-operable) ──────────────────────────────────────────────────────
const MENU_LABEL = { extend: "Extend the seal", release: "Release", watch: "Watch for release", unwatch: "Stop watching", "copy-link": "Copy link", "force-release": "Force release…" };
const Kebab = ({ items, onPick, name }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  useEffect(() => { if (open) ref.current?.querySelector('[role="menuitem"]')?.focus(); }, [open]);
  const onKey = (e) => {
    const els = Array.from(ref.current?.querySelectorAll('[role="menuitem"]') || []);
    const i = els.indexOf(document.activeElement);
    if (e.key === "Escape") { setOpen(false); ref.current?.querySelector("button")?.focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
  };
  if (!items.length) return null;
  return (
    <div className="pd-kebab-wrap" ref={ref} onKeyDown={onKey}>
      <button type="button" className="pd-kebab" aria-label={`More actions for ${name}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="pd-kebab">⋯</button>
      {open && (
        <div className="pd-menu" role="menu">
          {items.map((id) => (
            <button key={id} type="button" role="menuitem" className={`pd-menu-item ${id === "force-release" ? "danger" : ""}`} data-testid={`pd-menu-${id}`}
              onClick={() => { setOpen(false); onPick(id); }}>{MENU_LABEL[id] || id}</button>
          ))}
        </div>
      )}
    </div>
  );
};

// One inline bar for anything that needs typed input: an edit request's reason, a force release's reason.
const ReasonBar = ({ label, placeholder, confirm, danger, required, onConfirm, onCancel, busy }) => {
  const [text, setText] = useState("");
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="pd-reason" data-testid="pd-reason-bar">
      <label className="pd-reason-label">{label}</label>
      <input ref={ref} className="pd-input" value={text} placeholder={placeholder} maxLength={300} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (!required || text.trim())) onConfirm(text.trim()); if (e.key === "Escape") onCancel(); }} data-testid="pd-reason-input" />
      <button type="button" className={`pd-btn ${danger ? "danger" : "primary"}`} disabled={busy || (required && !text.trim())} onClick={() => onConfirm(text.trim())} data-testid="pd-reason-confirm">{confirm}</button>
      <button type="button" className="pd-btn quiet" disabled={busy} onClick={onCancel}>Cancel</button>
    </div>
  );
};

// ── one seal row: icon · name + sentence · primary action · ⋯ ────────────────────────────────
const SealRow = ({ row, viewer, pageId, siteUrl, onChanged }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [bar, setBar] = useState(null); // "request" | "force" | null
  const [copied, setCopied] = useState(false);
  const primary = primaryActionFor(row, viewer);
  const menu = menuActionsFor(row, viewer);
  const isAtt = row.kind === "attachment";
  const idPayload = isAtt ? { attachmentId: row.id } : { sectionId: row.id };

  const run = async (action, payload, { reload = true } = {}) => {
    setBusy(true); setError(null);
    try {
      const r = await invoke(action, payload);
      if (r?.success === false || r?.ok === false) { setError(r?.reason || "That did not work."); return false; }
      if (reload) await onChanged();
      return true;
    } catch (_) { setError("That did not work."); return false; }
    finally { setBusy(false); }
  };

  const copyLink = async () => {
    const base = siteUrl || "";
    const href = isAtt && row.link
      ? (row.link.startsWith("http") ? row.link : `${base}/wiki${row.link.startsWith("/wiki") ? row.link.slice(5) : row.link}`)
      : `${base}/wiki/pages/viewpage.action?pageId=${pageId}`;
    try { await navigator.clipboard.writeText(href); }
    catch (_) {
      const ta = document.createElement("textarea"); ta.value = href; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch (__) { /* nothing more to try */ }
      document.body.removeChild(ta);
    }
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  };

  const onMenu = (id) => {
    if (id === "extend") run("extend-seal", { attachmentId: row.id });
    else if (id === "release") run(isAtt ? "unseal-artifact" : "unseal-section", idPayload);
    else if (id === "watch") run("watch-artifact", { attachmentId: row.id });
    else if (id === "unwatch") run("unwatch-artifact", { attachmentId: row.id });
    else if (id === "copy-link") copyLink();
    else if (id === "force-release") setBar("force");
  };

  // The sentence under the name (mockup §4).
  const owner = row.isMine ? "you" : (row.ownerName || "another user");
  const clock = row.isTrashed ? "in the trash"
    : !row.expiresAt ? "no expiry"
    : row.isExpired ? `expired ${when(row.expiresAt)}`
    : `until ${when(row.expiresAt)}`;
  const extra = row.isMine
    ? (row.pendingRequests.length > 0
      ? ` · ${row.pendingRequests[0].requesterName || "Someone"} is waiting${row.pendingRequests[0].reason ? `: “${row.pendingRequests[0].reason}”` : ""}${row.pendingRequests.length > 1 ? ` (+${row.pendingRequests.length - 1} more)` : ""}`
      : "")
    : primary.kind === "editnow" ? " · you can edit until then"
    : primary.kind === "waiting" ? " · your request was sent"
    : "";
  const trashNote = row.isTrashed ? " — restore it from the Attachments view" : "";

  const primaryEl = (() => {
    switch (primary.kind) {
      case "decide": {
        const rq = primary.request;
        const approve = isAtt ? "approve-edit-request" : "approve-section-edit";
        const deny = isAtt ? "deny-edit-request" : "deny-section-edit";
        return (
          <>
            <button type="button" className="pd-btn primary" disabled={busy} data-testid="pd-primary" data-action="approve" onClick={() => run(approve, { ...idPayload, requesterAccountId: rq.requesterAccountId })} aria-label={`Approve ${rq.requesterName || "the request"} editing ${row.name}`}>Approve</button>
            <button type="button" className="pd-btn quiet" disabled={busy} data-testid="pd-decline" onClick={() => run(deny, { ...idPayload, requesterAccountId: rq.requesterAccountId })} aria-label={`Decline ${rq.requesterName || "the request"} editing ${row.name}`}>Decline</button>
          </>
        );
      }
      case "release":
        return <button type="button" className="pd-btn quiet" disabled={busy} data-testid="pd-primary" data-action="release" onClick={() => run(isAtt ? "unseal-artifact" : "unseal-section", idPayload)}>Release</button>;
      case "request":
        return <button type="button" className="pd-btn primary" disabled={busy || primary.disabled} title={primary.hint || undefined} data-testid="pd-primary" data-action="request" onClick={() => setBar("request")}>Request edit</button>;
      case "waiting":
        return <span className="pd-state wait" data-testid="pd-primary" data-action="waiting">Waiting for {primary.owner || "the owner"}</span>;
      case "editnow":
        return <span className="pd-state ok" data-testid="pd-primary" data-action="editnow">Edit now{primary.until ? ` until ${when(primary.until)}` : ""}</span>;
      case "expired":
        return <span className="pd-state expired" data-testid="pd-primary" data-action="expired">Expired</span>;
      case "trashed":
        return <span className="pd-state trashed" data-testid="pd-primary" data-action="trashed">In the trash</span>;
      case "seal":
        return <button type="button" className="pd-btn primary" disabled={busy} data-testid="pd-primary" data-action="seal" onClick={() => run("seal-artifact", { attachmentId: row.id })}>Seal</button>;
      default:
        return null;
    }
  })();

  return (
    <li className="pd-row" data-testid="pd-seal-row" data-kind={row.kind} data-id={row.id} data-primary={primary.kind}>
      <div className="pd-row-main">
        <span className={`pd-ic ${isAtt ? "file" : "sec"}`} aria-hidden="true">{isAtt ? "F" : "§"}</span>
        <div className="pd-t">
          <div className="pd-n" title={row.name}>{isAtt ? row.name : `Section “${row.name}”`}</div>
          <div className="pd-m">Sealed by {owner} · {clock}{extra}{trashNote}</div>
        </div>
        <div className="pd-a">
          {primaryEl}
          <Kebab items={menu} onPick={onMenu} name={row.name} />
        </div>
      </div>
      {copied && <div className="pd-note" role="status">Link copied</div>}
      {bar === "request" && (
        <ReasonBar label="Why do you need to edit it?" placeholder="A short reason for the owner (optional)" confirm="Send request"
          busy={busy} onCancel={() => setBar(null)}
          onConfirm={async (reason) => { if (await run(isAtt ? "request-edit-access" : "request-section-edit", { ...idPayload, reason })) setBar(null); }} />
      )}
      {bar === "force" && (
        <ReasonBar label="Force release — a reason is required and recorded" placeholder="Why this seal is being released over its owner" confirm="Force release" danger required
          busy={busy} onCancel={() => setBar(null)}
          onConfirm={async (reason) => { if (await run(isAtt ? "unseal-artifact" : "unseal-section", isAtt ? { attachmentId: row.id, adminOverride: true, reason } : { sectionId: row.id, reason })) setBar(null); }} />
      )}
      {error && <div className="pd-error" role="alert" data-testid="pd-row-error">{error}</div>}
    </li>
  );
};

const SealsBlock = ({ summary, onChanged, siteUrl }) => {
  const rows = summary.seals || [];
  return (
    <section className="pd-sec" data-testid="pd-seals">
      <h4>Seals on this page · {rows.length}</h4>
      {summary.sealError && <p className="pd-error" role="alert">{summary.sealError}</p>}
      {!summary.sealError && rows.length === 0 && <p className="pd-empty" data-testid="pd-seals-empty">Nothing on this page is sealed.</p>}
      {rows.length > 0 && (
        <ul className="pd-list">
          {rows.map((r) => <SealRow key={`${r.kind}-${r.id}`} row={r} viewer={summary.viewer} pageId={summary.pageId} siteUrl={siteUrl} onChanged={onChanged} />)}
        </ul>
      )}
    </section>
  );
};

// ── Attachments tab ──────────────────────────────────────────────────────────────────────────
// overlay/index.jsx is one 1,400-line file that mounts itself at import, so it cannot be embedded
// here; the tab opens the same Forge Modal the ribbon opens (resource "overlay", size "max").
const openAttachmentsOverlay = (onClose) => {
  const m = new Modal({ resource: "overlay", size: "max", onClose: () => { if (onClose) onClose(); } });
  m.open();
};

// ── "Seal attachments…" (content action `sentinel-vault-seal-action`, Part 3c journey 1) ──────
// The primary door for protecting a file: every attachment as a row with a checkbox, one duration
// picker (the space default preselected), an optional note, ONE primary button, and the same
// upload dropzone the panel has (4 MB, `upload-artifact`) so "protect a file" is one door.
// Already-sealed rows show their lozenge and are not selectable; the owner's Extend / Release
// sit under ⋯ (the same row rules as the Overview). Every write is gated server-side: seal-artifact
// checks canEditPage on the attachment, upload-artifact runs as the user.

const SIZE_LIMIT = 4 * 1024 * 1024; // mirrors shared/upload-limits.js MAX_UPLOAD_BYTES (raw bytes)
const encodeFileBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(",")[1]);
  reader.onerror = () => reject(new Error("Could not process file"));
  reader.readAsDataURL(file);
});
const DAY = 86400;
const DURATIONS = [
  { label: "1 day", seconds: DAY }, { label: "3 days", seconds: 3 * DAY }, { label: "1 week", seconds: 7 * DAY },
  { label: "2 weeks", seconds: 14 * DAY }, { label: "30 days", seconds: 30 * DAY }, { label: "90 days", seconds: 90 * DAY }, { label: "1 year", seconds: 365 * DAY },
];
const humanSeconds = (s) => {
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n % DAY === 0) { const d = n / DAY; return d === 1 ? "1 day" : d % 7 === 0 && d >= 14 ? `${d / 7} weeks` : `${d} days`; }
  const h = Math.round(n / 3600);
  return h <= 1 ? "1 hour" : `${h} hours`;
};
const fileSize = (b) => (b == null ? "" : b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`);

const DurationPicker = ({ value, defaultSeconds, onChange, disabled }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", key); };
  }, [open]);
  const defLabel = `Space default${defaultSeconds ? ` (${humanSeconds(defaultSeconds)})` : ""}`;
  const options = [{ label: defLabel, seconds: null }, ...DURATIONS];
  const current = options.find((o) => o.seconds === value) || options[0];
  return (
    <div className="pd-dd-wrap" ref={ref}>
      <button type="button" className="pd-dd" onClick={() => setOpen((o) => !o)} disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-label="How long the seal holds" data-testid="pd-duration">
        <span className="pd-dd-cur">{current.label}</span><span className="pd-dd-arrow" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="pd-dd-menu" role="listbox" aria-label="Seal duration">
          {options.map((o) => (
            <div key={String(o.seconds)} role="option" aria-selected={o.seconds === value} tabIndex={0} className={`pd-dd-opt pd-dd-opt-plain ${o.seconds === value ? "sel" : ""}`} data-testid={`pd-duration-${o.seconds == null ? "default" : o.seconds}`}
              onClick={() => { setOpen(false); onChange(o.seconds); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(false); onChange(o.seconds); } }}>
              <span className="pd-dd-name">{o.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const UploadZone = ({ onUploaded, emptyCopy }) => {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState(null);
  const processFile = async (file) => {
    setError(null);
    if (!file) return;
    if (file.size > SIZE_LIMIT) { setError(`This file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 4 MB.`); return; }
    setUploading(true);
    try {
      const r = await invoke("upload-artifact", { fileName: file.name, fileDataBase64: await encodeFileBase64(file) });
      if (r?.success) await onUploaded(); else setError(r?.reason || "The upload did not go through.");
    } catch (_) { setError("The upload did not go through. The file may be over the 4 MB limit."); }
    finally { setUploading(false); }
  };
  return (
    <div className={`pd-drop ${dragOver ? "over" : ""} ${uploading ? "busy" : ""}`} data-testid="pd-dropzone"
      onDrop={(e) => { e.preventDefault(); setDragOver(false); processFile(e.dataTransfer.files?.[0]); }}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}>
      {uploading ? <span className="pd-drop-text">Uploading…</span> : (
        <>
          <span className="pd-drop-text">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
            {" "}{emptyCopy || "Drop a file here or"}{" "}
            <label className="pd-drop-link">click to select<input type="file" style={{ display: "none" }} data-testid="pd-file-input" onChange={(e) => { processFile(e.target.files?.[0]); e.target.value = ""; }} /></label>
          </span>
          <span className="pd-drop-hint">Up to 4 MB · the file is attached to this page; seal it afterwards</span>
        </>
      )}
      {error && <div className="pd-error" role="alert">{error}</div>}
    </div>
  );
};

/**
 * The seal action's body. `summary` is page-details-summary (attachments + seals + sealDefaults);
 * `reload` refetches it after any write (the seal path already refreshes the byline).
 */
const SealActionSeam = ({ summary, reload, siteUrl, loadError, onRetry }) => {
  const [selected, setSelected] = useState(() => new Set());
  const [duration, setDuration] = useState(null); // null = space default
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { sealed: n, failed: [{name, reason}] }
  const attachments = summary?.attachments || [];
  const sealRowById = useMemo(() => new Map((summary?.seals || []).filter((r) => r.kind === "attachment").map((r) => [r.id, r])), [summary]);
  const selectable = attachments.filter((a) => !a.sealed);
  const allOn = selectable.length > 0 && selectable.every((a) => selected.has(a.id));
  const toggle = (id) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSelected(allOn ? new Set() : new Set(selectable.map((a) => a.id)));
  const n = [...selected].filter((id) => selectable.some((a) => a.id === id)).length;

  const seal = async () => {
    const ids = selectable.filter((a) => selected.has(a.id));
    if (!ids.length) return;
    setBusy(true); setResult(null);
    const failed = [];
    let sealed = 0;
    for (const a of ids) {
      try {
        const payload = { attachmentId: a.id };
        if (duration) payload.lockDuration = duration;
        if (note.trim()) payload.note = note.trim();
        const r = await invoke("seal-artifact", payload);
        if (r?.success) sealed += 1; else failed.push({ name: a.name, reason: r?.reason || "refused" });
      } catch (_) { failed.push({ name: a.name, reason: "did not go through" }); }
    }
    setSelected(new Set()); setNote("");
    setResult({ sealed, failed });
    await reload();
    setBusy(false);
  };

  if (loadError) {
    return (
      <div className="pd-seal" data-testid="pd-seal-action">
        <div className="pd-fail" role="alert" data-testid="pd-seal-error"><span>Sentinel Vault could not load the attachments on this page.</span><button type="button" className="pd-btn quiet" onClick={onRetry}>Retry</button></div>
      </div>
    );
  }
  if (!summary) {
    return (
      <div className="pd-seal" data-testid="pd-seal-action" aria-busy="true">
        <ul className="pd-list pd-skel" aria-hidden="true">{[0, 1, 2].map((i) => <li key={i} className="pd-row"><div className="pd-row-main"><span className="pd-skel-box" /><div className="pd-t"><span className="pd-skel-bar" style={{ width: `${55 + i * 12}%` }} /><span className="pd-skel-bar short" /></div></div></li>)}</ul>
      </div>
    );
  }
  return (
    <div className="pd-seal" data-testid="pd-seal-action">
      {summary.sealError && <p className="pd-error" role="alert">{summary.sealError}</p>}
      {attachments.length === 0 ? (
        <p className="pd-empty" data-testid="pd-seal-empty">No attachments on this page yet — drop a file here.</p>
      ) : (
        <>
          <div className="pd-seal-bar">
            <label className="pd-check pd-check-all"><input type="checkbox" checked={allOn} disabled={busy || selectable.length === 0} onChange={toggleAll} aria-label="Select every attachment that can be sealed" data-testid="pd-select-all" /><span>{selectable.length === 0 ? "Everything here is already sealed" : `Select all (${selectable.length})`}</span></label>
          </div>
          <ul className="pd-list" data-testid="pd-attachment-list">
            {attachments.map((a) => {
              const row = a.sealed ? sealRowById.get(a.id) : null;
              const loz = !row ? null : row.isExpired ? { cls: "expired", text: "Expired" } : row.isMine ? { cls: "mine", text: "Sealed · yours" } : { cls: "locked", text: `Sealed · ${row.ownerName || "another user"}` };
              return (
                <li key={a.id} className={`pd-row ${a.sealed ? "is-sealed" : ""}`} data-testid="pd-attachment-row" data-id={a.id} data-sealed={a.sealed ? "1" : "0"}>
                  <div className="pd-row-main pd-row-check">
                    <label className="pd-check"><input type="checkbox" checked={selected.has(a.id)} disabled={busy || a.sealed} onChange={() => toggle(a.id)} aria-label={`Select ${a.name}`} data-testid="pd-attachment-check" /></label>
                    <span className="pd-ic file" aria-hidden="true">F</span>
                    <div className="pd-t">
                      <div className="pd-n" title={a.name}>{a.name}</div>
                      <div className="pd-m">{[fileSize(a.fileSize), a.mediaType, a.version ? `v${a.version}` : null].filter(Boolean).join(" · ")}{row ? ` · ${row.isExpired ? `expired ${when(row.expiresAt)}` : row.expiresAt ? `until ${when(row.expiresAt)}` : "no expiry"}${row.note ? ` · “${row.note}”` : ""}` : ""}</div>
                    </div>
                    <div className="pd-a">
                      {loz && <span className={`pd-loz ${loz.cls}`} data-testid="pd-lozenge">{loz.text}</span>}
                      {/* One state, one action: the owner's Release (or a viewer's Request edit) is the
                          PRIMARY here exactly as on the Overview rows; ⋯ holds the rest. */}
                      {row && (() => {
                        const primary = primaryActionFor(row, summary.viewer);
                        if (!primary || primary.kind === "seal") return null;
                        if (primary.kind === "release") return <button type="button" className="pd-btn quiet" data-testid="pd-primary" data-action="release" onClick={() => invoke("unseal-artifact", { attachmentId: row.id }).then(reload)}>Release</button>;
                        return <span className="pd-state" data-testid="pd-primary" data-action={primary.kind}>{primary.label}</span>;
                      })()}
                      {row && <Kebab items={menuActionsFor(row, summary.viewer)} onPick={(id) => {
                        if (id === "extend") invoke("extend-seal", { attachmentId: row.id }).then(reload);
                        else if (id === "release") invoke("unseal-artifact", { attachmentId: row.id }).then(reload);
                        else if (id === "watch") invoke("watch-artifact", { attachmentId: row.id }).then(reload);
                        else if (id === "unwatch") invoke("unwatch-artifact", { attachmentId: row.id }).then(reload);
                        else if (id === "copy-link") navigator.clipboard?.writeText(`${siteUrl || ""}/wiki${row.link || `/pages/viewpage.action?pageId=${summary.pageId}`}`).catch(() => {});
                      }} name={a.name} />}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="pd-seal-form">
            <div className="pd-seal-field"><span className="pd-seal-label">Seal holds for</span><DurationPicker value={duration} defaultSeconds={summary.sealDefaults?.holdSeconds} onChange={setDuration} disabled={busy} /></div>
            <div className="pd-seal-field grow"><span className="pd-seal-label">Note (optional)</span><input className="pd-input" value={note} maxLength={300} placeholder="Why these are sealed — shown with the seal" onChange={(e) => setNote(e.target.value)} disabled={busy} data-testid="pd-note" /></div>
            <button type="button" className="pd-btn primary pd-seal-go" disabled={busy || n === 0} onClick={seal} data-testid="pd-seal-go">{busy ? "Sealing…" : n === 1 ? "Seal 1 attachment" : `Seal ${n} attachments`}</button>
          </div>
          {result && (
            <div className={`pd-result ${result.failed.length ? "warn" : "ok"}`} role="status" data-testid="pd-seal-result">
              {result.sealed > 0 && <span>{result.sealed === 1 ? "1 attachment sealed." : `${result.sealed} attachments sealed.`}</span>}
              {result.failed.map((f) => <span key={f.name}> {f.name}: {f.reason}.</span>)}
            </div>
          )}
        </>
      )}
      <UploadZone onUploaded={reload} emptyCopy={attachments.length === 0 ? "Drop a file here or" : undefined} />
    </div>
  );
};

const AttachmentsTab = ({ mode, summary, reload, siteUrl, loadError, onRetry }) => (
  mode === "seal"
    ? <SealActionSeam summary={summary} reload={reload} siteUrl={siteUrl} loadError={loadError} onRetry={onRetry} />
    : (
      <div className="pd-attachments" data-testid="pd-attachments">
        <p className="pd-desc">Every attachment on this page — sealed or not — with seal, release, extend, watch and edit-request controls, labels, previews and the trash.</p>
        <button type="button" className="pd-btn primary" onClick={() => openAttachmentsOverlay(reload)} data-testid="pd-open-overlay">Open the full attachments view</button>
      </div>
    )
);

// ── Activity tab: the full feed with category chips (client-side filter over loaded rows) ────
const ActivityTab = ({ pageId }) => {
  const [entries, setEntries] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [state, setState] = useState("loading");
  const [on, setOn] = useState(() => new Set(ACTIVITY_CATEGORIES.map((c) => c.id)));
  const fetchPage = useCallback(async (c) => {
    const payload = { pageId, limit: 50 };
    if (c) payload.cursor = c;
    const r = await invoke("get-page-activity", payload);
    return { entries: Array.isArray(r?.entries) ? r.entries : [], nextCursor: r?.nextCursor || null };
  }, [pageId]);
  useEffect(() => {
    let dead = false;
    fetchPage(null).then((r) => { if (!dead) { setEntries(r.entries); setCursor(r.nextCursor); setState("ready"); } }).catch(() => { if (!dead) setState("error"); });
    return () => { dead = true; };
  }, [fetchPage]);
  const more = async () => {
    if (!cursor) return;
    setState("more");
    try { const r = await fetchPage(cursor); setEntries((p) => [...p, ...r.entries]); setCursor(r.nextCursor); setState("ready"); }
    catch (_) { setState("error"); }
  };
  const toggle = (id) => setOn((prev) => {
    const n = new Set(prev);
    if (n.has(id)) { if (n.size === 1) return prev; n.delete(id); } else n.add(id);
    return n;
  });
  const shown = entries.filter((e) => on.has(categoryOf(e?.type)));
  return (
    <div className="pd-activity" data-testid="pd-activity-tab">
      <div className="sv-activity-chips" role="group" aria-label="Categories">
        {ACTIVITY_CATEGORIES.map((c) => (
          <button key={c.id} type="button" className={`sv-activity-chip-btn sv-activity-chip-${c.id} ${on.has(c.id) ? "is-active" : ""}`} aria-pressed={on.has(c.id)} onClick={() => toggle(c.id)} data-testid={`pd-chip-${c.id}`}>{c.label}</button>
        ))}
      </div>
      {state === "loading" && <p className="pd-empty">Loading activity…</p>}
      {state === "error" && <p className="pd-error" role="alert">Couldn’t load activity right now. Close and reopen to try again.</p>}
      {state !== "loading" && shown.length === 0 && state !== "error" && <p className="pd-empty">{entries.length === 0 ? "No activity recorded yet on this page." : "Nothing in the selected categories."}</p>}
      {shown.length > 0 && <ul className="sv-activity-list">{shown.map((e, i) => <ActivityRow key={e.id || `${e.ts}-${i}`} entry={e} />)}</ul>}
      {cursor && state !== "loading" && <div className="sv-activity-footer"><button type="button" className="sv-activity-more" disabled={state === "more"} onClick={more}>{state === "more" ? "Loading…" : "Show more"}</button></div>}
    </div>
  );
};

// ── the modal ────────────────────────────────────────────────────────────────────────────────
export const PageDetails = ({ mode = "details", ctx }) => {
  const pageId = ctx?.extension?.content?.id || ctx?.contentId || null;
  const siteUrl = ctx?.siteUrl || "";
  const [tab, setTab] = useState(mode === "seal" ? "attachments" : "overview");
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [activityKey, setActivityKey] = useState(0);
  const load = useCallback(async () => {
    if (!pageId) { setError("Sentinel Vault could not tell which page this is."); return; }
    try {
      const r = await invoke("page-details-summary", { pageId });
      if (!r?.ok) { setError(r?.reason === "Not authorized" ? "You do not have access to this page." : (r?.reason || "Could not load this page.")); return; }
      setSummary(r); setError(null); setActivityKey((k) => k + 1);
    } catch (_) { setError("Could not load this page."); }
  }, [pageId]);
  useEffect(() => { enablePaletteSync().catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const key = (e) => { if (e.key === "Escape" && !document.querySelector(".pd-menu, .pd-dd-menu, .pd-reason")) view.close().catch(() => {}); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  const close = () => view.close().catch(() => {});
  const sealed = useMemo(() => (summary?.seals || []).some((s) => !s.isTrashed), [summary]);
  const tabs = [["overview", "Overview"], ["attachments", "Attachments"], ["activity", "Activity"]];
  return (
    <div className="pd-modal" data-testid="pd-modal" data-mode={mode} data-ready={summary ? "1" : "0"}>
      <div className="pd-head">
        <h3 data-testid="pd-title">{mode === "seal" ? `Seal attachments${summary?.title ? ` · ${summary.title}` : ""}` : (summary?.title || (error ? "Sentinel Vault" : "Loading…"))}</h3>
        {summary?.waitingOnMe > 0 && <span className="pd-waiting" data-testid="pd-waiting">{summary.waitingOnMe} waiting for you</span>}
        <button type="button" className="pd-dismiss" aria-label="Close" onClick={close} data-testid="pd-close">×</button>
      </div>
      <div className="pd-tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`pd-tab ${tab === id ? "on" : ""}`} onClick={() => setTab(id)} data-testid={`pd-tab-${id}`}>{label}</button>
        ))}
      </div>
      <div className="pd-body">
        {error && !(mode === "seal" && tab === "attachments") && <p className="pd-error pd-error-block" role="alert" data-testid="pd-error">{error}</p>}
        {!error && !summary && !(mode === "seal" && tab === "attachments") && <p className="pd-empty">Loading…</p>}
        {summary && tab === "overview" && (
          <>
            <ClassificationBlock c={summary.classification} sealed={sealed} pageId={summary.pageId} onChanged={load} />
            <SealsBlock summary={summary} onChanged={load} siteUrl={siteUrl} />
            <section className="pd-sec" data-testid="pd-recent">
              <h4>Recent activity</h4>
              <div className="pd-trail"><ActivityFeed pageId={summary.pageId} pageSize={5} compact reloadKey={activityKey} /></div>
            </section>
          </>
        )}
        {(summary || mode === "seal") && tab === "attachments" && <AttachmentsTab mode={mode} summary={summary} reload={load} siteUrl={siteUrl} loadError={error} onRetry={load} />}
        {summary && tab === "activity" && <ActivityTab pageId={summary.pageId} />}
      </div>
      <div className="pd-foot">
        <span>One primary action per row; everything else under ⋯ (Extend, Watch, Copy link, Force release — space admins, reason required).</span>
        <button type="button" className="pd-btn quiet" onClick={(e) => { e.preventDefault(); router.navigate(MY_WORK_PATH); }} data-testid="pd-open-my-work">Open My work</button>
      </div>
    </div>
  );
};

/**
 * SEAM: which module opened this resource. The byline item renders the details modal; the content
 * action (`sentinel-vault-seal-action`) renders it in mode "seal" (the other agent's entry point).
 */
export function renderForModule(moduleKey, ctx) {
  const key = String(moduleKey || "");
  const type = String(ctx?.extension?.type || "");
  const isSealAction = key.includes("seal-action") || type.includes("contentAction");
  return <PageDetails mode={isSealAction ? "seal" : "details"} ctx={ctx} />;
}

const Root = () => {
  const [ctx, setCtx] = useState(null);
  useEffect(() => { view.getContext().then(setCtx).catch(() => setCtx({})); }, []);
  if (!ctx) return <div className="pd-modal"><div className="pd-body"><p className="pd-empty">Loading…</p></div></div>;
  return renderForModule(ctx.moduleKey || ctx.extension?.moduleKey || ctx.extension?.type, ctx);
};

createRoot(document.getElementById("root")).render(<Root />);
