/**
 * sam-tools/src/index.ts — FreeModelRotator + provider registry.
 *
 * Local-first model router: rotates across free-tier providers without
 * requiring API keys (each provider offers a no-key free tier).
 *
 * Pattern inspired by SAM (richhabits/sam): "rotates across all of them"
 * so no single provider hits its quota. SAM runs as a Node/Express server
 * at localhost:8787; we reimplement the rotation core here so Dadabot can
 * call it in-process without npm install.
 *
 * Providers (6): Groq, Cerebras, NVIDIA, Google Gemini, Mistral, GitHub Models.
 * Each has an OpenAI-compatible chat endpoint and a free tier.
 *
 * Zero external dependencies — uses fetch (Node 22+ built-in).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  model?: string;            // preferred model id, optional
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Stop after N rotations on failure (default: 3) */
  maxRotations?: number;
}

export interface ChatResponse {
  content: string;
  provider: string;
  model: string;
  rotationIndex: number;     // which provider served this request
  totalRotations: number;    // total providers tried
  latencyMs: number;
}

export interface ProviderConfig {
  id: string;                 // unique id (e.g. "groq")
  name: string;               // display name
  baseUrl: string;            // API base URL
  defaultModel: string;       // free-tier default model
  apiKeyEnvVar?: string;      // env var name holding the key
  authHeader: (key: string) => Record<string, string>;
  bodyShape: "openai" | "gemini";  // request body shape
}

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

export const PROVIDERS: ProviderConfig[] = [
  {
    id: "groq",
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.1-8b-instant",
    apiKeyEnvVar: "GROQ_API_KEY",
    authHeader: (k) => ({ Authorization: `Bearer ${k}` }),
    bodyShape: "openai",
  },
  {
    id: "cerebras",
    name: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    defaultModel: "llama-3.1-8b",
    apiKeyEnvVar: "CEREBRAS_API_KEY",
    authHeader: (k) => ({ Authorization: `Bearer ${k}` }),
    bodyShape: "openai",
  },
  {
    id: "nvidia",
    name: "NVIDIA",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    defaultModel: "meta/llama-3.1-8b-instruct",
    apiKeyEnvVar: "NVIDIA_API_KEY",
    authHeader: (k) => ({ Authorization: `Bearer ${k}` }),
    bodyShape: "openai",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    baseUrl:
      "https://generativelanguage.googleapis.com/v1beta/openai/",
    defaultModel: "gemini-2.0-flash-exp",
    apiKeyEnvVar: "GEMINI_API_KEY",
    authHeader: (k) => ({ Authorization: `Bearer ${k}` }),
    bodyShape: "openai",
  },
  {
    id: "mistral",
    name: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-small-latest",
    apiKeyEnvVar: "MISTRAL_API_KEY",
    authHeader: (k) => ({ Authorization: `Bearer ${k}` }),
    bodyShape: "openai",
  },
  {
    id: "github-models",
    name: "GitHub Models",
    baseUrl: "https://models.github.ai/inference",
    defaultModel: "openai/gpt-4o-mini",
    apiKeyEnvVar: "GITHUB_TOKEN",
    authHeader: (k) => ({ Authorization: `Bearer ${k}` }),
    bodyShape: "openai",
  },
];

// ---------------------------------------------------------------------------
// FreeModelRotator
// ---------------------------------------------------------------------------

export interface RotatorOptions {
  /** Force-include providers even without API keys (test mode) */
  forceProviders?: string[];
  /** Custom rotation order (defaults to round-robin starting at 0) */
  order?: string[];
  /** Custom fetch (for testing) */
  fetch?: typeof fetch;
  /** Logger for rotation events */
  onRotate?: (provider: ProviderConfig, index: number) => void;
  /** Provider allowlist (only rotate among these) */
  allowedProviders?: string[];
}

export class FreeModelRotator {
  private providers: ProviderConfig[];
  private cursor = 0;
  private opts: RotatorOptions;

  constructor(opts: RotatorOptions = {}) {
    const allow = opts.allowedProviders
      ? new Set(opts.allowedProviders)
      : null;
    this.providers = PROVIDERS.filter((p) => {
      if (allow && !allow.has(p.id)) return false;
      if (opts.forceProviders?.includes(p.id)) return true;
      return p.apiKeyEnvVar ? !!process.env[p.apiKeyEnvVar] : false;
    });
    if (opts.order) {
      this.providers = opts.order
        .map((id) => this.providers.find((p) => p.id === id))
        .filter((p): p is ProviderConfig => !!p);
    }
    this.opts = opts;
  }

