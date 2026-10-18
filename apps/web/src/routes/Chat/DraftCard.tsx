import { BRAND, type ChatView, type DraftView, type NewPoint, type PointView } from '@nitpilot/protocol';
import { useIsMutating } from '@tanstack/react-query';
import { useDiscardDraft, useSendDraft } from '../../api/drafts';
import { Ping } from '../../components/Ping/Ping';
import { useCopy } from '../../lib/clipboard';
import { agentName } from '../../lib/names';
import { DiffView } from './DiffView';
import { PointCard, type People } from './PointCard';
import styles from './DraftCard.module.css';

/** A drafted point has no thread yet, so nobody's picture is needed. */
const NOBODY: People = new Map();

/** How a reply or a decision would settle its point, as the point card's outcome tags say it (handoff §3). */
const OUTCOME = {
  fixed: { word: 'Fixed', tone: 'ok' },
  answered: { word: 'Answered', tone: 'accent' },
  declined: { word: 'Declined', tone: 'plain' },
  resolve: { word: 'Resolve', tone: 'ok' },
  keep_open: { word: 'Keep open', tone: 'warn' },
} as const;

/**
 * Work an agent finished with Auto off, waiting for its owner (handoff component sheet "Draft", spec §9 "Drafts"), in
 * the feed where that job finished. A reviewer's draft shows its points as point cards marked Draft and the
 * decisions of a re-review; an author's shows each reply and the drafted commit's diff (or, when the diff was too big
 * to send, the files and the `git show` command for the clone it's in). Everyone in the chat sees it; only the owner
 * gets Send and Discard (`canAct`, from `Permissions.drafts`). It goes when the server says it was sent, discarded or
 * went out of date: nothing here decides that.
 */
export function DraftCard({ draft, view, you, canAct }: { draft: DraftView; view: ChatView; you: string; canAct: boolean }) {
  const title = draftTitle(draft, you);
  const { result } = draft;
  const repoUrl = view.url.replace(/\/pull\/\d+$/, '');
  return (
    <section className={styles.card} aria-label={`Draft: ${title}`}>
      <div className={styles.head}>
        <span className={styles.eyebrow}>Draft · {draft.role}</span>
        <span className={styles.state} data-state>
          {draft.sending ? <Ping /> : <span className={styles.ring} aria-hidden="true" />}
          {draft.sending ? 'Sending…' : draft.role === 'author' && result.draft ? 'Not pushed' : 'Not sent'}
        </span>
      </div>
      <h3 className={styles.title}>{title}</h3>
      {result.summary && <p className={styles.summary}>{result.summary}</p>}
      {(result.decisions.length > 0 || result.replies.length > 0) && (
        <ul className={styles.outcomes}>
          {result.decisions.map((d) => (
            <Outcome key={`d${d.point}`} view={view} point={d.point} outcome={d.decision} comment={d.comment} />
          ))}
          {result.replies.map((r) => (
            <Outcome key={`r${r.point}`} view={view} point={r.point} outcome={r.resolution} comment={r.comment} />
          ))}
        </ul>
      )}
      {result.points.length > 0 && (
        <div className={styles.points}>
          {result.points.map((p, i) => (
            <PointCard key={i} point={draftPoint(p, i, draft, view, repoUrl)} thread={[]} you={you} people={NOBODY} repoUrl={repoUrl} draft />
          ))}
        </div>
      )}
      {result.draft && (result.draft.diff !== null ? <DiffView diff={result.draft.diff} files={result.draft.files} /> : <TooBig draft={draft} files={result.draft.files} mine={draft.owner === you} />)}
      {canAct && <DraftActions chatId={view.id} draft={draft} />}
    </section>
  );
}

/** "Your agent wants to push fixes for P1 and reply on P2", "leo's agent wants to raise 2 points". */
function draftTitle(draft: DraftView, you: string): string {
  const who = agentName(draft.owner, you);
  const { points, decisions, replies, draft: commit } = draft.result;
  if (draft.role === 'reviewer') {
    const raise = points.length > 0 ? `raise ${points.length} point${points.length === 1 ? '' : 's'}` : '';
    if (decisions.length > 0) return `${who} wants to settle ${pointList(decisions.map((d) => d.point))}${raise ? ` and ${raise}` : ''}`;
    return raise ? `${who} wants to ${raise}` : `${who} found nothing to raise`;
  }
  if (!commit) return replies.length > 0 ? `${who} wants to reply on ${pointList(replies.map((r) => r.point))}` : `${who} has nothing to send`;
  const fixed = replies.filter((r) => r.resolution === 'fixed').map((r) => r.point);
  const others = replies.filter((r) => r.resolution !== 'fixed').map((r) => r.point);
  return `${who} wants to ${fixed.length > 0 ? `push fixes for ${pointList(fixed)}` : 'push a commit'}${others.length > 0 ? ` and reply on ${pointList(others)}` : ''}`;
}

