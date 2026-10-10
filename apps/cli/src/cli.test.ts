import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { recordOut } from '../test/out';
import { runCli, type Command } from './cli';
import { CliError } from './errors';
import { CLI_VERSION } from './version';

const hello: Command = {
  usage: 'nitpilot hello <name>',
  summary: 'Say hello',
  async run([name], out) {
    if (!name) throw new CliError('Who should I greet?');
    out.log(`hello ${name}`);
  },
};

describe('runCli', () => {
  it('lists the commands for --help, and when no command is given', async () => {
    for (const argv of [['--help'], []]) {
      const out = recordOut();
      expect(await runCli(argv, out, { hello })).toBe(0);
      expect(out.text()).toContain('Usage: nitpilot <command>');
      expect(out.text()).toContain('nitpilot hello <name>  Say hello');
    }
  });

  it('prints the version, which matches package.json', async () => {
    const out = recordOut();
    expect(await runCli(['--version'], out)).toBe(0);
    expect(out.lines).toEqual([CLI_VERSION]);
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(CLI_VERSION).toBe(pkg.version);
  });

  it('runs a command with the arguments after its name', async () => {
    const out = recordOut();
    expect(await runCli(['hello', 'maya'], out, { hello })).toBe(0);
    expect(out.lines).toEqual(['hello maya']);
  });

  it('shows a CliError as a plain message and exits with 1', async () => {
    const out = recordOut();
    expect(await runCli(['hello'], out, { hello })).toBe(1);
    expect(out.lines).toEqual(['Who should I greet?']);
  });

  it('rejects an unknown command with exit code 2', async () => {
    const out = recordOut();
    expect(await runCli(['nope'], out, { hello })).toBe(2);
    expect(out.text()).toContain('Unknown command: nope');
  });

  it('treats names every JS object has (constructor, toString) as unknown commands', async () => {
    for (const name of ['constructor', 'toString', '__proto__']) {
      const out = recordOut();
      expect(await runCli([name], out, { hello })).toBe(2);
      expect(out.text()).toContain(`Unknown command: ${name}`);
    }
  });
});
