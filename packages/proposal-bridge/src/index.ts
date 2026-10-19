/**
 * @agentmesh/proposal-bridge — public entry point.
 *
 * The single integration point of Dadabot's safety pipeline. Wires together:
 *   - sam-tools free-model output  → Proposal
 *   - busabase-adapter              → ChangeRequest, Inbox, audit
 *   - affine-adapter                → ai-message + human-note canvas blocks
 */
export * from "./proposal.ts";
export * from "./pipeline.ts";
export * from "./executor.ts";
export * from "./synopsis.ts";
