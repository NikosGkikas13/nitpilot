import type { BrowserContext, Page } from '@playwright/test';
import { BASE_URL, CONTROL_URL } from './ports';

/**
 * The people the Playwright server knows (apps/server/test/e2e/web-server.ts): maya and leo, who open and review the
 * test PRs and have CLIs; rita, who can read the repo but takes no part; and otto, from whom GitHub hides it.
 */
export type Person = 'maya' | 'leo' | 'rita' | 'otto';

/** Sign a test user in: the browser gets the session cookie a real GitHub sign-in would have set. */
export async function signIn(context: BrowserContext, login: Person): Promise<void> {
  const res = await fetch(`${CONTROL_URL}/signin`, { method: 'POST', body: JSON.stringify({ login }) });
  if (!res.ok) throw new Error(`signing in ${login} failed: ${res.status} ${await res.text()}`);
  const cookie = (await res.json()) as { name: string; value: string };
  await context.addCookies([{ ...cookie, url: BASE_URL }]);
}

/** Forget every PR the earlier tests opened (they share one server and database). People stay signed up. */
export async function resetChats(): Promise<void> {
  const res = await fetch(`${CONTROL_URL}/reset`, { method: 'POST' });
  if (!res.ok) throw new Error(`resetting failed: ${res.status} ${await res.text()}`);
}

/** Open a pull request on the test repo (octo/sandbox), as GitHub's webhook would. */
export async function openPr(pr: { number: number; title: string; author: 'maya' | 'leo'; reviewer: 'maya' | 'leo' }): Promise<void> {
  const res = await fetch(`${CONTROL_URL}/pr`, { method: 'POST', body: JSON.stringify(pr) });
  if (!res.ok) throw new Error(`opening PR #${pr.number} failed: ${res.status} ${await res.text()}`);
}

/** Start someone's CLI on the fake agent, running a scenario from apps/cli/src/agents/fake/scenarios. */
export async function startCli(login: 'maya' | 'leo', scenario: string): Promise<void> {
  const res = await fetch(`${CONTROL_URL}/cli`, { method: 'POST', body: JSON.stringify({ login, scenario }) });
  if (!res.ok) throw new Error(`starting ${login}'s CLI failed: ${res.status} ${await res.text()}`);
}

export async function stopCli(login: 'maya' | 'leo'): Promise<void> {
  const res = await fetch(`${CONTROL_URL}/cli`, { method: 'DELETE', body: JSON.stringify({ login }) });
  if (!res.ok) throw new Error(`stopping ${login}'s CLI failed: ${res.status} ${await res.text()}`);
}

/** Make `login`'s agent have failed in PR `number` for `reason` (a FailureReason); load the chat page after this. */
export async function failJob(job: { login: 'maya' | 'leo'; number: number; reason: string }): Promise<void> {
  const res = await fetch(`${CONTROL_URL}/fail-job`, { method: 'POST', body: JSON.stringify(job) });
  if (!res.ok) throw new Error(`failing ${job.login}'s job failed: ${res.status} ${await res.text()}`);
}

/**
 * What went wrong on the page: a script error, or something the Content-Security-Policy blocked. (A request
 * that answers 401 is logged by the browser too, but signed out that's expected, so it isn't collected.)
 */
export function pageProblems(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && msg.text().includes('Content Security Policy')) errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

/** Give someone a push subscription for a made-up endpoint, so `notify` has somewhere to send. `resetChats` clears it. */
export async function pushSubscription(login: 'maya' | 'leo'): Promise<void> {
  const res = await fetch(`${CONTROL_URL}/push-subscription`, { method: 'POST', body: JSON.stringify({ login }) });
  if (!res.ok) throw new Error(`subscribing ${login} failed: ${res.status} ${await res.text()}`);
}

/**
 * Tell someone they're needed, through the server's real notifier: a sample "Ready for your approval". Answers who it
 * reached and the pushes the server recorded (the Playwright server never sends a real push).
 */
export async function notify(login: 'maya' | 'leo'): Promise<{ reached: string[]; recorded: { endpoint: string; payload: string }[] }> {
  const res = await fetch(`${CONTROL_URL}/notify`, { method: 'POST', body: JSON.stringify({ login }) });
  if (!res.ok) throw new Error(`notifying ${login} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { reached: string[]; recorded: { endpoint: string; payload: string }[] };
}

/**
 * Give someone a computer without running a CLI: a CLI token row named `name` (offline; `lastSeenAt` ISO makes it look
 * used). Answers its id. Revoking it on the Settings page removes it.
 */
export async function addDevice(device: { login: 'maya' | 'leo'; name: string; lastSeenAt?: string; agent?: { id: string; version: string | null } }): Promise<string> {
  const res = await fetch(`${CONTROL_URL}/cli-token`, { method: 'POST', body: JSON.stringify(device) });
  if (!res.ok) throw new Error(`adding ${device.login}'s device failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}

/** Have GitHub list an installation of the app for someone (the setup checklist's install step). `resetChats` clears it. */
export async function installApp(login: string): Promise<void> {
  const res = await fetch(`${CONTROL_URL}/installations`, { method: 'POST', body: JSON.stringify({ login }) });
  if (!res.ok) throw new Error(`installing the app for ${login} failed: ${res.status} ${await res.text()}`);
}

/** Stop someone's CLI and revoke all their tokens, so their setup checklist starts again from "Connect your computer". */
export async function forgetDevices(login: 'maya' | 'leo'): Promise<void> {
  const res = await fetch(`${CONTROL_URL}/forget-devices`, { method: 'POST', body: JSON.stringify({ login }) });
  if (!res.ok) throw new Error(`forgetting ${login}'s devices failed: ${res.status} ${await res.text()}`);
}
