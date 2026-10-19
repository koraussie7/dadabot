/**
 * InboxPanel.tsx — DadaBot Inbox UI for Tauri mobile app.
 *
 * Connects to the Rust-side `dadabot_*` Tauri commands which invoke the
 * `dadabot` CLI subprocess. Renders ChangeRequests with approve/reject
 * actions (P3-D mobile bridge).
 */
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface ChangeRequest {
  id: string;
  title: string;
  rationale?: string;
  status:
    | "draft"
    | "open"
    | "approved"
    | "rejected"
    | "merged"
    | "expired"
    | "superseded";
  permission?: string;
  confidence?: number;
  agent?: { name: string; modelId: string };
}

interface Props {
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
}

export function InboxPanel({ onApprove, onReject }: Props) {
  const [crs, setCrs] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("open");

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const json = await invoke<string>("dadabot_list", { status });
      const parsed = JSON.parse(json);
      setCrs(Array.isArray(parsed) ? parsed : []);
    } catch (e) {
      setError(String(e));
      setCrs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [status]);

  const handleApprove = async (id: string) => {
    try {
      await invoke("dadabot_approve", { id, comment: "approved via mobile" });
      onApprove?.(id);
      await refresh();
    } catch (e) {
      setError(`approve failed: ${e}`);
    }
  };

  const handleReject = async (id: string) => {
    try {
      await invoke("dadabot_reject", { id, comment: "rejected via mobile" });
      onReject?.(id);
      await refresh();
    } catch (e) {
      setError(`reject failed: ${e}`);
    }
  };

  return (
    <section
      style={{
        marginTop: "1.5rem",
        padding: "1rem",
        background: "#0f172a",
        borderRadius: "12px",
        color: "#e2e8f0",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "1.25rem" }}>📥 DadaBot Inbox</h2>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            style={{
              padding: "0.25rem 0.5rem",
              borderRadius: "6px",
              border: "1px solid #334155",
              background: "#1e293b",
              color: "#e2e8f0",
            }}
          >
            <option value="open">Open</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="merged">Merged</option>
            <option value="expired">Expired</option>
          </select>
          <button
            onClick={refresh}
            disabled={loading}
            style={{
              padding: "0.25rem 0.75rem",
              borderRadius: "6px",
              border: "none",
              background: loading ? "#475569" : "#3b82f6",
              color: "#fff",
              cursor: loading ? "wait" : "pointer",
            }}
          >
            {loading ? "..." : "↻"}
          </button>
        </div>
      </header>

      {error && (
        <div
          style={{
            marginTop: "0.75rem",
            padding: "0.5rem",
            background: "#7f1d1d",
            borderRadius: "6px",
            fontSize: "0.875rem",
          }}
        >
          ⚠ {error}
        </div>
      )}

      <div style={{ marginTop: "0.75rem" }}>
        {crs.length === 0 && !loading && !error && (
          <p style={{ color: "#94a3b8", textAlign: "center", padding: "1rem" }}>
            No ChangeRequests in this status.
          </p>
        )}
        {crs.map((cr) => (
          <article
            key={cr.id}
            style={{
              padding: "0.75rem",
              marginTop: "0.5rem",
              background: "#1e293b",
              borderRadius: "8px",
              borderLeft: `4px solid ${
                cr.status === "open"
                  ? "#f59e0b"
                  : cr.status === "approved"
                    ? "#22c55e"
                    : cr.status === "rejected"
                      ? "#ef4444"
                      : "#64748b"
              }`,
            }}
          >
            <h3 style={{ margin: 0, fontSize: "1rem" }}>{cr.title}</h3>
            <div
              style={{
                fontSize: "0.75rem",
                color: "#94a3b8",
                marginTop: "0.25rem",
                display: "flex",
                gap: "0.75rem",
                flexWrap: "wrap",
              }}
            >
              <span>id: {cr.id.slice(0, 8)}</span>
              {cr.permission && <span>perm: {cr.permission}</span>}
              {cr.confidence !== undefined && (
                <span>conf: {(cr.confidence * 100).toFixed(0)}%</span>
              )}
              {cr.agent && <span>by: {cr.agent.name}</span>}
            </div>
            {cr.rationale && (
              <p
                style={{
                  marginTop: "0.5rem",
                  marginBottom: 0,
                  fontSize: "0.875rem",
                  color: "#cbd5e1",
                }}
              >
                {cr.rationale}
              </p>
            )}
            {cr.status === "open" && (
              <div
                style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem" }}
              >
                <button
                  onClick={() => handleApprove(cr.id)}
                  style={{
                    padding: "0.4rem 0.75rem",
                    borderRadius: "6px",
                    border: "none",
                    background: "#22c55e",
                    color: "#fff",
                    fontSize: "0.875rem",
                  }}
                >
                  ✓ Approve
                </button>
                <button
                  onClick={() => handleReject(cr.id)}
                  style={{
                    padding: "0.4rem 0.75rem",
                    borderRadius: "6px",
                    border: "none",
                    background: "#ef4444",
                    color: "#fff",
                    fontSize: "0.875rem",
                  }}
                >
                  ✗ Reject
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
