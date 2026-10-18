import { describe, expect, it } from 'vitest';
import { MeResponse } from './api';
import { jobResult, settings } from './test-samples';
import {
  ActionResponse, AutoRequest, ChatResponse, DraftView, FilesResponse, InboxResponse, InboxStatus, MarkReadRequest, NoteRequest, PushSubscriptionRequest,
  PushUnsubscribeRequest, Settings, WebMe, type ChatView, type InboxRow,
} from './web-api';

describe('web API bodies', () => {
  const me: WebMe = { id: 'user_1', githubId: '1001', login: 'maya', avatarUrl: null, githubAuth: 'ok', agentOnline: true, settings: settings(), usedToday: 12, push: { vapidPublicKey: 'BPublicKey', subscribed: true } };

  it('round-trips WebMe', () => {
    expect(WebMe.parse(JSON.parse(JSON.stringify(me)))).toEqual(me);
  });

  it('leaves the CLI able to read the same /api/me answer', () => {
    expect(MeResponse.parse(me)).toEqual({ login: 'maya', avatarUrl: null, githubAuth: 'ok' });
  });

  it('takes settings with a daily cap of 5 to 200 jobs', () => {
    expect(Settings.parse({ autoReview: false, autoAddress: true, dailyJobCap: 5 })).toEqual({ autoReview: false, autoAddress: true, dailyJobCap: 5 });
    expect(Settings.parse({ ...settings(), dailyJobCap: 200 }).dailyJobCap).toBe(200);
    for (const dailyJobCap of [4, 201, 12.5]) expect(Settings.safeParse({ ...settings(), dailyJobCap }).success).toBe(false);
    expect(Settings.safeParse({ autoReview: true, dailyJobCap: 40 }).success).toBe(false);
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
      participants: [{ githubId: '1002', login: 'leo', avatarUrl: 'https://avatars.githubusercontent.com/u/1002', role: 'reviewer', isBot: false, onNitpilot: true, requested: true, auto: false, agent: { online: false, offlineSince: '2026-10-16T18:04:00.000Z', working: false } }],
      activity: { kind: 'none', who: null, why: null, offlineSince: null },
      points: [{
        number: 1, raisedBy: { githubId: '1002', login: 'leo' }, origin: 'agent', path: 'src/orders/list.ts', line: 48, side: 'RIGHT',
        url: 'https://github.com/acme/shop-api/blob/abc1234/src/orders/list.ts#L48', severity: 'blocker', category: 'security',
        title: 'SQL built from input', body: 'Use a parameter.', snippet: { startLine: 43, lines: ['const q = `…`;'] },
        status: 'escalated', authorResolution: null, escalationReason: 'category', trusted: true, round: 1,
      }],
      rules: { maxRounds: 3, alwaysEscalate: ['security'], autoReview: true, autoAddress: true, error: null },
      drafts: [{ jobId: 'job_7', owner: 'leo', role: 'reviewer', jobType: 're_review', headSha: 'c'.repeat(40), createdAt: '2026-10-16T18:00:00.000Z', result: jobResult(), sending: false }],
      permissions: { note: true, resolve: [1], continue: [1], review: false, retry: false, auto: ['reviewer'], drafts: ['job_7'] },
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

  it('switches Auto for one role, on or off', () => {
    expect(AutoRequest.parse({ role: 'author', on: false })).toEqual({ role: 'author', on: false });
    expect(() => AutoRequest.parse({ role: 'owner', on: true })).toThrow();
    expect(() => AutoRequest.parse({ role: 'reviewer' })).toThrow();
  });

  it("reads a draft whose result was stored before drafts existed (Plan 1's rows have no draft commit), and never a publish job", () => {
    const plan1Result: Record<string, unknown> = { ...jobResult() };
    delete plan1Result.draft;
    const draft = { jobId: 'job_7', owner: 'maya', role: 'author', jobType: 'address', headSha: 'c'.repeat(40), createdAt: '2026-10-16T18:00:00.000Z', result: plan1Result, sending: true };
    expect(DraftView.parse(draft).result.draft).toBeNull();
    expect(() => DraftView.parse({ ...draft, jobType: 'publish' })).toThrow();
  });

  describe('push subscriptions', () => {
    const subscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
      keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' },
      label: 'Chrome on macOS',
    };

    it('takes what the browser hands out, with a label for the Settings page', () => {
      expect(PushSubscriptionRequest.parse(subscription)).toEqual(subscription);
      expect(PushUnsubscribeRequest.parse({ endpoint: subscription.endpoint })).toEqual({ endpoint: subscription.endpoint });
      expect(PushSubscriptionRequest.parse({ ...subscription, endpoint: 'https://web.push.apple.com/QGuQyavXutnMH' }).endpoint).toBe('https://web.push.apple.com/QGuQyavXutnMH');
    });

    // The server POSTs to the endpoint, so it must never be one of the server's own neighbours (a blind SSRF).
    it.each([
      ['plain http', 'http://fcm.googleapis.com/fcm/send/abc'],
      ['not a URL', 'fcm.googleapis.com/fcm/send/abc'],
      ['another scheme', 'file:///etc/passwd'],
      ['localhost', 'https://localhost/push'],
      ['localhost with a dot at the end', 'https://localhost./push'],
      ['a .localhost name', 'https://api.localhost/push'],
      ['an IPv4 address', 'https://127.0.0.1/push'],
      ['an IPv4 address written as one number', 'https://2130706433/push'],
      ['a private IPv4 address', 'https://10.0.0.8:8443/push'],
      ['an IPv6 address', 'https://[::1]/push'],
      ['the cloud metadata address', 'https://169.254.169.254/latest/meta-data'],
      ['over 2,048 characters', `https://fcm.googleapis.com/${'a'.repeat(2048)}`],
    ])('refuses an endpoint that is %s', (_what, endpoint) => {
      expect(PushSubscriptionRequest.safeParse({ ...subscription, endpoint }).success).toBe(false);
      expect(PushUnsubscribeRequest.safeParse({ endpoint }).success).toBe(false);
    });

    it('wants a label of 1 to 100 characters and both keys', () => {
      expect(PushSubscriptionRequest.safeParse({ ...subscription, label: '' }).success).toBe(false);
      expect(PushSubscriptionRequest.safeParse({ ...subscription, label: 'x'.repeat(101) }).success).toBe(false);
      expect(PushSubscriptionRequest.safeParse({ ...subscription, keys: { p256dh: subscription.keys.p256dh } }).success).toBe(false);
      expect(PushSubscriptionRequest.safeParse({ ...subscription, keys: { ...subscription.keys, auth: 'not base64url!' } }).success).toBe(false);
    });
  });
});
