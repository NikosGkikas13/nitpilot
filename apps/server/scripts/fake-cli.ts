import {
  CLI_WS_PATH, CliLoginPollResponse, CliLoginStartResponse, PROTOCOL_VERSION, ServerToCli,
  type CliToServer, type JobBundle, type JobResult,
} from '@nitpilot/protocol';

// A stand-in for the real CLI (Plan 1b, M7), for live checks before it exists. It logs in like
// `nitpilot login`, connects to /ws/cli, and answers every review job with one planted point, so a
// summary comment shows up on GitHub. Its "agent" only reviews, so it never gets address jobs.
//   npm run dev:fake-cli -w apps/server -- owner/repo
// NITPILOT_SERVER points it at another server than http://localhost:8787.

const repo = process.argv[2] ?? '';
if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
  console.error('Usage: npm run dev:fake-cli -w apps/server -- owner/repo');
  process.exit(1);
}
const server = process.env.NITPILOT_SERVER ?? 'http://localhost:8787';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (text: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${text}`);

/** The planted point. Its title mentions someone outside the PR, which the summary must neutralize. */
const RESULT: JobResult = {
  summary: 'fake-cli planted one point to check the summary comment.',
  points: [
    {
      path: null,
      line: null,
      side: null,
      severity: 'minor',
      category: 'docs',
      title: 'Mention check: @nitpilot-mention-check must show as code, not as a mention',
      body: 'Planted by apps/server/scripts/fake-cli.ts.',
      snippet: null,
    },
  ],
  decisions: [],
  replies: [],
  push: null,
};

async function postJson(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${server}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return res.json();
}

/** `nitpilot login`, in short: get a code, wait for approval in the browser, receive a token. */
async function login(): Promise<string> {
  const start = CliLoginStartResponse.parse(await postJson('/api/cli/login', { deviceName: 'fake-cli (dev script)' }));
  log(`Approve this device: open ${start.verifyUrl} (code ${start.userCode}), signed in as the reviewer.`);
  for (;;) {
    await sleep(start.interval * 1000);
    const poll = CliLoginPollResponse.parse(await postJson('/api/cli/login/poll', { deviceCode: start.deviceCode }));
    if (poll.status === 'approved') return poll.token;
    if (poll.status !== 'pending') throw new Error(`login ${poll.status}`);
  }
}

async function main(): Promise<void> {
  const token = await login();
  const ws = new WebSocket(`${server.replace(/^http/, 'ws')}${CLI_WS_PATH}`, { headers: { authorization: `Bearer ${token}` } });
  const running = new Map<string, number>(); // jobId → attempt
  const send = (msg: CliToServer) => ws.send(JSON.stringify(msg));

  async function answer(bundle: JobBundle): Promise<void> {
    running.set(bundle.jobId, bundle.attempt);
    log(`job.assign: ${bundle.type} of ${bundle.pr.repoFullName}#${bundle.pr.number} at ${bundle.pr.headSha.slice(0, 7)} (attempt ${bundle.attempt})`);
    await sleep(2000);
    if (running.get(bundle.jobId) !== bundle.attempt) return; // cancelled meanwhile
    send({ v: 1, t: 'job.complete', id: `complete-${bundle.jobId}`, d: { jobId: bundle.jobId, attempt: bundle.attempt, result: RESULT } });
    running.delete(bundle.jobId);
  }

  ws.addEventListener('open', () => {
    send({
      v: 1,
      t: 'hello',
      d: {
        protocol: PROTOCOL_VERSION,
        cliVersion: '0.0.0-dev',
        device: 'fake-cli',
        agent: { id: 'fake', version: null, modes: ['reviewer'] },
        repos: [repo],
        concurrency: 1,
        running: [],
        defaults: { autoReview: true, autoAddress: true },
      },
    });
  });
  ws.addEventListener('message', (event) => {
    const msg = ServerToCli.parse(JSON.parse(String(event.data)));
    if (msg.t === 'welcome') {
      log(`connected as ${msg.d.login}; waiting for review jobs on ${repo} (Ctrl-C stops)`);
      setInterval(() => send({ v: 1, t: 'ping', d: { running: [...running].map(([jobId, attempt]) => ({ jobId, attempt })) } }), msg.d.pingSec * 1000);
    } else if (msg.t === 'job.assign') {
      void answer(msg.d.bundle);
    } else if (msg.t === 'job.cancel') {
      running.delete(msg.d.jobId);
      log(`job.cancel: ${msg.d.jobId} (${msg.d.reason})`);
    } else if (msg.t !== 'pong') {
      log(`${msg.t}: ${JSON.stringify(msg.d)}`);
    }
  });
  ws.addEventListener('close', (event) => {
    log(`disconnected (${event.code} ${event.reason})`);
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
