import type { ChatView, TimelineItem } from '@nitpilot/protocol';
import { useReview } from '../../api/actions';
import { useFiles } from '../../api/chat';
import { AgentBadge } from '../../components/AgentBadge/AgentBadge';
import { Avatar } from '../../components/Avatar/Avatar';
import { Ping } from '../../components/Ping/Ping';
import { useProgress } from '../../live/progress';
import { agentName, personName } from '../../lib/names';
import { itemTime } from '../../lib/time';
import { severityCounts, timelineRows, withCommitHashes, type Glyph } from '../../lib/timeline';
import { PointCard, type People } from './PointCard';
import styles from './Timeline.module.css';

/**
 * The chat's feed (handoff §2 "Timeline", the single-column layout): everyone left-aligned like an activity log,
 * point cards full width under the summary that raised them, and the live progress line at the end.
 */
export function Timeline(props: { view: ChatView; items: TimelineItem[]; hasOlder: boolean; you: string; loadingEarlier: boolean; onLoadEarlier: () => void }) {
  const { view, items, you } = props;
  const people: People = new Map(view.participants.map((p) => [p.githubId, { avatarUrl: p.avatarUrl }]));
  const repoUrl = view.url.replace(/\/pull\/\d+$/, '');
  const avatarOf = (item: TimelineItem) => people.get(item.author?.githubId ?? '')?.avatarUrl ?? null;
  return (
    <div className={styles.feed}>
      {props.hasOlder && (
        <button type="button" className={styles.earlier} onClick={props.onLoadEarlier} disabled={props.loadingEarlier}>
          {props.loadingEarlier ? 'Loading…' : 'Load earlier'}
        </button>
      )}
      <ol className={styles.list}>
        {timelineRows(items, view.points).map((row) => {
          if (row.kind === 'point') {
            return (
              <li key={`P${row.point.number}`} className={styles.pointRow}>
                <PointCard point={row.point} thread={row.thread} you={you} people={people} repoUrl={repoUrl} />
              </li>
            );
          }
          const { item } = row;
          return (
            <li key={item.seq}>
              {row.kind === 'system' ? (
                <SystemLine item={item} glyph={row.glyph} />
              ) : (
                <Message item={item} you={you} avatar={avatarOf(item)} agent={row.kind === 'summary'} />
              )}
            </li>
          );
        })}
      </ol>
      {!view.trusted && view.viewer.attention === 'manual_review' && <UntrustedCard view={view} />}
      <ProgressLine chatId={view.id} you={you} />
    </div>
  );
}

/** A system event: a glyph, the line in muted text, the time (handoff §2). */
function SystemLine({ item, glyph }: { item: TimelineItem; glyph: Glyph }) {
  return (
    <div className={styles.system}>
      <span className={styles.glyphColumn} aria-hidden="true">
        <span className={styles[glyph]}>{glyph === 'check' ? '✓' : null}</span>
      </span>
      <span className={styles.systemText}>
        {withCommitHashes(item.body).map((part, i) =>
          part.hash ? (
            <code key={i} className={styles.hash}>
              {part.text}
            </code>
          ) : (
            part.text
          ),
        )}
      </span>
      <time className={styles.time} dateTime={item.at}>
        {itemTime(item.at)}
      </time>
    </div>
  );
}

/** An agent's summary ("leo's agent", with severity counts) or a person's note (in a box; yours in your colour). */
function Message({ item, you, avatar, agent }: { item: TimelineItem; you: string; avatar: string | null; agent: boolean }) {
  const login = item.author?.login ?? '';
  const mine = login === you;
  const counts = agent ? severityCounts(item.data) : '';
  // A person's comment that came from GitHub carries the thread it was in; a note sent from Nitpilot doesn't.
  const fromGithub = item.data !== null && 'threadRootId' in item.data;
  return (
    <div className={styles.message}>
      <Avatar login={login} src={avatar} size={28}>
        {agent && <AgentBadge login={login} size="small" decorative />}
      </Avatar>
      <div className={styles.messageMain}>
        <div className={styles.messageHead}>
          <span className={styles.name}>{agent ? agentName(login, you) : personName(login, you)}</span>
          {!agent && <span className={styles.sub}>{fromGithub ? 'on GitHub' : 'to the agents'}</span>}
          <span className={styles.spacer} />
          <time className={styles.time} dateTime={item.at}>
            {itemTime(item.at)}
          </time>
        </div>
        {agent ? (
          <p className={styles.summary}>
            {item.body}
            {counts && <span className={styles.counts}> {counts}</span>}
          </p>
        ) : (
          <p className={`${styles.note} ${mine ? styles.mine : ''}`}>{item.body}</p>
        )}
      </div>
    </div>
  );
}

const STAGE: Record<string, string> = { preparing: 'getting the code', running_agent: '', pushing: 'pushing', finishing: 'finishing' };

/** What an agent is doing this second, from its CLI (handoff §2 "Live progress line"). */
function ProgressLine({ chatId, you }: { chatId: string; you: string }) {
  const progress = useProgress(chatId);
  return (
    <div className={styles.progress} role="status" aria-live="polite">
      {progress && (
        <>
          <span className={styles.glyphColumn}>
            <Ping />
          </span>
          <span className={styles.progressWho}>
            {agentName(progress.who, you)} is {progress.action}…{STAGE[progress.stage] ? ` ${STAGE[progress.stage]}` : ''}
          </span>
          <span className={styles.progressText}>{progress.text}</span>
        </>
      )}
    </div>
  );
}

/**
 * A PR from an outside contributor (handoff §2 "Untrusted PR card"): agents don't start on it by themselves, so the
 * requested reviewer skims the diff, then presses Review. With their agent offline it still queues: the "waiting"
 * line and pill come back through the socket.
 */
function UntrustedCard({ view }: { view: ChatView }) {
  const files = useFiles(view.id).data;
  const review = useReview(view.id);
  const biggest = files?.files.toSorted((a, b) => b.adds + b.dels - (a.adds + a.dels))[0];
  return (
    <section className={styles.untrusted} aria-label="First-time contributor">
      <div className={styles.eyebrow}>
        <span className={styles.ring} aria-hidden="true" />
        First-time contributor
      </div>
      <h3 className={styles.untrustedTitle}>Your agent hasn't started</h3>
      <p className={styles.untrustedBody}>Nitpilot doesn't run agents automatically on PRs from outside contributors. Skim the diff, then start the review yourself.</p>
      {files && (
        <p className={styles.fileLine}>
          {files.files.length} file{files.files.length === 1 ? '' : 's'} · <span className={styles.adds}>+{files.adds}</span> <span className={styles.dels}>−{files.dels}</span>
          {biggest ? ` · ${biggest.path}` : ''}
        </p>
      )}
      <div className={styles.untrustedActions}>
        {view.permissions.review && (
          <button type="button" className={styles.primaryButton} disabled={review.isPending} onClick={() => review.mutate()}>
            {review.isPending ? 'Starting…' : 'Review'}
          </button>
        )}
        <a className={styles.button} href={`${view.url}/files`} target="_blank" rel="noreferrer">
          View diff on GitHub <span aria-hidden="true">↗</span>
        </a>
      </div>
    </section>
  );
}
