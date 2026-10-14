/** @jsxImportSource hono/jsx */
import { BRAND, type Snippet } from '@nitpilot/protocol';
import type { Activity } from '../../chats/activity';
import type { Message, Point, PrChat, Repo } from '../../generated/prisma/client';
import { Layout } from './layout';

// The read-only transcript (spec §10). Deliberately plain: the web app replaces it in Plan 2.
// Everything people and agents wrote is shown as text; JSX escapes it, so nothing in it runs as HTML.

const PHASE: Record<string, string> = {
  idle: 'Waiting to start',
  reviewing: 'Reviewing',
  addressing: 'Fixing',
  ready: 'Ready for approval',
  escalated: 'Needs a human',
  closed: 'Closed',
};

export function TranscriptPage(props: { chat: PrChat & { repo: Repo }; maxRounds: number; activity: Activity; messages: Message[]; points: Point[] }) {
  const { chat, points } = props;
  const phase = chat.phase === 'closed' && chat.merged ? 'Merged' : (PHASE[chat.phase] ?? chat.phase);
  const activity = activityText(props.activity, chat.repo.fullName);
  // Replies and decisions are shown inside their point's card, and so are human replies in its GitHub thread.
  const pointOf = (m: Message) => points.find((p) => p.number === m.pointNumber) ?? threadPoint(m, points);
  const inCard = (m: Message) => m.kind !== 'point_raised' && pointOf(m) !== undefined;
  return (
    <Layout title={chat.title} wide>
      <h1>{chat.title}</h1>
      <p class="muted">
        <a href={chat.url}>{chat.repo.fullName}#{chat.number}</a> · {phase} · round {chat.round} of {props.maxRounds}
      </p>
      {chat.repo.rulesError && <p class="warn">{BRAND.teamConfigFile} has a problem, so the defaults apply: {chat.repo.rulesError}</p>}
      {activity && <p class="activity">{activity}</p>}
      <ol class="timeline">
        {props.messages.filter((m) => !inCard(m)).map((m) => {
          const point = m.kind === 'point_raised' ? pointOf(m) : undefined;
          if (point) return <li><PointCard point={point} thread={props.messages.filter((t) => t.kind !== 'point_raised' && pointOf(t) === point)} /></li>;
          return <li class={m.kind === 'system' ? 'muted' : undefined}>{line(m)}</li>;
        })}
      </ol>
    </Layout>
  );
}

function PointCard(props: { point: Point; thread: Message[] }) {
  const p = props.point;
  const where = p.path ? ` · ${p.path}${p.line ? `:${p.line}` : ''}` : '';
  const snippet = p.snippet as Snippet | null;
  return (
    <article class="point">
      <p class="muted">P{p.number} · {p.severity} · {p.category}{where}</p>
      <h2>{p.title}</h2>
      <p class="status">{statusText(p)}</p>
      <p class="text">{p.body}</p>
      {snippet && <pre>{snippet.lines.map((l, i) => `${String(snippet.startLine + i).padStart(4)}  ${l}`).join('\n')}</pre>}
      {props.thread.length > 0 && <ul class="thread">{props.thread.map((m) => <li>{line(m)}</li>)}</ul>}
    </article>
  );
}

/** A point's status, in words. */
function statusText(p: Point): string {
  if (p.status === 'addressed') return p.authorResolution ? `Addressed: ${p.authorResolution}` : 'Addressed';
  if (p.status === 'escalated') return p.escalationReason ? `Escalated: ${p.escalationReason.replaceAll('_', ' ')}` : 'Escalated';
  return p.status === 'resolved' ? 'Resolved' : 'Open';
}

/** One timeline item as a line of text: who said it, then what. */
function line(m: Message): string {
  if (m.kind === 'system' || !m.authorLogin) return m.body;
  const who = m.kind === 'job_summary' || m.kind === 'point_reply' || m.kind === 'point_decision' ? `${m.authorLogin}'s agent` : m.authorLogin;
  return `${who}: ${m.body}`;
}

/** The point whose GitHub thread a human comment replied in, if any. */
function threadPoint(m: Message, points: Point[]): Point | undefined {
  const root = (m.data as { threadRootId?: string } | null)?.threadRootId;
  return root ? points.find((p) => p.githubThreadRootId === root || p.githubCommentId === root) : undefined;
}

function activityText(a: Activity, repoFullName: string): string | null {
  switch (a.kind) {
    case 'agent_working':
      return `${a.who}'s agent is working`;
    case 'agent_waiting':
      if (a.why === 'offline') return `${a.who}'s agent is waiting: ${a.offlineSince ? `offline since ${utc(a.offlineSince)}` : "their CLI hasn't connected yet"}`;
      if (a.why === 'repo_not_linked') return `${a.who}'s agent is waiting: ${repoFullName} isn't linked on ${a.who}'s connected CLI (${BRAND.cli} repos add)`;
      return `${a.who}'s agent is waiting: it reached its limit for now (daily job cap or agent quota)`;
    case 'human_turn':
      return `${a.who}'s turn`;
    case 'none':
      return null;
  }
}

const utc = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/** No such chat, or the viewer can't read its repo: the same page, so it doesn't tell which repos have chats. */
export function TranscriptNotFound() {
  return (
    <Layout title="Not found">
      <h1>Nothing here</h1>
      <p class="muted">This chat doesn't exist, or your GitHub account can't see its repo.</p>
    </Layout>
  );
}

export function SignInAgain(props: { next: string }) {
  return (
    <Layout title="Sign in again">
      <h1>Sign in again</h1>
      <p class="muted">Your GitHub sign-in expired, so {BRAND.name} can't check that you can see this repo.</p>
      <div class="row"><a class="button primary" href={`/auth/github/login?next=${encodeURIComponent(props.next)}`}>Sign in with GitHub →</a></div>
    </Layout>
  );
}
