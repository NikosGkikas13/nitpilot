import { describe, expect, it } from 'vitest';
import { prEvent, reviewComment, reviewEvent } from '../../../test/fixtures/github';
import { FakePlatform } from './fake-platform';

const ref = { installationId: '77', repoId: '501', repoFullName: 'octo/sandbox', number: 42 };
const headers = (event: string) => new Headers({ 'x-github-event': event });

describe('FakePlatform', () => {
  it('parses real GitHub payloads, with review comments from its own store', async () => {
    const fake = new FakePlatform();
    fake.reviewComments.set('7001', [reviewComment({ id: 9101 })]);
    const [ne] = await fake.parseWebhook(headers('pull_request_review'), JSON.stringify(reviewEvent('COMMENTED', { id: 7001 })));
    expect(ne).toMatchObject({ event: { review: { comments: [{ id: '9101' }] } } });
    expect((await fake.parseWebhook(headers('pull_request'), JSON.stringify(prEvent('opened'))))[0]).toMatchObject({ event: { type: 'pr_opened' } });
  });

  it('keeps one summary per PR and edits it in place', async () => {
    const fake = new FakePlatform();
    const { id } = await fake.upsertSummary(ref, 'v1');
    await fake.upsertSummary(ref, 'v2', id);
    expect(fake.writesFor(ref, 'summary')).toEqual([expect.objectContaining({ id, body: 'v2', edits: 1 })]);
  });

  it('reuses an earlier write that carries the marker instead of writing twice', async () => {
    const fake = new FakePlatform();
    const first = await fake.postReview('user-leo', ref, { commitSha: 'a', body: 'review <!-- m1 -->', comments: [] });
    const again = await fake.postReview('user-leo', ref, { commitSha: 'a', body: 'review <!-- m1 -->', comments: [] }, { reuseIfContains: '<!-- m1 -->' });
    expect(again.reviewId).toBe(first.reviewId);
    expect(fake.writesFor(ref, 'review')).toHaveLength(1);
  });

  it('serves PRs and files it was given', async () => {
    const fake = new FakePlatform();
    fake.files.set('octo/sandbox:.nitpilot.yml', 'max_rounds: 2\n');
    const first = await fake.readDefaultBranchFile(ref, '.nitpilot.yml');
    expect(first).toEqual({ text: 'max_rounds: 2\n', etag: expect.any(String) });
    expect(await fake.readDefaultBranchFile(ref, '.nitpilot.yml', (first as { etag: string }).etag)).toBe('not_modified');
    await expect(fake.getPr(ref)).rejects.toThrow(/no PR/);
  });

  it("lists a PR's changed files it was given, and records each time it's asked", async () => {
    const fake = new FakePlatform();
    const file = { path: 'src/a.ts', oldPath: null, status: 'modified' as const, adds: 1, dels: 0 };
    fake.prFiles.set('octo/sandbox#42', [file]);
    expect(await fake.listPrFiles(ref)).toEqual({ files: [file], truncated: false });
    expect(await fake.listPrFiles({ ...ref, number: 43 })).toEqual({ files: [], truncated: false });
    expect(fake.fileLists).toEqual(['octo/sandbox#42', 'octo/sandbox#43']);
  });
});
