import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { CliLoginPollResponse, MyChatsResponse } from './api';
import { CliToServer, ServerToCli } from './cli-messages';
import { CLOSE_CODES } from './close-codes';
import { encode } from './envelope';
import { jobBundle, jobResult } from './test-samples';

function roundTrip<S extends z.ZodType>(schema: S, value: z.infer<S>) {
  expect(schema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value);
}

const job = { jobId: 'job_1', attempt: 2 };

// Typing the arrays makes TypeScript check every sample against the union too.
const cliMessages: CliToServer[] = [
  { v: 1, t: 'hello', d: { protocol: 1, cliVersion: '0.1.0', device: "Maya's MacBook Pro", agent: { id: 'claude-code', version: '2.1.290', modes: ['reviewer', 'editor'] }, repos: ['acme/shop-api'], concurrency: 1, running: [job], defaults: { autoReview: true, autoAddress: true } } },
  { v: 1, t: 'ping', d: { running: [job] } },
  { v: 1, t: 'job.progress', d: { ...job, stage: 'running_agent', text: 'reading src/orders/list.ts' } },
  { v: 1, t: 'job.pushing', id: 'm1', d: { ...job, from: 'a'.repeat(40), to: 'c'.repeat(40) } },
  { v: 1, t: 'job.complete', id: 'm2', d: { ...job, result: jobResult() } },
  { v: 1, t: 'job.fail', id: 'm3', d: { ...job, reason: 'quota', retryable: true, detail: 'Gemini quota reached' } },
  { v: 1, t: 'job.reject', id: 'm4', d: { ...job, reason: 'daily_cap' } },
];

const serverMessages: ServerToCli[] = [
  { v: 1, t: 'welcome', d: { login: 'maya', pingSec: 25, leaseSec: 90 } },
  { v: 1, t: 'pong', d: {} },
  { v: 1, t: 'ack', re: 'm1', d: { status: 'applied' } },
  { v: 1, t: 'job.assign', d: { bundle: jobBundle() } },
  { v: 1, t: 'job.cancel', d: { ...job, reason: 'pr_closed' } },
  { v: 1, t: 'notify', d: { kind: 'ready', chatId: 'c1', title: 'Ready for your approval', url: 'https://nitpilot.dev/c/acme/shop-api/142' } },
];

const pollResponses: CliLoginPollResponse[] = [
  { status: 'pending' },
  { status: 'approved', token: 'nit_abc' },
  { status: 'denied' },
  { status: 'expired' },
];

describe('CLI → server messages', () => {
  it.each(cliMessages)('round-trips $t', (msg) => roundTrip(CliToServer, msg));

  it('rejects a message type the server does not know', () => {
    expect(CliToServer.safeParse({ v: 1, t: 'job.explode', d: {} }).success).toBe(false);
  });

  it('rejects a CLI that asks for more than 4 concurrent jobs', () => {
    const hello = { v: 1, t: 'hello', d: { protocol: 1, cliVersion: '0.1.0', device: 'x', agent: { id: 'fake', version: null, modes: ['reviewer'] }, repos: [], concurrency: 9, running: [], defaults: { autoReview: true, autoAddress: true } } };
    expect(CliToServer.safeParse(hello).success).toBe(false);
  });
});

describe('server → CLI messages', () => {
  it.each(serverMessages)('round-trips $t', (msg) => roundTrip(ServerToCli, msg));
});

describe('envelope and constants', () => {
  it('encode() adds the protocol version', () => {
    expect(JSON.parse(encode({ t: 'pong', d: {} }))).toEqual({ v: 1, t: 'pong', d: {} });
  });

  it('uses the spec close codes', () => {
    expect(CLOSE_CODES).toEqual({ reauth: 4401, upgradeCli: 4426, serverRestart: 1012 });
  });
});

describe('REST shapes', () => {
  it.each(pollResponses)('round-trips poll status $status', (r) => roundTrip(CliLoginPollResponse, r));

  it('round-trips the chat list', () =>
    roundTrip(MyChatsResponse, {
      chats: [{ id: 'c1', repo: 'acme/shop-api', number: 142, title: 'Cursor pagination', role: 'reviewer', phase: 'ready', round: 2, attention: 'none', url: 'https://nitpilot.dev/c/acme/shop-api/142', updatedAt: '2026-10-07T18:04:00.000Z' }],
    }));
});
