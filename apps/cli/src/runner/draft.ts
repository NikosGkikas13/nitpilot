import { BRAND, MAX_DRAFT_DIFF_BYTES, type DraftFile, type DraftInfo } from '@nitpilot/protocol';
import { safeGit, SafeGitError, type GitPlace } from './safe-git';
import { cloneGitDir } from './worktree';

/** How long a draft commit is kept in your clone when nobody sends or discards it (spec §11 "Publish jobs"). */
export const DRAFT_KEEP_DAYS = 14;

/** Where drafts wait in a linked clone. */
const DRAFTS = `${BRAND.gitRefNamespace}/drafts`;

/** Where an author's draft commit waits in the linked clone until it's sent: refs/nitpilot/drafts/<job id>. */
export function draftRef(jobId: string): string {
  return `${DRAFTS}/${jobId}`;
}

/**
 * What a draft commit changes, for the web app's draft card (spec §11 step 6.4): the files with their added and
 * removed lines, and the unified diff, or null when it's over MAX_DRAFT_DIFF_BYTES (the card then shows the
 * files and the `git show` command). `from` is the head the commit was made on, `to` the commit. Both diffs run
 * with `--no-ext-diff --no-textconv`, so no diff program from your git config or the repo's attributes runs, and
 * with the same rename detection and `a/` `b/` prefixes whatever `diff.renames` or `diff.noprefix` say there.
 * The patch is read with a limit of MAX_DRAFT_DIFF_BYTES, so a huge one is never held in memory.
 */
export async function describeDraft(place: GitPlace, from: string, to: string): Promise<DraftInfo> {
  // The commits go before `--`, so git reads them as commits and nothing after them as one.
  const same = ['diff', '--no-ext-diff', '--no-textconv', '--find-renames'];
  const numstat = await safeGit(place, [...same, '--numstat', '-z', from, to, '--']);
  return { sha: to, from, files: parseNumstat(numstat.stdout), diff: await patchOf(place, [...same, '--no-color', '--src-prefix=a/', '--dst-prefix=b/', from, to, '--']) };
}

/** The patch, or null when git printed more than MAX_DRAFT_DIFF_BYTES. Any other failure is thrown. */
async function patchOf(place: GitPlace, args: string[]): Promise<string | null> {
  try {
    return (await safeGit(place, args, { maxOutputBytes: MAX_DRAFT_DIFF_BYTES })).stdout;
  } catch (err) {
    if (err instanceof SafeGitError && err.outputTooLarge) return null;
    throw err;
  }
}

/**
 * `git diff --numstat -z` prints `<adds>\t<dels>\t<path>\0` per file. A renamed file has no path there, and its
 * old and new names follow as two more `\0`-ended fields. A binary file has `-` for both counts: 0 here. With
 * `-z`, names are printed as they are (a tab or a newline in one is kept), never quoted.
 */
export function parseNumstat(output: string): DraftFile[] {
  const fields = output.split('\0');
  const files: DraftFile[] = [];
  for (let i = 0; i < fields.length; i++) {
    const counts = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(fields[i]!);
    if (!counts) continue; // the empty field after the last `\0`
    let path = counts[3]!;
    if (path === '') {
      path = fields[i + 2] ?? ''; // the new name; fields[i + 1] is the old one
      i += 2;
    }
    if (path === '') continue;
    files.push({ path, adds: countOf(counts[1]!), dels: countOf(counts[2]!) });
  }
  return files;
}

const countOf = (field: string) => (field === '-' ? 0 : Number(field));

export type PruneOptions = {
  repoPaths: string[];
  hooksDir: string;
  /** Now, as the tests decide it. */
  now: Date;
  env?: Record<string, string | undefined>;
};

/**
 * At `nitpilot start` (spec §11 "Publish jobs"): delete the draft refs in each linked clone whose commit was made
 * more than DRAFT_KEEP_DAYS days ago. Those drafts were neither sent nor discarded, or they went out of date and
 * were kept so you could still look at them. Only refs under refs/nitpilot/drafts/ are touched. A clone that's
 * gone or broken is skipped, as cleanUpWorktrees does (`nitpilot doctor` reports it). Returns how many were deleted.
 */
export async function pruneOldDraftRefs(opts: PruneOptions): Promise<number> {
  const oldest = Math.floor(opts.now.getTime() / 1000) - DRAFT_KEEP_DAYS * 24 * 60 * 60;
  let removed = 0;
  for (const repoPath of opts.repoPaths) {
    try {
      const place = { gitDir: cloneGitDir(repoPath), hooksDir: opts.hooksDir, env: opts.env };
      // One line per draft ref: its commit's committer date (seconds since 1970), the commit, and the ref. None has a space in it.
      const listed = (await safeGit(place, ['for-each-ref', '--format=%(committerdate:unix) %(objectname) %(refname)', DRAFTS])).stdout;
      for (const line of listed.split('\n')) {
        const [date, sha, ref] = line.split(' ');
        // An empty date: the ref points at something that isn't a commit. Not a draft we made, so it stays.
        if (!date || !sha || !ref || Number(date) >= oldest) continue;
        try {
          // With the sha: deleted only if it still points there, so a draft made a moment ago is never lost.
          await safeGit(place, ['update-ref', '-d', ref, sha]);
          removed++;
        } catch {
          // This one can't be deleted now (locked by another git, say): not counted, and the clone's other drafts are still pruned.
        }
      }
    } catch {
      // A clone that's gone or broken: skipped, like cleanUpWorktrees. The others are still pruned.
    }
  }
  return removed;
}
