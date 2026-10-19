/**
 * blocks.ts — Block schema system.
 *
 * Mirrors BlockSuite's `defineBlockSchema` API. Each schema declares:
 *   - flavour (e.g. "affine:ai-message")
 *   - props (typed)
 *   - children (nested block IDs)
 *   - toBlock (factory)
 *
 * Dadabot ships 3 builtin flavours:
 *   - "ai-message"   — assistant turn (Markdown + tool calls)
 *   - "human-note"   — human annotation/feedback
 *   - "code-snippet" — fenced code block with language
 */

export type BlockFlavour = string;

export interface BlockPropSchema {
  name: string;
  type: "string" | "number" | "boolean" | "json" | "array";
  default?: unknown;
  optional?: boolean;
}

export interface BlockSchema {
  flavour: BlockFlavour;
  displayName: string;
  icon: string;
  props: BlockPropSchema[];
  childrenAllowed: boolean;
}

export interface BlockInstance {
  id: string;
  flavour: BlockFlavour;
  props: Record<string, unknown>;
  children: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Define a block schema — pure declaration, no runtime side-effects.
 * Mirrors BlockSuite's `defineBlockSchema()` signature for familiarity.
 */
export function defineBlockSchema(schema: BlockSchema): BlockSchema {
  if (!schema.flavour.includes(":")) {
    throw new Error(`flavour must be namespaced (e.g. 'affine:ai-message'), got '${schema.flavour}'`);
  }
  return schema;
}

/**
 * Create a block instance from a schema + partial props.
 */
export function createBlock(
  schema: BlockSchema,
  partial: { id: string; props?: Record<string, unknown>; children?: string[] },
  now: () => Date = () => new Date(),
): BlockInstance {
  const props: Record<string, unknown> = {};
  for (const p of schema.props) {
    if (partial.props && p.name in partial.props) {
      props[p.name] = partial.props[p.name];
    } else if (p.default !== undefined) {
      props[p.name] = p.default;
    } else if (!p.optional) {
      throw new Error(`Missing required prop '${p.name}' for flavour '${schema.flavour}'`);
    }
  }
  return {
    id: partial.id,
    flavour: schema.flavour,
    props,
    children: partial.children ?? [],
    createdAt: now().toISOString(),
    updatedAt: now().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Dadabot's 3 builtin flavours
// ---------------------------------------------------------------------------

export const AIMessageSchema = defineBlockSchema({
  flavour: "dadabot:ai-message",
  displayName: "AI Message",
  icon: "🤖",
  props: [
    { name: "role", type: "string", default: "assistant" },
    { name: "content", type: "string" },
    { name: "modelProvider", type: "string", default: "unknown" },
    { name: "modelId", type: "string", default: "unknown" },
    { name: "confidence", type: "number", default: 0 },
    { name: "toolCalls", type: "array", default: [] },
    { name: "changeRequestId", type: "string", optional: true },
  ],
  childrenAllowed: false,
});

export const HumanNoteSchema = defineBlockSchema({
  flavour: "dadabot:human-note",
  displayName: "Human Note",
  icon: "👤",
  props: [
    { name: "author", type: "string" },
    { name: "content", type: "string" },
    { name: "color", type: "string", default: "yellow" },
    { name: "linkedBlockId", type: "string", optional: true },
  ],
  childrenAllowed: false,
});

export const CodeSnippetSchema = defineBlockSchema({
  flavour: "dadabot:code-snippet",
  displayName: "Code Snippet",
  icon: "💻",
  props: [
    { name: "language", type: "string", default: "plaintext" },
    { name: "code", type: "string" },
    { name: "filename", type: "string", optional: true },
    { name: "annotations", type: "array", default: [] },
  ],
  childrenAllowed: false,
});

export const DADABOT_SCHEMAS: BlockSchema[] = [
  AIMessageSchema,
  HumanNoteSchema,
  CodeSnippetSchema,
];

export function getSchema(schemas: BlockSchema[], flavour: BlockFlavour): BlockSchema | undefined {
  return schemas.find((s) => s.flavour === flavour);
}
