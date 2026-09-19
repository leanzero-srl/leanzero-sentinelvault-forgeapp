import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { view, invoke, router } from "@forge/bridge";
import { enablePaletteSync } from "../../kit/palette-sync";

// Sentinel Vault "Sealed Section" bodied macro.
// One resource serves both the macro VIEW (renders the protected body with a
// sealed header) and the CONFIG panel (shown on insert). Sealing itself is
// driven server-side from the Sentinel Vault panel's "Sealed Sections" group;
// this surface renders the wrapper and explains it.

const ShieldGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const LockGlyph = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
const CheckGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M5 12l4 4 10-10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// The renderer iframe (view.createAdfRendererIframeProps) is Atlassian's ADF renderer; the
// bridge posts the body to it only after it sends this message (10 s blind fallback). We
// watch for the same message so the iframe is only put in flow once it has actually answered.
const RENDERER_READY = "forge-adf-renderer-ready";
// How long one attempt may take to show real content before the frame is remounted (once), and
// then given up on with a plain message + Reload.
const RENDERER_WAIT_MS = 8_000;
const RENDERER_ATTEMPTS = 2;
// The body counts as rendered once the resizer has given the frame a real height.
const RENDERED_MIN_PX = 20;

const isRendererReady = (data) => {
  if (!data) return false;
  if (typeof data === "string") return data.includes(RENDERER_READY);
  try { return JSON.stringify(data).includes(RENDERER_READY); } catch (_) { return false; }
};

// The app writes the section id into attrs.parameters.guestParams.sectionId (doc-surgery
// buildSealedSectionNode); the macro context exposes it under one of these — both handled.
const readSectionId = (ext) =>
  ext?.config?.sectionId ||
  ext?.config?.guestParams?.sectionId ||
  ext?.macro?.params?.sectionId ||
  ext?.macro?.params?.guestParams?.sectionId ||
  null;

const fmtUntil = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return ` until ${d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}`;
};

// Test seam: a harness can stub the status the surface would have fetched (only one real
// browser identity exists, so the non-owner branch cannot be reached live).
const readStubbedStatus = () => {
  try { const s = window.__svSectionStatusStub; return s && typeof s === "object" ? s : null; } catch (_) { return null; }
};

const fetchSealStatus = async (sectionId) => {
  const stub = readStubbedStatus();
  if (stub) return stub;
  if (!sectionId) return { sealed: false };
  try {
    const r = await invoke("section-seal-status", { sectionId });
    return r && typeof r === "object" ? r : { sealed: false };
  } catch (e) {
    console.warn("[SECTION-UI] section-seal-status failed:", e?.message);
    return { sealed: false };
  }
};

