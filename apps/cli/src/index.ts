#!/usr/bin/env node
import { runCli } from './cli';
import { terminal } from './out';

// The `nitpilot` binary. Everything lives in cli.ts, so tests can run the CLI without starting a process.
process.exitCode = await runCli(process.argv.slice(2), terminal);
