import { jobBundle } from '@nitpilot/protocol/test-samples';
import { describe, expect, it } from 'vitest';
import { CliError } from '../errors';
import { githubToken, prBundle } from './pr-bundle';

const sample = jobBundle();

/** GitHub's answers for the sample PR (acme/shop-api#142), in the shape the API gives them. */
const pull = {
  title: sample.pr.title,
  body: sample.pr.body,
  html_url: sample.pr.url,
  user: { login: sample.pr.authorLogin },
  base: { ref: sample.pr.baseRef, sha: sample.pr.baseSha },
  head: { ref: sample.pr.headRef, sha: sample.pr.headSha, repo: { full_name: 'acme/shop-api' } },
};

function fakeGithub(answers: Record<string, Response | (() => Response)>) {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    seen.push({ url, headers: init.headers as Record<string, string> });
    const path = url.replace('https://api.github.com', '');
    const answer = answers[path];
    if (!answer) return new Response('not found', { status: 404 });
    return typeof answer === 'function' ? answer() : answer.clone();
  }) as typeof fetch;
  return { impl, seen };
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const pr = { repo: 'acme/shop-api', number: 142 };

describe('prBundle', () => {
  it("builds the same job the server would, with the defaults when there's no .nitpilot.yml", async () => {
    const gh = fakeGithub({ '/repos/acme/shop-api/pulls/142': json(pull), '/user': json({ login: 'leo', id: 1 }) });
    const { bundle, rulesError } = await prBundle(pr, 'tok', gh.impl);
    expect(rulesError).toBeNull();
    expect(bundle.jobId).toMatch(/^local-/);
    expect({ ...bundle, jobId: sample.jobId, apply: 'auto', rules: { ...bundle.rules, ignorePaths: ['**/*.lock'] } }).toEqual(sample);
    expect(bundle.apply).toBe('draft');
    expect(gh.seen[0]!.headers.authorization).toBe('Bearer tok');
  });

  it("uses the repo's .nitpilot.yml, and reports a broken one", async () => {
    const yml = 'max_rounds: 5\nmax_points_per_review: 4\nignore_paths: ["docs/**"]\n';
    const gh = fakeGithub({
      '/repos/acme/shop-api/pulls/142': json(pull),
      '/user': json({ login: 'leo', id: 1 }),
      '/repos/acme/shop-api/contents/.nitpilot.yml': new Response(yml),
    });
    const { bundle } = await prBundle(pr, 'tok', gh.impl);
    expect(bundle.maxRounds).toBe(5);
    expect(bundle.rules).toEqual({ ignorePaths: ['docs/**'], alwaysEscalate: ['security'], maxPoints: 4 });

    const broken = fakeGithub({
      '/repos/acme/shop-api/pulls/142': json(pull),
      '/user': json({ login: 'leo', id: 1 }),
      '/repos/acme/shop-api/contents/.nitpilot.yml': new Response('max_rounds: 99\n'),
    });
    expect((await prBundle(pr, 'tok', broken.impl)).rulesError).toMatch(/max_rounds/);
  });

  it('keeps a deleted fork as headRepoPath null', async () => {
    const gh = fakeGithub({ '/repos/acme/shop-api/pulls/142': json({ ...pull, head: { ...pull.head, repo: null } }), '/user': json({ login: 'leo', id: 1 }) });
    expect((await prBundle(pr, 'tok', gh.impl)).bundle.git.headRepoPath).toBeNull();
  });

  it('says what went wrong: a bad token, a missing PR, GitHub unreachable', async () => {
    const badToken = fakeGithub({ '/user': json({ message: 'Bad credentials' }, 401), '/repos/acme/shop-api/pulls/142': json({}, 401) });
    await expect(prBundle(pr, 'tok', badToken.impl)).rejects.toThrow(/turned down your token/);

    const noPr = fakeGithub({ '/user': json({ login: 'leo', id: 1 }) });
    await expect(prBundle(pr, 'tok', noPr.impl)).rejects.toThrow(/Can't find acme\/shop-api#142/);

    const offline = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    await expect(prBundle(pr, 'tok', offline)).rejects.toThrow(CliError);
  });
});

describe('githubToken', () => {
  it('takes GITHUB_TOKEN first, then the GitHub CLI', async () => {
    const neverRun = async () => {
      throw new Error('should not run gh');
    };
    expect(await githubToken({ GITHUB_TOKEN: 'env-tok' }, neverRun)).toBe('env-tok');
    expect(await githubToken({}, async () => ({ code: 0, stdout: 'gh-tok\n', stderr: '' }))).toBe('gh-tok');
  });

  it('explains how to get one when neither is there', async () => {
    await expect(githubToken({}, async () => ({ code: null, stdout: '', stderr: 'not found' }))).rejects.toThrow(/gh auth login/);
  });
});
