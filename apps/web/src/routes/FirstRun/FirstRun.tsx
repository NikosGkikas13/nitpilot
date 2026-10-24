import { BRAND, FirstRunManifestRequest, FirstRunProblem, type FirstRunManifestResponse } from '@nitpilot/protocol';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type Ref } from 'react';
import { useSearchParams } from 'react-router';
import { z } from 'zod';
import { ApiError } from '../../api/client';
import { RESTART_POLL_MS, useFirstRunStatus, useManifest, useRestartedServer } from '../../api/first-run';
import { ErrorState } from '../../components/ErrorState/ErrorState';
import { Wordmark } from '../../components/Wordmark/Wordmark';
import { browser } from '../../lib/browser';
import { useNow } from '../../lib/time';
import styles from './FirstRun.module.css';

const SIGN_IN = '/auth/github/login';
/** The longest name GitHub gives an app. */
const NAME_MAX = 34;
/** After this long without the server coming back, the page says where to look. */
const SLOW_RESTART_MS = 60_000;
const GITHUB_APPS_SETTINGS = 'GitHub → Settings → Developer settings → GitHub Apps';

/**
 * `/first-run` (spec §10 "First-run mode", docs/why/first-run-and-app-manifests.md): a self-hosted server with no
 * GitHub App yet has GitHub create one. The person types the setup code from the server's log and a few choices; the
 * page posts the server's manifest to GitHub in a real form; GitHub sends them back to `?done=1` while the server
 * restarts, or to `?error=…` if something went wrong. A page of its own, like device approval: nobody can be signed
 * in yet.
 */
