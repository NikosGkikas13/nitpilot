import { BRAND, type AgentId } from '@nitpilot/protocol';
import type { PersonalConfig } from '../config/config';
import type { RunProgram } from '../run-program';
import { claudeCodeAdapter } from './claude-code/adapter';
import { codexAdapter } from './codex/adapter';
import { copilotAdapter } from './copilot/adapter';
import { fakeAdapter } from './fake/adapter';
import { geminiCliAdapter } from './gemini-cli/adapter';
import type { AgentAdapter } from './types';

/** Names the scenario file the fake agent follows, instead of its built-in happy.json (live runs and tests only). */
export const FAKE_SCENARIO_ENV = `${BRAND.envPrefix}FAKE_SCENARIO`;

/**
 * The adapter for an agent. `apiKey` is the agent's own key (ANTHROPIC_API_KEY or GEMINI_API_KEY), only when you opted into
 * API billing. `run` is for tests (a pretend program); `scenario` is the fake agent's script.
 */
export function getAdapter(id: AgentId, opts: { apiKey?: string; apiBilling?: boolean; env?: Record<string, string | undefined>; run?: RunProgram; scenario?: string } = {}): AgentAdapter | null {
  switch (id) {
    case 'fake':
      return fakeAdapter({ scenario: opts.scenario });
    case 'claude-code':
      return claudeCodeAdapter(opts);
    case 'copilot':
      return copilotAdapter(opts);
    case 'codex':
      return codexAdapter(opts);
    case 'gemini-cli':
      return geminiCliAdapter(opts);
  }
}

/**
 * The adapter your config names. Claude Code gets your ANTHROPIC_API_KEY, and Gemini CLI your GEMINI_API_KEY, only when
 * you opted into API billing (spec §12.2); no other key ever reaches either. The fake agent follows the scenario file named by NITPILOT_FAKE_SCENARIO. `run` is for tests (a pretend program).
 */
export function adapterFor(config: Pick<PersonalConfig, 'agent' | 'apiBilling'>, env: Record<string, string | undefined>, opts: { run?: RunProgram } = {}): AgentAdapter | null {
  const keyName = config.agent === 'gemini-cli' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY';
  return getAdapter(config.agent, { apiBilling: config.apiBilling, apiKey: config.apiBilling ? env[keyName] || undefined : undefined, env, run: opts.run, scenario: env[FAKE_SCENARIO_ENV] || undefined });
}
