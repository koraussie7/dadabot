/**
 * InboxPage.tsx — Human review queue.
 *
 * Source: busabase-adapter's createInbox() + applyDecision()
 *
 * Shows pending ChangeRequests with risk classification (critical/high/medium/low)
 * from policy.categorizeRisk(), and allows approve/reject with a click.
 *
 * Drop-in integration: import { InboxPage } from this module in muhanai's
 * App.tsx route table, OR render standalone with the bundled DashboardShell.
 */
import * as React from "react";
import {
  createInbox,
  applyDecision,
  categorizeRisk,
  type ChangeRequest,
  type InboxFilter,
  type ChangeRequestStatus,
  type ProposedFile,
} from "../../../../packages/busabase-adapter/src/index.ts";
import { DashboardShell } from "../components/DashboardShell";

type Risk = "critical" | "high" | "medium" | "low";

function riskOf(cr: ChangeRequest): Risk {
  // Re-classify from CR data (no full PolicyContext, but we have enough)
  return categorizeRisk({
    confidence: cr.confidence,
    category: cr.category as never,
    reversible: cr.reversible,
    touchesProtected: cr.files.some((f) =>
      /\.(?:env|secrets?|pem|key)$|\bsecrets?\b|id_rsa|\.ssh\//i.test(f.path),
    ),
    autonomyLevel: 0,
  });
}

function StatusTag({
  status,
}: {
  status: ChangeRequestStatus;
}): React.ReactElement {
  return <span className={`ddb-tag ddb-tag--${status}`}>{status}</span>;
}

function RiskTag({ risk }: { risk: Risk }): React.ReactElement {
  return (
    <span
      className={`ddb-tag ddb-tag--${risk === "critical" ? "rejected" : risk === "high" ? "open" : risk === "medium" ? "merged" : "approved"}`}
    >
      {risk.toUpperCase()}
    </span>
  );
}

interface InboxCardProps {
  cr: ChangeRequest;
  onApprove: (id: string, comment?: string) => void;
  onReject: (id: string, comment?: string) => void;
}

function InboxCard({
  cr,
  onApprove,
  onReject,
}: InboxCardProps): React.ReactElement {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const risk = riskOf(cr);
  const fileSummary = cr.files
    .map(
      (f: ProposedFile) =>
        `${f.operation === "modify" ? "✎" : f.operation === "create" ? "＋" : "✖"} ${f.path} (+${f.linesAdded}/-${f.linesRemoved})`,
    )
    .join("\n");

  const handle = async (action: "approve" | "reject") => {
    setBusy(true);
    setError(null);
    try {
      // Simulate async (real impl would call inbox.approve via WebSocket)
      await new Promise((r) => setTimeout(r, 100));
      if (action === "approve") onApprove(cr.id, "approved via dashboard");
      else onReject(cr.id, "rejected via dashboard");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article
      className={`ddb-card ddb-card--${risk}`}
      data-testid={`inbox-card-${cr.id.slice(0, 8)}`}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h3 className="ddb-card__title">{cr.title}</h3>
        <div>
          <RiskTag risk={risk} />
          <StatusTag status={cr.status} />
        </div>
      </div>
      <p className="ddb-card__meta">
        {cr.agent.name} v{cr.agent.version} · {cr.agent.modelProvider}/
        {cr.agent.modelId} · conf {cr.confidence.toFixed(2)}
      </p>
      <p style={{ margin: "8px 0", fontSize: 14 }}>{cr.rationale}</p>
      {cr.files.length > 0 && (
        <pre className="ddb-card__files">{fileSummary}</pre>
      )}
      {cr.dryRunPreview && (
        <details style={{ marginTop: 8 }}>
          <summary
            style={{
              cursor: "pointer",
              fontSize: 12,
              color: "var(--ddb-text-mute)",
            }}
          >
            Dry-run preview
          </summary>
          <pre className="ddb-card__files">{cr.dryRunPreview}</pre>
        </details>
      )}
      {cr.status === "open" && (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            className="ddb-btn ddb-btn--approve"
            onClick={() => handle("approve")}
            disabled={busy}
            data-testid={`approve-${cr.id.slice(0, 8)}`}
          >
            ✓ Approve
          </button>
          <button
            className="ddb-btn ddb-btn--reject"
            onClick={() => handle("reject")}
            disabled={busy}
            data-testid={`reject-${cr.id.slice(0, 8)}`}
          >
            ✗ Reject
          </button>
        </div>
      )}
      {error && (
        <p style={{ color: "var(--ddb-danger)", fontSize: 12, marginTop: 8 }}>
          {error}
        </p>
      )}
    </article>
  );
}

export interface InboxPageProps {
  /** Optional override; defaults to in-memory inbox with sample data */
  inbox?: ReturnType<typeof createInbox>;
  /** Filter applied to the list */
  filter?: InboxFilter;
}

export function InboxPage({
  inbox: inboxProp,
  filter,
}: InboxPageProps): React.ReactElement {
  // Default inbox for standalone mode; muhanai integration passes its own
  const [inbox] = React.useState(() => inboxProp ?? createInbox());
  const [, forceUpdate] = React.useReducer((x) => x + 1, 0);

  const crs = inbox.list(filter);
  const pendingCount = inbox.list({ status: "open" }).length;

  const handleApprove = React.useCallback(
    (id: string, comment?: string) => {
      inbox.approve(id, "human", comment);
      forceUpdate();
    },
    [inbox],
  );

  const handleReject = React.useCallback(
    (id: string, comment?: string) => {
      inbox.reject(id, "human", comment);
      forceUpdate();
    },
    [inbox],
  );

  return (
    <DashboardShell activePath="/inbox" pendingCount={pendingCount}>
      <h1 className="ddb-page-title">DadaBot Inbox</h1>
      <p className="ddb-page-subtitle">
        {pendingCount > 0
          ? `${pendingCount} pending review${pendingCount === 1 ? "" : "s"} · ${crs.length} total`
          : `${crs.length} change request${crs.length === 1 ? "" : "s"}`}
      </p>
      {crs.length === 0 ? (
        <div className="ddb-card">
          <p
            style={{
              textAlign: "center",
              color: "var(--ddb-text-mute)",
              margin: 0,
            }}
          >
            🎉 Inbox is empty. All proposals have been reviewed.
          </p>
        </div>
      ) : (
        crs.map((cr) => (
          <InboxCard
            key={cr.id}
            cr={cr}
            onApprove={handleApprove}
            onReject={handleReject}
          />
        ))
      )}
    </DashboardShell>
  );
}
