import { BRAND, type ChatResponse, type WebMe } from '@nitpilot/protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useLocation, useOutletContext, useParams } from 'react-router';
import { chatKey, fetchOlderItems, useChat, useMarkRead, usePublicChat } from '../../api/chat';
import { ApiError } from '../../api/client';
import { ErrorState } from '../../components/ErrorState/ErrorState';
import { ToastProvider, Toasts, useToast } from '../../components/Toast/Toast';
import { useLiveChat } from '../../live/LiveProvider';
import { mergeItems } from '../../live/apply';
import { chatBanner } from '../../lib/banner';
import { useIsDesktop, useIsWide } from '../../lib/viewport';
import { Landing } from '../Landing/Landing';
import { EmptyPane, Pane } from '../Shell/Pane';
import { ChatBanner, VisitorBanner } from './ChatBanner';
import { ChatHeader } from './ChatHeader';
import { Composer } from './Composer';
import { DetailsPanel } from './DetailsPanel';
import { Timeline } from './Timeline';
import styles from './Chat.module.css';

/** `/c/:owner/:repo/:number`: one PR's chat (handoff §2), kept live over `/ws/web`, with the composer and the banners' actions. */
export function Chat() {
  const me = useOutletContext<WebMe>();
  const { owner = '', repo = '', number = '' } = useParams();
  const chat = useChat(owner, repo, number);
  if (chat.isPending) {
    return (
      <Pane>
        {/* A first answer that failed (GitHub slow, a 502) is asked again a few times before it's an error. */}
        <p className={styles.loading} role="status">
          {chat.failureCount > 0 ? 'Still trying…' : 'Loading…'}
        </p>
      </Pane>
    );
  }
  // A failed refetch keeps the data it had: only a chat that is gone or needs a new sign-in replaces a working screen.
  if (chat.isError && (!chat.data || isFatal(chat.error))) return <ChatUnavailable error={chat.error} onRetry={() => void chat.refetch()} />;
  return <ChatScreen key={chat.data.view.id} me={me} data={chat.data} cacheKey={chatKey(owner, repo, number)} />;
}

/**
 * `/c/:owner/:repo/:number` for someone who isn't signed in: a public repo's chat, read-only (spec §16 "Who can see a
 * chat"), under a banner inviting them to get their own. Any chat the server won't show (a 404) is the landing page,
 * as before.
 */
export function PublicChat({ owner, repo, number }: { owner: string; repo: string; number: string }) {
  const chat = usePublicChat(owner, repo, number);
  if (chat.isPending) {
    return (
      <p className={styles.loading} role="status">
        Loading…
      </p>
    );
  }
  if (chat.isError && chat.error instanceof ApiError && chat.error.status === 404) return <Landing />;
  if (chat.isError) return <ErrorState message={chat.error.message} onRetry={() => void chat.refetch()} />;
  return (
    // The chat screen expects the signed-in app's toasts; a visitor never sees one (they come from "Load earlier").
    <ToastProvider>
      <div className={styles.publicPage}>
        <VisitorBanner view={chat.data.view} />
        <ChatScreen key={chat.data.view.id} me={null} data={chat.data} cacheKey={['public-chat', owner, repo, number]} />
      </div>
    </ToastProvider>
  );
}

/** An error that ends the chat screen even when it has data: the chat is gone (404) or its viewer must sign in again. */
function isFatal(error: Error): boolean {
  return error instanceof ApiError && (error.status === 404 || error.code === 'reauth');
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

/** `me` is null for a visitor who isn't signed in: read-only, with no banner actions, composer or file list. */
function ChatScreen({ me, data, cacheKey }: { me: WebMe | null; data: ChatResponse; cacheKey: readonly unknown[] }) {
  const { view, items, hasOlder } = data;
  const you = me?.login ?? '';
  const queryClient = useQueryClient();
  const toast = useToast();
  const desktop = useIsDesktop();
  const wide = useIsWide();
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const newest = items.at(-1)?.seq ?? 0;
  // Both do nothing for a visitor: there's no socket outside the signed-in app, and no role to mark read for.
  useLiveChat(view.id, newest);
  useMarkRead(view.id, newest, view.viewer.role !== null);

  async function loadEarlier(): Promise<void> {
    const first = items[0];
    if (!first) return;
    setLoadingEarlier(true);
    try {
      const page = await fetchOlderItems(view.id, first.seq);
      queryClient.setQueryData<ChatResponse>(cacheKey, (chat) => chat && { ...chat, items: mergeItems(page.items, chat.items), hasOlder: page.hasOlder });
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't load earlier items.", { error: true });
    } finally {
      setLoadingEarlier(false);
    }
  }

  return (
    <div className={styles.chat}>
      <section className={styles.column} aria-label={`PR chat: ${view.title}`}>
        <ChatHeader view={view} you={you} desktop={desktop} collapsed={!desktop && collapsed} details={{ available: wide, open: detailsOpen, toggle: () => setDetailsOpen((open) => !open) }} />
        {me && <ChatBanner banner={chatBanner(view, me)} view={view} />}
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
        <div className={styles.scroll} tabIndex={0} role="region" aria-label="Timeline" onScroll={(e) => setCollapsed(e.currentTarget.scrollTop > 48)}>
          <Timeline view={view} items={items} hasOlder={hasOlder} you={you} loadingEarlier={loadingEarlier} onLoadEarlier={() => void loadEarlier()} />
        </div>
        {me && (
          <div className={styles.footer}>
            <Composer view={view} me={me} />
            <Toasts />
          </div>
        )}
      </section>
      {wide && detailsOpen && <DetailsPanel view={view} files={me !== null} />}
    </div>
  );
}
