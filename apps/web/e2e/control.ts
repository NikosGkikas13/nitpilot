import type { BrowserContext, Page } from '@playwright/test';
import { BASE_URL, CONTROL_URL } from './ports';

/** Sign a test user in: the browser gets the session cookie a real GitHub sign-in would have set. */
export async function signIn(context: BrowserContext, login: 'maya' | 'leo'): Promise<void> {
  const res = await fetch(`${CONTROL_URL}/signin`, { method: 'POST', body: JSON.stringify({ login }) });
  if (!res.ok) throw new Error(`signing in ${login} failed: ${res.status} ${await res.text()}`);
  const cookie = (await res.json()) as { name: string; value: string };
  await context.addCookies([{ ...cookie, url: BASE_URL }]);
}

/** Open a pull request on the test repo (octo/sandbox), as GitHub's webhook would. */
export async function openPr(pr: { number: number; title: string; author: 'maya' | 'leo'; reviewer: 'maya' | 'leo' }): Promise<void> {
  const res = await fetch(`${CONTROL_URL}/pr`, { method: 'POST', body: JSON.stringify(pr) });
  if (!res.ok) throw new Error(`opening PR #${pr.number} failed: ${res.status} ${await res.text()}`);
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
