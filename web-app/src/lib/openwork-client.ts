// openwork-client.ts — TypeScript browser helper for the Muhanai Agent OS
// OpenWork-compatible registry.
//
// All methods return Promises. Errors are normalized: { ok: false, error: { code, message } }
// from the server is preserved verbatim.
//
// Usage:
//   import { OpenWorkClient } from "@/lib/openwork-client";
//   const client = new OpenWorkClient("https://muhanai.com");
//   const { agent, created } = await client.register({ wallet, name, ... });

export type Capability =
  | "code-edit"
  | "code-review"
  | "test-generation"
  | "doc-generation"
  | "refactor"
  | "shell-command"
  | "research";

export type TaskStatus = "open" | "claimed" | "submitted" | "approved" | "rejected";

export interface Agent {
  id: string;
  wallet: string;
  name: string;
  modelProvider: string;
  modelId: string;
  capabilities: Capability[];
  reversible: boolean;
  tools: number;
  freeModels: number;
  skillUrl?: string;
  proofUrl?: string;
  credential: {
    "@context": string[];
    type: string[];
    issuer: string;
    issuanceDate: string;
    credentialSubject: {
      id: string;
      wallet: string;
      capabilities: Capability[];
    };
  };
  registeredAt: number;
  reputation: { score: number; successes: number; failures: number };
}

export interface Task {
  id: string;
  title: string;
  description: string;
  capability: Capability;
  reward: number;
  deadline: number;
  status: TaskStatus;
  claimedBy?: string;
  submittedAt?: number;
  prUrl?: string;
  createdAt: number;
}

export interface ReputationEvent {
  agentId: string;
  taskId?: string;
  kind: "successful_completion" | "human_revoked" | "timeout" | "registration_bonus";
  delta: number;
  at: number;
}

export interface OkResponse<T> { ok: true; [k: string]: T | unknown }
export interface ErrResponse { ok: false; error: { code: string; message: string } }
export type Result<T> = T | ErrResponse;

