import type { Snippet } from '@nitpilot/protocol';
import { safeGit, type GitPlace } from './safe-git';

/** Lines shown on each side of a point's line (spec §11 step 7). */
const AROUND = 5;

/**
 * The code around a point, read from git (never from the folder the agent edited): up to 5 lines on
 * each side of `line`, fewer at the start or end of the file. Null when there's nothing to show: the
 * file isn't at `sha`, is binary, or is shorter than `line`.
 */
export async function snippetFor(place: GitPlace, sha: string, path: string, line: number): Promise<Snippet | null> {
  let content: string;
  try {
    content = (await safeGit(place, ['cat-file', 'blob', `${sha}:${path}`])).stdout;
  } catch {
    return null; // not a file at that commit
  }
  if (content.includes('\0')) return null;
  const lines = content.split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (line > lines.length) return null;
  const startLine = Math.max(1, line - AROUND);
  return { startLine, lines: lines.slice(startLine - 1, Math.min(lines.length, line + AROUND)) };
}
