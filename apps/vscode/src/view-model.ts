import type { Attention, MyChat, RetryResponse } from '@nitpilot/protocol';
import { NEEDS, prUrl } from 'nitpilot/src/commands/status';
import type { Poll } from './poll';

/** The last list the server gave, kept so a network blip doesn't empty the sidebar. */
export type LastGood = { server: string; chats: MyChat[]; at: Date };

export type StatusBarModel = {
  text: string;
  tooltip: string;
  warning: boolean;
  command: 'nitpilot.showPrs' | 'nitpilot.login' | 'nitpilot.openServer';
};

export type ChatRow = {
  chat: MyChat;
  label: string;
  description: string;
  tooltip: string;
  icon: string;
  contextValue: 'chat' | 'chat.failed';
  githubUrl: string;
};

export type Group = { id: 'needs' | 'open'; label: string; rows: ChatRow[] };

/** `message` is shown above the tree (VS Code's TreeView.message): an error, or how old a stale list is. */
export type TreeModel = { reauthRow: boolean; groups: Group[]; message: string | undefined };

/** A codicon per attention flag (spec: "Sidebar"). */
const ICONS: Record<Attention, string> = {
  none: 'git-pull-request',
  decision: 'question',
  manual_review: 'eye',
  failed: 'error',
  drafts: 'edit',
};

/** The same count as `nitpilot status --line`: every chat waiting on you. */
export function needYouCount(chats: MyChat[]): number {
  return chats.filter((c) => c.attention !== 'none').length;
}

export function statusBar(p: Poll): StatusBarModel {
  switch (p.state) {
    case 'logged_out':
      return { text: '$(account) Nitpilot: log in', tooltip: 'Not logged in to Nitpilot. Click to run `nitpilot login`.', warning: false, command: 'nitpilot.login' };
    case 'needs_reauth':
      return { text: '$(warning) Nitpilot: sign in again', tooltip: `Your GitHub sign-in expired. Click to sign in again on ${host(p.server)}.`, warning: true, command: 'nitpilot.openServer' };
    case 'unreachable':
      return { text: '$(cloud-offline) Nitpilot', tooltip: p.message, warning: false, command: 'nitpilot.showPrs' };
    case 'error':
      return { text: '$(warning) Nitpilot', tooltip: p.message, warning: false, command: 'nitpilot.showPrs' };
    case 'ok': {
      const open = p.chats.length;
      const needYou = needYouCount(p.chats);
      const where = `${open} open on ${host(p.server)}`;
      if (needYou > 0) {
        return { text: `$(bell-dot) ${needYou} ${needYou === 1 ? 'needs' : 'need'} you`, tooltip: `${needYou} ${needYou === 1 ? 'PR needs' : 'PRs need'} you · ${where}`, warning: true, command: 'nitpilot.showPrs' };
      }
      if (open > 0) return { text: `$(check) ${open} open`, tooltip: `Nothing needs you · ${where}`, warning: false, command: 'nitpilot.showPrs' };
      return { text: '$(check) Nitpilot', tooltip: `No open PRs on ${host(p.server)}`, warning: false, command: 'nitpilot.showPrs' };
    }
  }
}

export function tree(p: Poll, lastGood: LastGood | null): TreeModel {
  if (p.state === 'ok') return { reauthRow: false, groups: groups(p.chats), message: undefined };
  if (p.state === 'logged_out') return { reauthRow: false, groups: [], message: undefined };
  if (p.state === 'error') return { reauthRow: false, groups: [], message: p.message };
  if (p.state === 'needs_reauth' && p.chats) return { reauthRow: true, groups: groups(p.chats), message: undefined };

  // unreachable, or needs_reauth without a list: the last good list from this same server, marked stale.
  const stale = lastGood?.server === p.server ? lastGood : null;
  if (!stale) return { reauthRow: false, groups: [], message: p.state === 'unreachable' ? p.message : undefined };
  return { reauthRow: p.state === 'needs_reauth', groups: groups(stale.chats), message: `Showing the list as of ${time(stale.at)}.` };
}

export function nextLastGood(p: Poll, prev: LastGood | null, now: Date): LastGood | null {
  if (p.state === 'ok' || (p.state === 'needs_reauth' && p.chats)) return { server: p.server, chats: p.chats!, at: now };
  if (p.state === 'unreachable' || p.state === 'needs_reauth') return prev;
  return null; // logged out or broken: nothing old is yours to show any more
}

/** What `nitpilot retry` says, shortened for the status bar. */
export function retryMessage(chat: Pick<MyChat, 'repo' | 'number'>, status: RetryResponse['status']): string {
  const pr = `${chat.repo}#${chat.number}`;
  return status === 'queued' ? `Queued your agent again on ${pr}.` : `Cleared the failure on ${pr}. Your agent runs again once the PR's current step is done.`;
}

function groups(chats: MyChat[]): Group[] {
  const needs = chats.filter((c) => c.attention !== 'none').map(row);
  const open = chats.filter((c) => c.attention === 'none').map(row);
  const all: Group[] = [
    { id: 'needs', label: `Needs you (${needs.length})`, rows: needs },
    { id: 'open', label: `Open (${open.length})`, rows: open },
  ];
  return all.filter((g) => g.rows.length > 0);
}

function row(chat: MyChat): ChatRow {
  const status = chat.attention === 'none' ? `${chat.phase} · round ${chat.round}` : NEEDS[chat.attention];
  return {
    chat,
    label: `${chat.repo}#${chat.number}`,
    description: `${chat.title} · ${status}`,
    tooltip: `${chat.title}\nYou're the ${chat.role} · ${chat.phase} · round ${chat.round}`,
    icon: ICONS[chat.attention],
    contextValue: chat.attention === 'failed' ? 'chat.failed' : 'chat',
    githubUrl: prUrl(chat),
  };
}

function host(server: string): string {
  return new URL(server).host;
}

function time(at: Date): string {
  return at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
