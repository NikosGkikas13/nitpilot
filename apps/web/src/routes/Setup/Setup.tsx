import { BRAND, type Onboarding, type WebMe } from '@nitpilot/protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link, useOutletContext } from 'react-router';
import { useOnboarding } from '../../api/onboarding';
import { Avatar } from '../../components/Avatar/Avatar';
import { ErrorState } from '../../components/ErrorState/ErrorState';
import { Wordmark } from '../../components/Wordmark/Wordmark';
import { ChecklistRow, type StepState } from './ChecklistRow';
import { CommandBlock } from './CommandBlock';
import styles from './Setup.module.css';

const LOGIN = `npx ${BRAND.npmPackage} login`;
const REPOS_ADD = `${BRAND.cli} repos add`;
const START = `${BRAND.cli} start`;

/**
 * `/setup` (handoff §5, spec §16 "Onboarding"): the five steps from signing in to a running agent, a page of its own.
 * It ticks itself off: the facts (`GET /api/onboarding`) are read again after every `me.update` (a CLI logged in or
 * connected) and when the window comes back into view (after GitHub's install page, in another tab). A first sign-in
 * lands here; "Skip for now" goes to the inbox, and Settings links back here until setup is done.
 */
export function Setup() {
  const me = useOutletContext<WebMe>();
  const onboarding = useOnboarding();
  const queryClient = useQueryClient();
  const done = onboarding.data?.done ?? false;

  // The server remembers done on this read; `me` says so too from now on, so Settings stops offering the checklist.
  useEffect(() => {
    if (done && !me.onboarded) queryClient.setQueryData<WebMe | null>(['me'], (old) => (old ? { ...old, onboarded: true } : old));
  }, [done, me.onboarded, queryClient]);

  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <Wordmark />
        <span className={styles.spacer} />
        <Avatar login={me.login} src={me.avatarUrl} size={32} />
      </header>
      <main className={styles.main}>
        <div className={styles.intro}>
          <h1 className={styles.title}>Set up {BRAND.name}</h1>
          <p className={styles.sub}>This list ticks itself off as each step completes.</p>
        </div>
        {onboarding.isPending ? (
          <p className={styles.loading} role="status">
            Checking your setup…
          </p>
        ) : onboarding.isError ? (
          <ErrorState message="Couldn't check your setup." onRetry={() => void onboarding.refetch()} />
        ) : (
          <Checklist me={me} facts={onboarding.data} />
        )}
        {done ? (
          <Link to="/" className={styles.primary}>
            Open your inbox
          </Link>
        ) : (
          <Link to="/" className={styles.skip}>
            Skip for now
          </Link>
        )}
      </main>
    </div>
  );
}

/** The progress bar and the five rows. The first step not done is the active one, even if a later one is done. */
function Checklist({ me, facts }: { me: WebMe; facts: Onboarding }) {
  const { appInstalled, cliConnected, repoLinked, agentStarted } = facts.steps;
  // Step 1, signing in, is done: only a signed-in person sees this page.
  const finished = [true, appInstalled, cliConnected, repoLinked, agentStarted];
  const firstOpen = finished.indexOf(false);
  const state = (i: number): StepState => (finished[i] ? 'done' : i === firstOpen ? 'active' : 'pending');
  const count = finished.filter(Boolean).length;

  return (
    <>
      <div className={styles.progress}>
        <div className={styles.track} role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={5} aria-valuenow={count}>
          <div className={styles.fill} style={{ width: `${(count / 5) * 100}%` }} />
        </div>
        <span className={styles.count}>{count} of 5</span>
      </div>
      <ol className={styles.card} aria-label="Setup steps">
        <ChecklistRow n={1} state="done" title="Sign in with GitHub" body={`Signed in as @${me.login}.`} />

        <ChecklistRow
          n={2}
          state={state(1)}
          title="Install the GitHub App on your repos"
          body={
            <>
              {state(1) === 'done' ? 'Installed on GitHub.' : 'Pick the repos your agents may work on. GitHub opens in a new tab.'}
              {facts.publicReposOnly && ` ${BRAND.hostedDomain} covers public repos only.`}
            </>
          }
        >
          {state(1) === 'active' && (
            <a className={styles.install} href={`https://github.com/apps/${facts.appSlug}/installations/new`} target="_blank" rel="noopener">
              Install on GitHub
            </a>
          )}
        </ChecklistRow>

        <ChecklistRow
          n={3}
          state={state(2)}
          title="Connect your computer"
          body={state(2) === 'done' ? 'Your terminal is linked to this account.' : 'Run this in a terminal, then approve the device in the tab that opens.'}
        >
          {state(2) !== 'done' && <CommandBlock command={LOGIN} active={state(2) === 'active'} />}
          {state(2) === 'active' && <span className={styles.status}>Waiting for your terminal…</span>}
          {state(2) === 'done' && <span className={styles.connected}>✓ Connected{facts.deviceName ? `: ${facts.deviceName}` : ''}</span>}
        </ChecklistRow>

        <ChecklistRow
          n={4}
          state={state(3)}
          title="Link a repo"
          body={
            state(3) === 'done' ? (
              'Your computer reported a linked repo.'
            ) : (
              <>
                Run it inside your clone. It's ticked off once <code>{START}</code> connects.
              </>
            )
          }
        >
          {state(3) !== 'done' && <CommandBlock command={REPOS_ADD} active={state(3) === 'active'} />}
        </ChecklistRow>

        <ChecklistRow
          n={5}
          state={state(4)}
          title="Start your agent"
          body={state(4) === 'done' ? 'Your agent is connected.' : `${BRAND.name} picks up your coding agent on its own.`}
        >
          {state(4) !== 'done' && (
            <>
              <CommandBlock command={START} active={state(4) === 'active'} />
              <div className={styles.chips}>
                <span className={styles.chip}>Claude Code · detected automatically</span>
                <span className={styles.chip}>GitHub Copilot CLI · set "agent": "copilot" in the config</span>
              </div>
            </>
          )}
        </ChecklistRow>
      </ol>
    </>
  );
}
