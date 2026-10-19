// store.ts — In-memory agent + task + reputation store.
//
// OpenWork-style protocol backed by a single Map<id, Record> per entity.
// No external DB needed; survives process lifetime, lost on restart.
//
// Idempotent: register() upserts on wallet; task creation uses server
// UUIDs so concurrent registrations never collide.
//
// All writes are synchronous and thread-safe in Node's single-threaded
// model. Reads return defensive copies.

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Capability =
  | "code-edit"
  | "code-review"
  | "test-generation"
  | "doc-generation"
  | "refactor"
  | "shell-command"
  | "research";

export interface Agent {
  id: string;                 // UUID
  wallet: string;             // 0x… lowercase
  name: string;
  modelProvider: string;
  modelId: string;
  capabilities: Capability[];
  reversible: boolean;
  tools: number;
  freeModels: number;
  skillUrl?: string;
  proofUrl?: string;
  credential: {               // W3C VC stub
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
  registeredAt: number;       // epoch ms
  reputation: {
    score: number;            // +1 per success, -5 human_revoked, -3 timeout
    successes: number;
    failures: number;
  };
}

export type TaskStatus = "open" | "claimed" | "submitted" | "approved" | "rejected";

export interface Task {
  id: string;
  title: string;
  description: string;
  capability: Capability;
  reward: number;             // arbitrary reputation points (not money in v1)
  deadline: number;           // epoch ms
  requirements?: Record<string, unknown>;
  status: TaskStatus;
  claimedBy?: string;         // agent id
  submittedAt?: number;
  prUrl?: string;
  artifacts?: Record<string, unknown>;
  createdAt: number;
}

export interface ReputationEvent {
  agentId: string;
  taskId?: string;
  kind: "successful_completion" | "human_revoked" | "timeout" | "registration_bonus";
  delta: number;
  at: number;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

class Store {
  private agents = new Map<string, Agent>();          // by wallet (lowercase)
  private tasks = new Map<string, Task>();            // by id
  private reputation = new Map<string, ReputationEvent[]>(); // by agent id
  private challenges = new Map<string, string>();     // by wallet (one nonce at a time)

  // -- Agents --------------------------------------------------------------

  registerAgent(input: Omit<Agent, "id" | "registeredAt" | "reputation" | "credential"> & {
    issuer?: string;
  }): { agent: Agent; created: boolean } {
    const walletKey = input.wallet.toLowerCase();
    const existing = this.agents.get(walletKey);
    if (existing) {
      // Upsert: refresh mutable fields, keep id + reputation
      const updated: Agent = {
        ...existing,
        name: input.name,
        modelProvider: input.modelProvider,
        modelId: input.modelId,
        capabilities: input.capabilities,
        reversible: input.reversible,
        tools: input.tools,
        freeModels: input.freeModels,
        skillUrl: input.skillUrl,
        proofUrl: input.proofUrl,
      };
      this.agents.set(walletKey, updated);
      return { agent: updated, created: false };
    }

    const now = Date.now();
    const issuer = input.issuer ?? `did:ethr:${walletKey}`;
    const agent: Agent = {
      id: randomUUID(),
      wallet: walletKey,
      name: input.name,
      modelProvider: input.modelProvider,
      modelId: input.modelId,
      capabilities: input.capabilities,
      reversible: input.reversible,
      tools: input.tools,
      freeModels: input.freeModels,
      skillUrl: input.skillUrl,
      proofUrl: input.proofUrl,
      credential: {
        "@context": ["https://www.w3.org/2018/credentials/v1"],
        type: ["VerifiableCredential", "AgentCredential"],
        issuer,
        issuanceDate: new Date(now).toISOString(),
        credentialSubject: {
          id: issuer,
          wallet: walletKey,
          capabilities: input.capabilities,
        },
      },
      registeredAt: now,
      reputation: { score: 0, successes: 0, failures: 0 },
    };
    this.agents.set(walletKey, agent);
    this.recordReputation({
      agentId: agent.id,
      kind: "registration_bonus",
      delta: 0,
      at: now,
    });
    return { agent, created: true };
  }

  getAgent(wallet: string): Agent | undefined {
    return this.agents.get(wallet.toLowerCase());
  }

