import { BRAND, type ChatResponse, type WebMe } from '@nitpilot/protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useLocation, useOutletContext, useParams } from 'react-router';
import { chatKey, fetchOlderItems, useChat, useMarkRead } from '../../api/chat';
import { ApiError } from '../../api/client';
import { ErrorState } from '../../components/ErrorState/ErrorState';
import { useLiveChat } from '../../live/LiveProvider';
import { mergeItems } from '../../live/apply';
import { chatBanner } from '../../lib/banner';
import { useIsDesktop, useIsWide } from '../../lib/viewport';
import { EmptyPane, Pane } from '../Shell/Pane';
import { ChatBanner } from './ChatBanner';
import { ChatHeader } from './ChatHeader';
import { DetailsPanel } from './DetailsPanel';
import { Timeline } from './Timeline';
import styles from './Chat.module.css';

/** `/c/:owner/:repo/:number`: one PR's chat (handoff §2), read-only in W3, kept live over `/ws/web`. */
export function Chat() {
  const me = useOutletContext<WebMe>();
  const { owner = '', repo = '', number = '' } = useParams();
  const chat = useChat(owner, repo, number);
  if (chat.isPending) {
    return (
      <Pane>
        <p className={styles.loading} role="status">
          Loading…
        </p>
      </Pane>
    );
  }
  if (chat.isError) return <ChatUnavailable error={chat.error} onRetry={() => void chat.refetch()} />;
  return <ChatScreen key={chat.data.view.id} me={me} data={chat.data} cacheKey={chatKey(owner, repo, number)} />;
}

/** "No such chat" and "you can't see it" alike (spec §16); a GitHub sign-in to renew; anything else, with a way to try again. */
function ChatUnavailable({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const here = useLocation();
  if (error instanceof ApiError && error.status === 404) {
    return <EmptyPane title="Nothing here" body="This chat doesn't exist, or your GitHub account can't see its repo." />;
  }
  if (error instanceof ApiError && error.code === 'reauth') {
    return (
      <Pane>
        <div className={styles.reauth} role="alert">
          <h1 className={styles.reauthTitle}>Sign in with GitHub again</h1>
          <p className={styles.reauthBody}>Your GitHub sign-in expired, so {BRAND.name} can't check that you can see this chat.</p>
          {/* A full page load: the sign-in starts on the server. */}
          <a className={styles.reauthButton} href={`/auth/github/login?next=${encodeURIComponent(here.pathname)}`}>
            Reconnect GitHub
          </a>
        </div>
      </Pane>
    );
  }
  return <ErrorState message={error.message} onRetry={onRetry} />;
}

function ChatScreen({ me, data, cacheKey }: { me: WebMe; data: ChatResponse; cacheKey: readonly unknown[] }) {
  const { view, items, hasOlder } = data;
  const queryClient = useQueryClient();
  const desktop = useIsDesktop();
  const wide = useIsWide();
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const newest = items.at(-1)?.seq ?? 0;
  useLiveChat(view.id, newest);
  useMarkRead(view.id, newest, view.viewer.role !== null);

  async function loadEarlier(): Promise<void> {
    const first = items[0];
    if (!first) return;
    setLoadingEarlier(true);
    try {
      const page = await fetchOlderItems(view.id, first.seq);
      queryClient.setQueryData<ChatResponse>(cacheKey, (chat) => chat && { ...chat, items: mergeItems(page.items, chat.items), hasOlder: page.hasOlder });
    } finally {
      setLoadingEarlier(false);
    }
  }

  return (
    <div className={styles.chat}>
      <section className={styles.column} aria-label={`PR chat: ${view.title}`}>
        <ChatHeader view={view} you={me.login} desktop={desktop} collapsed={!desktop && collapsed} details={{ available: wide, open: detailsOpen, toggle: () => setDetailsOpen((open) => !open) }} />
        <ChatBanner banner={chatBanner(view, me)} view={view} />
        {view.rules.error && (
          <div className={styles.rulesChip}>
            <span role="status">
              <span className={styles.bang} aria-hidden="true">
                !
              </span>{' '}
              <span className={styles.mono}>{BRAND.teamConfigFile}</span> has an error, using defaults
            </span>
          </div>
        )}
        {/* On a phone the header shrinks to one line once the feed has scrolled 48 px (handoff "App shell and layout").
            It takes focus when clicked or tabbed to, so ↑/↓ scroll it (lib/keys.ts leaves them alone inside <main>). */}
        <div className={styles.scroll} tabIndex={0} onScroll={(e) => setCollapsed(e.currentTarget.scrollTop > 48)}>
          <Timeline view={view} items={items} hasOlder={hasOlder} you={me.login} loadingEarlier={loadingEarlier} onLoadEarlier={() => void loadEarlier()} />
        </div>
      </section>
      {wide && detailsOpen && <DetailsPanel view={view} />}
    </div>
  );
}