export function FirstRun() {
  const [params, setParams] = useSearchParams();
  const problem = params.get('error');

  let content: ReactNode;
  if (problem !== null) content = <Problem problem={problem} retry={retryOf(params)} onStartAgain={() => setParams({})} />;
  else if (params.get('done') === '1') content = <Restarting />;
  else content = <Start />;

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

/** Asks the server which mode it's in: the form if it needs setting up, Install and Sign in if it already has its app. */
function Start() {
  const status = useFirstRunStatus();
  if (status.isPending) return <Loading />;
  if (status.isError) return <ErrorState message={status.error.message} onRetry={() => void status.refetch()} />;
  if (status.data.mode === 'ready') {
    return (
      <section className={`${styles.card} ${styles.centered}`} aria-labelledby="first-run-title">
        <span className={styles.icon} data-kind="ready" aria-hidden="true">
          ✓
        </span>
        <h1 id="first-run-title" className={styles.outcomeTitle}>
          This server is set up
        </h1>
        <p className={styles.body}>It has its GitHub App. Install it on your repos, or sign in.</p>
        <InstallAndSignIn installUrl={status.data.installUrl} installLabel="Install the app" />
      </section>
    );
  }
  return <SetupForm publicUrl={status.data.publicUrl} />;
}

type Field = 'code' | 'org' | 'name';
type FieldErrors = Partial<Record<Field, string>>;
/** The fields in the order they're on the page: focus goes to the first one with a problem. */
const FIELD_ORDER: Field[] = ['code', 'org', 'name'];

const MESSAGES = {
  noCode: "Enter the setup code from the server's log.",
  wrongCode: "That code doesn't match the one in the server's log.",
  orgLogin: "Enter the organization's GitHub login, like acme-inc.",
  noName: 'Give the app a name.',
  nameTooLong: `Up to ${NAME_MAX} characters.`,
  tooManyTries: 'Too many tries. Wait a minute and try again.',
};

/** The form: the setup code, whose app it is, its name, who can install it. "Create GitHub App" then leaves for GitHub. */
function SetupForm({ publicUrl }: { publicUrl: string }) {
  const [code, setCode] = useState('');
  const [ownerKind, setOwnerKind] = useState<'user' | 'org'>('user');
  const [org, setOrg] = useState('');
  const [name, setName] = useState(() => defaultAppName(publicUrl));
  const [isPublic, setIsPublic] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const manifest = useManifest();
  const codeInput = useRef<HTMLInputElement>(null);
  const orgInput = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const id = useId();
  const ids = { code: `${id}-code`, org: `${id}-org`, name: `${id}-name`, owner: `${id}-owner`, who: `${id}-who` };

  // Back from GitHub with the browser's Back button, the page can come back exactly as it left, "Opening GitHub…"
  // included. Make the form usable again, keeping what was typed.
  const { reset } = manifest;
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) reset();
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, [reset]);

  function showFieldErrors(next: FieldErrors) {
    setErrors(next);
    const first = FIELD_ORDER.find((field) => next[field]);
    const inputs = { code: codeInput, org: orgInput, name: nameInput };
    if (first) inputs[first].current?.focus();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    // The same schema the server checks with, so the page names the field to fix before asking.
    const parsed = FirstRunManifestRequest.safeParse({ code, owner: ownerKind === 'org' ? { kind: 'org', login: org.trim() } : { kind: 'user' }, name, isPublic });
    const problems: FieldErrors = parsed.success ? {} : fieldErrorsFrom(parsed.error.issues, name);
    if (code.trim() === '') problems.code = MESSAGES.noCode;
    if (!parsed.success || problems.code) return showFieldErrors(problems);

    setErrors({});
    manifest.mutate(parsed.data, {
      onError: (err) => {
        if (err instanceof ApiError && err.code === 'setup_code') return showFieldErrors({ code: MESSAGES.wrongCode });
        if (err instanceof ApiError && err.code === 'rate_limited') return setFormError(MESSAGES.tooManyTries);
        const named = err instanceof ApiError && err.code === 'validation_error' ? fieldErrorsFrom(issuesIn(err), name) : {};
        if (Object.keys(named).length > 0) return showFieldErrors(named);
        setFormError(err.message);
      },
    });
  }

  /** Typing in a field clears its message. */
  function edit(field: Field, set: (value: string) => void) {
    return (value: string) => {
      set(value);
      setErrors((current) => ({ ...current, [field]: undefined }));
    };
  }

  const leaving = manifest.isPending || manifest.isSuccess;
  return (
    <section className={styles.card} aria-labelledby="first-run-title">
      <span className={styles.eyebrow}>First run</span>
      <div className={styles.intro}>
        <h1 id="first-run-title" className={styles.title}>
          Set up {BRAND.name}
        </h1>
        <p className={styles.body}>This server needs a GitHub App of its own. Fill this in, and GitHub creates it after one more click.</p>
      </div>

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <TextField
          id={ids.code}
          ref={codeInput}
          label="Setup code"
          value={code}
          onChange={edit('code', setCode)}
          error={errors.code}
          hint={
            <>
              Find it in the server's log: <code className={styles.inlineCode}>docker compose logs {BRAND.cli}</code>
            </>
          }
          mono
        />

        <fieldset className={styles.choices} role="radiogroup" aria-labelledby={ids.owner}>
          <legend id={ids.owner} className={styles.label}>
            Create the app on
          </legend>
          <Choice name="owner" label="Your personal account" checked={ownerKind === 'user'} onChoose={() => setOwnerKind('user')} />
          <Choice name="owner" label="An organization" checked={ownerKind === 'org'} onChoose={() => setOwnerKind('org')} />
        </fieldset>
        {ownerKind === 'org' && <TextField id={ids.org} ref={orgInput} label="Organization" value={org} onChange={edit('org', setOrg)} error={errors.org} />}

        <TextField
          id={ids.name}
          ref={nameInput}
          label="App name"
          value={name}
          onChange={edit('name', setName)}
          error={errors.name}
          maxLength={NAME_MAX}
          hint="GitHub shows this name, and no two apps on GitHub can share one."
        />

        <fieldset className={styles.choices} role="radiogroup" aria-labelledby={ids.who}>
          <legend id={ids.who} className={styles.label}>
            Who can install it
          </legend>
          <Choice name="who" label="Only this account or organization" checked={!isPublic} onChoose={() => setIsPublic(false)} />
          <Choice name="who" label="Anyone on GitHub" checked={isPublic} onChoose={() => setIsPublic(true)} />
        </fieldset>

        {formError && (
          <p className={styles.formError} role="alert">
            {formError}
          </p>
        )}
        <button type="submit" className={styles.primary} disabled={leaving} aria-busy={leaving}>
          {leaving ? 'Opening GitHub…' : 'Create GitHub App'}
        </button>
      </form>
      {/* Outside the form above: a form can't hold another. */}
      {manifest.data && <PostToGithub answer={manifest.data} />}
    </section>
  );
}

