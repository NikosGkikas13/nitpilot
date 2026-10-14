import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCRUB_PATHS } from '../../runner/scrub';
import { CLI_VERSION } from '../../version';
import type { AgentAdapter, AgentEvent } from '../types';

/** The fake agent's script. It only exists in a source checkout: the published CLI doesn't ship it. */
const AGENT_SCRIPT = fileURLToPath(new URL('./agent.ts', import.meta.url));
/** The scenario files that come with it. */
export const FAKE_SCENARIOS = fileURLToPath(new URL('./scenarios/', import.meta.url));

/**
 * The fake agent's adapter (spec §12.2 "Fake agent"): it runs agent.ts, a small Node script that follows
 * a scenario file over real MCP. Tests and CI use it in place of Claude Code or Gemini CLI.
 */
export function fakeAdapter(opts: { scenario?: string } = {}): AgentAdapter {
  const scenario = opts.scenario ?? join(FAKE_SCENARIOS, 'happy.json');
  return {
    id: 'fake',
    modes: ['reviewer', 'editor'],
    // It loads nothing by itself, but it scrubs what every agent would, so tests see what real jobs see.
    scrubPaths: SCRUB_PATHS,
    async detect() {
      if (!existsSync(AGENT_SCRIPT)) return { ok: false, problem: 'The fake agent only runs from a source checkout of Nitpilot: it is for tests.' };
      if (!existsSync(scenario)) return { ok: false, problem: `The fake agent's scenario file ${scenario} doesn't exist.` };
      return { ok: true, version: CLI_VERSION };
    },
    buildInvocation(i) {
      const mcpConfig = join(i.tmpDir, 'mcp.json');
      return {
        command: process.execPath,
        // The token goes in a file, never on the command line, where other programs could read it.
        args: ['--experimental-strip-types', '--no-warnings', AGENT_SCRIPT, '--mcp-config', mcpConfig, '--scenario', scenario],
        env: i.baseEnv,
        files: [{ path: mcpConfig, content: JSON.stringify({ url: i.mcp.url, token: i.mcp.token }) }],
      };
    },
    parseLine(line) {
      try {
        const event = JSON.parse(line) as Partial<Record<string, unknown>>;
        if (event.type === 'progress' && typeof event.text === 'string') return { type: 'progress', text: event.text };
        if (event.type === 'result' && typeof event.ok === 'boolean') return { type: 'result', ok: event.ok, text: String(event.text ?? '') };
      } catch {
        // not one of ours
      }
      return null;
    },
    outcome({ code, last }) {
      return code === 0 && isSuccess(last) ? { ok: true } : { ok: false, reason: 'crash', retryable: true };
    },
  };
}

function isSuccess(event: AgentEvent | undefined): boolean {
  return event?.type === 'result' && event.ok;
}
