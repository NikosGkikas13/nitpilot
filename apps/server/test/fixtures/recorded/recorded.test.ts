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
};

/** The `pull_request` actions the normalizer maps. Each has a fixture, or says here why it doesn't yet. */
const PULL_REQUEST_ACTIONS = ['opened', 'reopened', 'ready_for_review', 'converted_to_draft', 'closed', 'review_requested', 'review_request_removed', 'synchronize', 'edited'];
const NOT_RECORDED: Record<string, string> = {
  reopened: 'to record in the live run',
  ready_for_review: 'to record in the live run',
  converted_to_draft: 'to record in the live run',
  review_request_removed: 'to record in the live run',
  synchronize: 'to record in the live run',
  edited: 'to record in the live run',
};

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