/** A labelled text input with its hint and its error, both read out with it (`aria-describedby`). */
function TextField({ ref, ...props }: {
  id: string;
  ref: Ref<HTMLInputElement>;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: ReactNode;
  maxLength?: number;
  mono?: boolean;
}) {
  const hintId = `${props.id}-hint`;
  const errorId = `${props.id}-error`;
  const describedBy = [props.hint ? hintId : null, props.error ? errorId : null].filter(Boolean).join(' ');
  return (
    <div className={styles.field}>
      <label htmlFor={props.id} className={styles.label}>
        {props.label}
      </label>
      <input
        id={props.id}
        ref={ref}
        className={props.mono ? `${styles.input} ${styles.mono}` : styles.input}
        type="text"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        maxLength={props.maxLength}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={describedBy || undefined}
      />
      {props.hint && (
        <p id={hintId} className={styles.hint}>
          {props.hint}
        </p>
      )}
      {props.error && (
        <p id={errorId} className={styles.fieldError}>
          {props.error}
        </p>
      )}
    </div>
  );
}

function Choice(props: { name: string; label: string; checked: boolean; onChoose: () => void }) {
  return (
    <label className={styles.choice}>
      <input type="radio" name={props.name} checked={props.checked} onChange={props.onChoose} />
      {props.label}
    </label>
  );
}

/**
 * The manifest, posted to GitHub the only way GitHub takes it: a form the browser submits, which leaves this page.
 * Submitted once, as soon as it's on the page (a ref keeps React's development double-run from posting twice).
 */
function PostToGithub({ answer }: { answer: FirstRunManifestResponse }) {
  const form = useRef<HTMLFormElement>(null);
  const posted = useRef(false);
  useEffect(() => {
    if (posted.current || !form.current) return;
    posted.current = true;
    browser.submit(form.current);
  }, []);
  return (
    <form ref={form} method="post" action={answer.action} hidden>
      <input type="hidden" name="manifest" value={JSON.stringify(answer.manifest)} />
    </form>
  );
}

/**
 * Back from GitHub: the server saved the app and is restarting. Ask every 2 seconds until it answers `ready`. The
 * title and its line sit in a polite live region, so a screen reader hears "ready" when it comes.
 */
function Restarting() {
  const server = useRestartedServer();
  const [startedAt] = useState(() => Date.now());
  const now = useNow(RESTART_POLL_MS);
  const ready = server.data?.mode === 'ready' ? server.data : null;
  const slow = !ready && now.getTime() - startedAt >= SLOW_RESTART_MS;

  return (
    <section className={`${styles.card} ${styles.centered}`} aria-labelledby="first-run-title">
      <div className={styles.status} role="status">
        {ready ? (
          <span className={styles.icon} data-kind="ready" aria-hidden="true">
            ✓
          </span>
        ) : (
          <span className={styles.spinner} aria-hidden="true" />
        )}
        <h1 id="first-run-title" className={styles.outcomeTitle}>
          {ready ? 'Your GitHub App is ready' : 'Restarting the server…'}
        </h1>
        <p className={styles.body}>
          {ready ? 'Install it on the repos you want reviewed, then sign in.' : "GitHub made the app and the server saved it. It's restarting to use it, which takes a few seconds."}
        </p>
      </div>
      {slow && (
        <p className={styles.fine}>
          Taking a while? Check that the server restarted: <code className={styles.inlineCode}>docker compose ps</code>, and its log:{' '}
          <code className={styles.inlineCode}>docker compose logs {BRAND.cli}</code>.
        </p>
      )}
      {ready && <InstallAndSignIn installUrl={ready.installUrl} installLabel="Install the app on your repos" />}
    </section>
  );
}

function InstallAndSignIn({ installUrl, installLabel }: { installUrl: string; installLabel: string }) {
  return (
    <div className={styles.buttons}>
      <a className={styles.primary} href={installUrl}>
        {installLabel}
      </a>
      <a className={styles.secondary} href={SIGN_IN}>
        Sign in
      </a>
    </div>
  );
}

