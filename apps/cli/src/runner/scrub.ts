import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { safeGit, type GitPlace } from './safe-git';

/**
 * Project files agents load on their own (spec §11 step 3). A PR could plant instructions or hooks in
 * them, so they leave the worktree before the agent starts. A trailing `/` means a folder. Each agent
 * adapter declares its own list (spec §12.2); this is all of them.
 */
export const SCRUB_PATHS: readonly string[] = [
  '.claude/', '.gemini/', '.mcp.json', '.env', 'CLAUDE.md', 'GEMINI.md', 'AGENTS.md',
  // GitHub Copilot CLI
  '.copilot/', '.github/copilot-instructions.md', '.github/instructions/', '.github/agents/', '.github/skills/', '.github/prompts/', '.github/hooks/',
  '.github/mcp.json', '.vscode/mcp.json',
];

/**
 * What a job scrubs: every agent's files (spec §11 step 3), whichever agent runs, plus any the job's own
 * adapter adds. An adapter can add to the list, never shorten it.
 */
export function scrubPathsFor(agentPaths: readonly string[]): readonly string[] {
  return [...new Set([...SCRUB_PATHS, ...agentPaths])];
}

/**
 * A name the way macOS compares it: in any letter case, and look-alikes too (`.mcp.jſon`, with a long
 * s, opens as `.mcp.json`). Folding to upper case and back catches those. Matching too much only
 * scrubs one extra file, so this errs on the wide side.
 */
function foldName(name: string): string {
  return name.toUpperCase().toLowerCase();
}

/**
 * Which tracked files to hide from git, and what to delete for them: a matching folder at any depth
 * goes as a whole, a matching file on its own. Names match as macOS compares them (see foldName), because
 * there `claude.md` and `CLAUDE.md` are the same file.
 */
export function scrubPlan(tracked: string[], scrubPaths: readonly string[]): { hide: string[]; remove: string[] } {
  // An entry can be one name (`CLAUDE.md`) or a short path (`.github/instructions/`); either matches at any depth.
  const entries = scrubPaths.map((p) => ({ folder: p.endsWith('/'), parts: p.replace(/\/$/, '').split('/').map(foldName) }));
  const hide: string[] = [];
  const remove = new Set<string>();
  for (const path of tracked) {
    const parts = path.split('/');
    const folded = parts.map(foldName);
    const folderEnd = Math.min(...entries.filter((e) => e.folder).map((e) => endOfMatch(folded, e.parts)).filter((end) => end > 0), Infinity);
    if (folderEnd !== Infinity) {
      hide.push(path);
      remove.add(parts.slice(0, folderEnd).join('/'));
    } else if (entries.some((e) => !e.folder && endsWith(folded, e.parts))) {
      hide.push(path);
      remove.add(path);
    }
  }
  return { hide, remove: [...remove] };
}

/** Where `run` first appears in `parts` as consecutive items: the index just after it, or -1. */
function endOfMatch(parts: readonly string[], run: readonly string[]): number {
  for (let start = 0; start + run.length <= parts.length; start++) {
    if (run.every((item, offset) => parts[start + offset] === item)) return start + run.length;
  }
  return -1;
}

function endsWith(parts: readonly string[], run: readonly string[]): boolean {
  return run.length <= parts.length && run.every((item, offset) => parts[parts.length - run.length + offset] === item);
}

/**
 * Scrub a fresh worktree: mark each matching file `skip-worktree`, so git stops looking at it and no
 * commit records it as deleted, then delete it. Returns the hidden paths. See docs/why/git-worktrees.md.
 */
export async function scrub(place: GitPlace & { workTree: string }, scrubPaths: readonly string[]): Promise<string[]> {
  const tracked = (await safeGit(place, ['ls-files', '-z'])).stdout.split('\0').filter(Boolean);
  const { hide, remove } = scrubPlan(tracked, scrubPaths);
  if (hide.length === 0) return [];
  await safeGit(place, ['update-index', '--skip-worktree', '--', ...hide]);
  for (const path of remove) rmSync(join(place.workTree, path), { recursive: true, force: true });
  return hide;
}
