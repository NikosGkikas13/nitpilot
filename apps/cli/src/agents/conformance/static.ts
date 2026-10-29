import { readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { tempDir } from '../../../test/temp';
import { agentBaseEnv, runAgent } from '../runner';
import type { AgentAdapter, AgentEvent, AgentInvocation, AgentMode, AgentOutcome, InvocationInput } from '../types';

/** One recorded run of the agent: its stdout (a file of `fixtures`), how it ended, and what Nitpilot makes of it. */
export type FixtureCase = { file: string; code: number | null; signal: string | null; stderr?: string; outcome: AgentOutcome };

export type StaticSuite = {
  adapter: AgentAdapter;
  /** The built-in tools an invocation turns on, read from its arguments or files, in the agent's own names. */
  toolsOf(invocation: AgentInvocation): string[];
  /** The agent's names for tools that only read, and for tools that edit files. Anything else (a shell, the web) fails S1. */
  readTools: readonly string[];
  editTools: readonly string[];
  /** Per mode, the argument sequences that keep the agent away from the repo's own settings, hooks and servers (S4). */
  isolation: Record<AgentMode, readonly (readonly string[])[]>;
  /** The folder of recorded runs, and each one's expected outcome (S5): success, max_turns, auth, quota, crash, signal. */
  fixtures: { dir: string; cases: FixtureCase[] };
};

/** Variables that must never reach an agent (spec §12.3 S3). */
const SECRETS = { ANTHROPIC_API_KEY: 'sk-ant-x', GITHUB_TOKEN: 'ghp_x', GH_TOKEN: 'gho_x', COPILOT_GITHUB_TOKEN: 'github_pat_x', NPM_TOKEN: 'npm_x', AWS_SECRET_ACCESS_KEY: 'aws-x', AWS_PROFILE: 'prod' };
/** Lines that aren't the agent's events: parseLine must shrug at every one (S5). */
const GARBAGE = ['', 'not json', 'null', '42', '[]', '"text"', '{}', '{"type":"assistant","message":{"content":[null,1,"x"]}}', '{"type":"result"}', '{"type":"result","errors":"x"}'];

/**
 * The static conformance suite (spec §12.3 S1–S6): every adapter runs it in CI. It builds invocations and
 * reads recorded output, so it needs no agent installed. The live suite (live.test.ts) runs the real one.
 */
export function staticConformance(suite: StaticSuite): void {
  const { adapter } = suite;
  const input = (mode: AgentMode, over: Partial<InvocationInput> = {}): InvocationInput => ({
    mode, cwd: '/work', prompt: 'Review this PR.', mcp: { url: 'http://127.0.0.1:4100/mcp', token: 'tok-9f8e7d6c5b4a' }, tmpDir: tempDir(), baseEnv: agentBaseEnv(), maxTurns: 50, ...over,
  });

  describe(`${adapter.id}: static conformance (spec §12.3)`, () => {
    it('S1: a reviewer only reads; an editor adds only edit tools', () => {
      const reviewer = suite.toolsOf(adapter.buildInvocation(input('reviewer')));
      expect(reviewer.length).toBeGreaterThan(0);
      expect(reviewer.filter((tool) => !suite.readTools.includes(tool))).toEqual([]);
      if (!adapter.modes.includes('editor')) return;
      const editor = suite.toolsOf(adapter.buildInvocation(input('editor')));
      expect(editor.filter((tool) => !suite.readTools.includes(tool) && !suite.editTools.includes(tool))).toEqual([]);
      expect(editor.some((tool) => suite.editTools.includes(tool))).toBe(true);
    });

    for (const mode of adapter.modes) {
      it(`S2: the MCP token is only in a 0600 file inside the run's private folder (${mode})`, async () => {
        const i = input(mode);
        const invocation = adapter.buildInvocation(i);
        expect(JSON.stringify(invocation.args)).not.toContain(i.mcp.token);
        expect(Object.values(invocation.env).join('\n')).not.toContain(i.mcp.token);
        expect(invocation.files.filter((file) => file.content.includes(i.mcp.token))).toHaveLength(1);
        for (const file of invocation.files) expect(file.path.startsWith(i.tmpDir + sep)).toBe(true);
        // runAgent writes them: run a program that does nothing in place of the agent, then look.
        await runAgent(adapter, { ...invocation, command: process.execPath, args: ['-e', ''] }, { cwd: tempDir(), timeoutMs: 10_000 });
        for (const file of invocation.files) {
          expect(statSync(file.path).mode & 0o777).toBe(0o600);
          expect(readFileSync(file.path, 'utf8')).toBe(file.content);
        }
      });

      it(`S3: no API key or cloud token reaches the agent unless you opted in (${mode})`, () => {
        // In your environment, where an adapter that reads process.env itself would find them.
        for (const [name, value] of Object.entries(SECRETS)) vi.stubEnv(name, value);
        onTestFinished(() => void vi.unstubAllEnvs());
        const invocation = adapter.buildInvocation(input(mode, { baseEnv: agentBaseEnv(process.env) }));
        expect(Object.keys(invocation.env).filter((name) => name in SECRETS || name.startsWith('AWS_'))).toEqual([]);
      });

      it(`S4: the isolation flags are there (${mode})`, () => {
        const { args } = adapter.buildInvocation(input(mode));
        for (const flags of suite.isolation[mode]) expect(containsRun(args, flags), `${flags.join(' ')} in ${args.join(' ')}`).toBe(true);
      });
    }

    it('S5: parseLine and outcome read every recorded run, and parseLine never throws', () => {
      for (const line of GARBAGE) expect(() => adapter.parseLine(line), line).not.toThrow();
      for (const c of suite.fixtures.cases) {
        let last: AgentEvent | undefined;
        for (const line of readFileSync(join(suite.fixtures.dir, c.file), 'utf8').split('\n')) last = adapter.parseLine(line) ?? last;
        expect(adapter.outcome({ code: c.code, signal: c.signal, last, stderrTail: c.stderr ?? '' }), c.file).toEqual(c.outcome);
      }
    });

    it('S6: asking for a mode it does not declare throws, naming the mode', () => {
      const missing = (['reviewer', 'editor', 'janitor'] as AgentMode[]).filter((mode) => !adapter.modes.includes(mode));
      for (const mode of missing) expect(() => adapter.buildInvocation(input(mode)), mode).toThrow(mode);
    });
  });
}

/** Does `args` contain `run` as consecutive items? */
function containsRun(args: readonly string[], run: readonly string[]): boolean {
  return args.some((_, start) => run.every((item, offset) => args[start + offset] === item));
}
