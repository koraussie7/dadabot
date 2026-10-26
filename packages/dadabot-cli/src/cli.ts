/**
 * cli.ts — main entry point.
 *
 * Subcommands:
 *   list [--status <s>] [--agent <n>] [--json] [--limit N]
 *   show <crId> [--json]
 *   approve <crId> [--comment "..."] [--json]
 *   reject <crId>  [--comment "..."] [--json]
 *   run <proposal.json> [--auto-approve] [--json]
 *   inbox [--json]
 *   doctor [--json]
 *   version
 *   help
 */

import { parseArgs } from "./args.ts";
import { loadEnv } from "./env.ts";
import {
  cmdList,
  cmdShow,
  cmdApprove,
  cmdReject,
  cmdRun,
  cmdInbox,
  cmdDoctor,
  cmdVersion,
  cmdMigrateInbox,
} from "./commands.ts";
import {
  type ChangeRequestStatus,
} from "../../busabase-adapter/src/index.ts";

const HELP = `
dadabot — Local-first AI Agent OS CLI

Usage:
  dadabot <command> [options]

Commands:
  list        List ChangeRequests in inbox
  show        Show one ChangeRequest in detail
  approve     Approve a ChangeRequest
  reject      Reject a ChangeRequest
  run         Run a Proposal through the 5-stage safety pipeline
  inbox       Summarize inbox counts
  doctor      System health check
  version     Print version info
  help        Print this help

Options:
  --status <open|approved|...>  Filter list by status
  --agent <name>                Filter list by agent name
  --limit N                     Limit list output
  --json                        JSON output
  --comment "..."               Comment attached to approve/reject
  --auto-approve                run: auto-approve via policy (bypasses inbox)

Environment:
  DADABOT_HOME       Storage directory (default $HOME/.dadabot)
  DADABOT_DRY_RUN=1  Don't persist any changes
  DADABOT_VERSION    Reported in 'dadabot version'

Examples:
  dadabot list --status open
  dadabot approve a1b2c3d4 --comment "lgtm"
  dadabot show a1b2c3d4 --json
  dadabot run proposal.json --auto-approve
  dadabot doctor
`.trim();

export function run(argv: string[]): number {
  const parsed = parseArgs(argv);
  const env = loadEnv();

  if (parsed.flags["help"] === true || parsed.command === null || parsed.command === "help") {
    console.log(HELP);
    return 0;
  }

  try {
    switch (parsed.command) {
      case "version":
      case "--version":
      case "-v":
        return cmdVersion(env);

      case "doctor":
        return cmdDoctor(env, { json: parsed.flags["json"] === true });

      case "inbox":
        return cmdInbox(env, { json: parsed.flags["json"] === true });

      case "migrate-inbox":
        return cmdMigrateInbox(env, { json: parsed.flags["json"] === true });

      case "list":
        return cmdList(env, {
          status: typeof parsed.flags["status"] === "string" ? (parsed.flags["status"] as ChangeRequestStatus) : undefined,
          agent: typeof parsed.flags["agent"] === "string" ? parsed.flags["agent"] : undefined,
          json: parsed.flags["json"] === true,
          limit: typeof parsed.flags["limit"] === "string" ? parseInt(parsed.flags["limit"], 10) : undefined,
        });

      case "show": {
        const id = parsed.positional[0];
        if (!id) { console.error("error: show requires a CR id"); return 1; }
        return cmdShow(env, { id, json: parsed.flags["json"] === true });
      }

      case "approve": {
        const id = parsed.positional[0];
        if (!id) { console.error("error: approve requires a CR id"); return 1; }
        return cmdApprove(env, {
          id,
          comment: typeof parsed.flags["comment"] === "string" ? parsed.flags["comment"] : undefined,
          json: parsed.flags["json"] === true,
        });
      }

      case "reject": {
        const id = parsed.positional[0];
        if (!id) { console.error("error: reject requires a CR id"); return 1; }
        return cmdReject(env, {
          id,
          comment: typeof parsed.flags["comment"] === "string" ? parsed.flags["comment"] : undefined,
          json: parsed.flags["json"] === true,
        });
      }

      case "run": {
        const file = parsed.positional[0];
        if (!file) { console.error("error: run requires a Proposal JSON file"); return 1; }
        const r = cmdRun(env, {
          file,
          autoApprove: parsed.flags["auto-approve"] === true,
          json: parsed.flags["json"] === true,
        });
        return r;
      }

      default:
        console.error(`error: unknown command '${parsed.command}'`);
        console.error(`Run 'dadabot help' for usage.`);
        return 1;
    }
  } catch (err) {
    console.error(`error: ${(err as Error).message}`);
    return 1;
  }
}

// Re-export for direct programmatic use
export { parseArgs } from "./args.ts";
export { loadEnv, formatTable, formatJson } from "./env.ts";
