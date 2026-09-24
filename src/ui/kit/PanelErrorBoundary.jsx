import React from "react";

/**
 * A crash while drawing must never leave a blank space (2026-09-24: user B saw NOTHING where the
 * panel sits in view mode — a render error unmounts the whole tree and the frame collapses).
 * Shows what failed, so the person can report it, and logs it to the console.
 */
export default class PanelErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[SENTINEL-VAULT] panel crashed while drawing:", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const message = String(this.state.error?.message || this.state.error);
    return (
      <div className="sv-panel-container" role="alert" data-testid="sv-panel-crash">
        <div className="sv-panel-header">
          <span className="sv-panel-header-title">Sentinel Vault</span>
        </div>
        <div className="sv-panel-error">
          This panel could not be displayed. Reload the page; if it happens again, send this to your admin:
          <code className="sv-panel-crash-detail">{message}</code>
        </div>
      </div>
    );
  }
}
