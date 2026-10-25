import { BRAND, type ChatView, type PointView } from '@nitpilot/protocol';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { useContinue, useResolve, useRetry } from '../../api/actions';
import { draftCardId, failureText, type Banner } from '../../lib/banner';
import { useCopy } from '../../lib/clipboard';
import { itemTime } from '../../lib/time';
import styles from './ChatBanner.module.css';

/**
 * The banner under the header (handoff §2 "Banners", §10). Its buttons (Resolve, Continue, Retry) show only what
 * `view.permissions` allows, and wait for the server's answer; the chat itself changes when `/ws/web` says so. An
 * escalation is an alert; the rest are statuses.
 */
export function ChatBanner({ banner, view }: { banner: Banner; view: ChatView }) {
  const here = useLocation();
  const reconnect = `/auth/github/login?next=${encodeURIComponent(here.pathname)}`;
  const outcome = (rounds: number, resolved: number) => `${rounds} round${rounds === 1 ? '' : 's'} · ${resolved} point${resolved === 1 ? '' : 's'} resolved`;
  switch (banner.kind) {
    case 'none':
      return null;
    case 'github_expired':
      return (
        <Strip tone="warn" glyph="!" title="GitHub sign-in expired" body={`${BRAND.name} can't approve, post or push as you until you reconnect. Agents keep working in the meantime.`}>
          {/* A full page load: the sign-in starts on the server. */}
          <a className={styles.dark} href={reconnect}>
            Reconnect GitHub
          </a>
        </Strip>
      );
    case 'escalated':
      return (
        <div className={styles.escalated} role="alert">
          <div className={styles.escalatedHead}>
            <span className={styles.diamond} aria-hidden="true" />
            <span className={styles.title}>Needs a human decision</span>
            <span className={styles.body}>{banner.note}</span>
          </div>
          <ul className={styles.points}>
            {banner.points.map((p) => (
              <li key={p.number} className={styles.point}>
                <span className={styles.pointId}>P{p.number}</span>
                <span className={styles.pointTitle}>{p.title}</span>
                <PointActions view={view} point={p} />
              </li>
            ))}
          </ul>
        </div>
      );
    case 'failed_job':
      return (
        <Strip tone="warn" glyph="!" title="Your agent couldn't finish" body={view.viewer.failureReason ? failureText(view.viewer.failureReason) : 'The timeline says why.'}>
          {view.permissions.retry && <RetryButton chatId={view.id} />}
        </Strip>
      );
    case 'failed_post':
      return (
        <Strip tone="warn" glyph="!" title="Couldn't post on GitHub as you" body={`Sign in with GitHub again, and ${BRAND.name} posts it.`}>
          <a className={styles.dark} href={reconnect}>
            Reconnect GitHub
          </a>
        </Strip>
      );
    case 'cap':
      return (
        <Strip tone="warn" glyph="!" title="Daily agent cap reached" body="Agents pick up again at midnight, or raise the cap in Settings.">
          <Link className={styles.dark} to="/settings">
            Raise cap
          </Link>
        </Strip>
      );
    case 'drafts':
      return (
        <Strip tone="muted" title={banner.count === 1 ? '1 draft waits for you' : `${banner.count} drafts wait for you`} body="Your agent's work is ready. Send it or discard it.">
          <ReviewDraftsButton firstJobId={banner.firstJobId} />
        </Strip>
      );
    case 'repo_not_linked':
      return (
        <Strip tone="muted" title={`${banner.repo} isn't linked on this computer`} body="Your agent can't review or fix this PR until the repo is linked. In your clone, run:">
          <CopyCommand command={`${BRAND.cli} repos add`} />
        </Strip>
      );
    case 'waiting':
      return (
        <Strip
          tone="muted"
          glyph="ring"
          title="Waiting for your agent"
          body={banner.offlineSince ? `Offline since ${itemTime(banner.offlineSince)}. Start it to pick the work up.` : "Your agent hasn't connected yet. Start it to pick the work up."}
        >
          <CopyCommand command={`${BRAND.cli} start`} />
        </Strip>
      );
    case 'ready_reviewer':
      return (
        <Strip tone="ok" glyph="check" title="Ready for your approval" body={outcome(banner.rounds, banner.resolved)}>
          {/* Approval always happens on GitHub (handoff §2). */}
          <a className={styles.primary} href={`${view.url}/files`} target="_blank" rel="noreferrer">
            Approve on GitHub <span aria-hidden="true">↗</span>
          </a>
        </Strip>
      );
    case 'ready_author':
      return (
        <Strip tone="ok" glyph="check" title={banner.reviewer ? `Waiting for ${banner.reviewer}'s approval` : 'Waiting for approval'} body={outcome(banner.rounds, banner.resolved)}>
          <a className={styles.secondary} href={view.url} target="_blank" rel="noreferrer">
            View on GitHub <span aria-hidden="true">↗</span>
          </a>
        </Strip>
      );
  }
}

