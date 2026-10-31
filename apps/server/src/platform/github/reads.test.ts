import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fakeFetch, json } from '../../../test/fake-fetch';
import { reviewComment, reviewEvent } from '../../../test/fixtures/github';
import { AppAuth } from './app-auth';
import { GithubClient } from './client';
import type { GhPull } from './payloads';
import { GithubReads, gitSpecFor, isTrustedAssociation, snapshotFromPull } from './reads';

const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const ref = { installationId: '77', repoId: '501', repoFullName: 'octo/sandbox', number: 42 };

const pull: GhPull = {
  number: 42,
  title: 'Cursor pagination',
  body: null,
  html_url: 'https://github.com/octo/sandbox/pull/42',
  state: 'open',
  draft: false,
  merged: false,
  user: { id: 1001, login: 'maya', type: 'User' },
  author_association: 'OWNER',
  requested_reviewers: [{ id: 1002, login: 'leo', type: 'User' }],
  head: { sha: 'a'.repeat(40), ref: 'feature/cursor', repo: { full_name: 'maya/sandbox-fork' } },
  base: { sha: 'b'.repeat(40), ref: 'main', repo: { id: 501, full_name: 'octo/sandbox', private: false } },
};

function reads(routes: Parameters<typeof fakeFetch>[0]) {
  const fetch = fakeFetch({ 'POST /app/installations/77/access_tokens': () => ({ token: 'ghs_x', expires_at: '2099-01-01T00:00:00Z' }), ...routes });
  const github = new GithubClient(fetch);
  return { fetch, platform: new GithubReads(github, new AppAuth(github, '12345', pem), async (userId) => `ghu_${userId}`) };
}

describe('snapshotFromPull', () => {
  it('maps a PR, keeping ids as strings', () => {
    expect(snapshotFromPull(ref, pull)).toEqual({
      ref,
      title: 'Cursor pagination',
      body: '',
      url: 'https://github.com/octo/sandbox/pull/42',
      state: 'open',
      merged: false,
      isDraft: false,
      author: { githubId: '1001', login: 'maya', isBot: false, userId: null },
      authorAssociation: 'OWNER',
      requestedReviewers: [{ githubId: '1002', login: 'leo', isBot: false, userId: null }],
      headSha: 'a'.repeat(40),
      baseSha: 'b'.repeat(40),
      headRef: 'feature/cursor',
      baseRef: 'main',
      headRepoFullName: 'maya/sandbox-fork',
    });
  });

  it('handles a PR whose fork was deleted (Review Focus #5)', () => {
    const snap = snapshotFromPull(ref, { ...pull, head: { ...pull.head, repo: null } });
    expect(snap.headRepoFullName).toBeNull();
    expect(gitSpecFor(snap)).toEqual({ baseCloneUrl: 'https://github.com/octo/sandbox.git', fetchRef: 'refs/pull/42/head', headRepoPath: null, headBranch: 'feature/cursor' });
  });

  it('fetches from the base repo even for a fork, so fork PRs work', () => {
    expect(gitSpecFor(snapshotFromPull(ref, pull))).toMatchObject({ baseCloneUrl: 'https://github.com/octo/sandbox.git', headRepoPath: 'maya/sandbox-fork' });
  });
});

describe('isTrustedAssociation', () => {
  it.each<[string, boolean]>([['OWNER', true], ['MEMBER', true], ['COLLABORATOR', true], ['CONTRIBUTOR', false], ['FIRST_TIME_CONTRIBUTOR', false], ['NONE', false]])('%s → %s', (a, expected) => {
    expect(isTrustedAssociation(a)).toBe(expected);
  });
});

describe('GithubReads', () => {
  it('reads a PR with an installation token', async () => {
    const { platform, fetch } = reads({ 'GET /repos/octo/sandbox/pulls/42': () => pull });
    expect((await platform.getPr(ref)).title).toBe('Cursor pagination');
    expect(fetch.calls.at(-1)!.headers.get('authorization')).toBe('Bearer ghs_x');
  });

  it('reads .nitpilot.yml with an ETag and understands 304 and 404', async () => {
    let status = 200;
    const { platform, fetch } = reads({
      'GET /repos/octo/sandbox/contents/.nitpilot.yml': () =>
        status === 200 ? new Response('max_rounds: 2\n', { status: 200, headers: { etag: '"abc"', 'content-type': 'application/vnd.github.raw' } }) : json(null, status),
    });
    const repo = { installationId: '77', repoId: '501', repoFullName: 'octo/sandbox' };

    expect(await platform.readDefaultBranchFile(repo, '.nitpilot.yml')).toEqual({ text: 'max_rounds: 2\n', etag: '"abc"' });
    status = 304;
    expect(await platform.readDefaultBranchFile(repo, '.nitpilot.yml', '"abc"')).toBe('not_modified');
    expect(fetch.calls.at(-1)!.headers.get('if-none-match')).toBe('"abc"');
    status = 404;
    expect(await platform.readDefaultBranchFile(repo, '.nitpilot.yml')).toBeNull();
  });

  it("parses a submitted review, fetching that review's comments with the installation token", async () => {
    const { fetch, platform } = reads({ 'GET /repos/octo/sandbox/pulls/42/reviews/7001/comments': () => [reviewComment({ id: 9101 })] });
    const [ne] = await platform.parseWebhook(new Headers({ 'x-github-event': 'pull_request_review' }), JSON.stringify(reviewEvent('COMMENTED', { id: 7001 })));
    expect(ne).toMatchObject({ event: { type: 'external_review_submitted', review: { id: '7001', comments: [{ id: '9101' }] } } });
    expect(fetch.calls.at(-1)!.headers.get('authorization')).toBe('Bearer ghs_x');
  });
});

