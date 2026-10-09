import { describe, expect, it } from 'vitest';
import { people, prEvent } from '../../../../test/fixtures/github';
import { normalizePullRequest } from './pull-request';

const ref = { installationId: '77', repoId: '501', repoFullName: 'octo/sandbox', number: 42 };
const maya = { githubId: '1001', login: 'maya', isBot: false, userId: null };
const leo = { githubId: '1002', login: 'leo', isBot: false, userId: null };

describe('normalizePullRequest', () => {
  it('turns opened into pr_opened with the author, the requested reviewers and a snapshot', () => {
    const [ne] = normalizePullRequest(prEvent('opened'));
    expect(ne).toMatchObject({ scope: 'pr', pr: ref, event: { type: 'pr_opened', author: maya, reviewers: [leo] } });
    expect(ne!.scope === 'pr' && ne!.snapshot?.headSha).toBe('a'.repeat(40));
  });

  it.each([
    ['reopened', { type: 'pr_reopened' }],
    ['ready_for_review', { type: 'pr_ready' }],
    ['converted_to_draft', { type: 'pr_to_draft' }],
  ] as const)('maps %s', (action, event) => {
    expect(normalizePullRequest(prEvent(action))[0]).toMatchObject({ event });
  });

  it('tells merged and closed apart', () => {
    expect(normalizePullRequest(prEvent('closed', { pull: { state: 'closed', merged: true } }))[0]).toMatchObject({ event: { type: 'pr_closed', merged: true } });
    expect(normalizePullRequest(prEvent('closed', { pull: { state: 'closed', merged: false } }))[0]).toMatchObject({ event: { type: 'pr_closed', merged: false } });
  });

  it('maps a review request for a person, and ignores team requests (v1)', () => {
    expect(normalizePullRequest(prEvent('review_requested', { requested_reviewer: people.leo }))[0]).toMatchObject({ event: { type: 'review_requested', reviewer: leo } });
    expect(normalizePullRequest(prEvent('review_requested', { requested_team: { slug: 'backend' } }))).toEqual([]);
    expect(normalizePullRequest(prEvent('review_request_removed', { requested_reviewer: people.leo }))[0]).toMatchObject({ event: { type: 'review_request_removed', reviewer: leo } });
  });

  it('turns synchronize into head_updated; the router decides whether the push was ours', () => {
    expect(normalizePullRequest(prEvent('synchronize', { before: 'a'.repeat(40), after: 'c'.repeat(40) }))[0]).toMatchObject({
      event: { type: 'head_updated', before: 'a'.repeat(40), after: 'c'.repeat(40), ours: false },
    });
  });

  it('marks bots', () => {
    const [ne] = normalizePullRequest(prEvent('opened', { pull: { user: people.rabbit } }));
    expect(ne).toMatchObject({ event: { author: { login: 'coderabbitai[bot]', isBot: true } } });
  });

  it('keeps a PR from a deleted fork (Review Focus #5)', () => {
    const [ne] = normalizePullRequest(prEvent('opened', { pull: { head: { sha: 'a'.repeat(40), ref: 'patch-1', repo: null } } }));
    expect(ne!.scope === 'pr' && ne!.snapshot?.headRepoFullName).toBeNull();
  });

  it.each(['edited', 'labeled', 'assigned', 'auto_merge_enabled'])('ignores %s', (action) => {
    expect(normalizePullRequest(prEvent(action))).toEqual([]);
  });
});
