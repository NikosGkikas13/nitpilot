import { getEnv } from './env';

/** A chat's page in the web app, which the summary comment and the notifications link to (spec §10). */
export function transcriptUrl(repoFullName: string, number: number): string {
  return `${getEnv().PUBLIC_URL}/c/${repoFullName}/${number}`;
}
