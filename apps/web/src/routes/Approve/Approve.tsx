import { BRAND, type CliRequestView } from '@nitpilot/protocol';
import { useEffect, useRef, type ReactNode } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { useCliRequest, useDecideCliRequest } from '../../api/cli-requests';
import { ApiError } from '../../api/client';
import { useMe } from '../../api/me';
import { ErrorState } from '../../components/ErrorState/ErrorState';
import { Wordmark } from '../../components/Wordmark/Wordmark';
import { browser } from '../../lib/browser';
import { itemTime, useNow } from '../../lib/time';
import { CommandBlock } from '../Setup/CommandBlock';
import styles from './Approve.module.css';

const LOGIN = `npx ${BRAND.npmPackage} login`;

/**
 * `/cli/approve?code=…` (handoff §6, docs/why/cli-login.md): `nitpilot login` opened this page with the short code it
 * printed. You check the code matches your terminal, then Approve or Deny. A page of its own: no inbox and no socket.
 * Signed out, it sends you through GitHub sign-in first, which brings you back here with the same code.
 */
export function Approve() {
  const me = useMe();
  const [params] = useSearchParams();
  const location = useLocation();
  const code = (params.get('code') ?? '').trim();
  const signedOut = me.data === null;

  useEffect(() => {
    if (signedOut) browser.goTo(`/auth/github/login?next=${encodeURIComponent(location.pathname + location.search)}`);
  }, [signedOut, location.pathname, location.search]);

  let content: ReactNode;
  if (me.isError) content = <ErrorState message={me.error.message} onRetry={() => void me.refetch()} />;
  else if (me.isPending || signedOut) content = <Loading />;
  else if (code === '') content = <Outcome kind="not_found" />;
  else content = <LoginRequest code={code} />;

  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <Wordmark />
      </header>
      <main className={styles.main}>{content}</main>
    </div>
  );
}

function Loading() {
  return (
    <p className={styles.loading} role="status" aria-busy="true">
      Loading…
    </p>
  );
}

/** The login behind `code`: read it, show it, send Approve or Deny. */
function LoginRequest({ code }: { code: string }) {
  const request = useCliRequest(code, true);
  const decide = useDecideCliRequest(code);

  if (request.isPending) return <Loading />;
  // A decision that never got an answer: read the login again, which shows whether it went through.
  if (decide.isError) {
    return (
      <ErrorState
        message={decide.error.message}
        onRetry={() => {
          decide.reset();
          void request.refetch();
        }}
      />
    );
  }
  if (request.isError) {
    if (request.error instanceof ApiError && request.error.status === 404) return <Outcome kind="not_found" />;
    return <ErrorState message={request.error.message} onRetry={() => void request.refetch()} />;
  }
  return <LoginCard view={request.data} busy={decide.isPending} decided={decide.isSuccess} onDecide={(decision) => decide.mutate(decision)} />;
}

/** The card for one login. It counts down each second, and turns to Expired at zero on its own, without a request. */
function LoginCard(props: { view: CliRequestView; busy: boolean; decided: boolean; onDecide: (decision: 'approve' | 'deny') => void }) {
  const { view } = props;
  const now = useNow(1000);
  const secondsLeft = Math.ceil((Date.parse(view.expiresAt) - now.getTime()) / 1000);
  const status = view.status === 'pending' && secondsLeft <= 0 ? 'expired' : view.status;
  if (status !== 'pending') return <Outcome kind={status} deviceName={view.deviceName} focus={props.decided} />;

  return (
    <section className={styles.card} aria-labelledby="approve-title">
      <span className={styles.eyebrow}>Device login</span>
      <div className={styles.intro}>
        <h1 id="approve-title" className={styles.title}>
          Approve this device?
        </h1>
        <p className={styles.body}>Check that this code matches the one in your terminal.</p>
      </div>
      {/* Read out letter by letter, so a screen reader can compare it with the terminal's too. */}
      <div className={styles.code} role="img" aria-label={`Code ${spelled(view.userCode)}`}>
        {view.userCode}
      </div>
      <div className={styles.device}>
        <span className={styles.laptop} aria-hidden="true" />
        <div className={styles.deviceText}>
          <span className={styles.deviceName}>{view.deviceName}</span>
          <span className={styles.meta}>requested {itemTime(view.requestedAt, now)}</span>
        </div>
      </div>
      <div className={styles.buttons}>
        <button type="button" className={styles.approve} disabled={props.busy} aria-busy={props.busy} onClick={() => props.onDecide('approve')}>
          Approve
        </button>
        <button type="button" className={styles.deny} disabled={props.busy} aria-busy={props.busy} onClick={() => props.onDecide('deny')}>
          Deny
        </button>
      </div>
      <p className={styles.fine}>
        Only approve if you just ran {LOGIN}. The code expires in {countdown(secondsLeft)}.
      </p>
    </section>
  );
}

const OUTCOMES = {
  approved: { title: 'Device approved', body: (device: string) => `${device} can now run your agent. You can close this tab.` },
  denied: { title: 'Login denied', body: () => "Nothing was connected. If you didn't start this login, you're all set." },
  expired: { title: 'This code expired', body: () => 'Codes last 10 minutes. Run the login again in your terminal:' },
  not_found: { title: 'Code not found', body: () => 'Check the code in your terminal, or start again:' },
} as const;

/**
 * Approved, Denied, Expired, or a code we don't know. Each has its glyph and its title, so the state never rests on
 * colour alone. `focus` moves focus to the title when it replaces the buttons you just pressed, so a screen reader says it.
 */
function Outcome({ kind, deviceName = '', focus = false }: { kind: keyof typeof OUTCOMES; deviceName?: string; focus?: boolean }) {
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focus) title.current?.focus();
  }, [focus]);
  const { title: text, body } = OUTCOMES[kind];

  return (
    <section className={`${styles.card} ${styles.outcome}`} aria-labelledby="approve-title">
      <span className={styles.icon} data-kind={kind} aria-hidden="true">
        {kind === 'approved' ? '✓' : kind === 'denied' ? '×' : <span className={styles.ring} />}
      </span>
      <h1 id="approve-title" ref={title} tabIndex={-1} className={styles.outcomeTitle}>
        {text}
      </h1>
      <p className={styles.outcomeBody}>{body(deviceName)}</p>
      {(kind === 'expired' || kind === 'not_found') && (
        <div className={styles.command}>
          <CommandBlock command={LOGIN} active />
        </div>
      )}
    </section>
  );
}

/** "9:41": minutes and seconds left. */
function countdown(seconds: number): string {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "WDJB-MJHT" → "W D J B M J H T". */
function spelled(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, '').split('').join(' ');
}
