import { getEnv } from './env';

/** The read-only chat transcript (Plan 1b) and, later, the web app's chat page. */
export function transcriptUrl(repoFullName: string, number: number): string {
  return `${getEnv().PUBLIC_URL}/c/${repoFullName}/${number}`;
}
