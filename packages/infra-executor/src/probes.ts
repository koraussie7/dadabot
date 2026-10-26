/**
 * probes.ts — Post-execution verification.
 *
 * A command exiting 0 is NOT proof the service works. Nginx can report a clean
 * reload and still serve 502s. Every action therefore declares at least one
 * verification check, and `verify` failing is what triggers rollback.
 */
import type {
  CommandResult,
  CommandRunner,
  InfraAction,
  InfraActionId,
  Verification,
  VerificationCheck,
} from "./types.ts";

const CHARON_ADMIN_HEALTH = "http://127.0.0.1:8081/api/v1/health";

/** Default probe for sites routed through Charon; overridable per action. */
const DEFAULT_SITE_PROBE = "https://muhanai.com/";

function expectExitZero(command: string, result: CommandResult): Verification {
  return {
    ok: result.exitCode === 0,
    detail:
      result.exitCode === 0
        ? `${command} exit 0`
        : `${command} exit ${result.exitCode}: ${(result.stderr || result.stdout).trim().slice(0, 300)}`,
  };
}

/** curl -o /dev/null -w '%{http_code}' prints the status code as stdout. */
function expectHttpOk(result: CommandResult): Verification {
  const code = Number(result.stdout.trim());
  const ok = result.exitCode === 0 && code > 0 && code < 400;
  return {
    ok,
    detail: ok ? `HTTP ${code}` : `HTTP ${result.stdout.trim() || "?"} (exit ${result.exitCode})`,
  };
}

/**
 * Checks per action. Intentionally conservative: an action with no check
 * listed here is unverifiable and is refused by `verify`.
 */
export function checksFor(action: InfraAction): VerificationCheck[] {
  const id: InfraActionId = action.id;

  switch (id) {
    case "nginx.validate":
      return [
        {
          name: "nginx-syntax",
          async check(runner) {
            const r = await runner.run("nginx", ["-t"]);
            return expectExitZero("nginx -t", r);
          },
        },
      ];

    case "nginx.reload":
      return [
        {
          name: "nginx-syntax",
          async check(runner) {
            const r = await runner.run("nginx", ["-t"]);
            return expectExitZero("nginx -t", r);
          },
        },
        {
          name: "site-http",
          async check(runner) {
            const r = await runner.run("curl", [
              "-fsS",
              "-o",
              "/dev/null",
              "-w",
              "%{http_code}",
              "--max-time",
              "10",
              action.url ?? DEFAULT_SITE_PROBE,
            ]);
            return expectHttpOk(r);
          },
        },
      ];

    case "caddy.validate":
      return [
        {
          name: "caddy-validate",
          async check(runner) {
            const r = await runner.run("caddy", [
              "validate",
              "--config",
              "/etc/caddy/Caddyfile",
              "--adapter",
              "caddyfile",
            ]);
            return expectExitZero("caddy validate", r);
          },
        },
      ];

    case "service.restart":
      return restartChecks(action.service);

    case "health_check":
    case "http.probe":
      return [
        {
          name: "http",
          async check(runner) {
            const url = action.url ?? (id === "health_check" ? CHARON_ADMIN_HEALTH : DEFAULT_SITE_PROBE);
            const r = await runner.run("curl", [
              "-fsS",
              "-o",
              "/dev/null",
              "-w",
              "%{http_code}",
              "--max-time",
              "10",
              url,
            ]);
            return expectHttpOk(r);
          },
        },
      ];

    case "docker.inspect":
      return [
        {
          name: "docker-ps",
          async check(runner) {
            const r = await runner.run("docker", ["ps", "--format", "{{.Names}}|{{.Status}}"]);
            const ok = r.exitCode === 0 && r.stdout.trim().length > 0;
            return { ok, detail: ok ? `${r.stdout.trim().split("\n").length} container(s)` : "docker ps failed" };
          },
        },
      ];

    case "read_logs":
      // Reading is inherently safe; success means the command ran.
      return [
        {
          name: "log-read",
          async check(runner) {
            const r = await runner.run("journalctl", ["--version"]);
            return { ok: r.exitCode === 0, detail: `journalctl exit ${r.exitCode}` };
          },
        },
      ];

    case "config.rollback":
      // Verification is delegated to rollback.ts, which re-runs the caller's
      // original checks after restoring the snapshot.
      return [];

    default: {
      const exhaustive: never = id;
      return [
        {
          name: "unverifiable",
          async check() {
            return { ok: false, detail: `no verification defined for ${String(exhaustive)}` };
          },
        },
      ];
    }
  }
}

function restartChecks(service: InfraAction["service"]): VerificationCheck[] {
  if (service === "charon" || service === "caddy") {
    // Restarting Charon drops every routed site briefly. Verify the admin
    // endpoint first, then the public apex.
    return [
      {
        name: "charon-admin-health",
        async check(runner) {
          const r = await runner.run("curl", [
            "-fsS",
            "--max-time",
            "10",
            CHARON_ADMIN_HEALTH,
          ]);
          return {
            ok: r.exitCode === 0 && r.stdout.includes('"status":"ok"'),
            detail:
              r.exitCode === 0
                ? "admin health ok"
                : `admin health failed: ${r.stderr.trim().slice(0, 200)}`,
          };
        },
      },
      {
        name: "apex-http",
        async check(runner) {
          const r = await runner.run("curl", [
            "-fsS",
            "-o",
            "/dev/null",
            "-w",
            "%{http_code}",
            "--max-time",
            "15",
            DEFAULT_SITE_PROBE,
          ]);
          return expectHttpOk(r);
        },
      },
    ];
  }

  if (service === "nginx") {
    return [
      {
        name: "nginx-syntax",
        async check(runner) {
          const r = await runner.run("nginx", ["-t"]);
          return expectExitZero("nginx -t", r);
        },
      },
    ];
  }

  // traefik (test-only instance)
  return [
    {
      name: "traefik-container",
      async check(runner) {
        const r = await runner.run("docker", ["ps", "--format", "{{.Names}}|{{.Status}}"]);
        const running = r.stdout.split("\n").some((l) => l.startsWith("muhanai-traefik") && l.includes("Up"));
        return { ok: r.exitCode === 0 && running, detail: running ? "traefik up" : "traefik not running" };
      },
    },
  ];
}

/**
 * Run every check. Stops at the first failure so the detail names the actual
 * broken thing rather than a downstream symptom.
 */
export async function verify(
  runner: CommandRunner,
  action: InfraAction,
): Promise<Verification> {
  const checks = checksFor(action);
  if (checks.length === 0) {
    return { ok: false, detail: `no verification defined for ${action.id}` };
  }
  const results: string[] = [];
  for (const check of checks) {
    const result = await check.check(runner, action);
    results.push(`${check.name}: ${result.detail}`);
    if (!result.ok) {
      return { ok: false, detail: results.join(" | ") };
    }
  }
  return { ok: true, detail: results.join(" | ") };
}
