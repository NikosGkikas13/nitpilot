import type { BrowserContext, Page } from '@playwright/test';
import { BASE_URL, CONTROL_URL } from './ports';

/** Sign a test user in: the browser gets the session cookie a real GitHub sign-in would have set. */
export async function signIn(context: BrowserContext, login: 'maya' | 'leo'): Promise<void> {
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
