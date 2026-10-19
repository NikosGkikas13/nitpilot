import type { WebMe } from '@nitpilot/protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type MouseEvent } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router';
import { Toasts } from '../../components/Toast/Toast';
import { useEscapeBack } from '../../lib/keys';
import { useIsDesktop } from '../../lib/viewport';
import { Account } from './Account';
import { Agent } from './Agent';
import { Defaults } from './Defaults';
import { Devices } from './Devices';
import { Notifications } from './Notifications';
import styles from './Settings.module.css';

/** The section nav (desktop): each label, and the section it jumps to. */
const SECTIONS = [
  { id: 'devices', label: 'Devices' },
  { id: 'agent', label: 'Agent' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'defaults', label: 'Defaults' },
  { id: 'account', label: 'Account' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

/**
 * `/settings` (handoff §7), a page of its own: the top bar ("‹ Inbox" and the title), then on a desktop a sticky 180 px
 * section nav beside the cards, and on a phone the cards stacked, with Esc going back to the inbox. The sections:
 * your computers and their agents, push for this browser, your defaults for new chats, and your account. You are read
 * again when the page opens, so today's usage is fresh (the server sends no update when a CLI pings).
 */
export function Settings() {
  const me = useOutletContext<WebMe>();
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState<SectionId>('devices');
  useEscapeBack(!desktop, () => void navigate('/'));

  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ['me'] });
  }, [queryClient]);

  // Scroll to the section without adding "#agent" to the address (Back still goes to the inbox).
  function jump(e: MouseEvent<HTMLAnchorElement>, id: SectionId) {
    e.preventDefault();
    setCurrent(id);
    document.getElementById(id)?.scrollIntoView?.({ block: 'start' });
    // And focus its heading, so the keyboard and a screen reader are in the section too (the scroll is already done).
    document.getElementById(`${id}-heading`)?.focus({ preventScroll: true });
  }

  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <Link to="/" className={styles.back}>
          ‹ Inbox
        </Link>
        <h1 className={styles.title}>Settings</h1>
      </header>
      <div className={styles.body}>
        {desktop && (
          <nav aria-label="Settings sections" className={styles.nav}>
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`} className={styles.navLink} aria-current={current === s.id ? 'true' : undefined} onClick={(e) => jump(e, s.id)}>
                {s.label}
              </a>
            ))}
          </nav>
        )}
        <div className={styles.sections}>
          <Devices />
          <Agent />
          <Notifications me={me} />
          <Defaults me={me} />
          <Account me={me} />
        </div>
      </div>
      {/* The toasts' place: fixed near the bottom of the window (handoff "Toasts": 96 px up). */}
      <div className={styles.toasts}>
        <Toasts />
      </div>
    </div>
  );
}