/** What the `github` problem's "Try again" needs: the server hands the `code` and `state` back so it can open the callback again. */
type Retry = { code: string; state: string };

function retryOf(params: URLSearchParams): Retry | null {
  const code = params.get('code');
  const state = params.get('state');
  return code && state ? { code, state } : null;
}

const PROBLEMS: Record<FirstRunProblem, { title: string; body: string; hint: string; retryHint?: string }> = {
  expired: {
    title: 'This setup link expired',
    body: "Nothing was saved. GitHub's link back works once, within the hour, and only until the server restarts.",
    hint: `If GitHub made an app anyway, delete it in ${GITHUB_APPS_SETTINGS}, then start again.`,
  },
  github: {
    title: "GitHub didn't finish the setup",
    body: "GitHub didn't answer, or its answer was missing part of the new app. Nothing was saved.",
    hint: `If GitHub made an app anyway, delete it in ${GITHUB_APPS_SETTINGS}, then try again in a minute.`,
    // With the link to retry (the server kept the setup link), the hint is about trying that first.
    retryHint: `Try again in a minute. If it keeps failing, delete the app GitHub may have made in ${GITHUB_APPS_SETTINGS}, then start again.`,
  },
  exists: {
    title: 'This server already has its GitHub App',
    body: "The app GitHub just made isn't used.",
    hint: `Delete it in ${GITHUB_APPS_SETTINGS}.`,
  },
};

/**
 * GitHub sent the person back, but the server couldn't finish (`/first-run?error=…`, setup/first-run.ts). When GitHub
 * itself failed, the server kept the setup link and put its `code` and `state` in the address: "Try again" opens the
 * callback with them, so the person doesn't have to make a second app.
 */
function Problem({ problem, retry, onStartAgain }: { problem: string; retry: Retry | null; onStartAgain: () => void }) {
  const known = FirstRunProblem.safeParse(problem);
  const kind = known.success ? known.data : 'expired';
  const { title, body, hint, retryHint } = PROBLEMS[kind];
  const retryHref = kind === 'github' && retry ? `/first-run/callback?${new URLSearchParams(retry)}` : null;
  const startAgain = (
    <button type="button" className={styles.secondary} onClick={onStartAgain}>
      Start again
    </button>
  );
  return (
    <section className={`${styles.card} ${styles.centered}`} aria-labelledby="first-run-title">
      <span className={styles.icon} data-kind="problem" aria-hidden="true">
        !
      </span>
      <h1 id="first-run-title" className={styles.outcomeTitle}>
        {title}
      </h1>
      <p className={styles.body}>{body}</p>
      <p className={styles.fine}>{retryHref ? retryHint : hint}</p>
      {retryHref ? (
        <div className={styles.buttons}>
          <a className={styles.primary} href={retryHref}>
            Try again
          </a>
          {startAgain}
        </div>
      ) : (
        startAgain
      )}
    </section>
  );
}

/** "Nitpilot (nitpilot.example.com)", with the host cut short to fit GitHub's 34 characters. */
function defaultAppName(publicUrl: string): string {
  const host = URL.canParse(publicUrl) ? new URL(publicUrl).host : '';
  if (host === '') return BRAND.name;
  const prefix = `${BRAND.name} (`;
  return `${prefix}${host.slice(0, NAME_MAX - prefix.length - 1)})`;
}

/** Which field each problem is about, from the schema's issues (the page's own check, or a 400's `details.issues`). */
function fieldErrorsFrom(issues: readonly { path: readonly PropertyKey[] }[], name: string): FieldErrors {
  const errors: FieldErrors = {};
  for (const { path } of issues) {
    if (path[0] === 'code') errors.code = MESSAGES.noCode;
    if (path[0] === 'owner') errors.org = MESSAGES.orgLogin;
    if (path[0] === 'name') errors.name = name.trim() === '' ? MESSAGES.noName : MESSAGES.nameTooLong;
  }
  return errors;
}

const Issues = z.object({ issues: z.array(z.object({ path: z.array(z.union([z.string(), z.number()])) })) });

/** The issues a 400 sent along (http/errors.ts puts zod's in `details.issues`), or none. */
function issuesIn(err: ApiError) {
  const parsed = Issues.safeParse(err.details);
  return parsed.success ? parsed.data.issues : [];
}
