import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseGithubWebhook } from '../../../src/platform/github/normalize';
import type { FetchReviewComments } from '../../../src/platform/github/normalize';
import type { GhReviewComment } from '../../../src/platform/github/payloads';
import { findSecrets, scrubPayload, type RecordedFixture } from './scrub';

// Real deliveries from the dev GitHub App and the sandbox repo (docs/why/recorded-fixtures.md). Each file is
// replayed through the same code a live webhook goes through, and what comes out is checked here, by hand-written
// expectations: a recording is only the input. Add a fixture with `npm run record:fixtures -w apps/server`.

const DIR = fileURLToPath(new URL('./', import.meta.url));
const names = readdirSync(DIR)
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.slice(0, -'.json'.length))
  .sort();

const load = (name: string): RecordedFixture => JSON.parse(readFileSync(`${DIR}${name}.json`, 'utf8')) as RecordedFixture;

/** The sandbox repo and the two accounts that took part, as the normalizer sees them. */
const SANDBOX = { installationId: '169557306', repoId: '1411793061', repoFullName: 'NikosGkikas13/nitpilot-sandbox' };
const A = { githubId: '340081894', login: 'ngkdev93-jpg', isBot: false }; // the author
const B = { githubId: '69345580', login: 'NikosGkikas13', isBot: false }; // the reviewer, who owns the repo
const pr = (number: number) => ({ ...SANDBOX, number });
/** For the fixtures recorded in the live run, where the PR number, comment ids and shas are the sandbox's own and not worth pinning. */
const anyPr = { ...SANDBOX, number: expect.any(Number) };
const anyId = expect.any(String);
const aSha = expect.stringMatching(/^[0-9a-f]{40}$/);