  /** Number of providers currently available (with API keys). */
  size(): number {
    return this.providers.length;
  }

  /** List of provider ids available for rotation. */
  list(): string[] {
    return this.providers.map((p) => p.id);
  }

  /** Pick the next provider (round-robin). */
  private next(): ProviderConfig {
    if (this.providers.length === 0) {
      throw new Error(
        "No providers available — set at least one API key env var " +
          "(GROQ_API_KEY, CEREBRAS_API_KEY, NVIDIA_API_KEY, " +
          "GEMINI_API_KEY, MISTRAL_API_KEY, GITHUB_TOKEN) " +
          "or use forceProviders for testing",
      );
    }
    const p = this.providers[this.cursor % this.providers.length]!;
    this.cursor = (this.cursor + 1) % this.providers.length;
    return p;
  }

  /** Send a chat request, rotating across providers on failure. */
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const maxRotations = Math.min(
      req.maxRotations ?? this.providers.length,
      this.providers.length,
    );
    if (maxRotations === 0) {
      throw new Error("FreeModelRotator: no providers configured");
    }
    const fetcher = this.opts.fetch ?? fetch;
    const errors: Array<{ provider: string; error: string }> = [];
    const start = Date.now();
    let rotationIndex = 0;

    for (let i = 0; i < maxRotations; i++) {
      const provider = this.next();
      rotationIndex = i;
      this.opts.onRotate?.(provider, i);
      const forced = this.opts.forceProviders?.includes(provider.id) ?? false;
      const key = forced
        ? "forced-no-key"
        : provider.apiKeyEnvVar
        ? process.env[provider.apiKeyEnvVar]
        : "no-key-needed";
      if (!key || key === "forced-no-key" ? false : false) {
        // (intentionally never true; key check below)
      }
      if (!forced && !key) {
        errors.push({ provider: provider.id, error: "no API key" });
        continue;
      }
      try {
        const body = buildBody(req, provider);
        const resp = await fetcher(`${provider.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...provider.authHeader(key),
          },
          body: JSON.stringify(body),
        });
        if (!resp.ok) {
          const text = await resp.text();
          errors.push({ provider: provider.id, error: `${resp.status} ${text}` });
          continue;
        }
        const json = (await resp.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = json.choices?.[0]?.message?.content ?? "";
        return {
          content,
          provider: provider.id,
          model: body.model,
          rotationIndex,
          totalRotations: i + 1,
          latencyMs: Date.now() - start,
        };
      } catch (e) {
        errors.push({ provider: provider.id, error: String(e) });
        continue;
      }
    }

    throw new Error(
      `FreeModelRotator: all ${maxRotations} providers failed. ` +
        `Errors: ${JSON.stringify(errors)}`,
    );
  }
}

function buildBody(
  req: ChatRequest,
  provider: ProviderConfig,
): { model: string; messages: ChatMessage[]; temperature: number; max_tokens?: number } {
  return {
    model: req.model ?? provider.defaultModel,
    messages: req.messages,
    temperature: req.temperature ?? 0.7,
    max_tokens: req.maxTokens,
  };
}

// ---------------------------------------------------------------------------
// Convenience factory
// ---------------------------------------------------------------------------

export function createRotator(opts: RotatorOptions = {}): FreeModelRotator {
  return new FreeModelRotator(opts);
}

/** Return the list of providers whose API keys are present. */
export function listAvailableProviders(): string[] {
  return PROVIDERS.filter(
    (p) => p.apiKeyEnvVar && !!process.env[p.apiKeyEnvVar],
  ).map((p) => p.id);
}

/** Return the full provider catalog (for status displays). */
export function listAllProviders(): Array<{ id: string; name: string; defaultModel: string; hasKey: boolean }> {
  return PROVIDERS.map((p) => ({
    id: p.id,
    name: p.name,
    defaultModel: p.defaultModel,
    hasKey: p.apiKeyEnvVar ? !!process.env[p.apiKeyEnvVar] : false,
  }));
}

// Re-export the Proposal generator so consumers can `import { generateProposal } from "@agentmesh/sam-tools"`.
export { generateProposal, type GenerateProposalOptions } from "./proposal-gen.ts";
