import type { PointView, Severity, TimelineItem } from '@nitpilot/protocol';
import { useEffect, useRef, useState } from 'react';
import { AgentBadge } from '../../components/AgentBadge/AgentBadge';
import { Avatar } from '../../components/Avatar/Avatar';
import { agentName, personName } from '../../lib/names';
import { snippetLines, syntaxTokens } from '../../lib/snippet';
import { itemTime } from '../../lib/time';
import styles from './PointCard.module.css';

const SEVERITY: Record<Severity, { word: string; bars: number }> = {
  blocker: { word: 'Blocker', bars: 4 },
  major: { word: 'Major', bars: 3 },
  minor: { word: 'Minor', bars: 2 },
  nit: { word: 'Nit', bars: 1 },
};

const STATUS: Record<PointView['status'], string> = { open: 'Open', addressed: 'Addressed', resolved: 'Resolved', escalated: 'Escalated' };

/** What the chat knows about the people in it: their pictures, by GitHub id. */
export type People = ReadonlyMap<string, { avatarUrl: string }>;

/**
 * A review point (handoff §3, the key component): severity, category, where in the code, what's wrong, the code
 * around it, and the thread of replies and decisions. A resolved point starts collapsed to one line. A `draft` point
 * (one a reviewer's agent drafted with Auto off, in its DraftCard) is marked Draft instead of a number and a status:
 * it has neither until it's sent.
 */
export function PointCard({ point, thread, you, people, repoUrl, draft = false }: { point: PointView; thread: TimelineItem[]; you: string; people: People; repoUrl: string; draft?: boolean }) {
  // Open unless resolved, until you toggle it. When the point's status changes (resolved by a person, reopened on
  // GitHub), the card follows the new status again.
  const [chosen, setChosen] = useState<{ status: PointView['status']; open: boolean } | null>(null);
  const open = chosen?.status === point.status ? chosen.open : point.status !== 'resolved';
  // Opening or closing swaps one button for the other, so the focused one disappears: hand the focus to its successor.
  // Only right after the person toggled it: never on the first render, nor when the status changes the card.
  const moveFocus = useRef(false);
  const collapsedButton = useRef<HTMLButtonElement>(null);
  const collapseButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (open ? collapseButton : collapsedButton).current?.focus();
  }, [open]);
  function toggle(next: boolean): void {
    moveFocus.current = true;
    setChosen({ status: point.status, open: next });
  }
  const severity = SEVERITY[point.severity];
  const label = draft ? `Draft, ${severity.word} ${point.category} point: ${point.title}` : `P${point.number}, ${severity.word} ${point.category} point, ${STATUS[point.status]}: ${point.title}`;

  if (!open) {
    return (
      <button ref={collapsedButton} type="button" className={styles.collapsed} onClick={() => toggle(true)} aria-expanded="false" aria-label={label}>
        <span className={styles.checkSmall} aria-hidden="true">
          ✓
        </span>
        <span className={styles.id}>P{point.number}</span>
        <span className={styles.collapsedTitle}>{point.title}</span>
        <span className={styles.id}>{outcome(point, thread)}</span>
        <span className={styles.resolvedWord}>Resolved</span>
        <span className={styles.caret} aria-hidden="true">
          ▾
        </span>
      </button>
    );
  }

  const lines = snippetLines(point);
  return (
    <article className={`${styles.card} ${point.status === 'escalated' ? styles.escalatedCard : ''}`} aria-label={label}>
      <div className={styles.head}>
        <div className={styles.chips}>
          <span className={`${styles.severity} ${styles[point.severity]}`}>
            <span className={styles.bars} aria-hidden="true">
              {[1, 2, 3, 4].map((bar) => (
                <span key={bar} className={`${styles.bar} ${bar <= severity.bars ? styles.filled : ''}`} style={{ height: 2 + bar * 2 }} />
              ))}
            </span>
            {severity.word}
          </span>
          <span className={styles.category}>{point.category}</span>
          {draft ? <span className={styles.draft}>Draft</span> : <span className={styles.id}>P{point.number}</span>}
          <span className={styles.spacer} />
          {!draft && (
            <span className={`${styles.status} ${styles[point.status]}`}>
              <StatusGlyph status={point.status} />
              {STATUS[point.status]}
            </span>
          )}
          {point.status === 'resolved' && (
            <button ref={collapseButton} type="button" className={styles.collapse} onClick={() => toggle(false)} aria-expanded="true" aria-label="Collapse point">
              ▴
            </button>
          )}
        </div>
        {point.path && (
          <a className={styles.file} href={point.url ?? undefined} target="_blank" rel="noreferrer">
            {point.line ? `${point.path}:${point.line}` : point.path}
          </a>
        )}
        <h3 className={styles.title}>{point.title}</h3>
        <p className={styles.body}>{point.body}</p>
      </div>
      {lines.length > 0 && (
        <div className={styles.snippet}>
          <div className={styles.snippetHead}>
            <span className={styles.snippetPath}>{point.path}</span>
            <span>
              L{lines[0]!.n}–{lines.at(-1)!.n}
            </span>
          </div>
          <pre className={styles.code}>
            {lines.map((line) => (
              <div key={line.n} className={`${styles.line} ${line.highlighted ? styles.highlighted : ''}`} data-highlighted={line.highlighted || undefined}>
                <span className={styles.lineNumber}>
                  {line.highlighted && <span className={styles.gutterDiamond} aria-hidden="true" />}
                  {line.n}
                </span>
                <code className={styles.lineText}>
                  {syntaxTokens(line.text).map((token, i) => (
                    <span key={i} className={styles[token.kind]}>
                      {token.text}
                    </span>
                  ))}
                </code>
              </div>
            ))}
          </pre>
        </div>
      )}
      {thread.length > 0 && (
        <ol className={styles.thread}>
          {thread.map((reply) => (
            <Reply key={reply.seq} reply={reply} you={you} people={people} repoUrl={repoUrl} />
          ))}
        </ol>
      )}
    </article>
  );
}

