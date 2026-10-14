import type {
  GhInstallationEvent, GhInstallationReposEvent, GhIssueCommentEvent, GhPull, GhPullRequestEvent, GhRepo, GhRepositoryEvent,
  GhReviewComment, GhReviewCommentEvent, GhReviewEvent, GhReviewThreadEvent, GhUser,
} from '../../src/platform/github/payloads';

// GitHub-shaped payloads for tests. Fixed ids: DB tests that use them call resetDb() first.

export const people = {
  maya: { id: 1001, login: 'maya', type: 'User' },
  leo: { id: 1002, login: 'leo', type: 'User' },
  sam: { id: 1003, login: 'sam', type: 'User' },
  rabbit: { id: 1004, login: 'coderabbitai[bot]', type: 'Bot' },
  bot: { id: 1005, login: 'nitpilot-dev[bot]', type: 'Bot' },
} satisfies Record<string, GhUser>;

export const repository: GhRepo = { id: 501, full_name: 'octo/sandbox', private: false, default_branch: 'main' };
export const installation = { id: 77 };
const envelope = { installation, repository, sender: people.maya };

export function pull(over: Partial<GhPull> = {}): GhPull {
  return {
    number: 42,
    title: 'Cursor pagination for orders',
    body: 'Replaces offset pagination.',
    html_url: 'https://github.com/octo/sandbox/pull/42',
    state: 'open',
    draft: false,
    merged: false,
    user: people.maya,
    author_association: 'OWNER',
    requested_reviewers: [people.leo],
    head: { sha: 'a'.repeat(40), ref: 'feature/cursor-pagination', repo: { full_name: 'octo/sandbox' } },
    base: { sha: 'b'.repeat(40), ref: 'main', repo: repository },
    ...over,
  };
}

export function prEvent(
  action: string,
  opts: { pull?: Partial<GhPull>; requested_reviewer?: GhUser; requested_team?: { slug: string }; before?: string; after?: string; changes?: GhPullRequestEvent['changes'] } = {},
): GhPullRequestEvent {
  const { pull: pullOver, ...rest } = opts;
  const pr = pull(pullOver);
  return { ...envelope, action, number: pr.number, pull_request: pr, ...rest };
}

export function reviewComment(over: Partial<GhReviewComment> = {}): GhReviewComment {
  return {
    id: 9001,
    user: people.sam,
    author_association: 'COLLABORATOR',
    body: 'Please handle the empty list.',
    path: 'src/orders/list.ts',
    line: 48,
    side: 'RIGHT',
    commit_id: 'a'.repeat(40),
    ...over,
  };
}

export function reviewCommentEvent(action: string, comment: GhReviewComment = reviewComment()): GhReviewCommentEvent {
  return { ...envelope, action, comment, pull_request: pull() };
}

export function reviewEvent(state: string, opts: { id?: number; user?: GhUser; body?: string | null; association?: string; action?: string } = {}): GhReviewEvent {
  return {
    ...envelope,
    action: opts.action ?? 'submitted',
    review: { id: opts.id ?? 7001, user: opts.user ?? people.sam, author_association: opts.association ?? 'COLLABORATOR', state, body: opts.body ?? null },
    pull_request: pull(),
  };
}

export function threadEvent(action: 'resolved' | 'unresolved', rootCommentId = 9001): GhReviewThreadEvent {
  return { ...envelope, action, thread: { comments: [reviewComment({ id: rootCommentId }), reviewComment({ id: rootCommentId + 1, in_reply_to_id: rootCommentId })] }, pull_request: pull() };
}

export function issueCommentEvent(action: string, opts: { id?: number; user?: GhUser; body?: string; association?: string; onPr?: boolean } = {}): GhIssueCommentEvent {
  return {
    ...envelope,
    action,
    issue: { number: 42, ...(opts.onPr === false ? {} : { pull_request: { url: 'https://api.github.com/repos/octo/sandbox/pulls/42' } }) },
    comment: { id: opts.id ?? 8001, user: opts.user ?? people.sam, author_association: opts.association ?? 'COLLABORATOR', body: opts.body ?? 'Could this use a cursor type?' },
  };
}

export function installationEvent(action: string, repos: GhRepo[] = [repository]): GhInstallationEvent {
  return { action, installation: { id: installation.id, account: { login: 'octo' } }, repositories: repos };
}

export function installationReposEvent(added: GhRepo[], removed: GhRepo[]): GhInstallationReposEvent {
  return { action: added.length ? 'added' : 'removed', installation: { id: installation.id, account: { login: 'octo' } }, repositories_added: added, repositories_removed: removed };
}

export function repositoryEvent(action: string, repo: GhRepo = repository): GhRepositoryEvent {
  return { action, installation, repository: repo, sender: people.maya };
}
