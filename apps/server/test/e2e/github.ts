import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pull } from '../fixtures/github';

// A pretend GitHub for the end-to-end tests, made of local git folders: the PR from test/fixtures/github.ts
// (octo/sandbox#42), each person's own clone of it, and a stand-in for ssh so their CLIs reach it the way
// they reach github.com.

export type Who = 'maya' | 'leo';

const BRANCH = pull().head.ref;
const PULL_REF = `refs/pull/${pull().number}/head`;

export function localGithub() {
  const root = mkdtempSync(join(tmpdir(), 'nitpilot-e2e-'));
  const bare = join(root, 'github', `${pull().base.repo.full_name}.git`);

  /** A HOME with this person's git identity, and nothing else of the developer's own git config. */
  function home(name: string): Record<string, string> {
    const dir = join(root, 'home', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.gitconfig'), `[user]\n\tname = ${name}\n\temail = ${name}@example.com\n[init]\n\tdefaultBranch = main\n`);
    return { PATH: process.env.PATH ?? '', HOME: dir, GIT_CONFIG_NOSYSTEM: '1' };
  }
  const git = (cwd: string, env: Record<string, string>, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();

  // GitHub keeps refs/pull/42/head on the PR's branch tip: a hook does the same here.
  mkdirSync(dirname(bare), { recursive: true });
  const setup = home('github');
  git(root, setup, 'init', '-q', '--bare', bare);
  writeFileSync(join(bare, 'hooks', 'post-receive'), `#!/bin/sh\nwhile read old new ref; do\n  if [ "$ref" = "refs/heads/${BRANCH}" ]; then git update-ref ${PULL_REF} "$new"; fi\ndone\n`, { mode: 0o755 });

  // The author's own working folder, where the PR was made (and where a human pushes from).
  const work = join(root, 'work');
  const authorEnv = home('maya');
  git(root, authorEnv, 'init', '-q', work);
  const commit = (files: Record<string, string>, message: string) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(work, path)), { recursive: true });
      writeFileSync(join(work, path), text);
    }
    git(work, authorEnv, 'add', '-A');
    git(work, authorEnv, 'commit', '-q', '-m', message);
    return git(work, authorEnv, 'rev-parse', 'HEAD');
  };
  const baseSha = commit({ 'README.md': 'Shop API\n' }, 'base');
  git(work, authorEnv, 'push', '-q', bare, 'HEAD:refs/heads/main');
  const headSha = commit({ 'src/orders.ts': 'export const pageSize = 50;\n' }, 'cursor pagination');
  git(work, authorEnv, 'push', '-q', bare, `HEAD:refs/heads/${BRANCH}`);

  // Git runs: <script> -o BatchMode=yes github-test "git-upload-pack 'octo/sandbox.git'". Serve the bare folder instead.
  const ssh = join(root, 'fake-ssh.sh');
  writeFileSync(ssh, `#!/bin/sh\nfor last; do :; done\nunset GIT_DIR GIT_WORK_TREE GIT_CONFIG_PARAMETERS GIT_CONFIG_COUNT\nexec "\${last%% *}" '${bare}'\n`, { mode: 0o755 });

  return {
    root,
    baseSha,
    headSha,
    branch: BRANCH,
    /** A person's clone, reaching "GitHub" over ssh, and the environment their CLI runs with. */
    personFor(who: Who): { clone: string; env: Record<string, string> } {
      const env = { ...home(who), GIT_SSH_COMMAND: ssh };
      const clone = join(root, 'clones', who);
      git(root, env, 'clone', '-q', bare, clone);
      git(clone, env, 'remote', 'set-url', 'origin', `git@github-test:${pull().base.repo.full_name}.git`);
      return { clone, env };
    },
    /**
     * Another PR on the same repo, at the same head as #42: GitHub keeps refs/pull/<number>/head for every PR,
     * and that is what a CLI fetches (the Playwright tests open PRs with other numbers).
     */
    addPull(number: number): void {
      git(root, setup, '--git-dir', bare, 'update-ref', `refs/pull/${number}/head`, headSha);
    },
    /** Someone pushes to the PR's branch by hand, from the PR's old head (Review Focus #2). Returns the new head. */
    pushAsHuman(files: Record<string, string>): string {
      const sha = commit(files, 'a human pushed');
      git(work, authorEnv, 'push', '-q', bare, `HEAD:refs/heads/${BRANCH}`);
      return sha;
    },
    /** `git log` of the PR's branch on "GitHub": sha, author and Nitpilot-Job trailer of each commit, newest first. */
    branchLog(): { sha: string; author: string; job: string }[] {
      return git(root, setup, '--git-dir', bare, 'log', '--format=%H|%an|%(trailers:key=Nitpilot-Job,valueonly,separator=)', BRANCH)
        .split('\n')
        .map((line) => {
          const [sha, author, job] = line.split('|');
          return { sha: sha!, author: author!, job: job ?? '' };
        });
    },
  };
}

export type LocalGithub = ReturnType<typeof localGithub>;
