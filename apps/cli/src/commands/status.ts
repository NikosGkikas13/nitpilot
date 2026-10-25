import { BRAND, type Attention, type MyChat } from '@nitpilot/protocol';
import { loadConfig } from '../config/config';
import { joinServerUrl, ServerClient } from '../http';
import { terminal, type Out } from '../out';

export type StatusDeps = { env?: Record<string, string | undefined>; out?: Out; fetch?: typeof fetch };

/** What the NEEDS YOU column says for each attention flag. */
const NEEDS: Record<Attention, string> = {
  none: '',
  decision: 'a decision',
  manual_review: 'start review',
  failed: 'agent failed',
  drafts: 'drafts',
};

/** `nitpilot status` (spec §11): who you are on the server, and your open PRs with Nitpilot. */
export async function status(deps: StatusDeps = {}): Promise<void> {
  const out = deps.out ?? terminal;
  const cfg = loadConfig({ env: deps.env });
  const client = new ServerClient(cfg.server, cfg.token, deps.fetch);
  const [me, { chats }] = await Promise.all([client.me(), client.myChats()]);

  out.log(`Logged in as ${me.login} on ${cfg.server}`);
  if (me.githubAuth === 'needs_reauth') {
    out.log(`! GitHub access expired. Sign in again at ${joinServerUrl(cfg.server, '/').href} so ${BRAND.name} can post in your name.`);
  }
  if (chats.length === 0) {
    out.log(`No open PRs with ${BRAND.name} yet.`);
    return;
  }
  out.log('');
  out.log(table([['PR', 'ROLE', 'PHASE', 'ROUND', 'NEEDS YOU', 'TITLE'], ...chats.map(row)]));
  for (const chat of chats.filter((c) => c.attention === 'failed')) {
    out.log('');
    out.log(`Your agent couldn't finish on ${chat.repo}#${chat.number}. To run it again: ${BRAND.cli} retry ${prUrl(chat)}`);
  }
}

function row(c: MyChat): string[] {
  const title = c.title.length > 50 ? `${c.title.slice(0, 49)}…` : c.title;
  return [`${c.repo}#${c.number}`, c.role, c.phase, String(c.round), NEEDS[c.attention], title];
}

/** Columns padded to their widest cell. */
function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
  return rows.map((r) => r.map((cell, i) => cell.padEnd(widths[i]!)).join('  ').trimEnd()).join('\n');
}

/** The PR on GitHub: the link `nitpilot retry` takes. */
export function prUrl(chat: Pick<MyChat, 'repo' | 'number'>): string {
  return `https://github.com/${chat.repo}/pull/${chat.number}`;
}
