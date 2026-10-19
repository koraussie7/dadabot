/**
 * synopsis.ts — Generates a textual + structured summary of a Proposal.
 *
 * Used to:
 *   - populate busabase-adapter CR.dryRunPreview
 *   - render a short notification on the web console
 *   - send a Slack/email digest of pending reviews
 */

import type { Proposal } from "./proposal.js";

export interface Synopsis {
  headline: string;
  body: string;
  fileList: string[];
  riskTag: "low" | "medium" | "high" | "critical";
}

export function synopsis(proposal: Proposal): Synopsis {
  const totalLines = proposal.files.reduce(
    (acc, f) => acc + (f.linesAdded ?? 0) + (f.linesRemoved ?? 0),
    0,
  );
  const fileList = proposal.files.map((f) =>
    `${operationSymbol(f.operation)} ${f.path}${f.linesAdded !== undefined ? ` (+${f.linesAdded}/-${f.linesRemoved ?? 0})` : ""
    }`,
  );
  const risk = classifyRisk(proposal);
  const headline = `[${risk.toUpperCase()}] ${proposal.title}`;
  const body = [
    `**Agent**: ${proposal.agent.name} v${proposal.agent.version}`,
    `**Model**: ${proposal.agent.modelProvider}/${proposal.agent.modelId}`,
    `**Confidence**: ${proposal.confidence.toFixed(2)}`,
    `**Lines touched**: ${totalLines}`,
    "",
    proposal.rationale,
    "",
    "**Files:**",
    ...fileList.map((l) => `- ${l}`),
    proposal.toolCalls.length > 0
      ? "\n**Tool calls:**\n" +
      proposal.toolCalls.map((t) => `- \`${t.name}(${JSON.stringify(t.args)})\``).join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { headline, body, fileList, riskTag: risk };
}

function operationSymbol(op: string): string {
  switch (op) {
    case "create":
      return "＋";
    case "modify":
      return "✎";
    case "delete":
      return "✖";
    default:
      return "•";
  }
}

function classifyRisk(proposal: Proposal): Synopsis["riskTag"] {
  if (proposal.kind === "shell_command") return "critical";
  if (proposal.kind === "package_install") return "high";
  if (proposal.kind === "file_delete") return "high";
  if (proposal.files.some((f) => /\.(?:env|secrets?|pem|key)/i.test(f.path))) return "critical";
  if (proposal.confidence < 0.5) return "high";
  if (proposal.confidence < 0.7) return "medium";
  return "low";
}
