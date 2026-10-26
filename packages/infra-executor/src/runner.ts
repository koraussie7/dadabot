/**
 * runner.ts — Turns a validated InfraAction into a concrete argv and runs it.
 *
 * Hard rules:
 *   • spawn() with shell:false and an argv ARRAY. No string concatenation ever
 *     reaches a shell, so there is no injection surface to sanitize.
 *   • The command is chosen from a closed table keyed by InfraActionId.
 *     Callers cannot supply an executable.
 *   • Only whitelisted binaries may be invoked; the table doubles as that list.
 *
 * MuhanAI specifics baked into the table (see INFRA-AUTOMATION-EXECUTION-PLAN §3-3):
 *   • nginx systemd unit is masked on the VPS, so reload uses `nginx -s reload`.
 *   • Charon is a Docker container; restarting it briefly drops every routed
 *     site, which is why allowlist.ts forces human approval for it.
 */
import { spawn } from "node:child_process";
import type {
  CommandResult,
  CommandRunner,
  InfraAction,
  InfraActionId,
  RestartableService,
} from "./types.ts";

export interface CommandSpec {
  command: string;
  argv: readonly string[];
}

/** Binaries the executor is permitted to spawn. Nothing else exists in code. */
export const ALLOWED_BINARIES: ReadonlySet<string> = new Set([
  "nginx",
  "caddy",
  "docker",
  "curl",
  "tail",
  "journalctl",
  "sqlite3",
  "systemctl",
]);

const DEFAULT_TIMEOUT_MS = 30_000;

/** Test instance path. The production promotion changes these two constants. */
export const TRAEFIK_COMPOSE = "/opt/muhanai-traefik-test/compose.yaml";
export const TUNNEL_UNIT = "cloudflared-muhanai-traefik";

/**
 * Build the argv for an action. Pure — used by tests and by dry-run previews.
 * Throws on anything it cannot express as a fixed argv (defence in depth:
 * allowlist.ts should already have refused it).
 */
