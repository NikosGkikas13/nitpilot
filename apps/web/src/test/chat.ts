import type { ChatResponse, ChatView, DraftView, PointView, TimelineItem } from '@nitpilot/protocol';
import type { Answer } from './render';

// A chat for component tests: maya's PR #142 on acme/shop-api, reviewed by leo. Pass only what a test cares about.

export function point(over: Partial<PointView> = {}): PointView {
  return {
    number: 1, raisedBy: { githubId: '1002', login: 'leo' }, origin: 'agent', path: 'src/orders/list.ts', line: 48, side: 'RIGHT',
    url: 'https://github.com/acme/shop-api/blob/abc1234/src/orders/list.ts#L48', severity: 'major', category: 'bug',
    title: 'parseCursor throws on an empty cursor', body: 'An empty cursor decodes to "", which is an Invalid Date.',
    snippet: { startLine: 47, lines: ['export function parseCursor(raw: string) {', '  const [ts, id] = raw.split(":");', '  return { ts: new Date(Number(ts)), id };'] },
    status: 'open', authorResolution: null, escalationReason: null, trusted: true, round: 1, ...over,
  };
}

export function chatView(over: Partial<ChatView> = {}): ChatView {
  return {
    id: 'chat_142', repo: 'acme/shop-api', number: 142, title: 'Add cursor pagination to /orders', url: 'https://github.com/acme/shop-api/pull/142',
    author: 'maya', headRef: 'feature/cursor-pagination', baseRef: 'main', phase: 'reviewing', round: 1, maxRounds: 3,
    merged: false, closed: false, trusted: true, isDraft: false,
    viewer: { role: 'author', attention: 'none', failure: null, failureReason: null },
    participants: [
      { githubId: '1001', login: 'maya', avatarUrl: 'https://avatars.githubusercontent.com/u/1001', role: 'author', isBot: false, onNitpilot: true, requested: false, auto: true, agent: { online: true, offlineSince: null, working: false } },
      { githubId: '1002', login: 'leo', avatarUrl: 'https://avatars.githubusercontent.com/u/1002', role: 'reviewer', isBot: false, onNitpilot: true, requested: true, auto: true, agent: { online: true, offlineSince: null, working: false } },
    ],
    activity: { kind: 'none', who: null, why: null, offlineSince: null },
    points: [],
    drafts: [],
    rules: { maxRounds: 3, alwaysEscalate: ['security'], autoReview: true, autoAddress: true, error: null },
    permissions: { note: true, resolve: [], continue: [], review: false, retry: false, auto: ['author'], drafts: [] },
    summaryUrl: null, lastSeq: 0, ...over,
  };
}

/** A draft commit's diff: two files, a change in the middle of one and a new one. */
export const DRAFT_DIFF = [
  'diff --git a/src/orders/cursor.ts b/src/orders/cursor.ts',
  '--- a/src/orders/cursor.ts',
  '+++ b/src/orders/cursor.ts',
  '@@ -1,3 +1,3 @@',
  ' export function parseCursor(raw: string) {',
  "-  const [ts, id] = raw.split(':');",
  "+  if (raw === '') return null;",
  '   return { ts, id };',
  'diff --git a/test/cursor.test.ts b/test/cursor.test.ts',
  '--- /dev/null',
  '+++ b/test/cursor.test.ts',
  '@@ -0,0 +1 @@',
  "+it('returns null for an empty cursor', () => expect(parseCursor('')).toBeNull());",
  '',
].join('\n');
export const DRAFT_FILES = [
  { path: 'src/orders/cursor.ts', adds: 1, dels: 1 },
  { path: 'test/cursor.test.ts', adds: 1, dels: 0 },
];

/** maya's agent's drafted fixes for P1 (fixed, with the commit above) and P2 (answered), waiting for her Send. */
export function authorDraft(over: Partial<DraftView> = {}): DraftView {
  return {
    jobId: 'job_9', owner: 'maya', role: 'author', jobType: 'address', headSha: 'abc1234def', createdAt: '2026-10-16T14:05:00Z', sending: false,
    result: {
      summary: 'Fixed the empty cursor, answered the naming point.', points: [], decisions: [], push: null,
      replies: [{ point: 1, resolution: 'fixed', comment: 'Return null for empty cursors.' }, { point: 2, resolution: 'answered', comment: 'The name matches the API docs.' }],
      draft: { sha: 'd7a1f00ba5e', from: 'abc1234def', files: DRAFT_FILES, diff: DRAFT_DIFF },
    },
    ...over,
  };
}

/** leo's agent's drafted review: two points, waiting for his Send. */
export function reviewerDraft(over: Partial<DraftView> = {}): DraftView {
  return {
    jobId: 'job_8', owner: 'leo', role: 'reviewer', jobType: 'review', headSha: 'abc1234def', createdAt: '2026-10-16T14:02:00Z', sending: false,
    result: {
      summary: 'Two points: the retry delay and a magic number.', decisions: [], replies: [], push: null, draft: null,
      points: [
        { path: 'src/retry.ts', line: 31, side: 'RIGHT', severity: 'major', category: 'bug', title: 'Retry delay ignores Retry-After', body: 'A 429 says how long to wait; this waits 1 s.', snippet: null },
        { path: null, line: null, side: null, severity: 'nit', category: 'style', title: 'Magic number 5 for max attempts', body: 'Name it.', snippet: null },
      ],
    },
    ...over,
  };
}

let at = Date.parse('2026-10-16T14:00:00Z');

/** A timeline item; `seq` and `at` count up unless given. */
export function item(seq: number, over: Partial<TimelineItem> = {}): TimelineItem {
  at += 60_000;
  return { seq, kind: 'system', author: null, pointNumber: null, jobId: null, body: `item ${seq}`, data: null, at: new Date(at).toISOString(), ...over };
}

export function chatResponse(over: { view?: Partial<ChatView>; items?: TimelineItem[]; hasOlder?: boolean } = {}): ChatResponse {
  const items = over.items ?? [];
  return { view: chatView({ lastSeq: items.at(-1)?.seq ?? 0, ...over.view }), items, hasOlder: over.hasOlder ?? false };
}

/** fakeApi answers for opening these chats: each one maya's PR with that title. */
export function chatRoutes(chats: { repo: string; number: number; title: string }[]): Record<string, () => Answer> {
  return Object.fromEntries(
    chats.map((c) => [`GET /api/chats/${c.repo}/${c.number}`, (): Answer => [200, chatResponse({ view: { id: `chat_${c.number}`, repo: c.repo, number: c.number, title: c.title } })]]),
  );
}
