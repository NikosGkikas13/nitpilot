import { rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { CLI_WS_PATH, WEB_WS_PATH } from '@nitpilot/protocol';
import { fakeAdapter, FAKE_SCENARIOS } from '../../../cli/src/agents/fake/adapter';
import { start } from '../../../cli/src/commands/start';
import { PersonalConfigSchema, saveConfig } from '../../../cli/src/config/config';
import type { Out } from '../../../cli/src/out';
import { RepoAccess } from '../../src/auth/repo-access';
import { Dispatcher } from '../../src/chats/dispatch';
import { loadItemsAfter } from '../../src/chats/timeline';
import { createDeliveryHandler } from '../../src/ingest/handle';
import { createIngest } from '../../src/ingest/process';
import { prisma } from '../../src/lib/prisma';
import { FakePlatform } from '../../src/platform/fake/fake-platform';
import { GithubClient } from '../../src/platform/github/client';
import { CliNotifier } from '../../src/tasks/cli-notifier';
import { reportFailedWrite } from '../../src/tasks/handlers/failed-writes';
import { createTaskHandlers } from '../../src/tasks/handlers/index';
import { FallbackNotifier, type Notification } from '../../src/tasks/notifier';
import { PushNotifier } from '../../src/tasks/push-notifier';
import { TaskRunner } from '../../src/tasks/runner';
import { CliHub, type MessageListener } from '../../src/ws/cli-hub';
import { routeUpgrades } from '../../src/ws/upgrade-router';
import { WebHub } from '../../src/ws/web-hub';
import { wireWebHub } from '../../src/ws/web-wire';
import { wireCliHub } from '../../src/ws/wire';
import { testApp } from '../app';
import { makeCliToken, resetDb } from '../db';
import { fakeFetch } from '../fake-fetch';
import { installationEvent, people, prEvent, pull } from '../fixtures/github';
import { sendWebhook } from '../webhooks';
import { localGithub, type Who } from './github';

/**
 * A running `nitpilot start`: what it printed, where its config lives, whether it has started an agent yet
 * (so its checkout is over), and how to stop it (resolves with its exit code).
 */
export type RunningCli = { lines: string[]; configDir: string; agentStarted: boolean; stop(): Promise<number> };

/**
 * Plan 1 end to end (spec §19): the server, wired exactly like main.ts with GitHub replaced by
 * FakePlatform and local git folders, on a random port; and one `nitpilot start` per person, each with
 * its own config folder, clone and git identity, running the fake agent. The Playwright tests' server
 * (web-server.ts) passes a fixed port, the built web app, and a GithubClient that lets people read the test repo.
 */
export async function startE2e(opts: { port?: number; webDistDir?: string; github?: GithubClient } = {}) {
  await resetDb();
  const github = localGithub();
  const platform = new FakePlatform();
  const hub = new CliHub();
  const notified: Notification[] = [];
  // As main.ts builds it on a server without VAPID keys: push is off, so every CLI alerts.
  const realNotifier = new FallbackNotifier(new PushNotifier(null), new CliNotifier(hub));
  const notifier = {
    notify: async (n: Notification) => {
      notified.push(n);
      return realNotifier.notify(n);
    },
  };
  const dispatcher = new Dispatcher();
  // Debounced work (the summary comment, notifications) is due at once: tasks run as if a minute had passed.
  const runner = new TaskRunner(createTaskHandlers({ platform, notifier, dispatch: dispatcher.dispatch }), {
    now: () => new Date(Date.now() + 60_000),
    tickMs: 100,
    onGiveUp: reportFailedWrite(dispatcher.dispatch),
  });
  dispatcher.onCommit((_chatId, effects) => {
    if (effects.tasksCreated) runner.wake();
  });
  // A test can look at (and act on) each CLI message before the server handles it, e.g. push as a human first.
  let intercept: MessageListener | null = null;
  hub.onMessage(async (conn, msg) => intercept?.(conn, msg));
  const cliJobs = wireCliHub({ hub, dispatcher, platform });
  const ingest = createIngest(createDeliveryHandler({ platform, dispatch: dispatcher.dispatch }));
  // GitHub's API for people's own access checks; nothing answers unless the caller passes one that does.
  const githubApi = opts.github ?? new GithubClient(fakeFetch({}));
  const access = new RepoAccess(githubApi);
  const webHub = new WebHub({ access, loadItems: loadItemsAfter });
  const live = wireWebHub({ webHub, dispatcher, cliHub: hub, access });
  const app = testApp({ ingest, dispatch: dispatcher.dispatch, clis: hub, access, webSockets: webHub, github: githubApi, platform, ...(opts.webDistDir ? { webDistDir: opts.webDistDir } : {}) });
  const clis: RunningCli[] = [];
  let server: Server | null = null;
  /** Stop everything started so far, then delete the pretend GitHub's folders. Also what a failed setup does. */
  async function close(): Promise<void> {
    try {
      for (const cli of clis) await cli.stop().catch(() => {});
      cliJobs.stop();
      live.stop();
      runner.stop();
      await hub.idle();
      hub.closeAll(1001, 'test over');
      webHub.close(1001, 'test over');
      const listening = server;
      if (listening) {
        listening.closeAllConnections();
        await new Promise((closed) => listening.close(closed));
      }
    } finally {
      // Even when a step above failed: the bare repo, the clones, the configs and the worktrees go too.
      rmSync(github.root, { recursive: true, force: true });
    }
  }

  // If anything below throws, stop what already started (otherwise the server and its timers keep running).
  try {
    const listening = await new Promise<Server>((resolve) => {
      const s = serve({ fetch: app.fetch, port: opts.port ?? 0, hostname: '127.0.0.1' }, () => resolve(s as Server));
    });
    server = listening;
    routeUpgrades(listening, { [CLI_WS_PATH]: hub.handleUpgrade, [WEB_WS_PATH]: webHub.handleUpgrade });
    const url = `http://127.0.0.1:${(listening.address() as AddressInfo).port}`;
    runner.start();
    cliJobs.start();

    const users = {
      maya: await prisma.user.create({ data: { githubId: String(people.maya.id), login: people.maya.login } }),
      leo: await prisma.user.create({ data: { githubId: String(people.leo.id), login: people.leo.login } }),
    };
    /** Send a webhook as GitHub would, and wait until it's handled. */
    const deliver = async (event: string, payload: unknown) => {
      const res = await sendWebhook(app, event, payload);
      if (res.status !== 202) throw new Error(`webhook ${event} answered ${res.status}`);
      await ingest.idle();
    };
    await deliver('installation', installationEvent('created'));

    const people_ = { maya: github.personFor('maya'), leo: github.personFor('leo') };

    return {
      url,
      github,
      platform,
      hub,
      webHub,
      notified,
      users,
      deliver,
      /** Run code on each CLI message before the server sees it. */
      intercept(listener: MessageListener | null): void {
        intercept = listener;
      },
      /** The PR's chat, once the server has one. */
      chat: () => prisma.prChat.findFirstOrThrow({ include: { jobs: true } }),
      /** Open the PR with leo as reviewer, at the local head. */
      openPr: () => deliver('pull_request', prEvent('opened', { pull: { head: { ...pull().head, sha: github.headSha }, base: { ...pull().base, sha: github.baseSha } } })),
      /** `nitpilot start` for one person, running the fake agent with a scenario from agents/fake/scenarios. */
      async startCli(who: Who, scenario = 'happy.json'): Promise<RunningCli> {
        const { clone, env } = people_[who];
        const configDir = join(github.root, 'config', who);
        const { raw } = await makeCliToken(users[who].id);
        saveConfig(PersonalConfigSchema.parse({ server: url, token: raw, agent: 'fake', repos: { [pull().base.repo.full_name]: { path: clone } } }), configDir);
        const lines: string[] = [];
        const out: Out = { log: (text) => void lines.push(text), error: (text) => void lines.push(text) };
        const stop = new AbortController();
        // buildInvocation runs right before the agent starts, after the checkout has finished: that is when
        // `agentStarted` turns true, so a test can tell "still checking out" from "the agent is running".
        const fake = fakeAdapter({ scenario: join(FAKE_SCENARIOS, scenario) });
        const adapter = {
          ...fake,
          buildInvocation: (...args: Parameters<typeof fake.buildInvocation>) => {
            cli.agentStarted = true;
            return fake.buildInvocation(...args);
          },
        };
        const exit = start({ env: { ...env, NITPILOT_CONFIG_DIR: configDir }, out, stop: stop.signal, adapter });
        const cli: RunningCli = {
          lines,
          configDir,
          agentStarted: false,
          async stop() {
            stop.abort();
            return exit;
          },
        };
        clis.push(cli);
        // Connected once the server has its hello.
        await waitFor(async () => hub.connectionsFor(users[who].id).length > 0, `${who}'s CLI to connect`);
        return cli;
      },
      close,
    };
  } catch (err) {
    await close();
    throw err;
  }
}

export type E2e = Awaited<ReturnType<typeof startE2e>>;

/** Check `ready` every 100 ms until it's true, or fail after `ms` saying what didn't happen. */
export async function waitFor(ready: () => Promise<boolean> | boolean, what: string, ms = 20_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await ready())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
