/**
 * BlockCanvas.tsx — Minimal AFFiNE-style block canvas.
 *
 * Renders blocks as vertical cards with:
 *   - drag handle
 *   - flavour icon + displayName
 *   - block-specific renderers (ai-message, human-note, code-snippet)
 *   - new-block dock at the bottom
 *
 * This is intentionally framework-light (only React) so it can be ported
 * to Vue/Solid/CLI by replacing the renderer.
 */
import * as React from "react";
import type { Workspace } from "../store.js";
import type { BlockInstance } from "../blocks.js";

interface BlockCanvasProps {
  workspace: Workspace;
  onSelect?: (block: BlockInstance) => void;
  onApprove?: (block: BlockInstance) => void;
  onReject?: (block: BlockInstance) => void;
}

export function BlockCanvas({
  workspace,
  onSelect,
  onApprove,
  onReject,
}: BlockCanvasProps): React.ReactElement {
  const [blocks, setBlocks] = React.useState<BlockInstance[]>(() =>
    workspace.listBlocks(),
  );

  React.useEffect(() => {
    const sync = (): void => setBlocks(workspace.listBlocks());
    sync();
    const unsub = workspace.onBlockChange(sync);
    return unsub;
  }, [workspace]);

  const handleAppend = (flavour: string): void => {
    const id = `${flavour.split(":")[1]}-${Math.random().toString(36).slice(2, 8)}`;
    const schema = workspace.schemas.find((s) => s.flavour === flavour);
    if (!schema) return;
    const defaults: Record<string, unknown> = {};
    for (const p of schema.props)
      if (p.default !== undefined) defaults[p.name] = p.default;
    workspace.addBlock({
      id,
      flavour,
      props: defaults,
      children: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  };

  return (
    <div className="ddb-canvas" data-testid="block-canvas">
      {blocks.length === 0 && (
        <div className="ddb-canvas__empty">
          <p>비어 있는 워크스페이스입니다.</p>
          <p>아래 + 버튼으로 첫 블록을 추가하세요.</p>
        </div>
      )}
      {blocks.map((block) => (
        <BlockCard
          key={block.id}
          block={block}
          onSelect={onSelect}
          onApprove={onApprove}
          onReject={onReject}
        />
      ))}
      <BlockDock onAppend={handleAppend} />
    </div>
  );
}

function BlockCard({
  block,
  onSelect,
  onApprove,
  onReject,
}: {
  block: BlockInstance;
  onSelect?: (b: BlockInstance) => void;
  onApprove?: (b: BlockInstance) => void;
  onReject?: (b: BlockInstance) => void;
}): React.ReactElement {
  return (
    <article
      className={`ddb-card ddb-card--${block.flavour.split(":")[1]}`}
      onClick={() => onSelect?.(block)}
      data-flavour={block.flavour}
    >
      <BlockRenderer block={block} />
      {block.flavour === "dadabot:ai-message" && onApprove && onReject && (
        <div className="ddb-card__actions">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onApprove(block);
            }}
          >
            ✓ 승인
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onReject(block);
            }}
          >
            ✗ 거절
          </button>
        </div>
      )}
    </article>
  );
}

function BlockRenderer({
  block,
}: {
  block: BlockInstance;
}): React.ReactElement {
  switch (block.flavour) {
    case "dadabot:ai-message":
      return (
        <div>
          <header>
            🤖 AI ({String(block.props.modelProvider ?? "?")}/
            {String(block.props.modelId ?? "?")})
          </header>
          <p>{String(block.props.content ?? "")}</p>
          {Array.isArray(block.props.toolCalls) &&
            block.props.toolCalls.length > 0 && (
              <details>
                <summary>{block.props.toolCalls.length}개 도구 호출</summary>
                <pre>{JSON.stringify(block.props.toolCalls, null, 2)}</pre>
              </details>
            )}
        </div>
      );
    case "dadabot:human-note":
      return (
        <div>
          <header>👤 {String(block.props.author ?? "anon")}의 메모</header>
          <p>{String(block.props.content ?? "")}</p>
        </div>
      );
    case "dadabot:code-snippet":
      return (
        <div>
          <header>
            💻 {String(block.props.language ?? "code")}
            {block.props.filename ? ` · ${String(block.props.filename)}` : ""}
          </header>
          <pre>
            <code>{String(block.props.code ?? "")}</code>
          </pre>
        </div>
      );
    default:
      return <pre>{JSON.stringify(block.props, null, 2)}</pre>;
  }
}

function BlockDock({
  onAppend,
}: {
  onAppend: (flavour: string) => void;
}): React.ReactElement {
  return (
    <div className="ddb-dock" data-testid="block-dock">
      <button onClick={() => onAppend("dadabot:ai-message")}>
        + AI 메시지
      </button>
      <button onClick={() => onAppend("dadabot:human-note")}>
        + 사람 메모
      </button>
      <button onClick={() => onAppend("dadabot:code-snippet")}>+ 코드</button>
    </div>
  );
}
