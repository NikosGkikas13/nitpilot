import { describe, expect, it } from 'vitest';
import { MeResponse } from './api';
import { ActionResponse, ChatResponse, FilesResponse, InboxResponse, InboxStatus, MarkReadRequest, NoteRequest, WebMe, type ChatView, type InboxRow } from './web-api';

describe('web API bodies', () => {
  const me: WebMe = { id: 'user_1', githubId: '1001', login: 'maya', avatarUrl: null, githubAuth: 'ok', agentOnline: true };

  it('round-trips WebMe', () => {
    expect(WebMe.parse(JSON.parse(JSON.stringify(me)))).toEqual(me);
  });

  it('leaves the CLI able to read the same /api/me answer', () => {
    expect(MeResponse.parse(me)).toEqual({ login: 'maya', avatarUrl: null, githubAuth: 'ok' });
  });

  it('knows every inbox status, and nothing else', () => {
    expect(InboxStatus.parse({ kind: 'waiting', who: 'leo', reason: 'offline' })).toEqual({ kind: 'waiting', who: 'leo', reason: 'offline' });
    expect(() => InboxStatus.parse({ kind: 'busy', who: null, reason: null })).toThrow();
  });

  it('round-trips an inbox row, and refuses a negative read cursor', () => {
    const row: InboxRow = {
      chatId: 'chat_1', repo: 'acme/shop-api', number: 142, title: 'Cursor pagination', url: 'https://github.com/acme/shop-api/pull/142',
      role: 'author', other: { login: 'leo', avatarUrl: null, agentActive: true }, status: { kind: 'working', who: 'leo', reason: null },
      round: 2, maxRounds: 3, lastActivity: 'leo raised 2 points', updatedAt: '2026-10-15T12:00:00.000Z', unread: 2, needsYou: false,
    };
    expect(InboxResponse.parse(JSON.parse(JSON.stringify({ rows: [row] })))).toEqual({ rows: [row] });
    expect(() => MarkReadRequest.parse({ seq: -1 })).toThrow();
  });

  it('round-trips a chat with its points and items, and a files list', () => {
    const view: ChatView = {
      id: 'chat_1', repo: 'acme/shop-api', number: 142, title: 'Cursor pagination', url: 'https://github.com/acme/shop-api/pull/142',
      author: 'maya', headRef: 'feature/cursor-pagination', baseRef: 'main', phase: 'escalated', round: 2, maxRounds: 3,
      merged: false, closed: false, trusted: true, isDraft: false,
      viewer: { role: 'reviewer', attention: 'decision', failure: null },
      participants: [{ githubId: '1002', login: 'leo', avatarUrl: 'https://avatars.githubusercontent.com/u/1002', role: 'reviewer', isBot: false, onNitpilot: true, requested: true, agent: { online: false, offlineSince: '2026-10-16T18:04:00.000Z', working: false } }],
      activity: { kind: 'none', who: null, why: null, offlineSince: null },
      points: [{
        number: 1, raisedBy: { githubId: '1002', login: 'leo' }, origin: 'agent', path: 'src/orders/list.ts', line: 48, side: 'RIGHT',
        url: 'https://github.com/acme/shop-api/blob/abc1234/src/orders/list.ts#L48', severity: 'blocker', category: 'security',
        title: 'SQL built from input', body: 'Use a parameter.', snippet: { startLine: 43, lines: ['const q = `…`;'] },
        status: 'escalated', authorResolution: null, escalationReason: 'category', trusted: true, round: 1,
      }],
      rules: { maxRounds: 3, alwaysEscalate: ['security'], autoReview: true, autoAddress: true, error: null },
      permissions: { note: true, resolve: [1], continue: [1], review: false, retry: false },
      summaryUrl: null, lastSeq: 7,
    };
    const body = { view, items: [], hasOlder: false };
    expect(ChatResponse.parse(JSON.parse(JSON.stringify(body)))).toEqual(body);
    expect(() => ChatResponse.parse({ ...body, view: { ...view, phase: 'waiting' } })).toThrow();
    const files = { files: [{ path: 'locales/tr.json', oldPath: null, status: 'added', adds: 412, dels: 0 }], adds: 412, dels: 0, truncated: false };
    expect(FilesResponse.parse(files)).toEqual(files);
  });

  it('takes a note of 1 to 4,000 characters, trimmed, and answers a change with ok', () => {
    expect(NoteRequest.parse({ body: '  Keep the old endpoint  ' })).toEqual({ body: 'Keep the old endpoint' });
    expect(NoteRequest.parse({ body: 'x'.repeat(4000) }).body).toHaveLength(4000);
    expect(() => NoteRequest.parse({ body: 'x'.repeat(4001) })).toThrow();
    expect(() => NoteRequest.parse({ body: ' \n ' })).toThrow();
    expect(ActionResponse.parse({ ok: true })).toEqual({ ok: true });
  });
});
