import React, { useEffect, useState } from "react";
import { invoke } from "@forge/bridge";

const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

function toCsv(pages) {
  const header = ["Page ID", "Title", "State", "Entered", "Review due", "Overdue"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = pages.map((p) => [p.pageId, p.title, p.stateName, p.enteredAt || "", p.reviewDueAt || "", p.overdue ? "yes" : ""]);
  return [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
}

// #48: read-only workflow dashboard for a space — state distribution + recent pages + CSV.
export function WorkflowDashboard({ spaceKey }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    invoke("get-workflow-dashboard", { spaceKey })
      .then((r) => { if (alive) { setData(r); setLoading(false); } })
      .catch(() => { if (alive) { setData({ error: true }); setLoading(false); } });
    return () => { alive = false; };
  }, [spaceKey]);

  if (loading) return <div className="wf-dash-loading">Loading workflow status…</div>;
  if (!data || data.error || data.total === 0) return null; // nothing to report

  const colorOf = Object.fromEntries((data.states || []).map((s) => [s.id, s.color || "neutral"]));
  const download = () => {
    const blob = new Blob([toCsv(data.pages)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workflow-${spaceKey || "space"}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="wf-dash">
      <div className="wf-dash-head">
        <div>
          <h3 className="wf-dash-title">Workflow status</h3>
          <p className="wf-dash-sub">{data.total} page{data.total === 1 ? "" : "s"} under workflow in this space.</p>
        </div>
        <button type="button" className="wf-dash-export" onClick={download}>Export CSV</button>
      </div>

      <div className="wf-dash-stats">
        {data.states.map((s) => (
          <div key={s.id} className={`wf-dash-stat wf-state-${s.color || "neutral"}`}>
            <span className="wf-dash-stat-count">{s.count}</span>
            <span className="wf-dash-stat-label">{s.name}</span>
          </div>
        ))}
        {data.overdue > 0 && (
          <div className="wf-dash-stat wf-dash-stat-overdue">
            <span className="wf-dash-stat-count">{data.overdue}</span>
            <span className="wf-dash-stat-label">Review overdue</span>
          </div>
        )}
      </div>

      <div className="wf-dash-table-wrap">
        <table className="wf-dash-table">
          <thead>
            <tr><th>Page</th><th>State</th><th>Entered</th><th>Review due</th></tr>
          </thead>
          <tbody>
            {data.pages.map((p) => (
              <tr key={p.pageId}>
                <td className="wf-dash-page">
                  {p.url ? <a href={p.url} target="_blank" rel="noreferrer">{p.title}</a> : p.title}
                </td>
                <td><span className={`wf-state-chip wf-state-${colorOf[p.stateId] || "neutral"}`}>{p.stateName}</span></td>
                <td>{fmtDate(p.enteredAt)}</td>
                <td className={p.overdue ? "wf-dash-overdue" : ""}>
                  {p.reviewDueAt ? (p.overdue ? `${fmtDate(p.reviewDueAt)} · overdue` : fmtDate(p.reviewDueAt)) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.truncated && (
        <p className="wf-dash-note">Showing the {data.listCap} most recently updated pages. The counts above cover all {data.total}.</p>
      )}
    </div>
  );
}