export function buildCommand(action: InfraAction): CommandSpec {
  const id: InfraActionId = action.id;

  switch (id) {
    case "nginx.validate":
      return { command: "nginx", argv: ["-t"] };

    case "nginx.reload":
      // `-s reload` re-reads config in the running master; works with a masked unit.
      return { command: "nginx", argv: ["-s", "reload"] };

    case "caddy.validate":
      return {
        command: "caddy",
        argv: ["validate", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"],
      };

    case "docker.inspect":
      return { command: "docker", argv: ["ps", "--format", "{{.Names}}|{{.Status}}"] };

    case "read_logs":
      // Lines are re-validated here even though allowlist.ts bounded them.
      return {
        command: "journalctl",
        argv: ["-n", String(clampLines(action.lines)), "--no-pager"],
      };

    case "http.probe":
      return {
        command: "curl",
        argv: ["-fsS", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "10", requireUrl(action)],
      };

    case "health_check":
      // Local Charon admin health is the cheapest liveness signal for routing.
      return {
        command: "curl",
        argv: ["-fsS", "--max-time", "5", "http://127.0.0.1:8081/api/v1/health"],
      };

    case "service.restart":
      return restartCommand(requireService(action));

    case "traefik.validate":
      return {
        command: "docker",
        argv: ["compose", "-f", TRAEFIK_COMPOSE, "config", "-q"],
      };

    case "traefik.reload":
      // `up -d` reconciles only what changed; dynamic/ files are hot-reloaded
      // by file.watch, so this rarely needs to do anything.
      return { command: "docker", argv: ["compose", "-f", TRAEFIK_COMPOSE, "up", "-d"] };

    case "tunnel.status":
      return { command: "systemctl", argv: ["is-active", TUNNEL_UNIT] };

    case "tunnel.restart":
      // Blast radius: every hostname published through this tunnel.
      return { command: "systemctl", argv: ["restart", TUNNEL_UNIT] };

    case "config.rollback":
      // Handled by rollback.ts (file restore), not by a subprocess.
      throw new Error("config.rollback is not a subprocess action");

    default: {
      const exhaustive: never = id;
      throw new Error(`unhandled action: ${String(exhaustive)}`);
    }
  }
}

function restartCommand(service: RestartableService): CommandSpec {
  switch (service) {
    case "nginx":
      // Prefer reload semantics: restarting nginx drops in-flight requests.
      return { command: "nginx", argv: ["-s", "reload"] };
    case "caddy":
      return { command: "docker", argv: ["restart", "charon"] };
    case "charon":
      return { command: "docker", argv: ["restart", "charon"] };
    case "traefik":
      return { command: "docker", argv: ["compose", "-f", TRAEFIK_COMPOSE, "restart"] };
    case "cloudflared":
      return { command: "systemctl", argv: ["restart", TUNNEL_UNIT] };
  }
}

function clampLines(lines: number | undefined): number {
  if (lines === undefined) return 200;
  if (!Number.isInteger(lines) || lines <= 0) {
    throw new Error("read_logs: lines must be a positive integer");
  }
  return Math.min(lines, 10_000);
}

function requireUrl(action: InfraAction): string {
  if (!action.url || !/^https?:\/\//i.test(action.url)) {
    throw new Error("http.probe: url must be http(s)");
  }
  return action.url;
}

function requireService(action: InfraAction): RestartableService {
  if (!action.service) throw new Error("service.restart: service is required");
  return action.service;
}

// ---------------------------------------------------------------------------
// Real runner
// ---------------------------------------------------------------------------

export interface SpawnRunnerOptions {
  timeoutMs?: number;
  /** Guard against a caller injecting a path like "../bin/sh". */
  allowUnlistedCommand?: boolean;
}

/**
 * Production CommandRunner backed by node:child_process.spawn.
 * `shell` is false and `argv` is an array — both non-negotiable.
 */
export function createSpawnRunner(options: SpawnRunnerOptions = {}): CommandRunner {
  return {
    async run(command, argv, runOptions) {
      const base = command.split("/").pop() ?? command;
      if (!options.allowUnlistedCommand && !ALLOWED_BINARIES.has(base)) {
        throw new Error(`refusing to spawn non-allowlisted binary: ${command}`);
      }

      const timeoutMs = runOptions?.timeoutMs ?? options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const startedAt = Date.now();

      return await new Promise<CommandResult>((resolve, reject) => {
        const child = spawn(command, [...argv], {
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
          timeout: timeoutMs,
        });

        const out: Buffer[] = [];
        const err: Buffer[] = [];
        child.stdout?.on("data", (c: Buffer) => out.push(c));
        child.stderr?.on("data", (c: Buffer) => err.push(c));

        child.on("error", (e) => {
          reject(new Error(`spawn ${command} failed: ${e.message}`));
        });

        child.on("close", (code, signal) => {
          resolve({
            command,
            argv: [...argv],
            // A SIGTERM from `timeout` surfaces as a null exit code; keep that
            // distinguishable rather than pretending it succeeded.
            exitCode: signal ? null : code,
            stdout: Buffer.concat(out).toString("utf8"),
            stderr: Buffer.concat(err).toString("utf8"),
            durationMs: Date.now() - startedAt,
          });
        });
      });
    },
  };
}

/**
 * Deterministic runner for tests and dry-runs. Matches on `command` and the
 * full argv joined by spaces, so a test cannot accidentally match a prefix.
 */
export interface ScriptedResponse {
  command: string;
  argv: readonly string[];
  exitCode?: number;
  stdout?: string;
  stderr?: string;
}

export interface RecordingRunner extends CommandRunner {
  calls: { command: string; argv: readonly string[] }[];
}

export function createRecordingRunner(
  script: readonly ScriptedResponse[] = [],
  defaults: { exitCode?: number; stdout?: string; stderr?: string } = {},
): RecordingRunner {
  const calls: { command: string; argv: readonly string[] }[] = [];
  const replay = [...script];

  return {
    calls,
    async run(command, argv) {
      calls.push({ command, argv: [...argv] });

      const exact = replay.findIndex(
        (r) => r.command === command && r.argv.join(" ") === argv.join(" "),
      );
      const matched = exact >= 0 ? replay.splice(exact, 1)[0] : undefined;

      const exitCode = matched?.exitCode ?? defaults.exitCode ?? 0;
      return {
        command,
        argv: [...argv],
        exitCode,
        stdout: matched?.stdout ?? defaults.stdout ?? "",
        stderr: matched?.stderr ?? defaults.stderr ?? "",
        durationMs: 1,
      };
    },
  };
}
