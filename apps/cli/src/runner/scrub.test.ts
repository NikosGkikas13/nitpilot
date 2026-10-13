import { describe, expect, it } from 'vitest';
import { SCRUB_PATHS, scrubPathsFor, scrubPlan } from './scrub';

describe('scrubPlan', () => {
  it('finds agent files and folders at any depth, in any letter case and look-alike spelling', () => {
    const tracked = [
      'README.md', 'CLAUDE.md', 'docs/claude.md', 'sub/.claude/settings.json', 'sub/.claude/agents/x.md', 'a/b/.gemini/settings.json',
      'pkg/AGENTS.md', '.mcp.json', '.env', '.env.example', 'src/env.ts', 'notes/CLAUDE.md.bak',
      '.mcp.jſon', 'AGENTſ.md', // look-alikes: macOS opens these as .mcp.json and AGENTS.md
    ];
    expect(scrubPlan(tracked, SCRUB_PATHS)).toEqual({
      hide: ['CLAUDE.md', 'docs/claude.md', 'sub/.claude/settings.json', 'sub/.claude/agents/x.md', 'a/b/.gemini/settings.json', 'pkg/AGENTS.md', '.mcp.json', '.env', '.mcp.jſon', 'AGENTſ.md'],
      remove: ['CLAUDE.md', 'docs/claude.md', 'sub/.claude', 'a/b/.gemini', 'pkg/AGENTS.md', '.mcp.json', '.env', '.mcp.jſon', 'AGENTſ.md'],
    });
  });

  it('scrubs only what the adapter asks for', () => {
    expect(scrubPlan(['CLAUDE.md', 'GEMINI.md', '.gemini/settings.json'], ['CLAUDE.md'])).toEqual({ hide: ['CLAUDE.md'], remove: ['CLAUDE.md'] });
  });
});

describe('scrubPathsFor', () => {
  it("scrubs every agent's files whichever agent runs, plus any an adapter adds", () => {
    expect(scrubPathsFor(['.claude/', '.mcp.json', 'CLAUDE.md'])).toEqual(SCRUB_PATHS);
    expect(scrubPathsFor(['.cursor/'])).toEqual([...SCRUB_PATHS, '.cursor/']);
  });
});