/** What each fixture must turn into. `[]` means Nitpilot ignores it. A fixture without a row here fails the test below. */
const EXPECTED: Record<string, unknown[]> = {
  'installation_repositories.added': [
    { scope: 'installation_repos', installationId: '169557306', accountLogin: 'NikosGkikas13', added: [{ id: '1412072001', fullName: 'NikosGkikas13/nitpilot', private: true, defaultBranch: 'main' }], removed: [] },
  ],
  'repository.created': [],
  'pull_request.opened': [
    {
      scope: 'pr',
      pr: pr(2),
      snapshot: { title: 'Update README.md', state: 'open', isDraft: false, authorAssociation: 'COLLABORATOR', headRef: 'ngkdev93-jpg-patch-2', baseRef: 'main', headSha: '92747e094611ec1c912663d06888c1f4e8c80815', requestedReviewers: [B] },
      event: { type: 'pr_opened', author: A, reviewers: [B] },
    },
  ],
  'pull_request.review_requested': [{ scope: 'pr', pr: pr(2), event: { type: 'review_requested', reviewer: B } }],
  'pull_request.closed': [{ scope: 'pr', pr: pr(2), snapshot: { state: 'closed', merged: false }, event: { type: 'pr_closed', merged: false } }],
  'pull_request_review.submitted': [
    {
      scope: 'pr',
      pr: pr(1),
      event: {
        type: 'external_review_submitted',
        review: { id: '5470301182', author: A, trusted: true, state: 'commented', body: '', comments: [{ id: '4230317325', threadRootId: null, body: 'what is this?', path: 'README.md', line: 2, side: 'RIGHT' }] },
      },
    },
  ],
  'pull_request_review.submitted.reply': [
    {
      scope: 'pr',
      pr: pr(1),
      event: {
        type: 'external_review_submitted',
        review: { id: '5470415815', author: B, trusted: true, state: 'commented', comments: [{ id: '4230409588', threadRootId: '4230317325', body: 'dont worry abou tit' }] },
      },
    },
  ],
  'pull_request_review_comment.created': [
    {
      scope: 'pr',
      pr: pr(1),
      event: { type: 'external_comment', comment: { id: '4230317325', threadRootId: null, author: A, trusted: true, body: 'what is this?', path: 'README.md', line: 2, side: 'RIGHT', commitSha: 'e539491a85b101c5b27e31fb88e2cb1436519929' } },
    },
  ],
  'pull_request_review_comment.created.reply': [
    { scope: 'pr', pr: pr(1), event: { type: 'external_comment', comment: { id: '4230409588', threadRootId: '4230317325', author: B, trusted: true } } },
  ],
  // The app's own summary comment is a comment like any other to the normalizer; the router drops it by its marker.
  'issue_comment.created': [
    { scope: 'pr', pr: pr(2), event: { type: 'external_comment', comment: { id: 'issue:6094600445', author: { login: 'nitpilot-dev[bot]', isBot: true }, trusted: false, path: null } } },
  ],
  'issue_comment.edited': [],
  // The probe PR (docs/acceptance/plan-1.md section 3): one delivery of every kind a PR's life sends.
  'pull_request.review_requested.again': [{ scope: 'pr', pr: anyPr, event: { type: 'review_requested', reviewer: B } }],
  'pull_request.review_request_removed': [{ scope: 'pr', pr: anyPr, event: { type: 'review_request_removed', reviewer: B } }],
  'pull_request.converted_to_draft': [{ scope: 'pr', pr: anyPr, snapshot: { isDraft: true }, event: { type: 'pr_to_draft' } }],
  'pull_request.ready_for_review': [{ scope: 'pr', pr: anyPr, snapshot: { isDraft: false }, event: { type: 'pr_ready' } }],
  'pull_request.synchronize': [{ scope: 'pr', pr: anyPr, event: { type: 'head_updated', before: aSha, after: aSha, ours: false } }],
  'pull_request.edited': [], // a new title is nothing to us
  'pull_request.edited.retarget': [{ scope: 'pr', pr: anyPr, snapshot: { baseRef: 'acc/base2' }, event: { type: 'pr_retargeted', baseRef: 'acc/base2', trusted: true } }],
  'pull_request.reopened': [{ scope: 'pr', pr: anyPr, snapshot: { state: 'open' }, event: { type: 'pr_reopened' } }],
  'pull_request_review_comment.created.probe-first': [
    { scope: 'pr', pr: anyPr, event: { type: 'external_comment', comment: { id: anyId, threadRootId: null, author: B, trusted: true, body: 'probe: first comment', path: 'orders-demo/src/orders.js', line: 5, side: 'RIGHT' } } },
  ],
  'pull_request_review_comment.created.probe-second': [
    { scope: 'pr', pr: anyPr, event: { type: 'external_comment', comment: { id: anyId, threadRootId: null, author: B, trusted: true, body: 'probe: second comment', path: 'orders-demo/src/orders.js', line: 12, side: 'RIGHT' } } },
  ],
  'pull_request_review.submitted.probe': [
    {
      scope: 'pr',
      pr: anyPr,
      event: {
        type: 'external_review_submitted',
        review: { id: anyId, author: B, trusted: true, state: 'commented', comments: [{ body: 'probe: first comment', line: 5 }, { body: 'probe: second comment', line: 12 }] },
      },
    },
  ],
  'pull_request_review_comment.created.reply-conversation': [
    { scope: 'pr', pr: anyPr, event: { type: 'external_comment', comment: { id: anyId, threadRootId: anyId, author: A, trusted: true, body: 'probe: reply from the Conversation tab' } } },
  ],
  'pull_request_review_comment.created.reply-files': [
    { scope: 'pr', pr: anyPr, event: { type: 'external_comment', comment: { id: anyId, threadRootId: anyId, author: A, trusted: true, body: 'probe: reply from Files changed' } } },
  ],
  'pull_request_review.submitted.reply-conversation': [
    { scope: 'pr', pr: anyPr, event: { type: 'external_review_submitted', review: { id: anyId, author: A, trusted: true, state: 'commented', comments: [{ threadRootId: anyId, body: 'probe: reply from the Conversation tab' }] } } },
  ],
  'pull_request_review.submitted.reply-files': [
    { scope: 'pr', pr: anyPr, event: { type: 'external_review_submitted', review: { id: anyId, author: A, trusted: true, state: 'commented', comments: [{ threadRootId: anyId, body: 'probe: reply from Files changed' }] } } },
  ],
  'pull_request_review_thread.resolved': [{ scope: 'pr', pr: anyPr, event: { type: 'thread_resolved', threadRootId: anyId } }],
  'pull_request_review_thread.unresolved': [{ scope: 'pr', pr: anyPr, event: { type: 'thread_unresolved', threadRootId: anyId } }],
  'issue_comment.created.human': [
    { scope: 'pr', pr: anyPr, event: { type: 'external_comment', comment: { id: expect.stringMatching(/^issue:\d+$/), author: B, trusted: true, body: 'probe: a plain comment', path: null } } },
  ],
  // Written by Nitpilot itself in the live run (single-player author and reviewer): the hidden marker must survive the trip through GitHub, because it is how our own writes are recognized.
  'pull_request.synchronize.by-agent': [{ scope: 'pr', pr: anyPr, event: { type: 'head_updated', before: aSha, after: aSha, ours: false } }],
  'pull_request_review_comment.created.reply-by-agent': [
    { scope: 'pr', pr: anyPr, event: { type: 'external_comment', comment: { id: anyId, threadRootId: anyId, author: A, trusted: true, body: expect.stringContaining('nitpilot:v1') } } },
  ],
  // The same reply again, wrapped by GitHub in a review with no body (`null` in the payload). The router takes a review that holds only our own comments as our own write.
  'pull_request_review.submitted.reply-by-agent': [
    { scope: 'pr', pr: anyPr, event: { type: 'external_review_submitted', review: { id: anyId, author: A, state: 'commented', body: '', comments: [{ threadRootId: anyId, author: A, body: expect.stringContaining('nitpilot:v1') }] } } },
  ],
  'pull_request_review_comment.created.by-agent-line5': [
    { scope: 'pr', pr: anyPr, event: { type: 'external_comment', comment: { id: anyId, author: B, path: 'orders-demo/src/orders.js', line: 5, body: expect.stringContaining('nitpilot:v1') } } },
  ],
  'pull_request_review_comment.created.by-agent-line12': [
    { scope: 'pr', pr: anyPr, event: { type: 'external_comment', comment: { id: anyId, author: B, path: 'orders-demo/src/orders.js', line: 12, body: expect.stringContaining('nitpilot:v1') } } },
  ],
  'pull_request_review_comment.created.by-agent-line18': [
    { scope: 'pr', pr: anyPr, event: { type: 'external_comment', comment: { id: anyId, author: B, path: 'orders-demo/src/orders.js', line: 18, body: expect.stringContaining('nitpilot:v1') } } },
  ],
  'pull_request_review.submitted.by-agent': [
    {
      scope: 'pr',
      pr: anyPr,
      event: { type: 'external_review_submitted', review: { id: anyId, author: B, state: 'commented', body: expect.stringContaining('nitpilot:v1'), comments: [{ line: 5 }, { line: 12 }, { line: 18 }] } },
    },
  ],
};

