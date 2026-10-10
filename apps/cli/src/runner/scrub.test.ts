import { describe, expect, it } from 'vitest';
import { SCRUB_PATHS, scrubPlan } from './scrub';

describe('scrubPlan', () => {
  it('finds agent files and folders at any depth, in any letter case', () => {
    const tracked = [
      'README.md', 'CLAUDE.md', 'docs/claude.md', 'sub/.claude/settings.json', 'sub/.claude/agents/x.md', 'a/b/.gemini/settings.json',
      'pkg/AGENTS.md', '.mcp.json', '.env', '.env.example', 'src/env.ts', 'notes/CLAUDE.md.bak',
    ];
    expect(scrubPlan(tracked, SCRUB_PATHS)).toEqual({
      hide: ['CLAUDE.md', 'docs/claude.md', 'sub/.claude/settings.json', 'sub/.claude/agents/x.md', 'a/b/.gemini/settings.json', 'pkg/AGENTS.md', '.mcp.json', '.env'],
      remove: ['CLAUDE.md', 'docs/claude.md', 'sub/.claude', 'a/b/.gemini', 'pkg/AGENTS.md', '.mcp.json', '.env'],
    });
  });

  it('scrubs only what the adapter asks for', () => {
    expect(scrubPlan(['CLAUDE.md', 'GEMINI.md', '.gemini/settings.json'], ['CLAUDE.md'])).toEqual({ hide: ['CLAUDE.md'], remove: ['CLAUDE.md'] });
  });
});