function isErr(r: unknown): r is ErrResponse {
  return !!r && typeof r === "object" && (r as any).ok === false;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface RegisterAgentInput {
  wallet: string;
  name: string;
  modelProvider: string;
  modelId: string;
  capabilities: Capability[];
  reversible?: boolean;
  tools?: number;
  freeModels?: number;
  skillUrl?: string;
  proofUrl?: string;
  /** Optional SIWE message + signature for elevated trust */
  message?: string;
  signature?: string;
}

export class OpenWorkClient {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    baseUrl: string,
    fetchImpl: typeof fetch = (...args: Parameters<typeof fetch>) => fetch(...args),
  ) {
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
  }

  // -- Request core -------------------------------------------------------

  private async req<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<OkResponse<T> | ErrResponse> {
    const url = `${this.baseUrl}${path}`;
    const init: RequestInit = {
      method,
      headers: { "content-type": "application/json" },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await this.fetchImpl(url, init);
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      return {
        ok: false,
        error: { code: "parse_error", message: `non-JSON response: ${text.slice(0, 200)}` },
      };
    }
    if (!res.ok && !isErr(json)) {
      return {
        ok: false,
        error: { code: `http_${res.status}`, message: `HTTP ${res.status}` },
      };
    }
    return json as OkResponse<T> | ErrResponse;
  }

  // -- Agents -------------------------------------------------------------

  async register(
    input: RegisterAgentInput,
  ): Promise<{ ok: true; agent: Agent; created: boolean } | ErrResponse> {
    const r = await this.req<{ agent: Agent; created: boolean }>(
      "POST",
      "/api/agents/register",
      input,
    );
    if (isErr(r)) return r;
    return { ok: true, agent: (r as any).agent, created: (r as any).created };
  }

  async listAgents(): Promise<{ ok: true; agents: Agent[] } | ErrResponse> {
    const r = await this.req<{ agents: Agent[] }>("GET", "/api/agents");
    if (isErr(r)) return r;
    return { ok: true, agents: (r as any).agents };
  }

  async getAgent(id: string): Promise<{ ok: true; agent: Agent } | ErrResponse> {
    const r = await this.req<{ agent: Agent }>("GET", `/api/agents/${id}`);
    if (isErr(r)) return r;
    return { ok: true, agent: (r as any).agent };
  }

  async getReputation(
    id: string,
  ): Promise<{ ok: true; score: number; events: ReputationEvent[] } | ErrResponse> {
    const r = await this.req<{ score: number; events: ReputationEvent[] }>(
      "GET",
      `/api/agents/${id}/reputation`,
    );
    if (isErr(r)) return r;
    return { ok: true, score: (r as any).score, events: (r as any).events };
  }

  // -- Tasks --------------------------------------------------------------

  async createTask(input: {
    title: string;
    description: string;
    capability: Capability;
    reward?: number;
    deadline?: number;
    requirements?: Record<string, unknown>;
  }): Promise<{ ok: true; task: Task } | ErrResponse> {
    const r = await this.req<{ task: Task }>("POST", "/api/tasks", input);
    if (isErr(r)) return r;
    return { ok: true, task: (r as any).task };
  }

  async listTasks(filter?: {
    status?: TaskStatus;
    capability?: Capability;
  }): Promise<{ ok: true; tasks: Task[] } | ErrResponse> {
    const params = new URLSearchParams();
    if (filter?.status) params.set("status", filter.status);
    if (filter?.capability) params.set("capability", filter.capability);
    const q = params.toString();
    const path = q ? `/api/tasks?${q}` : "/api/tasks";
    const r = await this.req<{ tasks: Task[] }>("GET", path);
    if (isErr(r)) return r;
    return { ok: true, tasks: (r as any).tasks };
  }

  async claimTask(
    taskId: string,
    agentId: string,
  ): Promise<{ ok: true; task: Task } | ErrResponse> {
    const r = await this.req<{ task: Task }>("POST", `/api/tasks/${taskId}/claim`, { agentId });
    if (isErr(r)) return r;
    return { ok: true, task: (r as any).task };
  }

  async submitTask(
    taskId: string,
    agentId: string,
    prUrl: string,
    artifacts?: Record<string, unknown>,
  ): Promise<{ ok: true; task: Task } | ErrResponse> {
    const r = await this.req<{ task: Task }>(
      "POST",
      `/api/tasks/${taskId}/submit`,
      { agentId, prUrl, artifacts },
    );
    if (isErr(r)) return r;
    return { ok: true, task: (r as any).task };
  }

  async decideTask(
    taskId: string,
    decision: "approved" | "rejected",
  ): Promise<{ ok: true; task: Task } | ErrResponse> {
    const r = await this.req<{ task: Task }>(
      "POST",
      `/api/tasks/${taskId}/decide`,
      { decision },
    );
    if (isErr(r)) return r;
    return { ok: true, task: (r as any).task };
  }

  // -- Discovery ----------------------------------------------------------

  async fetchSkillMd(): Promise<string | ErrResponse> {
    const res = await this.fetchImpl(`${this.baseUrl}/skill.md`);
    if (!res.ok) {
      return {
        ok: false,
        error: { code: `http_${res.status}`, message: `HTTP ${res.status}` },
      };
    }
    return res.text();
  }

  async health(): Promise<{ ok: true; ts: number } | ErrResponse> {
    return this.req<{ ts: number }>("GET", "/health");
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isErrResponse(r: unknown): r is ErrResponse {
  return isErr(r);
}

/** Convenience: returns a default client pointing at muhanai.com. */
export function defaultClient(): OpenWorkClient {
  return new OpenWorkClient("https://muhanai.com");
}

/** Convenience: a localhost client for dev. */
export function localhostClient(port = 4319): OpenWorkClient {
  return new OpenWorkClient(`http://127.0.0.1:${port}`);
}
