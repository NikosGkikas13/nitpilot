import type { AgentId } from '@nitpilot/protocol';
import type { PersonalConfig } from '../config/config';
import type { RunProgram } from '../run-program';
import { claudeCodeAdapter } from './claude-code/adapter';
import { fakeAdapter } from './fake/adapter';
import type { AgentAdapter } from './types';

/**
 * The adapter for an agent. `run` is for tests (a pretend program). Gemini CLI's (Task 20) waits on Google's sign-in (spec §22); until then it's
 * null, and `nitpilot start` takes no jobs with it.
 */
export function getAdapter(id: AgentId, opts: { apiKey?: string; apiBilling?: boolean; run?: RunProgram } = {}): AgentAdapter | null {
  switch (id) {
    case 'fake':
      return fakeAdapter();
    case 'claude-code':
      return claudeCodeAdapter(opts);
    case 'gemini-cli':
      return null;
  }
}

/**
 * The adapter your config names. Claude Code gets your ANTHROPIC_API_KEY only when you opted into API
 * billing (spec §12.2). `run` is for tests (a pretend program).
 */
export function adapterFor(config: Pick<PersonalConfig, 'agent' | 'apiBilling'>, env: Record<string, string | undefined>, opts: { run?: RunProgram } = {}): AgentAdapter | null {
  return getAdapter(config.agent, { apiBilling: config.apiBilling, apiKey: config.apiBilling ? env.ANTHROPIC_API_KEY : undefined, run: opts.run });
}
