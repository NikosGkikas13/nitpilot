import type { ChatResponse, ChatView, PointView, TimelineItem } from '@nitpilot/protocol';
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
    viewer: { role: 'author', attention: 'none', failure: null },
    participants: [
      { githubId: '1001', login: 'maya', avatarUrl: 'https://avatars.githubusercontent.com/u/1001', role: 'author', isBot: false, onNitpilot: true, requested: false, agent: { online: true, offlineSince: null, working: false } },
      { githubId: '1002', login: 'leo', avatarUrl: 'https://avatars.githubusercontent.com/u/1002', role: 'reviewer', isBot: false, onNitpilot: true, requested: true, agent: { online: true, offlineSince: null, working: false } },
    ],
    activity: { kind: 'none', who: null, why: null, offlineSince: null },
    points: [],
    rules: { maxRounds: 3, alwaysEscalate: ['security'], autoReview: true, autoAddress: true, error: null },
    summaryUrl: null, lastSeq: 0, ...over,
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
