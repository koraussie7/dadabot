/**
 * args.ts — minimal argv parser (no commander dependency).
 *
 * Supports:
 *   --flag
 *   --key value
 *   --key=value
 * Positional args after subcommand are gathered into args.positional[].
 */

export interface ParsedArgs {
  command: string | null;
  positional: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    command: null,
    positional: [],
    flags: {},
  };
  let i = 0;
  // First non-flag token is the subcommand
  while (i < argv.length) {
    const tok = argv[i]!;
    if (tok.startsWith("--")) {
      const eq = tok.indexOf("=");
      if (eq >= 0) {
        out.flags[tok.slice(2, eq)] = tok.slice(eq + 1);
        i += 1;
      } else {
        const key = tok.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          out.flags[key] = next;
          i += 2;
        } else {
          out.flags[key] = true;
          i += 1;
        }
      }
    } else if (out.command === null) {
      out.command = tok;
      i += 1;
    } else {
      out.positional.push(tok);
      i += 1;
    }
  }
  return out;
}
