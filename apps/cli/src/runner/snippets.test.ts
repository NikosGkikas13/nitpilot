import { describe, expect, it } from 'vitest';
import { prRepo } from '../../test/git-fixtures';
import { mcpJob } from '../../test/mcp-job';
import { snippetFor } from './snippets';

const numbered = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`);

describe('snippetFor', () => {
  it('reads 5 lines on each side of the line from git, fewer at the start or end of the file', async () => {
    const ctx = await mcpJob(prRepo({ head: { 'src/twenty.ts': `${numbered(20).join('\n')}\n`, 'img/a.png': 'PNG\0\0' } }));
    const at = (line: number, path = 'src/twenty.ts') => snippetFor(ctx.worktree.git, ctx.worktree.headSha, path, line);
    expect(await at(10)).toEqual({ startLine: 5, lines: numbered(15).slice(4) });
    expect(await at(2)).toEqual({ startLine: 1, lines: numbered(7) });
    expect(await at(20)).toEqual({ startLine: 15, lines: numbered(20).slice(14) });
    expect(await at(21)).toBeNull(); // past the end
    expect(await at(1, 'nope.ts')).toBeNull(); // not in the commit
    expect(await at(1, 'img/a.png')).toBeNull(); // binary
  });
});