/** The `pull_request` actions the normalizer maps. Each has a fixture, or says here why it doesn't yet. */
const PULL_REQUEST_ACTIONS = ['opened', 'reopened', 'ready_for_review', 'converted_to_draft', 'closed', 'review_requested', 'review_request_removed', 'synchronize', 'edited'];
const NOT_RECORDED: Record<string, string> = {};

/** Only these repositories may appear in a committed fixture: the public sandbox and this project. */
const PUBLISHABLE_REPOS = ['NikosGkikas13/nitpilot-sandbox', 'NikosGkikas13/nitpilot'];

/** `GET /pulls/:n/reviews/:id/comments` answered from the recorded review comments, oldest first, as GitHub would. */
const fetchReviewComments: FetchReviewComments = async (_pr, reviewId) =>
  names
    .filter((name) => name.startsWith('pull_request_review_comment.'))
    .map((name) => (load(name).payload as { comment: GhReviewComment & { pull_request_review_id?: number } }).comment)
    .filter((comment) => String(comment.pull_request_review_id) === reviewId)
    .sort((a, b) => a.id - b.id);

describe('the recorded set', () => {
  it('has an expectation for every fixture, and a fixture for every expectation', () => {
    expect(names).toEqual(Object.keys(EXPECTED).sort());
  });

  it('covers every pull_request action the normalizer maps, or says why one is missing', () => {
    for (const action of PULL_REQUEST_ACTIONS) {
      const recorded = names.some((name) => name === `pull_request.${action}` || name.startsWith(`pull_request.${action}.`));
      expect(recorded || action in NOT_RECORDED, `pull_request.${action} has neither a fixture nor a reason`).toBe(true);
      expect(!(recorded && action in NOT_RECORDED), `pull_request.${action} is recorded: remove it from NOT_RECORDED`).toBe(true);
    }
  });

  it('mentions only repositories that may be published', () => {
    for (const name of names) {
      const repos = [...readFileSync(`${DIR}${name}.json`, 'utf8').matchAll(/"full_name": "([^"]+)"/g)].map((m) => m[1]);
      for (const repo of repos) expect(PUBLISHABLE_REPOS, `${name} mentions ${repo}`).toContain(repo);
    }
  });
});

describe.each(names)('recorded %s', (name) => {
  const fixture = load(name);

  it('is named for the event and action it holds', () => {
    const base = `${fixture.event}.${fixture.action}`;
    expect(name === base || name.startsWith(`${base}.`)).toBe(true);
  });

  it('holds no secret and is already scrubbed', () => {
    expect(findSecrets(readFileSync(`${DIR}${name}.json`, 'utf8'))).toEqual([]);
    expect(scrubPayload(fixture.payload)).toEqual(fixture.payload);
  });

  it('turns into the expected events', async () => {
    const events = await parseGithubWebhook(fixture.event, JSON.stringify(fixture.payload), fetchReviewComments);
    expect(events).toMatchObject(EXPECTED[name] ?? []);
  });
});
