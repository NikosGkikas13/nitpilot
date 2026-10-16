import type { InboxRow } from '@nitpilot/protocol';
import { useEffect, useRef } from 'react';
import { AgentBadge } from '../../components/AgentBadge/AgentBadge';
import { Avatar } from '../../components/Avatar/Avatar';
import { StatusPill } from '../../components/StatusPill/StatusPill';
import { rowTime } from '../../lib/time';
import styles from './InboxRow.module.css';

type Props = {
  row: InboxRow;
  viewerLogin: string;
  /** The chat open on the right (desktop). */
  selected: boolean;
  /** The keyboard cursor is on this row: it takes the focus, so Enter opens it and a screen reader reads it. */
  cursor: boolean;
  onOpen(): void;
};

/** One pull request in the list (handoff §1, item 6). */
export function InboxRowItem({ row, viewerLogin, selected, cursor, onOpen }: Props) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (cursor) button.current?.focus();
  }, [cursor]);
  const finished = row.status.kind === 'merged' || row.status.kind === 'closed';
  const classes = [styles.row, selected && styles.selected, cursor && styles.cursor, finished && styles.finished].filter(Boolean).join(' ');
  return (
    <button ref={button} type="button" role="option" aria-selected={selected} className={classes} onClick={onOpen}>
      <Avatar login={row.other?.login ?? '?'} src={row.other?.avatarUrl ?? null} size={38}>
        {row.other?.agentActive && <AgentBadge login={row.other.login} />}
      </Avatar>
      <span className={styles.text}>
        <span className={styles.top}>
          <span className={styles.ref}>
            {row.repo} #{row.number}
          </span>
          <span className={styles.time}>{rowTime(row.updatedAt)}</span>
        </span>
        <span className={styles.middle}>
          <span className={row.unread > 0 ? `${styles.title} ${styles.unread}` : styles.title} data-testid="title">
            {row.title}
          </span>
          {row.unread > 0 && <span className={styles.dot} role="img" aria-label="Unread" />}
        </span>
        <span className={styles.bottom}>
          <StatusPill status={row.status} viewerLogin={viewerLogin} />
          <span className={styles.last}>{row.lastActivity}</span>
          <span className={styles.round}>
            <span aria-hidden="true">
              {row.round}/{row.maxRounds}
            </span>
            <span className="visually-hidden">
              Round {row.round} of {row.maxRounds}
            </span>
          </span>
        </span>
      </span>
    </button>
  );
}
