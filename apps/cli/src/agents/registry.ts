import type { AgentId } from '@nitpilot/protocol';
import type { PersonalConfig } from '../config/config';
import { claudeCodeAdapter } from './claude-code/adapter';
import { fakeAdapter } from './fake/adapter';
import type { AgentAdapter } from './types';

/**
 * The adapter for an agent. Gemini CLI's (Task 20) waits on Google's sign-in (spec §22); until then it's
 * null, and `nitpilot start` takes no jobs with it.
 */
export function getAdapter(id: AgentId, opts: { apiKey?: string } = {}): AgentAdapter | null {
  switch (id) {
    case 'fake':
      return fakeAdapter();
    case 'claude-code':
      return claudeCodeAdapter({ apiKey: opts.apiKey });
    case 'gemini-cli':
      return null;
  }
}

/** The adapter your config names. Claude Code gets your ANTHROPIC_API_KEY only when you opted into API billing (spec §12.2). */
export function adapterFor(config: Pick<PersonalConfig, 'agent' | 'apiBilling'>, env: Record<string, string | undefined>): AgentAdapter | null {
  return getAdapter(config.agent, { apiKey: config.apiBilling ? env.ANTHROPIC_API_KEY : undefined });
}
