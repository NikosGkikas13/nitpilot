import { describe, expect, it } from 'vitest';
import type { TimelineItem } from './web-api';
import { ServerToWeb, WebToServer } from './web-messages';

const item: TimelineItem = {
  seq: 3,
  kind: 'point_raised',
  author: { githubId: '1002', login: 'leo' },
  pointNumber: 1,
  jobId: 'job_1',
  body: 'Cursor pagination skips rows',
  data: { severity: 'major', category: 'bug', path: 'src/orders.ts', line: 48 },
  at: '2026-10-16T09:00:00.000Z',
};

describe('/ws/web messages', () => {
  it('round-trips what a browser sends', () => {
    const subscribe: WebToServer = { v: 1, t: 'chat.subscribe', d: { chatId: 'chat_1', afterSeq: 0 } };
    expect(WebToServer.parse(JSON.parse(JSON.stringify(subscribe)))).toEqual(subscribe);
    expect(WebToServer.parse({ v: 1, t: 'chat.unsubscribe', d: { chatId: 'chat_1' } }).t).toBe('chat.unsubscribe');
  });

  it('refuses a negative cursor and anything a browser may not send', () => {
    expect(() => WebToServer.parse({ v: 1, t: 'chat.subscribe', d: { chatId: 'chat_1', afterSeq: -1 } })).toThrow();
    expect(() => WebToServer.parse({ v: 1, t: 'chat.items', d: { chatId: 'chat_1', items: [], lastSeq: 0 } })).toThrow();
  });

  it('round-trips what the server sends', () => {
    const sent: ServerToWeb[] = [
      { v: 1, t: 'chat.items', d: { chatId: 'chat_1', items: [item], lastSeq: 3 } },
      { v: 1, t: 'chat.error', d: { chatId: 'chat_1', code: 'reauth' } },
      { v: 1, t: 'job.progress', d: { chatId: 'chat_1', who: 'leo', action: 'reviewing', stage: 'running_agent', text: 'reading src/orders.ts' } },
      // A publish job runs no agent: the author's CLI is sending her drafted fixes.
      { v: 1, t: 'job.progress', d: { chatId: 'chat_1', who: 'maya', action: 'sending', stage: 'pushing', text: 'pushing the drafted fixes' } },
      { v: 1, t: 'inbox.upsert', d: { chatId: 'chat_1', rows: [] } },
    ];
    for (const msg of sent) expect(ServerToWeb.parse(JSON.parse(JSON.stringify(msg)))).toEqual(msg);
  });
});
