import { describe, expect, it } from 'vitest';
import { MeResponse } from './api';
import { InboxStatus, WebMe } from './web-api';

describe('web API bodies', () => {
  const me: WebMe = { id: 'user_1', githubId: '1001', login: 'maya', avatarUrl: null, githubAuth: 'ok' };

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
});
