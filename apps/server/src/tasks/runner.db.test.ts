import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeChat, makeRepo, resetDb } from '../../test/db';
import type { Prisma } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { GithubError } from '../platform/github/client';
import { timerHandler } from './handlers/timer';
import { backoffMs, MAX_TASK_ATTEMPTS, PermanentTaskError, recoverRunningTasks, TaskRunner } from './runner';

beforeEach(resetDb);

const NOW = new Date('2026-10-07T18:00:00Z');
const newTask = (over: Partial<Prisma.TaskUncheckedCreateInput> = {}) => prisma.task.create({ data: { kind: 'test', payload: {}, runAt: NOW, ...over } });
const statusOf = async (id: string) => (await prisma.task.findUniqueOrThrow({ where: { id } })).status;

describe('TaskRunner', () => {
  it('runs due tasks and leaves future ones for later', async () => {
    const due = await newTask();
    const later = await newTask({ runAt: new Date(NOW.getTime() + 60_000) });
    const handler = vi.fn(async () => {});
    expect(await new TaskRunner({ test: handler }, { now: () => NOW }).runDue()).toBe(1);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(await statusOf(due.id)).toBe('done');
    expect(await statusOf(later.id)).toBe('pending');
  });

  it('retries a failing task with backoff, then gives up', async () => {
    const task = await newTask();
    let now = NOW;
    const runner = new TaskRunner({ test: async () => { throw new Error('GitHub 502'); } }, { now: () => now });

    await runner.runDue();
    let row = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(row).toMatchObject({ status: 'pending', attempts: 1, lastError: 'GitHub 502' });
    expect(row.runAt).toEqual(new Date(NOW.getTime() + backoffMs(1)));

    for (let i = 2; i <= MAX_TASK_ATTEMPTS; i++) {
      now = row.runAt;
      await runner.runDue();
      row = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    }
    expect(row).toMatchObject({ status: 'failed', attempts: MAX_TASK_ATTEMPTS });
  });

  it('keeps trying for about an hour before giving up, so a short GitHub incident loses nothing', () => {
    const waits = Array.from({ length: MAX_TASK_ATTEMPTS - 1 }, (_, i) => backoffMs(i + 1));
    const total = waits.reduce((sum, ms) => sum + ms, 0);
    expect(total).toBeGreaterThanOrEqual(55 * 60_000);
    expect(total).toBeLessThanOrEqual(70 * 60_000);
  });

  it('waits as long as GitHub asks when it rate-limits a write', async () => {
    const task = await newTask();
    await new TaskRunner({ test: async () => { throw new GithubError(403, null, 'secondary rate limit', 120_000); } }, { now: () => NOW }).runDue();
    const row = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(row).toMatchObject({ status: 'pending', attempts: 1 });
    expect(row.runAt).toEqual(new Date(NOW.getTime() + 120_000));
  });

  it('tells onGiveUp about a task it gave up on, and not about one it will retry', async () => {
    const permanent = await newTask();
    const transient = await newTask({ kind: 'flaky' });
    const gaveUp: { id: string; error: unknown }[] = [];
    const error = new PermanentTaskError('user must sign in again');
    const runner = new TaskRunner(
      { test: async () => { throw error; }, flaky: async () => { throw new Error('GitHub 502'); } },
      { now: () => NOW, onGiveUp: async (task, err) => { gaveUp.push({ id: task.id, error: err }); } },
    );
    await runner.runDue();
    expect(gaveUp).toEqual([{ id: permanent.id, error }]);
    expect(await statusOf(transient.id)).toBe('pending');
  });

  it('gives up at once on a PermanentTaskError, or a kind it has no handler for', async () => {
    const permanent = await newTask();
    const unknown = await newTask({ kind: 'mystery' });
    await new TaskRunner({ test: async () => { throw new PermanentTaskError('user must sign in again'); } }, { now: () => NOW }).runDue();
    expect(await statusOf(permanent.id)).toBe('failed');
    expect((await prisma.task.findUniqueOrThrow({ where: { id: unknown.id } })).lastError).toMatch(/no handler/);
  });

  it('leaves a task pending when it was rescheduled while running (a debounce during the write)', async () => {
    const task = await newTask({ dedupeKey: 'summary:x' });
    const later = new Date(NOW.getTime() + 5_000);
    await new TaskRunner({ test: async () => { await prisma.task.update({ where: { id: task.id }, data: { status: 'pending', runAt: later } }); } }, { now: () => NOW }).runDue();
    expect(await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ status: 'pending', runAt: later });
  });

  it('never runs two passes at once', async () => {
    // Two tasks: overlapping passes would each claim one and run them side by side.
    await newTask();
    await newTask();
    let concurrent = 0;
    let maxConcurrent = 0;
    const runner = new TaskRunner({ test: async () => { concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent); await new Promise((r) => setTimeout(r, 10)); concurrent--; } }, { now: () => NOW });
    await Promise.all([runner.tick(), runner.tick(), runner.tick()]);
    expect(maxConcurrent).toBe(1);
  });
});

describe('recoverRunningTasks', () => {
  it('makes tasks left running by a crashed process pending again', async () => {
    const task = await newTask({ status: 'running', attempts: 1 });
    expect(await recoverRunningTasks()).toBe(1);
    expect(await statusOf(task.id)).toBe('pending');
  });
});

describe('timerHandler', () => {
  it('turns a due timer into a timer event for its chat', async () => {
    const chat = await makeChat((await makeRepo()).id);
    const dispatch = vi.fn(async () => ({ chat: {} as never, timeline: [], commands: [] }));
    const task = await newTask({ kind: 'timer', chatId: chat.id, payload: { key: 'comments' } });
    await timerHandler(dispatch)(task);
    expect(dispatch).toHaveBeenCalledWith(chat.id, { type: 'timer', key: 'comments' });
  });
});
