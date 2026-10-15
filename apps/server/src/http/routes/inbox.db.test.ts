import { InboxResponse } from '@nitpilot/protocol';
import { describe, expect, it } from 'vitest';
import { testApp } from '../../../test/app';
import { makeChat, makeMessage, makeParticipant, makeRepo, makeUser } from '../../../test/db';
import { sessionCookieFor } from '../../../test/http';
import { prisma } from '../../lib/prisma';

const ORIGIN = 'http://localhost:8787'; // PUBLIC_URL in test/test-env.ts

/** maya's PR with leo reviewing, and six items in its timeline, all written by leo. */
async function scene() {
  const maya = await makeUser({ login: 'maya' });
  const leo = await makeUser({ login: 'leo' });
  const chat = await makeChat((await makeRepo()).id, { authorGithubId: maya.githubId });
  await makeParticipant(chat.id, maya, 'author');
  await makeParticipant(chat.id, leo, 'reviewer', { requested: true });
  for (let i = 0; i < 6; i++) await makeMessage(chat.id, leo);
  const app = testApp();
  const cookie = await sessionCookieFor(maya.id);
  const inbox = async () => InboxResponse.parse(await (await app.request('/api/inbox', { headers: { cookie } })).json());
  const read = (seq: unknown, headers: Record<string, string> = { origin: ORIGIN }, chatId = chat.id) =>
    app.request(`/api/chats/${chatId}/read`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', ...headers }, body: JSON.stringify({ seq }) });
  return { maya, leo, chat, app, cookie, inbox, read };
}

describe('GET /api/inbox', () => {
  it('lists the signed-in person’s chats', async () => {
    const { chat, inbox } = await scene();
    const { rows } = await inbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ chatId: chat.id, role: 'author', unread: 6 });
  });

  it('is a 401 for a browser that is not signed in', async () => {
    expect((await testApp().request('/api/inbox')).status).toBe(401);
  });
});

describe('POST /api/chats/:id/read', () => {
  it('moves the read cursor, so only later items count as unread', async () => {
    const { read, inbox } = await scene();
    expect((await read(5)).status).toBe(204);
    expect((await inbox()).rows[0]!.unread).toBe(1);
  });

  it('never moves the cursor back', async () => {
    const { read, inbox } = await scene();
    await read(5);
    expect((await read(2)).status).toBe(204);
    expect((await inbox()).rows[0]!.unread).toBe(1);
  });

  it('stops at the newest item, so items that arrive later are unread', async () => {
    const { leo, chat, read, inbox } = await scene();
    await read(999);
    await makeMessage(chat.id, leo);
    expect((await inbox()).rows[0]!.unread).toBe(1);
  });

  it("is a 404 for a chat you're not part of, or one that doesn't exist", async () => {
    const { read } = await scene();
    const outsider = await scene();
    expect((await read(1, { origin: ORIGIN }, outsider.chat.id)).status).toBe(404);
    expect((await read(1, { origin: ORIGIN }, 'no-such-chat')).status).toBe(404);
  });

  it('is a 403 from another site (the Origin check), and a 400 for a bad seq', async () => {
    const { read } = await scene();
    expect((await read(1, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await read(-1)).status).toBe(400);
  });

  it('stores one cursor per person and chat, however many times it is called', async () => {
    const { maya, chat, read } = await scene();
    await Promise.all([read(3), read(4), read(2)]);
    const rows = await prisma.chatRead.findMany({ where: { userId: maya.id, chatId: chat.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.lastReadSeq).toBe(4);
  });
});
