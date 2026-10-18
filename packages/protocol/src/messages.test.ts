import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { CliLoginPollResponse, MyChatsResponse } from './api';
import { CliToServer, ServerToCli } from './cli-messages';
import { CLOSE_CODES } from './close-codes';
import { CLI_WS_PATH, encode, PROTOCOL_VERSION } from './envelope';
import { jobBundle, jobResult, publishBundle, settings } from './test-samples';

function roundTrip<S extends z.ZodType>(schema: S, value: z.infer<S>) {
  expect(schema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value);
}

const job = { jobId: 'job_1', attempt: 2 };

// Typing the arrays makes TypeScript check every sample against the union too.
const cliMessages: CliToServer[] = [
  { v: 1, t: 'hello', d: { protocol: 2, cliVersion: '0.1.0', device: "Maya's MacBook Pro", agent: { id: 'claude-code', version: '2.1.290', modes: ['reviewer', 'editor'] }, repos: ['acme/shop-api'], concurrency: 1, running: [job] } },
  { v: 1, t: 'ping', d: { running: [job], usedToday: 3 } },
  { v: 1, t: 'job.progress', d: { ...job, stage: 'running_agent', text: 'reading src/orders/list.ts' } },
  { v: 1, t: 'job.pushing', id: 'm1', d: { ...job, from: 'a'.repeat(40), to: 'c'.repeat(40) } },
  { v: 1, t: 'job.complete', id: 'm2', d: { ...job, result: jobResult() } },
  { v: 1, t: 'job.fail', id: 'm3', d: { ...job, reason: 'quota', retryable: true, detail: 'Gemini quota reached' } },
  { v: 1, t: 'job.reject', id: 'm4', d: { ...job, reason: 'daily_cap' } },
];

const serverMessages: ServerToCli[] = [
  { v: 1, t: 'welcome', d: { login: 'maya', pingSec: 25, leaseSec: 90, settings: settings() } },
  { v: 1, t: 'pong', d: {} },
  { v: 1, t: 'ack', re: 'm1', d: { status: 'applied' } },
  { v: 1, t: 'job.assign', d: { bundle: jobBundle() } },
  { v: 1, t: 'job.assign', d: { bundle: publishBundle() } },
  { v: 1, t: 'job.cancel', d: { ...job, reason: 'pr_closed' } },
  { v: 1, t: 'notify', d: { kind: 'ready', chatId: 'c1', title: 'Ready for your approval', url: 'https://nitpilot.dev/c/acme/shop-api/142', alert: true } },
  { v: 1, t: 'notify', d: { kind: 'ready', chatId: 'c1', title: 'Ready for your approval', url: 'https://nitpilot.dev/c/acme/shop-api/142', alert: false } },
  { v: 1, t: 'settings', d: { autoReview: false, autoAddress: true, dailyJobCap: 25 } },
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
    const hello = { v: 1, t: 'hello', d: { protocol: 2, cliVersion: '0.1.0', device: 'x', agent: { id: 'fake', version: null, modes: ['reviewer'] }, repos: [], concurrency: 9, running: [] } };
    expect(CliToServer.safeParse(hello).success).toBe(false);
  });

  it("still reads a protocol 1 hello, with its old defaults, so the server can tell that CLI to upgrade", () => {
    const old = { v: 1, t: 'hello', d: { protocol: 1, cliVersion: '0.1.0', device: 'x', agent: { id: 'fake', version: null, modes: ['reviewer'] }, repos: [], concurrency: 1, running: [], defaults: { autoReview: true, autoAddress: true } } };
    const parsed = CliToServer.parse(old);
    expect(parsed).toMatchObject({ t: 'hello', d: { protocol: 1 } });
    expect(parsed.d).not.toHaveProperty('defaults');
  });

  it('wants usedToday in every ping', () => {
    expect(CliToServer.safeParse({ v: 1, t: 'ping', d: { running: [] } }).success).toBe(false);
    expect(CliToServer.safeParse({ v: 1, t: 'ping', d: { running: [], usedToday: -1 } }).success).toBe(false);
  });
});

describe('server → CLI messages', () => {
  it.each(serverMessages)('round-trips $t', (msg) => roundTrip(ServerToCli, msg));

  it('refuses a welcome without the settings, and a daily cap outside 5 to 200', () => {
    expect(ServerToCli.safeParse({ v: 1, t: 'welcome', d: { login: 'maya', pingSec: 25, leaseSec: 90 } }).success).toBe(false);
    expect(ServerToCli.safeParse({ v: 1, t: 'settings', d: { ...settings(), dailyJobCap: 4 } }).success).toBe(false);
  });

  it("reads a notify without alert as an alerting one, the way a Plan 1 server sent it", () => {
    const plan1 = { v: 1, t: 'notify', d: { kind: 'failed', chatId: 'c1', title: 'Agent failed: acme/shop-api#142', url: 'https://nitpilot.dev/c/acme/shop-api/142' } };
    expect(ServerToCli.parse(plan1)).toMatchObject({ t: 'notify', d: { alert: true } });
  });
});

describe('envelope and constants', () => {
  it('speaks CLI protocol 2, in the same envelope as protocol 1: encode() adds v 1', () => {
    expect(PROTOCOL_VERSION).toBe(2);
    expect(JSON.parse(encode({ t: 'pong', d: {} }))).toEqual({ v: 1, t: 'pong', d: {} });
  });

  it('uses the spec close codes and path', () => {
    expect(CLOSE_CODES).toEqual({ reauth: 4401, upgradeCli: 4426, replaced: 4409, serverRestart: 1012 });
    expect(CLI_WS_PATH).toBe('/ws/cli');
  });
});

describe('REST shapes', () => {
  it.each(pollResponses)('round-trips poll status $status', (r) => roundTrip(CliLoginPollResponse, r));

  it('round-trips the chat list', () =>
    roundTrip(MyChatsResponse, {
      chats: [{ id: 'c1', repo: 'acme/shop-api', number: 142, title: 'Cursor pagination', role: 'reviewer', phase: 'ready', round: 2, attention: 'none', url: 'https://nitpilot.dev/c/acme/shop-api/142', updatedAt: '2026-10-07T18:04:00.000Z' }],
    }));
});
