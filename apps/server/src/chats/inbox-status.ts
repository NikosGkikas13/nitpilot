import type { Attention, InboxStatus, Phase, Role } from '@nitpilot/protocol';
import type { Activity } from './activity';

/** What a chat looks like to one person reading their inbox. */
export type InboxStatusFacts = {
  phase: Phase;
  merged: boolean;
  activity: Activity;
  /** The reader's attention in this chat, for this role. */
  attention: Attention;
  /** The reader's role in this chat: the author's row and a reviewer's row can differ. */
  role: Role;
  /** The reader's GitHub login, so "your turn" can be told from "their turn". */
  you: string;
};

/**
 * The status pill of one inbox row (spec §16, handoff §1). Rules are checked in order, most important first:
 * a finished PR, then what you have to do, then a ready chat, then what the agents and people are doing.
 */
export function inboxStatus(f: InboxStatusFacts): InboxStatus {
  if (f.merged) return pill('merged');
  if (f.phase === 'closed') return pill('closed');

  if (f.attention === 'decision') return pill('escalated', null, 'decision');
  if (f.attention !== 'none') return pill('needs_you', null, f.attention);

  // Nothing open: the reviewer approves on GitHub, and the author waits for that.
  if (f.phase === 'ready') return pill(f.role === 'reviewer' ? 'ready' : 'their_turn');

  const a = f.activity;
  if (a.kind === 'agent_waiting') return pill('waiting', a.who, a.why);
  if (a.kind === 'agent_working') return pill('working', a.who);
  if (a.kind === 'human_turn') return a.who === f.you ? pill('needs_you') : pill('their_turn', a.who);
  return pill('quiet');
}

function pill(kind: InboxStatus['kind'], who: string | null = null, reason: InboxStatus['reason'] = null): InboxStatus {
  return { kind, who, reason };
}
