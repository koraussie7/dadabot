/**
 * BlockCanvasPage.tsx — Block-based visual workspace.
 *
 * Source: affine-adapter's createWorkspace() + BlockCanvas.
 *
 * Renders AI messages, human notes, and code snippets as cards in a
 * vertical flow. CR ↔ block integrity is preserved via changeRequestId
 * and linkedBlockId props.
 *
 * When a CR is approved/rejected in /inbox, the inbox callback can
 * mirror the decision by adding a corresponding human-note block here.
 */
import * as React from "react";
import {
  createWorkspace,
  DADABOT_SCHEMAS,
  createBlock,
  AIMessageSchema,
  HumanNoteSchema,
  CodeSnippetSchema,
  getSchema,
  type Workspace,
  type BlockInstance,
  type ChangeRequest,
} from "../../../../packages/affine-adapter/src/index.ts";
import { DashboardShell } from "../components/DashboardShell";

function BlockCard({
  block,
  onApprove,
  onReject,
}: {
  block: BlockInstance;
  onApprove?: (block: BlockInstance) => void;
  onReject?: (block: BlockInstance) => void;
}): React.ReactElement {
  const schema = getSchema(DADABOT_SCHEMAS, block.flavour);
  const icon = schema?.icon ?? "•";
  const header = React.useMemo(() => {
    switch (block.flavour) {
      case "dadabot:ai-message":
        return `${icon} AI · ${String(block.props.modelProvider ?? "?")}/${String(block.props.modelId ?? "?")}`;
      case "dadabot:human-note":
        return `${icon} ${String(block.props.author ?? "anon")}'s note`;
      case "dadabot:code-snippet":
        return `${icon} ${String(block.props.language ?? "code")}${block.props.filename ? ` · ${String(block.props.filename)}` : ""}`;
      default:
        return `${icon} ${block.flavour}`;
    }
  }, [block, icon]);

  const isAi = block.flavour === "dadabot:ai-message";
  const crId = block.props.changeRequestId as string | undefined;

  return (
    <article
      className={`ddb-card ddb-card--${block.flavour.split(":")[1]}`}
      data-testid={`block-${block.id}`}
      data-flavour={block.flavour}
    >
      <header
        style={{ fontSize: 12, color: "var(--ddb-text-mute)", marginBottom: 6 }}
      >
        {header}
        {crId && (
          <span className="ddb-tag ddb-tag--open" style={{ marginLeft: 8 }}>
            CR #{crId.slice(0, 8)}
          </span>
        )}
      </header>
      <p style={{ margin: "4px 0", fontSize: 14 }}>
        {String(block.props.content ?? "")}
      </p>
      {Array.isArray(block.props.toolCalls) &&
        block.props.toolCalls.length > 0 && (
          <details style={{ marginTop: 6 }}>
            <summary
              style={{
                cursor: "pointer",
                fontSize: 12,
                color: "var(--ddb-text-mute)",
              }}
            >
              {block.props.toolCalls.length} tool calls
            </summary>
            <pre className="ddb-card__files">
              {JSON.stringify(block.props.toolCalls, null, 2)}
            </pre>
          </details>
        )}
      {block.flavour === "dadabot:code-snippet" && (
        <pre className="ddb-card__files">
          <code>{String(block.props.code ?? "")}</code>
        </pre>
      )}
      {isAi && onApprove && onReject && crId && (
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button
            className="ddb-btn ddb-btn--approve"
            onClick={() => onApprove(block)}
            data-testid={`canvas-approve-${block.id}`}
          >
            ✓ Approve CR
          </button>
          <button
            className="ddb-btn ddb-btn--reject"
            onClick={() => onReject(block)}
            data-testid={`canvas-reject-${block.id}`}
          >
            ✗ Reject CR
          </button>
        </div>
      )}
    </article>
  );
}

