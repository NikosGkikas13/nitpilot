import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { safeGit, type GitPlace } from './safe-git';

/**
 * Project files agents load on their own (spec §11 step 3). A PR could plant instructions or hooks in
 * them, so they leave the worktree before the agent starts. A trailing `/` means a folder. Each agent
 * adapter declares its own list (spec §12.2); this is all of them.
 */
export const SCRUB_PATHS: readonly string[] = ['.claude/', '.gemini/', '.mcp.json', '.env', 'CLAUDE.md', 'GEMINI.md', 'AGENTS.md'];

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
  const folders = new Set(scrubPaths.filter((p) => p.endsWith('/')).map((p) => foldName(p.slice(0, -1))));
  const files = new Set(scrubPaths.filter((p) => !p.endsWith('/')).map(foldName));
  const hide: string[] = [];
  const remove = new Set<string>();
  for (const path of tracked) {
    const parts = path.split('/');
    const folderAt = parts.findIndex((part) => folders.has(foldName(part)));
    if (folderAt >= 0) {
      hide.push(path);
      remove.add(parts.slice(0, folderAt + 1).join('/'));
    } else if (files.has(foldName(parts.at(-1)!))) {
      hide.push(path);
      remove.add(path);
    }
  }
  return { hide, remove: [...remove] };
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
