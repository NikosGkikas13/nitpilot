import type { ChatView } from '@nitpilot/protocol';
import { useIsMutating } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useAutoSwitch } from '../../api/drafts';
import { Ping } from '../../components/Ping/Ping';
import { autoSwitchFor } from '../../lib/auto';
import { agentName } from '../../lib/names';
import { itemTime } from '../../lib/time';
import { AutoSwitch } from './AutoSwitch';
import styles from './ChatHeader.module.css';

const ROLE = { author: 'Author', reviewer: 'Reviewer' } as const;

/**
 * The chat's header (handoff §2 "Header"). Desktop: the title, your role, "Open on GitHub" and the details toggle;
 * then the repo and number, the branches, the round and the other side's agent. Phone: a back arrow, and the
 * same facts stacked, shrinking to one line once the feed scrolls (`collapsed`). Your Auto switch is in the top
 * row on both, and stays there when the phone header shrinks.
 */
export function ChatHeader(props: { view: ChatView; you: string; desktop: boolean; collapsed: boolean; details: { available: boolean; open: boolean; toggle: () => void } }) {
  const { view, you } = props;
  const role = view.viewer.role;
  const ref = `${view.repo} #${view.number}`;
  if (!props.desktop) {
    return (
      <header className={styles.phone}>
        <div className={styles.phoneTop}>
          <Link to="/" className={styles.back} aria-label="Back to inbox">
            <span className={styles.chevron} aria-hidden="true" />
          </Link>
          {props.collapsed ? <h1 className={styles.phoneTitleLine}>{view.title}</h1> : <span className={styles.phoneRef}>{ref}</span>}
          <YourAutoSwitch view={view} you={you} />
        </div>
        {!props.collapsed && (
          <div className={styles.phoneFull}>
            <h1 className={styles.phoneTitle}>{view.title}</h1>
            <div className={styles.branches}>
              {view.headRef} → {view.baseRef}
            </div>
            <div className={styles.facts}>
              {role && <span className={styles.roleChip}>{ROLE[role]}</span>}
              <Round view={view} />
              <Presence view={view} you={you} />
            </div>
          </div>
        )}
      </header>
    );
  }
  return (
    <header className={styles.desktop}>
      <div className={styles.topRow}>
        <h1 className={styles.title}>{view.title}</h1>
        {role && <span className={styles.roleChip}>{ROLE[role]}</span>}
        <YourAutoSwitch view={view} you={you} />
        <a className={styles.button} href={view.url} target="_blank" rel="noreferrer">
          Open on GitHub{' '}
          <span className={styles.arrow} aria-hidden="true">
            ↗
          </span>
        </a>
        {props.details.available && (
          <button type="button" className={`${styles.iconButton} ${props.details.open ? styles.pressed : ''}`} onClick={props.details.toggle} aria-pressed={props.details.open} aria-label="PR details" title="PR details">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M15 4v16" />
            </svg>
          </button>
        )}
      </div>
      <div className={styles.facts}>
        <span className={styles.ref}>{ref}</span>
        <span className={styles.branches}>
          {view.headRef} <span className={styles.to}>→</span> {view.baseRef}
        </span>
        <Round view={view} />
        <Presence view={view} you={you} />
      </div>
    </header>
  );
}

/** Your Auto switch for your role here (lib/auto.ts says whether there is one, and why it may be off). */
function YourAutoSwitch({ view, you }: { view: ChatView; you: string }) {
  const auto = useAutoSwitch(view.id);
  // Read from the cache by the write's key, so a header drawn again while the request is open is still busy.
  const busy = useIsMutating({ mutationKey: ['auto', view.id] }) > 0;
  const state = autoSwitchFor(view, you);
  if (!state) return null;
  return <AutoSwitch {...state} busy={busy} onToggle={(on) => auto.mutate({ role: state.role, on })} />;
}

/** One pip per allowed round (accent when used, all amber on the last round), then "Round 2 of 3". */
function Round({ view }: { view: ChatView }) {
  const last = view.round >= view.maxRounds;
  return (
    <span className={styles.round}>
      <span className={styles.pips} aria-hidden="true">
        {Array.from({ length: view.maxRounds }, (_, i) => (
          <span key={i} className={`${styles.pip} ${i < view.round ? (last ? styles.lastPip : styles.usedPip) : ''}`} />
        ))}
      </span>
      Round {view.round} of {view.maxRounds}
    </span>
  );
}

/**
 * The agent that matters here: the one at work if any, else the other side's (your reviewer's, or the author's).
 * A ping while it works, a dot while it's online, a ring with when it was last seen when it's offline.
 */
function Presence({ view, you }: { view: ChatView; you: string }) {
  if (view.activity.kind === 'agent_working' && view.activity.who) {
    return (
      <span className={styles.presence}>
        <Ping />
        {agentName(view.activity.who, you)} · working
      </span>
    );
  }
  const others = view.participants.filter((p) => p.login !== you && p.agent && p.role !== view.viewer.role);
  const other = others.find((p) => p.requested) ?? others[0];
  if (!other?.agent) return null;
  const { online, offlineSince } = other.agent;
  return (
    <span className={styles.presence}>
      <span className={online ? styles.online : styles.offline} aria-hidden="true" />
      {agentName(other.login, you)} · {online ? 'online' : offlineSince ? `offline since ${itemTime(offlineSince)}` : 'offline'}
    </span>
  );
}
