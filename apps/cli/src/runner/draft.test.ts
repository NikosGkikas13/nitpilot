import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_DRAFT_DIFF_BYTES } from '@nitpilot/protocol';
import { describe, expect, it } from 'vitest';
import { prRepo } from '../../test/git-fixtures';
import { tempDir } from '../../test/temp';
import { describeDraft, draftRef, pruneOldDraftRefs } from './draft';
import { emptyHooksDir } from './safe-git';

type Pr = ReturnType<typeof prRepo>;

const DAY_MS = 24 * 60 * 60_000;

/** Where safeGit runs for the PR's clone (no worktree: only commits are compared). */
const placeOf = (pr: Pr) => ({ gitDir: join(pr.clone, '.git'), hooksDir: emptyHooksDir(tempDir()), env: pr.env });

/** Commit these files on top of the PR's head in the author's folder, and make the clone know the commit. */
function draftCommit(pr: Pr, files: Parameters<Pr['commit']>[1]): string {
  const sha = pr.commit(pr.work, files, 'Address review feedback (round 1)');
  pr.git(pr.clone, 'fetch', '-q', pr.work, sha);
  return sha;
}

/** A commit on top of the PR's head whose committer date is `daysAgo` days before `now`, made in the clone. */
function commitFrom(pr: Pr, now: Date, daysAgo: number): string {
  const date = new Date(now.getTime() - daysAgo * DAY_MS).toISOString();
  return execFileSync('git', ['commit-tree', `${pr.headSha}^{tree}`, '-p', pr.headSha, '-m', `${daysAgo} days old`], {
    cwd: pr.clone, env: { ...pr.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date }, encoding: 'utf8',
  }).trim();
}

/** The clone's refs under `prefix`, by name. */
const refsOf = (pr: Pr, prefix: string) => pr.git(pr.clone, 'for-each-ref', '--format=%(refname)', prefix).split('\n').filter(Boolean);

describe('describeDraft', () => {
  it('names the commit, lists each file it changes with its counts, and carries the unified diff', async () => {
    const pr = prRepo({ base: { 'src/old-name.ts': 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n' } });
    const sha = draftCommit(pr, {
      'src/orders.ts': 'export const pageSize = 25;\n', // one line changed: 1 added, 1 removed
      'src/limits.ts': 'export const max = 100;\nexport const min = 1;\n', // a new file
      'README.md': null, // a deleted file
      'src/old-name.ts': null,
      'src/new name\twith a tab.ts': 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n', // renamed, with a tab in its name
    });
    const draft = await describeDraft(placeOf(pr), pr.headSha, sha);
    expect(draft.sha).toBe(sha);
    expect(draft.from).toBe(pr.headSha);
    expect(draft.files).toEqual([
      { path: 'README.md', adds: 0, dels: 1 },
      { path: 'src/limits.ts', adds: 2, dels: 0 },
      { path: 'src/new name\twith a tab.ts', adds: 0, dels: 0 },
      { path: 'src/orders.ts', adds: 1, dels: 1 },
    ]);
    expect(draft.diff).toContain('diff --git a/src/orders.ts b/src/orders.ts');
    expect(draft.diff).toContain('-export const pageSize = 50;\n+export const pageSize = 25;\n');
    expect(draft.diff).toContain('+export const min = 1;\n');
  });

  it(`leaves the diff out when it is over ${MAX_DRAFT_DIFF_BYTES / 1024} KB, and still lists the files`, async () => {
    const pr = prRepo();
    const big = Array.from({ length: 6_000 }, (_, i) => `export const value${i} = '${'x'.repeat(40)}';`).join('\n') + '\n'; // about 300 KB
    const sha = draftCommit(pr, { 'src/generated.ts': big, 'src/orders.ts': 'export const pageSize = 25;\n' });
    const draft = await describeDraft(placeOf(pr), pr.headSha, sha);
    expect(draft.diff).toBeNull();
    expect(draft.files).toEqual([
      { path: 'src/generated.ts', adds: 6_000, dels: 0 },
      { path: 'src/orders.ts', adds: 1, dels: 1 },
    ]);
  });

  it('counts a binary file as 0 and 0', async () => {
    const pr = prRepo();
    const sha = draftCommit(pr, { 'logo.png': '\x89PNG\r\n\x1a\n\0\0\0binary' });
    expect((await describeDraft(placeOf(pr), pr.headSha, sha)).files).toEqual([{ path: 'logo.png', adds: 0, dels: 0 }]);
  });

  it('never runs a diff program from your git config or the repo (--no-ext-diff --no-textconv)', async () => {
    const pr = prRepo();
    // The attributes file a bare command reads (a worktree's .gitattributes would do the same there).
    writeFileSync(join(pr.clone, '.git/info/attributes'), '*.ts diff=evil\n');
    const canary = `touch '${join(pr.home, 'diff-ran')}'`;
    writeFileSync(join(pr.root, 'evil.sh'), `#!/bin/sh\n${canary}\ncat "$1"\n`, { mode: 0o755 });
    pr.git(pr.clone, 'config', 'diff.external', join(pr.root, 'evil.sh'));
    pr.git(pr.clone, 'config', 'diff.evil.textconv', join(pr.root, 'evil.sh'));
    const sha = draftCommit(pr, { 'src/orders.ts': 'export const pageSize = 25;\n' });
    const draft = await describeDraft(placeOf(pr), pr.headSha, sha);
    expect(draft.diff).toContain('+export const pageSize = 25;');
    expect(existsSync(join(pr.home, 'diff-ran'))).toBe(false);
  });
});

describe('pruneOldDraftRefs', () => {
  it('removes only draft refs whose commit is older than 14 days, and leaves every other ref alone', async () => {
    const pr = prRepo();
    const now = new Date('2026-10-17T12:00:00Z');
    const old = commitFrom(pr, now, 15);
    const young = commitFrom(pr, now, 13);
    pr.git(pr.clone, 'update-ref', draftRef('job_old'), old);
    pr.git(pr.clone, 'update-ref', draftRef('job_young'), young);
    pr.git(pr.clone, 'update-ref', 'refs/nitpilot/job_9-1/head', old); // a job's own ref, not a draft
    pr.git(pr.clone, 'update-ref', 'refs/heads/an-old-branch', old); // your own branch
    const second = tempDir(); // a second linked clone, with an old draft of its own
    pr.git(pr.root, 'clone', '-q', pr.base, second);
    pr.git(second, 'fetch', '-q', pr.clone, old);
    pr.git(second, 'update-ref', draftRef('job_other'), old);

    const removed = await pruneOldDraftRefs({ repoPaths: [pr.clone, second], hooksDir: emptyHooksDir(tempDir()), now, env: pr.env });
    expect(removed).toBe(2);
    expect(refsOf(pr, 'refs/nitpilot')).toEqual([draftRef('job_young'), 'refs/nitpilot/job_9-1/head']);
    expect(refsOf(pr, 'refs/heads/an-old-branch')).toEqual(['refs/heads/an-old-branch']);
    expect(pr.git(second, 'for-each-ref', 'refs/nitpilot')).toBe('');
  });

  it('skips a linked clone that is gone, and still prunes the others', async () => {
    const pr = prRepo();
    const now = new Date();
    pr.git(pr.clone, 'update-ref', draftRef('job_old'), commitFrom(pr, now, 30));
    const removed = await pruneOldDraftRefs({ repoPaths: [join(pr.root, 'no-such-clone'), pr.clone], hooksDir: emptyHooksDir(tempDir()), now, env: pr.env });
    expect(removed).toBe(1);
    expect(refsOf(pr, 'refs/nitpilot')).toEqual([]);
  });
});