describe('findOpenPrsFor (spec §15 "Catching up")', () => {
  const item = (repo: string, number: number) => ({ number, repository_url: `https://api.github.com/repos/${repo}` });

  it("runs the three searches with the person's own token and lists each PR once", async () => {
    const { fetch, platform } = reads({
      'GET /search/issues': (req) => ({ items: req.url.searchParams.get('q')!.includes('author:') ? [item('octo/api', 7)] : [item('octo/sandbox', 42)] }),
    });
    expect(await platform.findOpenPrsFor({ id: 'user-leo', login: 'leo' })).toEqual([
      { repoFullName: 'octo/api', number: 7 },
      { repoFullName: 'octo/sandbox', number: 42 },
    ]);
    const searches = fetch.calls.filter((c) => c.url.pathname === '/search/issues');
    expect(searches.map((c) => c.url.searchParams.get('q'))).toEqual(['is:pr is:open author:leo', 'is:pr is:open review-requested:leo', 'is:pr is:open reviewed-by:leo']);
    expect(searches.map((c) => c.headers.get('authorization'))).toEqual(Array(3).fill('Bearer ghu_user-leo'));
  });
});

describe('userInstallations (the setup checklist, spec §16 "Onboarding")', () => {
  it("lists the app's installations the person can see, asked with their own token", async () => {
    const { fetch, platform } = reads({
      'GET /user/installations': () => ({ total_count: 2, installations: [{ id: 77, account: { login: 'octo' } }, { id: 78, account: { login: 'maya' } }] }),
    });
    expect(await platform.userInstallations('user-maya')).toEqual([
      { id: '77', accountLogin: 'octo' },
      { id: '78', accountLogin: 'maya' },
    ]);
    const call = fetch.calls.find((c) => c.url.pathname === '/user/installations')!;
    expect(call.headers.get('authorization')).toBe('Bearer ghu_user-maya');
    expect(call.url.searchParams.get('per_page')).toBe('100');
  });

  it('answers an empty list when the app is installed nowhere they can see', async () => {
    const { platform } = reads({ 'GET /user/installations': () => ({ total_count: 0, installations: [] }) });
    expect(await platform.userInstallations('user-maya')).toEqual([]);
  });
});

describe('listPrFiles', () => {
  const file = (i: number) => ({ filename: `src/f${i}.ts`, status: 'modified', additions: 2, deletions: 1 });

  it('reads the changed files page by page, renamed ones with their old path', async () => {
    const pages = [Array.from({ length: 100 }, (_, i) => file(i)), [{ filename: 'src/new.ts', previous_filename: 'src/old.ts', status: 'renamed', additions: 0, deletions: 0 }, { filename: 'b.txt', status: 'copied', additions: 3, deletions: 0 }]];
    const { platform, fetch } = reads({ 'GET /repos/octo/sandbox/pulls/42/files': (req) => pages[Number(req.url.searchParams.get('page')) - 1] ?? [] });
    const { files, truncated } = await platform.listPrFiles(ref);
    expect(files).toHaveLength(102);
    expect(files.slice(100)).toEqual([
      { path: 'src/new.ts', oldPath: 'src/old.ts', status: 'renamed', adds: 0, dels: 0 },
      { path: 'b.txt', oldPath: null, status: 'added', adds: 3, dels: 0 },
    ]);
    expect(truncated).toBe(false);
    expect(fetch.calls.filter((c) => c.url.pathname.endsWith('/files')).map((c) => c.headers.get('authorization'))).toEqual(['Bearer ghs_x', 'Bearer ghs_x']);
  });

  it('stops at 300 files and says the list was cut', async () => {
    const { platform } = reads({ 'GET /repos/octo/sandbox/pulls/42/files': () => Array.from({ length: 100 }, (_, i) => file(i)) });
    const { files, truncated } = await platform.listPrFiles(ref);
    expect(files).toHaveLength(300);
    expect(truncated).toBe(true);
  });
});

describe('isRepoPublic', () => {
  it("is GitHub's answer now, asked with the app's token", async () => {
    for (const [isPrivate, expected] of [[false, true], [true, false]] as const) {
      const { platform, fetch } = reads({ 'GET /repos/octo/sandbox': () => ({ id: 501, private: isPrivate }) });
      expect(await platform.isRepoPublic(ref)).toBe(expected);
      expect(fetch.calls.at(-1)!.headers.get('authorization')).toBe('Bearer ghs_x');
    }
  });

  it("throws when GitHub won't say, so the chat isn't shown", async () => {
    const { platform } = reads({ 'GET /repos/octo/sandbox': () => json({ message: 'Not Found' }, 404) });
    await expect(platform.isRepoPublic(ref)).rejects.toThrow();
  });
});
