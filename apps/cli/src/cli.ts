import { BRAND } from '@nitpilot/protocol';
import { CliError } from './errors';
import type { Out } from './out';
import { CLI_VERSION } from './version';

/** One `nitpilot <name>` command. `run` gets the arguments after the name and may return an exit code. */
export type Command = { usage: string; summary: string; run(args: string[], out: Out): Promise<number | void> };

/** Every command, in the order `--help` lists them. Each lives in src/commands/ and is added by the task that builds it. */
export const COMMANDS: Record<string, Command> = {};

/** Run the CLI with these arguments and return the exit code. src/index.ts calls it with process.argv. */
export async function runCli(argv: string[], out: Out, commands: Record<string, Command> = COMMANDS): Promise<number> {
  const [name, ...args] = argv;
  if (name === undefined || name === 'help' || name === '--help' || name === '-h') {
    out.log(usage(commands));
    return 0;
  }
  if (name === '--version' || name === '-v') {
    out.log(CLI_VERSION);
    return 0;
  }
  // Own keys only: "constructor" or "toString" would otherwise find Object's built-ins.
  const command = Object.hasOwn(commands, name) ? commands[name] : undefined;
  if (!command) {
    out.error(`Unknown command: ${name}\n`);
    out.error(usage(commands));
    return 2;
  }
  try {
    return (await command.run(args, out)) ?? 0;
  } catch (err) {
    // A CliError is a message for the person; anything else is a bug, so show where it happened.
    out.error(err instanceof CliError ? err.message : `Unexpected error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    return 1;
  }
}

export function usage(commands: Record<string, Command>): string {
  const width = Math.max(0, ...Object.values(commands).map((c) => c.usage.length));
  return [
    `${BRAND.name}: your own AI agent reviews your teammates' pull requests, and theirs reviews yours.`,
    '',
    `Usage: ${BRAND.cli} <command>`,
    '',
    ...Object.values(commands).map((c) => `  ${c.usage.padEnd(width)}  ${c.summary}`),
    '',
    `  ${BRAND.cli} --version`,
  ].join('\n');
}
