#!/usr/bin/env node
/**
 * dadabot CLI — thin executable wrapper.
 *
 * Resolves the TS source via tsx (dev) or the built JS (prod) and forwards
 * all args. We re-export main() from src/cli.ts.
 *
 * Usage:
 *   dadabot list
 *   dadabot approve <crId>
 *   dadabot reject <crId>
 *   dadabot show <crId>
 *   dadabot run <proposal.json>
 *   dadabot inbox
 *   dadabot doctor
 *   dadabot version
 */
import { run } from "../src/cli.ts";

const code = await run(process.argv.slice(2));
process.exit(code);