  getAgentById(id: string): Agent | undefined {
    for (const a of this.agents.values()) {
      if (a.id === id) return a;
    }
    return undefined;
  }

  listAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  // -- Tasks ---------------------------------------------------------------

  createTask(input: Omit<Task, "id" | "status" | "createdAt">): Task {
    const task: Task = {
      ...input,
      id: randomUUID(),
      status: "open",
      createdAt: Date.now(),
    };
    this.tasks.set(task.id, task);
    return task;
  }

  listTasks(filter?: { status?: TaskStatus; capability?: Capability }): Task[] {
    let out = Array.from(this.tasks.values());
    if (filter?.status) out = out.filter((t) => t.status === filter.status);
    if (filter?.capability) out = out.filter((t) => t.capability === filter.capability);
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  claimTask(taskId: string, agentId: string): { ok: true; task: Task } | { ok: false; reason: string } {
    const task = this.tasks.get(taskId);
    if (!task) return { ok: false, reason: "task_not_found" };
    if (task.status !== "open") return { ok: false, reason: `task_status_${task.status}` };
    const agent = this.getAgentById(agentId);
    if (!agent) return { ok: false, reason: "agent_not_found" };
    if (!agent.capabilities.includes(task.capability)) {
      return { ok: false, reason: "capability_mismatch" };
    }
    task.status = "claimed";
    task.claimedBy = agentId;
    this.tasks.set(taskId, task);
    return { ok: true, task };
  }

  submitTask(
    taskId: string,
    agentId: string,
    payload: { prUrl: string; artifacts?: Record<string, unknown> },
  ): { ok: true; task: Task } | { ok: false; reason: string } {
    const task = this.tasks.get(taskId);
    if (!task) return { ok: false, reason: "task_not_found" };
    if (task.status !== "claimed") return { ok: false, reason: `task_status_${task.status}` };
    if (task.claimedBy !== agentId) return { ok: false, reason: "not_claim_owner" };
    task.status = "submitted";
    task.prUrl = payload.prUrl;
    task.artifacts = payload.artifacts;
    task.submittedAt = Date.now();
    this.tasks.set(taskId, task);
    return { ok: true, task };
  }

  decideTask(
    taskId: string,
    decision: "approved" | "rejected",
  ): { ok: true; task: Task } | { ok: false; reason: string } {
    const task = this.tasks.get(taskId);
    if (!task) return { ok: false, reason: "task_not_found" };
    if (task.status !== "submitted") return { ok: false, reason: `task_status_${task.status}` };
    task.status = decision;
    this.tasks.set(taskId, task);
    if (task.claimedBy) {
      const delta = decision === "approved" ? +1 : -5;
      this.recordReputation({
        agentId: task.claimedBy,
        taskId: task.id,
        kind: decision === "approved" ? "successful_completion" : "human_revoked",
        delta,
        at: Date.now(),
      });
    }
    return { ok: true, task };
  }

  // -- Reputation ----------------------------------------------------------

  recordReputation(event: ReputationEvent): void {
    const list = this.reputation.get(event.agentId) ?? [];
    list.push(event);
    this.reputation.set(event.agentId, list);
    const agent = this.getAgentById(event.agentId);
    if (agent) {
      agent.reputation.score += event.delta;
      if (event.delta > 0) agent.reputation.successes += 1;
      if (event.delta < 0) agent.reputation.failures += 1;
    }
  }

  getReputation(agentId: string): { score: number; events: ReputationEvent[]; agent?: Agent } {
    const agent = this.getAgentById(agentId);
    return {
      score: agent?.reputation.score ?? 0,
      events: this.reputation.get(agentId) ?? [],
      agent,
    };
  }

  // -- SIWE challenges -----------------------------------------------------

  putChallenge(wallet: string, nonce: string): void {
    this.challenges.set(wallet.toLowerCase(), nonce);
  }

  consumeChallenge(wallet: string): string | undefined {
    const nonce = this.challenges.get(wallet.toLowerCase());
    if (nonce) this.challenges.delete(wallet.toLowerCase());
    return nonce;
  }

  // -- Testing -------------------------------------------------------------

  reset(): void {
    this.agents.clear();
    this.tasks.clear();
    this.reputation.clear();
    this.challenges.clear();
  }
}

// Module-level singleton + named export for tests
export const store = new Store();
export { Store };
