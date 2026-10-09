import { BRAND } from '@nitpilot/protocol';

// Every body Nitpilot writes to GitHub carries a hidden HTML comment, so we can recognize our
// own writes when their webhooks come back (spec §15) and find them again after a crash.

const PREFIX = `<!-- ${BRAND.commentMarker}`;

export function summaryMarker(chatId: string): string {
  return `${PREFIX} chat=${chatId} -->`;
}

export function writeMarker(chatId: string, taskId: string, pointNumber?: number): string {
  return `${PREFIX} chat=${chatId} task=${taskId}${pointNumber ? ` point=${pointNumber}` : ''} -->`;
}

export function containsMarker(body: string | null | undefined): boolean {
  return !!body && body.includes(PREFIX);
}
