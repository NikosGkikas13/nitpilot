import { describe, expect, it } from 'vitest';
import { MeResponse } from './api';
import { InboxResponse, InboxStatus, MarkReadRequest, WebMe, type InboxRow } from './web-api';

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
});
