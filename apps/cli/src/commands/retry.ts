import { BRAND } from '@nitpilot/protocol';
import { loadConfig } from '../config/config';
import { CliError } from '../errors';
import { ServerClient } from '../http';
import { terminal, type Out } from '../out';

export type RetryDeps = { env?: Record<string, string | undefined>; out?: Out; fetch?: typeof fetch };

/** `nitpilot retry <pr-url>` (spec §11): queue your failed job on that PR again. */
export async function retry(ref: string | undefined, deps: RetryDeps = {}): Promise<void> {
  const out = deps.out ?? terminal;
  const pr = ref ? parsePrRef(ref) : null;
  if (!pr) throw new CliError(`Usage: ${BRAND.cli} retry <pr-url>, for example ${BRAND.cli} retry https://github.com/octo/sandbox/pull/12`);
  const cfg = loadConfig({ env: deps.env });
  const client = new ServerClient(cfg.server, cfg.token, deps.fetch);
  const { chats } = await client.myChats();
  const chat = chats.find((c) => c.repo.toLowerCase() === pr.repo.toLowerCase() && c.number === pr.number);
  if (!chat) throw new CliError(`You're not part of an open ${BRAND.name} chat on ${pr.repo}#${pr.number}.`);
  await client.retry(chat.id);
  out.log(`Queued your agent again on ${chat.repo}#${chat.number}. It runs on a device where \`${BRAND.cli} start\` is running.`);
}

/** `https://github.com/owner/name/pull/12` (anything after the number is ignored) or `owner/name#12`, else null. */
export function parsePrRef(ref: string): { repo: string; number: number } | null {
  const m = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/.exec(ref) ?? /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(ref);
  return m ? { repo: m[1]!, number: Number(m[2]) } : null;
}
