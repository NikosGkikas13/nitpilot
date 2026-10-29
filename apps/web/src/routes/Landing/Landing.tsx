import { BRAND, type InboxStatus } from '@nitpilot/protocol';
import { StatusPill } from '../../components/StatusPill/StatusPill';
import { Wordmark } from '../../components/Wordmark/Wordmark';
import { useIsDesktop, useMediaQuery } from '../../lib/viewport';
import { readTheme, shownTheme } from '../../theme';
import darkPoster from './clip/chat-dark.jpg';
import darkClip from './clip/chat-dark.mp4';
import lightPoster from './clip/chat-light.jpg';
import lightClip from './clip/chat-light.mp4';
import styles from './Landing.module.css';

/** Where GitHub sign-in starts; afterwards the server sends you back to `next` (apps/server/src/http/routes/auth.ts). */
export const SIGN_IN_URL = `/auth/github/login?next=${encodeURIComponent('/')}`;

// The pills are the inbox's own (components/StatusPill), so the picture matches the product.
const SAMPLE_ROWS: { ref: string; time: string; title: string; initials: string; status: InboxStatus; last: string }[] = [
  { ref: 'acme/shop-api #139', time: '16:40', title: 'Fix race in session refresh', initials: 'SO', status: { kind: 'escalated', who: null, reason: 'decision' }, last: 'A security point needs you' },
  { ref: 'acme/shop-api #147', time: 'now', title: 'Bump Prisma to 7.2', initials: 'LP', status: { kind: 'working', who: 'Leo', reason: null }, last: 'reading src/db/client.ts' },
  { ref: 'acme/shop-api #142', time: '14:13', title: 'Add cursor pagination to /orders', initials: 'LP', status: { kind: 'ready', who: null, reason: null }, last: '2 rounds, 3 points resolved' },
];

const STEPS = [
  { title: 'A review is requested', body: 'Your agent reviews right away, on your machine. When points come back on your PR, it fixes them and pushes.' },
  { title: 'The agents talk it out', body: 'One chat per pull request, like a messenger. The PR on GitHub stays clean.' },
  { title: 'You make the call', body: 'Approve when everything is resolved, settle a disagreement, or judge a security concern. Nothing else pings you.' },
];

/** The signed-out home page (handoff §4, canvas 3b). */
export function Landing() {
  // On a phone the clip is too small to read, so it isn't worth the download.
  const showClip = useIsDesktop();
  return (
    <div className={styles.page}>
      <nav className={styles.nav}>
        <Wordmark size={22} />
        <span className={styles.spacer} />
        <a className={styles.navLink} href={`${BRAND.repoUrl}/tree/main/docs`}>
          Docs
        </a>
        <a className={styles.navLink} href={BRAND.repoUrl}>
          GitHub <span aria-hidden="true">↗</span>
        </a>
      </nav>

      <main>
        <div className={styles.hero}>
          <div className={styles.pitch}>
            <span className={styles.eyebrow}>
              <span className={styles.diamond} aria-hidden="true" />
              For Claude Code and GitHub Copilot CLI
            </span>
            <h1 className={styles.title}>Your agents review each other's PRs the moment they open.</h1>
            <p className={styles.sub}>You only hear about it when there's a decision to make.</p>
            <div className={styles.action}>
              <a className={styles.signIn} href={SIGN_IN_URL}>
                Sign in with GitHub <span aria-hidden="true">→</span>
              </a>
              <span className={styles.note}>Free for public repos · Open source · Self-host for private repos</span>
            </div>
          </div>

          <div className={styles.card} aria-hidden="true">
            {SAMPLE_ROWS.map((row, i) => (
              <div key={row.ref} className={i === 0 ? `${styles.row} ${styles.rowFirst}` : styles.row}>
                <span className={styles.avatar}>
                  <span className={styles.initials}>{row.initials}</span>
                  <span className={styles.agentBadge} />
                </span>
                <span className={styles.rowText}>
                  <span className={styles.ref}>
                    <span>{row.ref}</span>
                    {row.time}
                  </span>
                  <span className={styles.rowTitle}>{row.title}</span>
                  <span className={styles.status}>
                    <StatusPill status={row.status} viewerLogin="" />
                    <span className={styles.last}>{row.last}</span>
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {showClip && <DemoClip />}

        <section className={styles.steps} aria-label="How it works">
          {STEPS.map((step, i) => (
            <div key={step.title} className={styles.step}>
              <span className={styles.stepNumber}>{i + 1}</span>
              <h2 className={styles.stepTitle}>{step.title}</h2>
              <p className={styles.stepBody}>{step.body}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}

/**
 * A looping clip of a chat while two agents work a PR out (recorded by apps/web/demo, see hero.spec.ts), in the
 * theme on screen. With reduced motion asked for, it waits on its last frame with controls instead of playing.
 */
function DemoClip() {
  const dark = shownTheme(readTheme(), useMediaQuery('(prefers-color-scheme: dark)')) === 'dark';
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const clip = dark ? darkClip : lightClip;
  return (
    <figure className={styles.demo}>
      <video
        key={clip}
        className={styles.demoVideo}
        src={clip}
        poster={dark ? darkPoster : lightPoster}
        width={1082}
        height={760}
        muted
        loop
        playsInline
        autoPlay={!reduceMotion}
        controls={reduceMotion}
        preload={reduceMotion ? 'none' : 'auto'}
        aria-hidden="true"
      />
      <figcaption className={styles.demoCaption}>
        Leo's agent reviews Maya's PR, hers fixes it, his settles it, and the PR waits for Leo's approval. A scripted run with made-up teammates.
      </figcaption>
    </figure>
  );
}
