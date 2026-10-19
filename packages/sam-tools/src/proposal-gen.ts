/**
 * proposal-gen.ts — Generate a Proposal from a natural-language intent.
 *
 * Given a plain-English request (e.g. "Refactor FindPage to use free models"),
 * produces a structured Proposal that the proposal-bridge pipeline can submit.
 *
 * Flow:
 *   1. Ask the FreeModelRotator to draft a Plan (files to change + confidence)
 *   2. Parse the JSON response into a Proposal object
 *   3. Return the Proposal (caller feeds it into runPipeline)
 *
 * This is the bridge between natural-language intent and the 5-stage safety
 * pipeline. FreeModelRotator chooses the cheapest, most-available free model.
 */

import type { ChatMessage, ChatResponse, FreeModelRotator } from "./index.ts";
import type { Proposal } from "../../proposal-bridge/src/index.ts";

export interface GenerateProposalOptions {
  /** Preferred model override (defaults to rotator's default) */
  model?: string;
  /** Agent identity for the proposal's "agent" field */
  agent?: { name: string; version: string; modelProvider: string; modelId: string };
  /** Specific files to scope the change (empty = let the model decide) */
  scopeFiles?: string[];
  /** Allow network call (default false — for testing without keys) */
  allowNetwork?: boolean;
}

const SYSTEM_PROMPT: ChatMessage = {
  role: "system",
  content: `You are a Proposal Planner for an AI agent OS called DadaBot.

Given a user intent, produce a JSON object with these fields:
- title: short action-oriented title (max 80 chars)
- rationale: 1-3 sentence explanation of why and how
- confidence: number 0..1 reflecting certainty
- reversible: boolean (true if git revert cleanly undoes it)
- kind: "file_edit" | "file_delete" | "package_install" | "shell_command"
- files: array of {path, operation ("create"|"modify"|"delete"), content, linesAdded, linesRemoved}
- toolCalls: array of {tool, args}

Constraints:
- Maximum 5 files per proposal
- confidence < 0.7 requires human approval (auto-flagged)
- protected paths (.env, id_rsa, /etc/) are FORBIDDEN

Return ONLY the JSON. No prose, no markdown fences.`,
};

export async function generateProposal(
  intent: string,
  rotator: FreeModelRotator,
  opts: GenerateProposalOptions = {},
): Promise<Proposal> {
  if (!opts.allowNetwork && rotator.size() === 0) {
    // Offline fallback: deterministic stub from the intent
    return stubProposal(intent, opts);
  }

  const userPrompt: ChatMessage = {
    role: "user",
    content: `Intent: ${intent}\n\nScope files: ${(opts.scopeFiles ?? []).join(", ") || "(model decides)"}`,
  };

  let resp: ChatResponse;
  try {
    resp = await rotator.chat({
      messages: [SYSTEM_PROMPT, userPrompt],
      model: opts.model,
    });
  } catch {
    return stubProposal(intent, opts);
  }

  // Parse the JSON response
  const parsed = parsePlan(resp.content, intent);
  return {
    id: `prop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    agent: opts.agent ?? {
      name: "dadabot",
      version: "0.1.0",
      modelProvider: resp.provider,
      modelId: resp.model,
    },
    title: parsed.title ?? truncate(intent, 80),
    rationale: parsed.rationale ?? intent,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.7,
    reversible: parsed.reversible ?? true,
    kind: parsed.kind ?? "file_edit",
    files: parsed.files ?? [],
    toolCalls: parsed.toolCalls ?? [],
    createdAt: Date.now(),
  };
}

function parsePlan(raw: string, intent: string): Partial<Proposal> {
  // Try to find JSON in the response (model may add prose)
  const jsonStart = raw.indexOf("{");
  const jsonEnd = raw.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd < 0) return {};
  const slice = raw.slice(jsonStart, jsonEnd + 1);
  try {
    return JSON.parse(slice) as Partial<Proposal>;
  } catch {
    return {};
  }
}

function stubProposal(intent: string, opts: GenerateProposalOptions): Proposal {
  // Deterministic stub when no providers are configured
  return {
    id: `prop-stub-${Date.now().toString(36)}`,
    agent: opts.agent ?? {
      name: "dadabot-stub",
      version: "0.1.0",
      modelProvider: "stub",
      modelId: "stub-model",
    },
    title: truncate(intent, 80),
    rationale: intent,
    confidence: 0.5,  // low enough to require human approval
    reversible: true,
    kind: "file_edit",
    files: [],
    toolCalls: [],
    createdAt: Date.now(),
  };
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