function StatusGlyph({ status }: { status: PointView['status'] }) {
  if (status === 'resolved') {
    return (
      <span className={styles.checkSmall} aria-hidden="true">
        ✓
      </span>
    );
  }
  return <span className={styles[`${status}Glyph`]} aria-hidden="true" />;
}

/** One reply in a point's thread: an agent's answer or decision, or a person's comment on GitHub. */
function Reply({ reply, you, people, repoUrl }: { reply: TimelineItem; you: string; people: People; repoUrl: string }) {
  const login = reply.author?.login ?? '';
  const byAgent = reply.kind === 'point_reply' || reply.kind === 'point_decision';
  const tag = replyTag(reply);
  const commit = typeof reply.data?.commit === 'string' ? reply.data.commit : null;
  return (
    <li className={styles.reply}>
      <Avatar login={login} src={people.get(reply.author?.githubId ?? '')?.avatarUrl ?? null} size={22}>
        {byAgent && <AgentBadge login={login} size="tiny" decorative />}
      </Avatar>
      <div className={styles.replyMain}>
        <div className={styles.replyHead}>
          <span className={styles.replyName}>{byAgent ? agentName(login, you) : personName(login, you)}</span>
          {tag && (
            <span className={`${styles.tag} ${styles[tag.tone]}`}>
              {tag.word}
              {tag.word === 'Fixed in' && commit && (
                <>
                  {' '}
                  <a className={styles.commit} href={`${repoUrl}/commit/${commit}`} target="_blank" rel="noreferrer">
                    {commit.slice(0, 7)}
                  </a>
                </>
              )}
            </span>
          )}
          <span className={styles.replyTime}>{itemTime(reply.at)}</span>
        </div>
        {reply.body && <p className={styles.replyText}>{reply.body}</p>}
      </div>
    </li>
  );
}

/** The outcome tag of a reply (handoff §3 "Outcome tags"). */
function replyTag(reply: TimelineItem): { word: string; tone: 'ok' | 'plain' | 'warn' | 'accent' } | null {
  const resolution = reply.data?.resolution;
  if (resolution === 'fixed') return { word: 'Fixed in', tone: 'ok' };
  if (resolution === 'declined') return { word: 'Declined', tone: 'plain' };
  if (resolution === 'answered') return { word: 'Answered', tone: 'accent' };
  const decision = reply.data?.decision;
  if (decision === 'resolve') return { word: 'Resolved', tone: 'ok' };
  if (decision === 'keep_open') return { word: 'Kept open', tone: 'warn' };
  return null;
}

/** "Fixed · a1b2c3d", "Declined" or "Answered": how a resolved point ended, for its collapsed line. */
function outcome(point: PointView, thread: TimelineItem[]): string {
  if (point.authorResolution === 'fixed') {
    const commit = thread.findLast((r) => typeof r.data?.commit === 'string')?.data?.commit;
    return typeof commit === 'string' ? `Fixed · ${commit.slice(0, 7)}` : 'Fixed';
  }
  if (point.authorResolution === 'declined') return 'Declined';
  if (point.authorResolution === 'answered') return 'Answered';
  return '';
}