/** "P1", "P1 and P2", "P1, P2 and P3". */
function pointList(numbers: number[]): string {
  const ids = numbers.map((n) => `P${n}`);
  return ids.length <= 1 ? (ids[0] ?? '') : `${ids.slice(0, -1).join(', ')} and ${ids.at(-1)}`;
}

/** One reply or decision: the point it's about, how it would settle it, and what the agent says. */
function Outcome({ view, point, outcome, comment }: { view: ChatView; point: number; outcome: keyof typeof OUTCOME; comment: string }) {
  const tag = OUTCOME[outcome];
  return (
    <li className={styles.outcome} data-reply>
      <div className={styles.outcomeHead}>
        <span className={styles.id}>P{point}</span>
        <span className={styles.outcomeTitle}>{view.points.find((p) => p.number === point)?.title}</span>
        <span className={`${styles.tag} ${styles[tag.tone]}`}>{tag.word}</span>
      </div>
      {comment && <p className={styles.comment}>{comment}</p>}
    </li>
  );
}

/** A drafted point as the point card shows one: where it points on GitHub is the commit the agent reviewed. */
function draftPoint(p: NewPoint, i: number, draft: DraftView, view: ChatView, repoUrl: string): PointView {
  const owner = view.participants.find((x) => x.login === draft.owner);
  const url = p.path ? `${repoUrl}/blob/${draft.headSha}/${encodeURI(p.path)}${p.line ? `#L${p.line}` : ''}` : null;
  return {
    ...p,
    number: i + 1,
    raisedBy: { githubId: owner?.githubId ?? '', login: draft.owner },
    origin: 'agent',
    url,
    status: 'open',
    authorResolution: null,
    escalationReason: null,
    trusted: true,
    round: view.round,
  };
}

/** A diff over 200 KB isn't sent (spec §11): the files it changes, and how to see it in the clone that has it. */
function TooBig({ draft, files, mine }: { draft: DraftView; files: { path: string; adds: number; dels: number }[]; mine: boolean }) {
  return (
    <div className={styles.tooBig}>
      <ul className={styles.files}>
        {files.map((f) => (
          <li key={f.path} className={styles.fileRow}>
            <span className={styles.path}>{f.path}</span>
            <span className={styles.adds}>+{f.adds}</span>
            <span className={styles.dels}>−{f.dels}</span>
          </li>
        ))}
      </ul>
      {mine ? (
        <div className={styles.see}>
          <span>The diff is too big to show here. In your clone, run:</span>
          <CopyCommand command={`git show ${BRAND.gitRefNamespace}/drafts/${draft.jobId}`} />
        </div>
      ) : (
        <p className={styles.see}>The whole diff is on {draft.owner}'s computer.</p>
      )}
    </div>
  );
}

function CopyCommand({ command }: { command: string }) {
  const { copied, copy } = useCopy(command);
  return (
    <button type="button" className={styles.command} onClick={copy} aria-label={`Copy ${command}`}>
      <span className={styles.dollar} aria-hidden="true">
        $
      </span>
      <span className={styles.commandText}>{command}</span>
      <span className={styles.copy}>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

/**
 * Send (primary) and Discard (outlined). Both wait while either is on its way. While the push runs, Send says
 * "Sending…"; Discard stays, since a push that hasn't started yet can still be called off (the server says when
 * it's too late). "On its way" is read from the cache by the writes' keys (like the composer does), not from this
 * card's own mutation, so a card drawn again while a request is open still waits.
 */
function DraftActions({ chatId, draft }: { chatId: string; draft: DraftView }) {
  const send = useSendDraft(chatId);
  const discard = useDiscardDraft(chatId);
  const sendOnItsWay = useIsMutating({ mutationKey: ['draft_send', chatId] }) > 0;
  const discardOnItsWay = useIsMutating({ mutationKey: ['draft_discard', chatId] }) > 0;
  const pressed = sendOnItsWay || discardOnItsWay;
  const sending = draft.sending || sendOnItsWay;
  return (
    <div className={styles.actions}>
      <button type="button" className={styles.primary} disabled={pressed || draft.sending} onClick={() => send.mutate(draft)}>
        {sending ? 'Sending…' : 'Send'}
      </button>
      <button type="button" className={styles.secondary} disabled={pressed} onClick={() => discard.mutate(draft)}>
        {discardOnItsWay ? 'Discarding…' : 'Discard'}
      </button>
    </div>
  );
}
