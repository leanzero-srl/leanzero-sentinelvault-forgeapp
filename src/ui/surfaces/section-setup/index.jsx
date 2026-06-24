import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { view } from "@forge/bridge";
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

const SectionMacro = () => {
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState("view"); // "view" | "config"
  const [bodyProps, setBodyProps] = useState(null);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    (async () => {
      try { await enablePaletteSync(); } catch (_) { /* non-critical */ }
      try {
        const context = await view.getContext();
        const hasBody = !!context?.extension?.macro?.body;
        // The config panel opens on insert before a body exists.
        setMode(hasBody ? "view" : "config");

        // Best-effort: render the protected body inline in view mode.
        if (hasBody && typeof view.createAdfRendererIframeProps === "function") {
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

  const onInsert = async () => {
    try {
      await view.submit({});
      setStatus("Inserted");
    } catch (e) {
      console.error("[SECTION-UI] submit failed:", e);
      setStatus("Could not insert");
    }
  };

  if (!ready) return <div className="sec-frame sec-loading">Loading…</div>;

  if (mode === "config") {
    return (
      <div className="sec-config">
        <div className="sec-config-head">
          <span className="sec-badge"><ShieldGlyph /> Sentinel Vault</span>
          <h1 className="sec-config-title">Sealed Section</h1>
        </div>
        <p className="sec-config-desc">
          Place the content you want to protect inside this section. To seal it against
          unauthorized edits, open the <strong>Sentinel Vault</strong> panel on this page
          and use <strong>Sealed Sections → Seal a section</strong>. The seal owner (or a
          steward) can release it at any time.
        </p>
        <button className="sec-btn" onClick={onInsert}>{status || "Insert section"}</button>
      </div>
    );
  }

  return (
    <div className="sec-frame">
      <div className="sec-frame-head">
        <span className="sec-badge"><ShieldGlyph /> Sealed by Sentinel Vault</span>
      </div>
      {bodyProps ? (
        <iframe title="Sealed section content" className="sec-body-frame" {...bodyProps} />
      ) : (
        <div className="sec-body-fallback">
          This section is protected. Unauthorized edits are automatically reverted.
        </div>
      )}
    </div>
  );
};

const root = createRoot(document.getElementById("root"));
root.render(<SectionMacro />);