/**
 * Resolve (dark) and Continue (outlined) for one escalated point, each only if you may. While one is on its way,
 * both wait: the two would contradict each other.
 */
function PointActions({ view, point }: { view: ChatView; point: PointView }) {
  const resolve = useResolve(view.id);
  const cont = useContinue(view.id);
  const mayResolve = view.permissions.resolve.includes(point.number);
  const mayContinue = view.permissions.continue.includes(point.number);
  if (!mayResolve && !mayContinue) return null;
  const busy = resolve.isPending || cont.isPending;
  return (
    <div className={styles.pointActions}>
      {mayResolve && (
        <button type="button" className={`${styles.button} ${styles.dark}`} disabled={busy} onClick={() => resolve.mutate(point.number)}>
          {resolve.isPending ? 'Resolving…' : 'Resolve'}
        </button>
      )}
      {mayContinue && (
        <button type="button" className={`${styles.button} ${styles.secondary}`} disabled={busy} onClick={() => cont.mutate(point.number)} title="Let the agents keep going on this point">
          {cont.isPending ? 'Continuing…' : 'Continue'}
        </button>
      )}
    </div>
  );
}

/** Scrolls to the first draft card in the feed (it carries `draftCardId`). */
function ReviewDraftsButton({ firstJobId }: { firstJobId: string }) {
  const go = () => {
    document.getElementById(draftCardId(firstJobId))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  return (
    <button type="button" className={`${styles.button} ${styles.dark}`} onClick={go}>
      Review drafts
    </button>
  );
}

function RetryButton({ chatId }: { chatId: string }) {
  const retry = useRetry(chatId);
  return (
    <button type="button" className={`${styles.button} ${styles.dark}`} disabled={retry.isPending} onClick={() => retry.mutate()}>
      {retry.isPending ? 'Retrying…' : 'Retry'}
    </button>
  );
}

/** One banner line: a glyph, a title and a line under it, then what you can do. */
function Strip(props: { tone: 'ok' | 'warn' | 'muted'; glyph?: '!' | 'ring' | 'check'; title: string; body: string; children: ReactNode }) {
  return (
    <div className={`${styles.strip} ${styles[props.tone]}`} role="status">
      {props.glyph === '!' && (
        <span className={styles.bang} aria-hidden="true">
          !
        </span>
      )}
      {props.glyph === 'check' && (
        <span className={styles.check} aria-hidden="true">
          ✓
        </span>
      )}
      {props.glyph === 'ring' && <span className={styles.ring} aria-hidden="true" />}
      <div className={styles.text}>
        <span className={styles.title}>{props.title}</span>
        <span className={styles.body}>{props.body}</span>
      </div>
      {props.children}
    </div>
  );
}

/** "$ nitpilot start  Copy": a command to run in a terminal, copied with one click. */
function CopyCommand({ command }: { command: string }) {
  const { copied, copy } = useCopy(command);
  return (
    <button type="button" className={styles.command} onClick={copy} aria-label={`Copy ${command}`}>
      <span className={styles.dollar} aria-hidden="true">
        $
      </span>
      {command}
      <span className={styles.copy}>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}
