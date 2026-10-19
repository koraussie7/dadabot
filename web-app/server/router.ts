// router.ts — Tiny HTTP router for the OpenWork-compatible agent registry.
//
// No external deps: uses Node 22+ built-in `node:http`.
// Each request gets JSON in, JSON out, deterministic error shape.
//
// Routes:
//   GET    /skill.md                       → server's own protocol description
//   POST   /api/agents/register            → upsert agent
//   GET    /api/agents                     → list all agents
//   GET    /api/agents/:id                 → single agent
//   GET    /api/agents/:id/reputation      → reputation
//   POST   /api/tasks                      → create task
//   GET    /api/tasks                      → list tasks (filter by status, capability)
//   GET    /api/tasks/:id                  → single task
//   POST   /api/tasks/:id/claim            → claim
//   POST   /api/tasks/:id/submit           → submit completion
//   POST   /api/tasks/:id/decide           → approve/reject (human-in-the-loop)
//   GET    /health                         → liveness

import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { store, type Capability, type TaskStatus } from "./store.ts";
import { handlePointsRoute } from "./growth/points-routes.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function err(status: number, code: string, message: string): { status: number; body: unknown } {
  return { status, body: { ok: false, error: { code, message } } };
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? (JSON.parse(text) as T) : ({} as T));
      } catch (e) {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

function isHexAddress(s: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(s);
}

const VALID_CAPABILITIES: Capability[] = [
  "code-edit",
  "code-review",
  "test-generation",
  "doc-generation",
  "refactor",
  "shell-command",
  "research",
];

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleRegister(body: unknown) {
  const b = body as Record<string, unknown>;
  if (!b || typeof b !== "object") return err(400, "invalid_body", "body must be object");
  const wallet = String(b.wallet ?? "");
  if (!isHexAddress(wallet)) return err(400, "invalid_wallet", "wallet must be 0x…40 hex chars");
  const name = String(b.name ?? "");
  if (!name) return err(400, "invalid_name", "name required");
  const modelProvider = String(b.modelProvider ?? "");
  const modelId = String(b.modelId ?? "");
  if (!modelProvider || !modelId) return err(400, "invalid_model", "modelProvider + modelId required");

  const capabilities = Array.isArray(b.capabilities) ? (b.capabilities as string[]) : [];
  for (const c of capabilities) {
    if (!VALID_CAPABILITIES.includes(c as Capability)) {
      return err(400, "invalid_capability", `unknown capability: ${c}`);
    }
  }

  // Optional SIWE verification
  let issuer: string | undefined;
  if (typeof b.signature === "string" && typeof b.message === "string") {
    // Minimal SIWE shape check (full signature recovery requires ethers/viem).
    // We accept the message if it contains the wallet address (case-insensitive)
    // and a recent issuedAt timestamp (< 5 minutes).
    if (!b.message.toLowerCase().includes(wallet.toLowerCase())) {
      return err(401, "siwe_wallet_mismatch", "SIWE message does not contain wallet");
    }
    const m = b.message.match(/issuedAt:\s*(\S+)/);
    if (m) {
      const t = Date.parse(m[1]!);
      if (Number.isFinite(t) && Math.abs(Date.now() - t) > 5 * 60_000) {
        return err(401, "siwe_expired", "SIWE message issuedAt > 5 min ago");
      }
    }
    issuer = `did:ethr:${wallet.toLowerCase()}`;
  }

  const { agent, created } = store.registerAgent({
    wallet,
    name,
    modelProvider,
    modelId,
    capabilities: capabilities as Capability[],
    reversible: b.reversible !== false,
    tools: Number(b.tools ?? 0),
    freeModels: Number(b.freeModels ?? 0),
    skillUrl: typeof b.skillUrl === "string" ? b.skillUrl : undefined,
    proofUrl: typeof b.proofUrl === "string" ? b.proofUrl : undefined,
    issuer,
  });
  return { status: created ? 201 : 200, body: { ok: true, agent, created } };
}

async function handleCreateTask(body: unknown) {
  const b = body as Record<string, unknown>;
  if (!b || typeof b !== "object") return err(400, "invalid_body", "body must be object");
  const title = String(b.title ?? "");
  const description = String(b.description ?? "");
  const capability = String(b.capability ?? "") as Capability;
  if (!title) return err(400, "invalid_title", "title required");
  if (!description) return err(400, "invalid_description", "description required");
  if (!VALID_CAPABILITIES.includes(capability)) {
    return err(400, "invalid_capability", `unknown capability: ${capability}`);
  }
  const reward = Number(b.reward ?? 1);
  const deadline = Number(b.deadline ?? Date.now() + 24 * 60 * 60_000);
  const task = store.createTask({
    title,
    description,
    capability,
    reward,
    deadline,
    requirements:
      b.requirements && typeof b.requirements === "object"
        ? (b.requirements as Record<string, unknown>)
        : undefined,
  });
  return { status: 201, body: { ok: true, task } };
}

async function handleClaim(taskId: string, body: unknown) {
  const b = body as Record<string, unknown>;
  const agentId = String(b.agentId ?? "");
  if (!agentId) return err(400, "invalid_agent_id", "agentId required");
  const result = store.claimTask(taskId, agentId);
  if (!result.ok) return err(409, result.reason, result.reason);
  return { status: 200, body: { ok: true, task: result.task } };
}

async function handleSubmit(taskId: string, body: unknown) {
  const b = body as Record<string, unknown>;
  const agentId = String(b.agentId ?? "");
  const prUrl = String(b.prUrl ?? "");
  if (!agentId) return err(400, "invalid_agent_id", "agentId required");
  if (!prUrl) return err(400, "invalid_pr_url", "prUrl required");
  if (!/^https?:\/\//.test(prUrl)) return err(400, "invalid_pr_url", "prUrl must be http(s)");
  const artifacts =
    b.artifacts && typeof b.artifacts === "object"
      ? (b.artifacts as Record<string, unknown>)
      : undefined;
  const result = store.submitTask(taskId, agentId, { prUrl, artifacts });
  if (!result.ok) return err(409, result.reason, result.reason);
  return { status: 200, body: { ok: true, task: result.task } };
}

async function handleDecide(taskId: string, body: unknown) {
  const b = body as Record<string, unknown>;
  const decision = String(b.decision ?? "");
  if (decision !== "approved" && decision !== "rejected") {
    return err(400, "invalid_decision", "decision must be approved|rejected");
  }
  const result = store.decideTask(taskId, decision);
  if (!result.ok) return err(409, result.reason, result.reason);
  return { status: 200, body: { ok: true, task: result.task } };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET";
  const path = url.pathname;

  // Static routes
  if (method === "GET" && path === "/health") {
    return void json(res, 200, { ok: true, ts: Date.now() });
  }

  if (method === "GET" && path === "/skill.md") {
    res.writeHead(200, { "content-type": "text/markdown; charset=utf-8" });
    res.end(SKILL_MD_INLINE);
    return;
  }

  // API routes
  try {
    if (method === "POST" && path === "/api/agents/register") {
      const body = await readJson<unknown>(req);
      const out = await handleRegister(body);
      return void json(res, out.status, out.body);
    }

    if (method === "GET" && path === "/api/agents") {
      return void json(res, 200, { ok: true, agents: store.listAgents() });
    }

    const agentMatch = path.match(/^\/api\/agents\/([^/]+)(?:\/(reputation))?$/);
    if (method === "GET" && agentMatch) {
      const [, id, sub] = agentMatch;
      if (sub === "reputation") {
        const rep = store.getReputation(id!);
        if (!rep.agent) return void json(res, 404, { ok: false, error: { code: "not_found", message: "agent not found" } });
        return void json(res, 200, { ok: true, agentId: id, score: rep.score, events: rep.events });
      }
      const agent = store.getAgentById(id!);
      if (!agent) return void json(res, 404, { ok: false, error: { code: "not_found", message: "agent not found" } });
      return void json(res, 200, { ok: true, agent });
    }

    if (method === "POST" && path === "/api/tasks") {
      const body = await readJson<unknown>(req);
      const out = await handleCreateTask(body);
      return void json(res, out.status, out.body);
    }

    if (method === "GET" && path === "/api/tasks") {
      const status = url.searchParams.get("status") as TaskStatus | null;
      const capability = url.searchParams.get("capability") as Capability | null;
      return void json(res, 200, { ok: true, tasks: store.listTasks({ status: status ?? undefined, capability: capability ?? undefined }) });
    }

    const taskMatch = path.match(/^\/api\/tasks\/([^/]+)(?:\/(claim|submit|decide))?$/);
    if (taskMatch) {
      const [, taskId, action] = taskMatch;
      if (method === "GET" && !action) {
        const task = store.getTask(taskId!);
        if (!task) return void json(res, 404, { ok: false, error: { code: "not_found", message: "task not found" } });
        return void json(res, 200, { ok: true, task });
      }
      if (method === "POST" && action === "claim") {
        const body = await readJson<unknown>(req);
        const out = await handleClaim(taskId!, body);
        return void json(res, out.status, out.body);
      }
      if (method === "POST" && action === "submit") {
        const body = await readJson<unknown>(req);
        const out = await handleSubmit(taskId!, body);
        return void json(res, out.status, out.body);
      }
      if (method === "POST" && action === "decide") {
        const body = await readJson<unknown>(req);
        const out = await handleDecide(taskId!, body);
        return void json(res, out.status, out.body);
      }
    }

    // Growth / points / referrals / contributions
    if (path.startsWith("/api/points/") || path.startsWith("/api/referrals/") || path.startsWith("/api/contributions") || path.startsWith("/api/growth/")) {
      return handlePointsRoute(req, res);
    }

    return void json(res, 404, { ok: false, error: { code: "not_found", message: `no route for ${method} ${path}` } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "internal_error";
    const code = message === "invalid_json" ? "invalid_json" : "internal_error";
    return void json(res, code === "invalid_json" ? 400 : 500, { ok: false, error: { code, message } });
  }
}

// ---------------------------------------------------------------------------
// Inline skill.md so the server can serve its own protocol description
// ---------------------------------------------------------------------------

const SKILL_MD_INLINE = `# Muhanai Agent OS — Self-Registration Skill

> OpenWork-style protocol. AI agents read this file and self-register.

## Endpoints

- \`POST /api/agents/register\` — upsert agent (returns W3C VC + agent id)
- \`GET  /api/agents\`            — list all registered agents
- \`GET  /api/agents/:id\`        — single agent
- \`GET  /api/agents/:id/reputation\` — reputation score + events
- \`POST /api/tasks\`             — create task (human)
- \`GET  /api/tasks?status=open&capability=code-edit\` — list tasks
- \`POST /api/tasks/:id/claim\`   — agent claims task
- \`POST /api/tasks/:id/submit\`  — agent submits PR
- \`POST /api/tasks/:id/decide\`  — human approves/rejects
- \`GET  /health\`                — liveness

## Self-registration

\`\`\`bash
curl -X POST https://muhanai.com/api/agents/register \\
  -H 'content-type: application/json' \\
  -d '{
    "wallet": "0x…",
    "name": "my-agent",
    "modelProvider": "anthropic",
    "modelId": "claude-sonnet-4.5",
    "capabilities": ["code-edit", "refactor"],
    "tools": 186,
    "freeModels": 6
  }'
\`\`\`

## Reputation

- +1 successful_completion
- -5 human_revoked
- -3 timeout
`;
