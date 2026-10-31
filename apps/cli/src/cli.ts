import { BRAND } from '@nitpilot/protocol';
import { doctor } from './commands/doctor';
import { login, loginOptions } from './commands/login';
import { reposAdd } from './commands/repos';
import { retry } from './commands/retry';
import { RULES_USAGE, rulesSuggest } from './commands/rules';
import { review, reviewOptions } from './commands/review';
import { start } from './commands/start';
import { status, statusOptions } from './commands/status';
import { CliError } from './errors';
import type { Out } from './out';
import { CLI_VERSION } from './version';

/** One `nitpilot <name>` command. `run` gets the arguments after the name and may return an exit code. */
export type Command = { usage: string; summary: string; run(args: string[], out: Out): Promise<number | void> };

/** Every command, in the order `--help` lists them. Each lives in src/commands/ and is added by the task that builds it. */
export const COMMANDS: Record<string, Command> = {
  login: { usage: `${BRAND.cli} login [--no-open]`, summary: 'Connect this device to your account', run: (args, out) => login({ out, ...loginOptions(args) }) },
  start: { usage: `${BRAND.cli} start`, summary: 'Stay connected and run jobs (Ctrl-C stops)', run: (_args, out) => start({ out }) },
  status: { usage: `${BRAND.cli} status [--json|--line]`, summary: 'Your open PRs and what they need from you', run: (args, out) => status({ out, ...statusOptions(args) }) },
  doctor: { usage: `${BRAND.cli} doctor`, summary: 'Check this machine is ready to run jobs', run: (_args, out) => doctor({ out }) },
  repos: {
    usage: `${BRAND.cli} repos add [path]`,
    summary: 'Link a local clone, so its jobs can come here',
    run: async ([sub, path], out) => {
      if (sub !== 'add') throw new CliError(`Usage: ${BRAND.cli} repos add [path]`);
      await reposAdd(path, { out });
    },
  },
  review: {
    usage: `${BRAND.cli} review <pr-url> [--post [--yes]]`,
    summary: 'Have your agent review one PR now, no account needed',
    run: (args, out) => {
      const { ref, ...flags } = reviewOptions(args);
      return review(ref, { out, ...flags });
    },
  },
  rules: {
    usage: `${BRAND.cli} rules suggest [owner/name]`,
    summary: "Draft .nitpilot.yml guidelines from the repo's past reviews",
    run: ([sub, repo, ...rest], out) => {
      if (sub !== 'suggest' || rest.length > 0 || repo?.startsWith('-')) throw new CliError(RULES_USAGE);
      return rulesSuggest(repo, { out });
    },
  },
  retry: { usage: `${BRAND.cli} retry <pr-url>`, summary: 'Run your failed job on that PR again', run: ([ref], out) => retry(ref, { out }) },
};

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
