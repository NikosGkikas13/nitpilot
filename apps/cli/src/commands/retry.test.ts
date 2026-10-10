import type { MyChat } from '@nitpilot/protocol';
import { describe, expect, it, onTestFinished } from 'vitest';
import { recordOut } from '../../test/out';
import { startStubServer, type StubReply } from '../../test/stub-server';
import { tempDir } from '../../test/temp';
import { parsePrRef, retry } from './retry';

const failedChat: MyChat = {
  id: 'chat_1',
  repo: 'acme/shop-api',
  number: 142,
  title: 'Cursor pagination for orders',
  role: 'reviewer',
  phase: 'reviewing',
  round: 1,
  attention: 'failed',
  url: 'http://nitpilot.test/c/acme/shop-api/142',
  updatedAt: '2026-10-10T08:00:00.000Z',
};

async function setup(retryReply: StubReply = { body: { status: 'queued' } }) {
  const stub = await startStubServer({
    'GET /api/me/chats': { body: { chats: [failedChat] } },
    'POST /api/chats/chat_1/retry': retryReply,
  });
  onTestFinished(() => stub.close());
  return { stub, env: { NITPILOT_CONFIG_DIR: tempDir(), NITPILOT_SERVER: stub.url, NITPILOT_TOKEN: 'nit_abc' } };
}

describe('nitpilot retry', () => {
  it("finds the PR's chat and asks the server to queue your job again", async () => {
    const { stub, env } = await setup();
    const out = recordOut();
    await retry('https://github.com/acme/shop-api/pull/142', { env, out });
    expect(stub.requests.at(-1)).toMatchObject({ method: 'POST', path: '/api/chats/chat_1/retry', authorization: 'Bearer nit_abc' });
    expect(out.lines[0]).toContain('Queued your agent again on acme/shop-api#142.');
  });

  it("passes on the server's answer when there is nothing to retry", async () => {
    const { env } = await setup({ status: 409, body: { error: { code: 'conflict', message: 'Nothing of yours failed on this PR.' } } });
    await expect(retry('acme/shop-api#142', { env, out: recordOut() })).rejects.toThrow('Nothing of yours failed on this PR.');
  });

  it("refuses a PR you're not part of", async () => {
    const { env } = await setup();
    await expect(retry('acme/shop-api#999', { env, out: recordOut() })).rejects.toThrow("You're not part of an open Nitpilot chat on acme/shop-api#999.");
  });

  it('explains the usage when it cannot read the PR', async () => {
    const { env } = await setup();
    await expect(retry('shop-api 142', { env, out: recordOut() })).rejects.toThrow('Usage: nitpilot retry <pr-url>');
  });

  it('reads PR links and the short owner/name#number form', () => {
    expect(parsePrRef('https://github.com/acme/shop-api/pull/142')).toEqual({ repo: 'acme/shop-api', number: 142 });
    expect(parsePrRef('https://github.com/acme/shop-api/pull/142/files')).toEqual({ repo: 'acme/shop-api', number: 142 });
    expect(parsePrRef('acme/shop-api#142')).toEqual({ repo: 'acme/shop-api', number: 142 });
    expect(parsePrRef('https://gitlab.com/acme/shop-api/pull/142')).toBeNull();
  });
});
