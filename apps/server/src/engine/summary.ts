import { createHash } from 'node:crypto';
import { BRAND, type EscalationReason, type Phase, type PointStatus, type Resolution } from '@nitpilot/protocol';

/** GitHub allows 65,536 characters per comment; stay safely below (spec §15). */
export const SUMMARY_MAX = 60_000;

export type SummaryPoint = {
  number: number;
  title: string;
  status: PointStatus;
  authorResolution: Resolution | null;
  escalationReason: EscalationReason | null;
  /** The commit that fixed it, from the author agent's reply. */
  fixedIn: string | null;
  /** The author agent's reply, shown for declined points. */
  authorComment: string | null;
};

export type SummaryView = {
  chatId: string;
  phase: Phase;
  merged: boolean;
  round: number;
  transcriptUrl: string;
  points: SummaryPoint[];
  /** Logins of the reviewers whose agents are on Nitpilot, for the last line. */
  reviewers: string[];
  /** The team's `footer` rule: false leaves the last line out. */
  footer: boolean;
};

const PHASE_LABEL: Record<Phase, string> = {
  idle: 'waiting',
  reviewing: 'agents reviewing',
  addressing: 'agents fixing',
  ready: 'ready for approval',
  escalated: 'needs a human',
  closed: 'closed',
};

const ESCALATION_LABEL: Record<EscalationReason, string> = {
  category: 'always escalated',
  disagreement: 'disagreement',
  round_limit: 'round limit',
};

/** The one PR comment Nitpilot keeps up to date in agent-to-agent mode (spec §15). */
export function renderSummary(view: SummaryView, clean: (text: string) => string = (t) => t): { body: string; hash: string } {
  const title = (p: SummaryPoint) => clean(oneLine(p.title));
  const status = view.phase === 'closed' && view.merged ? 'merged' : PHASE_LABEL[view.phase];
  const fixed = view.points.filter((p) => p.status === 'resolved' && p.authorResolution === 'fixed');
  const declined = view.points.filter((p) => p.status === 'resolved' && p.authorResolution === 'declined');
  const human = view.points.filter((p) => p.status === 'escalated');

  const head = [
    `<!-- ${BRAND.commentMarker} chat=${view.chatId} -->`,
    `🤖 **${BRAND.name}** · ${status} · ${view.round} round${view.round === 1 ? '' : 's'}`,
  ];
  if (fixed.length > 0) head.push(`Fixed: ${fixed.map((p) => `${title(p)} (P${p.number})`).join(', ')}`);
  if (declined.length > 0) {
    head.push(`Declined, reviewer agreed: ${declined.map((p) => `${title(p)} (P${p.number}${p.authorComment ? `, ${clean(short(p.authorComment))}` : ''})`).join(', ')}`);
  }
  head.push(`Needs a human: ${human.length > 0 ? human.map((p) => `${title(p)} (P${p.number})`).join(', ') : 'none'}`);

  const rows = view.points.map((p) => `| P${p.number} | ${cell(title(p))} | ${outcome(p)} |`);
  const count = view.points.length;
  const build = (shown: string[]) =>
    [
      ...head,
      `<details><summary>Review log (${count} point${count === 1 ? '' : 's'})</summary>`,
      '',
      '| # | Point | Outcome |',
      '|---|---|---|',
      ...shown,
      ...(shown.length < rows.length ? [`| … | +${rows.length - shown.length} more in chat | |`] : []),
      '</details>',
      '',
      `[Open the conversation →](${view.transcriptUrl})`,
      ...(view.footer ? ['', footerLine(view.reviewers)] : []),
    ].join('\n');

  // Drop rows from the end until the comment fits.
  let shown = rows;
  let body = build(shown);
  while (body.length > SUMMARY_MAX && shown.length > 0) {
    shown = shown.slice(0, -1);
    body = build(shown);
  }
  return { body, hash: createHash('sha256').update(body).digest('hex') };
}

/** Same style as the CLI's `review --post` footer. Logins go without `@`, so editing the comment never pings anyone. */
function footerLine(reviewers: string[]): string {
  const names = reviewers.map((login) => `${login}'s`);
  const who = names.length === 0 ? 'AI agents' : `${names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`} agent${names.length === 1 ? '' : 's'}`;
  return `<sub>Reviewed by ${who} · [get your own agent reviewer](https://${BRAND.hostedDomain})</sub>`;
}

function outcome(p: SummaryPoint): string {
  switch (p.status) {
    case 'resolved':
      if (p.authorResolution === 'fixed') return p.fixedIn ? `fixed in ${p.fixedIn.slice(0, 7)}` : 'fixed';
      if (p.authorResolution === 'declined') return 'declined, resolved by reviewer';
      if (p.authorResolution === 'answered') return 'answered, resolved by reviewer';
      return 'resolved';
    case 'escalated':
      return `needs a human (${ESCALATION_LABEL[p.escalationReason ?? 'category']})`;
    case 'addressed':
      return `${p.authorResolution ?? 'answered'}, waiting for review`;
    case 'open':
      return 'open';
  }
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function short(text: string): string {
  const line = oneLine(text);
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|');
}