export interface BlockCanvasPageProps {
  /** Override workspace for testing or external binding */
  workspace?: Workspace;
  /** Inbox callback to wire approve/reject back to the human review queue */
  onCrDecision?: (crId: string, decision: "approve" | "reject") => void;
}

export function BlockCanvasPage({
  workspace: workspaceProp,
  onCrDecision,
}: BlockCanvasPageProps): React.ReactElement {
  const [workspace] = React.useState(
    () =>
      workspaceProp ??
      createWorkspace({ id: "muhanai-session", schema: DADABOT_SCHEMAS }),
  );
  const [blocks, setBlocks] = React.useState<BlockInstance[]>(() =>
    workspace.listBlocks(),
  );

  React.useEffect(() => {
    const sync = () => setBlocks(workspace.listBlocks());
    sync();
    return workspace.onBlockChange(sync);
  }, [workspace]);

  const handleAdd = (flavour: string) => {
    const id = `${flavour.split(":")[1]}-${Math.random().toString(36).slice(2, 8)}`;
    const schema = getSchema(DADABOT_SCHEMAS, flavour);
    if (!schema) return;
    const props: Record<string, unknown> = {};
    for (const p of schema.props)
      if (p.default !== undefined) props[p.name] = p.default;
    workspace.addBlock({
      id,
      flavour,
      props,
      children: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  };

  const handleApprove = (block: BlockInstance) => {
    const crId = block.props.changeRequestId as string | undefined;
    if (crId && onCrDecision) onCrDecision(crId, "approve");
    // Add a corresponding human-note block to preserve CR ↔ block integrity
    const note = createBlock(HumanNoteSchema, {
      id: `note-${Math.random().toString(36).slice(2, 8)}`,
      props: {
        author: "dashboard",
        content: `Approved: ${String(block.props.content ?? "").slice(0, 60)}`,
        color: "green",
        linkedBlockId: block.id,
      },
    });
    workspace.addBlock(note);
  };

  const handleReject = (block: BlockInstance) => {
    const crId = block.props.changeRequestId as string | undefined;
    if (crId && onCrDecision) onCrDecision(crId, "reject");
    const note = createBlock(HumanNoteSchema, {
      id: `note-${Math.random().toString(36).slice(2, 8)}`,
      props: {
        author: "dashboard",
        content: `Rejected: ${String(block.props.content ?? "").slice(0, 60)}`,
        color: "red",
        linkedBlockId: block.id,
      },
    });
    workspace.addBlock(note);
  };

  return (
    <DashboardShell activePath="/canvas">
      <h1 className="ddb-page-title">Block Canvas</h1>
      <p className="ddb-page-subtitle">
        {blocks.length} block{blocks.length === 1 ? "" : "s"} · CR-linked blocks
        are tagged above
      </p>

      {blocks.length === 0 ? (
        <div className="ddb-card">
          <p style={{ textAlign: "center", color: "var(--ddb-text-mute)" }}>
            Empty workspace. Add a block below ↓
          </p>
        </div>
      ) : (
        blocks.map((b) => (
          <BlockCard
            key={b.id}
            block={b}
            onApprove={onCrDecision ? handleApprove : undefined}
            onReject={onCrDecision ? handleReject : undefined}
          />
        ))
      )}

      <div
        className="ddb-card"
        style={{ background: "#f5f5f4", borderStyle: "dashed" }}
      >
        <header
          style={{
            fontSize: 12,
            color: "var(--ddb-text-mute)",
            marginBottom: 8,
          }}
        >
          Add new block
        </header>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="ddb-btn"
            onClick={() => handleAdd("dadabot:ai-message")}
          >
            ＋ AI message
          </button>
          <button
            className="ddb-btn"
            onClick={() => handleAdd("dadabot:human-note")}
          >
            ＋ Human note
          </button>
          <button
            className="ddb-btn"
            onClick={() => handleAdd("dadabot:code-snippet")}
          >
            ＋ Code snippet
          </button>
        </div>
      </div>
    </DashboardShell>
  );
}
