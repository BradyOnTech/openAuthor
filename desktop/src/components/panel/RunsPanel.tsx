import { useWorkspace } from "../../contexts/WorkspaceContext";

export function RunsPanel() {
  const { runs } = useWorkspace();

  if (runs.length === 0) {
    return (
      <div style={{ padding: "var(--space-4)", color: "var(--text-tertiary)", fontSize: "var(--text-sm)" }}>
        No generation runs yet. Generate a proposal to see runs here.
      </div>
    );
  }

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th style={{ width: 32 }}>St</th>
          <th>Run ID</th>
          <th>Scene</th>
          <th>Provider</th>
          <th>Quality</th>
          <th>Cost</th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody>
        {runs.slice(0, 50).map((r) => (
          <tr key={r.run_id}>
            <td>
              <span style={{ color: r.status === "succeeded" ? "var(--success)" : "var(--danger)" }}>
                {r.status === "succeeded" ? "\u2713" : "\u2717"}
              </span>
            </td>
            <td className="mono">{r.run_id.slice(0, 8)}</td>
            <td className="mono">{r.scene_id}</td>
            <td>{r.provider}</td>
            <td>
              {r.quality_tier ? (
                <span className={`badge badge--${r.quality_tier === "high" ? "applied" : r.quality_tier === "low" ? "error" : "warning"}`}>
                  {r.quality_tier}
                </span>
              ) : "\u2014"}
            </td>
            <td className="mono">
              {r.estimated_cost_usd != null ? `$${r.estimated_cost_usd.toFixed(4)}` : "\u2014"}
            </td>
            <td className="mono">
              {r.latency_ms != null ? `${(r.latency_ms / 1000).toFixed(1)}s` : "\u2014"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