const SectionMacro = () => {
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState("view"); // "view" | "config"
  const [bodyProps, setBodyProps] = useState(null);
  const [rendererReady, setRendererReady] = useState(false); // the body has real height on screen
  const [rendererTimedOut, setRendererTimedOut] = useState(false);
  const [attempt, setAttempt] = useState(1); // remount key for the renderer frame
  const ctxRef = useRef(null); // the macro context, for the document message we send ourselves
  const frameRef = useRef(null);
  const [status, setStatus] = useState(null);
  const [editing, setEditing] = useState(false);
  const [seal, setSeal] = useState(null); // section-seal-status result (editor only)
  const [existingConfig, setExistingConfig] = useState(null); // config already on the node (edit dialog)
  const [contextSectionId, setContextSectionId] = useState(null); // the id the macro context carries, if any
  const [undone, setUndone] = useState(null); // { mine, revertedVersion, pageId } — THIS section was just put back

  useEffect(() => {
    (async () => {
      try { await enablePaletteSync(); } catch (_) { /* non-critical */ }
      try {
        const context = await view.getContext();
        ctxRef.current = context;
        const ext = context?.extension || {};
        const hasBody = !!ext.macro?.body;

        const isEditing = !!ext.isEditing;
        setEditing(isEditing);
        const sectionId = readSectionId(ext);
        setContextSectionId(sectionId);
        // Logged once so the context shape is visible in the console when it matters.
        console.info("[SECTION-UI] context", { isEditing, sectionId, configKeys: Object.keys(ext.config || {}), paramKeys: Object.keys(ext.macro?.params || {}) });

        if (ext.config && typeof ext.config === "object") setExistingConfig(ext.config);
        // In the editor a BODIED macro is rendered natively by ProseMirror (title chrome +
        // editable body) — the app iframe is never mounted there (platform fact, confirmed
        // 2026-09-14). The only app surface the editor shows is this CONFIG dialog (insert, or
        // the node's Edit button), so an editing context IS the dialog, body or not: it gets the
        // config chrome (Done / Insert + Cancel), never the read-only view frame (P1-6).
        setMode(isEditing || !hasBody ? "config" : "view");
        // The seal status drives the lock banner in the dialog AND the badge in view mode —
        // "Sealed by …" is only claimed when the resolver says so (P1-6). One call per render;
        // without a section id the fetch short-circuits to { sealed: false }.
        fetchSealStatus(sectionId).then(setSeal);
        // View mode only: have the server judge the page's live version NOW. The page event that
        // drives the restore can arrive 20+ minutes late (tester report 2026-09-17); the person
        // who just published lands on this view, so the restore happens while they are still
        // here — and if it was THIS section, they are told where their text went.
        if (!isEditing && hasBody && sectionId) {
          invoke("guard-page-now", {}).then((g) => {
            if (g?.restored && Array.isArray(g.sectionIds) && g.sectionIds.includes(sectionId)) {
              setUndone({ mine: g.mine === true, fresh: g.fresh === true, revertedVersion: g.revertedVersion || null, pageId: context?.extension?.content?.id || null });
            }
          }).catch((e) => console.warn("[SECTION-UI] guard-page-now failed:", e?.message));
        }

        // Best-effort: render the protected body inline in view mode (the dialog never shows it).
        if (hasBody && !isEditing && typeof view.createAdfRendererIframeProps === "function") {
          try {
            const props = await view.createAdfRendererIframeProps(context);
            if (props && typeof props === "object") setBodyProps(props);
          } catch (e) {
            console.warn("[SECTION-UI] ADF renderer unavailable:", e?.message);
          }
        }
      } catch (e) {
        console.warn("[SECTION-UI] getContext failed:", e?.message);
      }
      setReady(true);
    })();
  }, []);

  // The body handshake, done HERE (owner report 2026-09-17: "sometimes" the frame showed the badge
  // over an EMPTY body). The bridge attaches its one-shot `forge-adf-renderer-ready` listener
  // inside the iframe's onLoad; when the renderer says ready BEFORE the load event, the bridge
  // never hears it and only posts the document after its 10 s blind fallback — while this surface,
  // listening since mount, had already revealed the frame. So: (1) this listener exists before the
  // frame does and answers EVERY ready from that frame with the document itself (a second copy
  // from the bridge just re-renders the same body); (2) the frame is revealed on real HEIGHT, not
  // on the ready message; (3) no height in time → remount once, then say so plainly with Reload.
  useEffect(() => {
    if (!bodyProps) return undefined;
    const origin = (() => { try { return new URL(document.referrer).origin; } catch (_) { return "*"; } })();
    const send = () => {
      const c = ctxRef.current;
      const win = frameRef.current?.contentWindow;
      if (!c || !win) return;
      win.postMessage({
        type: "adf-document", document: c.extension?.macro?.body, timestamp: Date.now(), source: "forge-adf-renderer",
        localId: c.localId, isEditing: c.extension?.isEditing ?? false, contentId: c.extension?.content?.id,
      }, origin);
    };
    const onMessage = (e) => {
      if (!isRendererReady(e.data)) return;
      if (frameRef.current && e.source && e.source !== frameRef.current.contentWindow) return;
      send();
    };
    window.addEventListener("message", onMessage);

    // Height watch: iframe-resizer writes the measured height onto the frame's inline style.
    let done = false;
    const measure = () => {
      const el = frameRef.current;
      if (done || !el) return;
      const h = Math.max(parseFloat(el.style.height) || 0, 0);
      if (h >= RENDERED_MIN_PX) { done = true; setRendererReady(true); }
    };
    const poll = setInterval(measure, 250);
    // A ready that was posted before this effect ran is gone; nudge the frame once it has loaded.
    const nudge = setTimeout(send, 1500);
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      if (attempt < RENDERER_ATTEMPTS) {
        console.warn(`[SECTION-UI] body not rendered after ${RENDERER_WAIT_MS} ms — remounting the renderer (attempt ${attempt + 1})`);
        setAttempt((a) => a + 1);
      } else {
        console.warn("[SECTION-UI] body renderer gave no content; showing the plain message instead");
        setRendererTimedOut(true);
      }
    }, RENDERER_WAIT_MS);
    return () => { window.removeEventListener("message", onMessage); clearInterval(poll); clearTimeout(nudge); clearTimeout(timer); };
  }, [bodyProps, attempt]);

  const [error, setError] = useState(null);
  const onCancel = () => {
    // The editor owns the dialog; close() dismisses it without touching the node's config.
    try { const r = view.close(); if (r && r.catch) r.catch((e) => console.info("[SECTION-UI] view.close rejected:", e?.message || e)); } catch (e) { console.info("[SECTION-UI] view.close unavailable:", e?.message || e); }
  };
  const onInsert = async () => {
    setError(null);
    try {
      // The editor validates the payload: `config` MUST be an object (it rejected `{}` with
      // 'Invalid "config" provided. Expected object' — 2026-09-14, seen in dev AND prod). An empty
      // config is the whole configuration of a NEW macro: the sectionId is issued server-side
      // when the section is sealed from the panel. On an EXISTING node the config already carries
      // that sectionId and MUST be preserved — submitting `{}` would strip it and orphan the seal.
      const cfg = { ...(existingConfig || {}) };
      if (!cfg.sectionId && contextSectionId) cfg.sectionId = contextSectionId;
      await view.submit({ config: cfg });
      setStatus(cfg.sectionId ? "Saved" : "Inserted");
    } catch (e) {
      console.error("[SECTION-UI] submit failed:", e);
      setStatus("Could not insert");
      setError(e?.message || "The editor refused the insert. Close this dialog and try again.");
    }
  };

  if (!ready) return <div className="sec-frame sec-loading">Loading…</div>;

  // Editor lock banner (req 2.3): locked for a non-owner without a grant; quiet line for
  // the owner or a grantee; nothing when the section is not sealed or the seal has lapsed.
  const sealed = !!(seal?.sealed && !seal.isExpired);
  const canEdit = sealed && (seal.isMine || seal.hasGrant);
  const locked = sealed && !canEdit;
  const lockNotice = locked ? (
    <div className="sec-lock" role="alert">
      <LockGlyph />
      <span>
        Locked by {seal.ownerName || "the seal owner"}{fmtUntil(seal.expiresAt)} — edits you publish here are reverted automatically.
        <span className="sec-lock-hint">Ask to edit from the Sentinel Vault panel.</span>
      </span>
    </div>
  ) : canEdit ? (
    <div className="sec-editable"><CheckGlyph /> You can edit this section</div>
  ) : null;
  const sealState = locked ? "locked" : canEdit ? "editable" : "none";

  if (mode === "config") {
    const existing = !!(existingConfig?.sectionId || contextSectionId);
    return (
      <div className="sec-config" data-editing={editing ? "true" : "false"} data-seal={sealState}>
        <div className="sec-config-head">
          <span className="sec-badge"><ShieldGlyph /> Sentinel Vault</span>
          <h1 className="sec-config-title">Sealed Section</h1>
        </div>
        {lockNotice}
        <p className="sec-config-desc">
          Place the content you want to protect inside this section. To seal it against
          unauthorized edits, open the <strong>Sentinel Vault</strong> panel on this page
          and use <strong>Sealed Sections → Seal a section</strong>. The seal owner (or a
          space admin) can release the seal at any time.
        </p>
        <div className="sec-config-actions">
          <button className="sec-btn" onClick={onInsert} data-testid="sec-submit">{status || (existing ? "Done" : "Insert section")}</button>
          <button type="button" className="sec-btn sec-btn-subtle" onClick={onCancel} data-testid="sec-cancel">Cancel</button>
        </div>
        {error && <p className="sec-config-error" role="alert">{error}</p>}
      </div>
    );
  }

  const showFrame = !!bodyProps && rendererReady;
  const showFallback = !bodyProps || !rendererReady;
  const framePending = !!bodyProps && !rendererReady && !rendererTimedOut;

  // The badge claims exactly what the resolver answered (P1-6): pending until it has, then
  // sealed / expired / unsealed. The frame border follows the same state (brand / amber / grey).
  const viewState = seal === null ? "pending" : seal.sealed && seal.isExpired ? "expired" : seal.sealed ? "sealed" : "unsealed";
  const badgeText = viewState === "pending" ? "Sentinel Vault"
    : viewState === "sealed" ? `Sealed by ${seal.ownerName || "the seal owner"}`
      : viewState === "expired" ? "Expired seal"
        : "Not sealed yet — seal it from the Sentinel Vault panel";
  const fallbackText = viewState === "sealed" ? "This section is sealed. Unauthorized edits are automatically reverted."
    : viewState === "expired" ? "The seal on this section has expired. Edits are no longer reverted; the owner can seal it again from the Sentinel Vault panel."
      : viewState === "unsealed" ? "This section is not sealed yet. Open the Sentinel Vault panel and use Sealed Sections → Seal a section."
        : "Checking the seal…";
  const bodyText = rendererTimedOut
    ? "Sentinel Vault could not display this section's text here — a display problem, not the seal. The text is still on the page; reload to try again."
    : framePending ? "Loading the section…" : fallbackText;

  return (
    <div className="sec-frame" data-editing={editing ? "true" : "false"} data-seal={sealState} data-state={viewState}>
      <div className="sec-frame-head">
        <span className="sec-badge" data-testid="sec-view-badge" data-state={viewState}><ShieldGlyph /> {badgeText}</span>
      </div>
      {editing && lockNotice}
      {undone && (
        <div className="sec-undone" role="alert" data-testid="sec-undone">
          <span className="sec-undone-text">
            {undone.mine
              ? <>Your edit to this section was undone — it is sealed by {seal?.ownerName || "its owner"}. Your text is not lost: it is kept in the page history.</>
              : <>An edit to this sealed section was just undone. Reload to see the sealed content.</>}
          </span>
          <span className="sec-undone-actions">
            {undone.mine && undone.revertedVersion && undone.pageId && (
              <button type="button" className="sec-undone-btn" data-testid="sec-undone-version"
                onClick={() => router.open(`/wiki/pages/viewpage.action?pageId=${undone.pageId}&pageVersion=${undone.revertedVersion}`)}>
                Open my version
              </button>
            )}
            {undone.fresh && <button type="button" className="sec-undone-btn" onClick={() => { try { router.reload(); } catch (_) { /* older bridge */ } }}>Reload the page</button>}
          </span>
          {undone.mine && <span className="sec-undone-hint">To edit it, use Request edit in the Sentinel Vault panel, or ask the owner to give you access.</span>}
        </div>
      )}
      <div className="sec-body">
        {showFallback && (
          <div className="sec-body-fallback" data-testid="sec-body-fallback" data-timedout={rendererTimedOut ? "true" : "false"}>
            {bodyProps ? bodyText : fallbackText}
            {rendererTimedOut && <button type="button" className="sec-undone-btn sec-body-reload" onClick={() => { try { router.reload(); } catch (_) { /* older bridge */ } }}>Reload the page</button>}
          </div>
        )}
        {bodyProps && !rendererTimedOut && (
          <iframe
            key={attempt}
            {...bodyProps}
            ref={frameRef}
            title="Sealed section content"
            className={`sec-body-frame${framePending ? " sec-body-frame--pending" : ""}`}
            data-ready={showFrame ? "true" : "false"}
          />
        )}
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById("root"));
root.render(<SectionMacro />);
