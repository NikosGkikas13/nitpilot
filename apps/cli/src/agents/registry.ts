import { BRAND, type AgentId } from '@nitpilot/protocol';
import type { PersonalConfig } from '../config/config';
import type { RunProgram } from '../run-program';
import { claudeCodeAdapter } from './claude-code/adapter';
import { fakeAdapter } from './fake/adapter';
import type { AgentAdapter } from './types';

/** Names the scenario file the fake agent follows, instead of its built-in happy.json (live runs and tests only). */
export const FAKE_SCENARIO_ENV = `${BRAND.envPrefix}FAKE_SCENARIO`;

/**
 * The adapter for an agent. `run` is for tests (a pretend program); `scenario` is the fake agent's script. Gemini CLI's (Task 20) waits on
 * Google's sign-in (spec §22); until then it's null, and `nitpilot start` takes no jobs with it.
 */
export function getAdapter(id: AgentId, opts: { apiKey?: string; apiBilling?: boolean; env?: Record<string, string | undefined>; run?: RunProgram; scenario?: string } = {}): AgentAdapter | null {
  switch (id) {
    case 'fake':
      return fakeAdapter({ scenario: opts.scenario });
    case 'claude-code':
      return claudeCodeAdapter(opts);
    case 'gemini-cli':
      return null;
  }
}

/**
 * The adapter your config names. Claude Code gets your ANTHROPIC_API_KEY only when you opted into API
 * billing (spec §12.2). The fake agent follows the scenario file named by NITPILOT_FAKE_SCENARIO. `run` is for tests (a pretend program).
 */
export function adapterFor(config: Pick<PersonalConfig, 'agent' | 'apiBilling'>, env: Record<string, string | undefined>, opts: { run?: RunProgram } = {}): AgentAdapter | null {
  return getAdapter(config.agent, { apiBilling: config.apiBilling, apiKey: config.apiBilling ? env.ANTHROPIC_API_KEY : undefined, env, run: opts.run, scenario: env[FAKE_SCENARIO_ENV] || undefined });
}
