import type { AgentId } from '@nitpilot/protocol';
import { fakeAdapter } from './fake/adapter';
import type { AgentAdapter } from './types';

/**
 * The adapter for the agent your config names. Claude Code and Gemini CLI arrive in M11 (Tasks 19–20);
 * until then they're null, and `nitpilot start` takes no jobs.
 */
export function getAdapter(id: AgentId): AgentAdapter | null {
  switch (id) {
    case 'fake':
      return fakeAdapter();
    case 'claude-code':
    case 'gemini-cli':
      return null;
  }
}
