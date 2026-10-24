import type { FirstRunManifestResponse, FirstRunStatus } from '@nitpilot/protocol';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browser } from '../../lib/browser';
import { fakeApi, renderApp, type Answer } from '../../test/render';
import { sent } from '../../test/settings';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SETUP_CODE = 'K7PX-3MQD';
const FIRST_RUN: FirstRunStatus = { mode: 'first_run', publicUrl: 'https://nitpilot.example.com' };
const READY: FirstRunStatus = { mode: 'ready', installUrl: 'https://github.com/apps/nitpilot-example/installations/new' };
const MANIFEST: FirstRunManifestResponse = {
  action: 'https://github.com/settings/apps/new?state=abc123',
  manifest: { name: 'Nitpilot (nitpilot.example.com)', redirect_url: 'https://nitpilot.example.com/first-run/callback' },
};

type Route = () => Answer | Promise<Answer>;

/** A server in first-run mode: `status` for `GET /api/first-run`, `manifest` for the form's request. */
function serveFirstRun(opts: { status?: Route; manifest?: Route } = {}) {
  return fakeApi({
    'GET /api/first-run': opts.status ?? ((): Answer => [200, FIRST_RUN]),
    'POST /api/first-run/manifest': opts.manifest ?? ((): Answer => [200, MANIFEST]),
  });
}

/** Stands in for the browser posting the form to GitHub; answers the forms it was given. */
function catchFormPosts() {
  const posted: HTMLFormElement[] = [];
  vi.spyOn(browser, 'submit').mockImplementation((form) => void posted.push(form));
  return posted;
}

const codeField = () => screen.getByRole('textbox', { name: 'Setup code' });
const nameField = () => screen.getByRole('textbox', { name: 'App name' });
const createButton = () => screen.getByRole('button', { name: 'Create GitHub App' });

async function fillCode(code = SETUP_CODE) {
  await userEvent.type(await screen.findByRole('textbox', { name: 'Setup code' }), code);
}

const setupCodeWrong = (): Answer => [403, { error: { code: 'setup_code', message: "That code doesn't match the one in the server's log." } }];

describe('FirstRun: the form', () => {
  it('says it is loading until the server says which mode it is in', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderApp('/first-run');
    expect(await screen.findByRole('status')).toHaveTextContent('Loading…');
  });

  it('asks for the setup code, the owner, a name and who can install it, with the defaults filled in', async () => {
    serveFirstRun();
    renderApp('/first-run');
    expect(await screen.findByRole('heading', { level: 1, name: 'Set up Nitpilot' })).toBeInTheDocument();

    expect(codeField()).toHaveValue('');
    expect(codeField()).toHaveAccessibleDescription("Find it in the server's log: docker compose logs nitpilot");

    const owner = screen.getByRole('radiogroup', { name: 'Create the app on' });
    expect(within(owner).getByRole('radio', { name: 'Your personal account' })).toBeChecked();
    expect(within(owner).getByRole('radio', { name: 'An organization' })).not.toBeChecked();
    expect(screen.queryByRole('textbox', { name: 'Organization' })).not.toBeInTheDocument();

    expect(nameField()).toHaveValue('Nitpilot (nitpilot.example.com)');
    expect(nameField()).toHaveAttribute('maxlength', '34');

    const who = screen.getByRole('radiogroup', { name: 'Who can install it' });
    expect(within(who).getByRole('radio', { name: 'Only this account or organization' })).toBeChecked();
    expect(within(who).getByRole('radio', { name: 'Anyone on GitHub' })).not.toBeChecked();

    expect(createButton()).toBeEnabled();
  });

  it("trims the default name to GitHub's 34 characters, keeping the closing bracket", async () => {
    serveFirstRun({ status: (): Answer => [200, { mode: 'first_run', publicUrl: 'https://reviews.engineering.example-company.com' }] });
    renderApp('/first-run');
    await screen.findByRole('heading', { level: 1, name: 'Set up Nitpilot' });
    expect(nameField()).toHaveValue('Nitpilot (reviews.engineering.exa)');
    expect((nameField() as HTMLInputElement).value).toHaveLength(34);
  });

  it("asks for the manifest, then posts it to GitHub in a real form (GitHub doesn't take a fetch)", async () => {
    const posted = catchFormPosts();
    const fetch = serveFirstRun();
    renderApp('/first-run');
    await fillCode();
    await userEvent.click(createButton());

    expect(sent(fetch, '/api/first-run/manifest')).toEqual([
      `POST ${JSON.stringify({ code: SETUP_CODE, owner: { kind: 'user' }, name: 'Nitpilot (nitpilot.example.com)', isPublic: false })}`,
    ]);
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    const form = posted[0]!;
    expect(form.method).toBe('post');
    expect(form.action).toBe(MANIFEST.action);
    const fields = [...form.elements] as HTMLInputElement[];
    expect(fields.map((field) => [field.type, field.name, field.value])).toEqual([['hidden', 'manifest', JSON.stringify(MANIFEST.manifest)]]);
    // While the browser leaves for GitHub, the button says so and can't be pressed twice.
    expect(screen.getByRole('button', { name: 'Opening GitHub…' })).toBeDisabled();
  });

  it('makes the app for an organization, installable by anyone, under the name typed', async () => {
    catchFormPosts();
    const fetch = serveFirstRun();
    renderApp('/first-run');
    await fillCode();
    await userEvent.click(screen.getByRole('radio', { name: 'An organization' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Organization' }), 'acme-inc');
    await userEvent.clear(nameField());
    await userEvent.type(nameField(), 'Acme reviews');
    await userEvent.click(screen.getByRole('radio', { name: 'Anyone on GitHub' }));
    await userEvent.click(createButton());

    expect(sent(fetch, '/api/first-run/manifest')).toEqual([
      `POST ${JSON.stringify({ code: SETUP_CODE, owner: { kind: 'org', login: 'acme-inc' }, name: 'Acme reviews', isPublic: true })}`,
    ]);
  });

  it('can be filled in and sent with the keyboard alone, in reading order', async () => {
    const posted = catchFormPosts();
    serveFirstRun();
    renderApp('/first-run');
    await screen.findByRole('heading', { level: 1, name: 'Set up Nitpilot' });
    await userEvent.tab();
    expect(codeField()).toHaveFocus();
    await userEvent.keyboard(SETUP_CODE);
    await userEvent.tab();
    expect(screen.getByRole('radio', { name: 'Your personal account' })).toHaveFocus();
    await userEvent.tab();
    expect(nameField()).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('radio', { name: 'Only this account or organization' })).toHaveFocus();
    await userEvent.tab();
    expect(createButton()).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await vi.waitFor(() => expect(posted).toHaveLength(1));
  });

  it('comes back usable when the browser returns from GitHub with Back', async () => {
    catchFormPosts();
    serveFirstRun();
    renderApp('/first-run');
    await fillCode();
    await userEvent.click(createButton());
    expect(await screen.findByRole('button', { name: 'Opening GitHub…' })).toBeDisabled();

    // The browser shows the page from its back-forward cache, as it was when it left.
    act(() => void window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    expect(await screen.findByRole('button', { name: 'Create GitHub App' })).toBeEnabled();
    expect(codeField()).toHaveValue(SETUP_CODE);
  });
});

describe('FirstRun: what the form refuses', () => {
  it('a wrong code keeps everything typed and says so on the code field, which gets the focus', async () => {
    const posted = catchFormPosts();
    serveFirstRun({ manifest: setupCodeWrong });
    renderApp('/first-run');
    await fillCode('K7PX-3MQE');
    await userEvent.clear(nameField());
    await userEvent.type(nameField(), 'My reviews');
    await userEvent.click(createButton());

    const field = codeField();
    expect(await screen.findByText("That code doesn't match the one in the server's log.")).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription(expect.stringContaining("That code doesn't match the one in the server's log."));
    expect(field).toHaveFocus();
    expect(field).toHaveValue('K7PX-3MQE');
    expect(nameField()).toHaveValue('My reviews');
    expect(createButton()).toBeEnabled();
    expect(posted).toEqual([]);
  });

  it('fixing the code clears the message', async () => {
    serveFirstRun({ manifest: setupCodeWrong });
    renderApp('/first-run');
    await fillCode('WRONG');
    await userEvent.click(createButton());
    expect(await screen.findByText("That code doesn't match the one in the server's log.")).toBeInTheDocument();
    await userEvent.type(codeField(), 'X');
    expect(screen.queryByText("That code doesn't match the one in the server's log.")).not.toBeInTheDocument();
    expect(codeField()).not.toHaveAttribute('aria-invalid');
  });

  it('too many tries says to wait a minute', async () => {
    serveFirstRun({ manifest: (): Answer => [429, { error: { code: 'rate_limited', message: 'Too many tries from here. Wait a minute and try again.' } }] });
    renderApp('/first-run');
    await fillCode();
    await userEvent.click(createButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many tries. Wait a minute and try again.');
    expect(codeField()).toHaveValue(SETUP_CODE);
  });

  it('checks the fields before asking the server, and names the one to fix', async () => {
    const fetch = serveFirstRun();
    renderApp('/first-run');
    await screen.findByRole('heading', { level: 1, name: 'Set up Nitpilot' });
    await userEvent.click(createButton());
    expect(codeField()).toHaveAttribute('aria-invalid', 'true');
    expect(codeField()).toHaveAccessibleDescription(expect.stringContaining("Enter the setup code from the server's log."));
    expect(codeField()).toHaveFocus();

    await userEvent.type(codeField(), SETUP_CODE);
    await userEvent.click(screen.getByRole('radio', { name: 'An organization' }));
    await userEvent.clear(nameField());
    await userEvent.click(createButton());
    const org = screen.getByRole('textbox', { name: 'Organization' });
    expect(org).toHaveAttribute('aria-invalid', 'true');
    expect(org).toHaveAccessibleDescription("Enter the organization's GitHub login, like acme-inc.");
    expect(org).toHaveFocus();
    expect(nameField()).toHaveAttribute('aria-invalid', 'true');
    expect(nameField()).toHaveAccessibleDescription(expect.stringContaining('Give the app a name.'));

    await userEvent.type(org, 'not a login!');
    await userEvent.click(createButton());
    expect(org).toHaveAccessibleDescription("Enter the organization's GitHub login, like acme-inc.");
    expect(sent(fetch, '/api/first-run/manifest')).toEqual([]);
  });

  it("names the field when the server refuses one the page didn't catch", async () => {
    serveFirstRun({
      manifest: (): Answer => [400, { error: { code: 'validation_error', message: 'request validation failed', details: { issues: [{ path: ['name'], message: 'Too big' }] } } }],
    });
    renderApp('/first-run');
    await fillCode();
    await userEvent.click(createButton());
    await vi.waitFor(() => expect(nameField()).toHaveAttribute('aria-invalid', 'true'));
    expect(nameField()).toHaveAccessibleDescription(expect.stringContaining('Up to 34 characters.'));
  });

  it("shows the server's message for anything else, and keeps the form", async () => {
    serveFirstRun({ manifest: () => Promise.reject(new TypeError('Failed to fetch')) });
    renderApp('/first-run');
    await fillCode();
    await userEvent.click(createButton());
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach Nitpilot. Check your connection and try again.");
    expect(codeField()).toHaveValue(SETUP_CODE);
  });
});

describe('FirstRun: a server that already has its app', () => {
  it('says so, with Install and Sign in', async () => {
    const fetch = serveFirstRun({ status: (): Answer => [200, READY] });
    renderApp('/first-run');
    expect(await screen.findByRole('heading', { level: 1, name: 'This server is set up' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Install the app' })).toHaveAttribute('href', READY.installUrl);
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/auth/github/login');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(sent(fetch, '/api/first-run')).toEqual(['GET ']);
  });

  it("offers Try again when the server can't be read", async () => {
    let reads = 0;
    serveFirstRun({ status: (): Answer => (++reads <= 3 ? [500, {}] : [200, FIRST_RUN]) });
    renderApp('/first-run');
    expect(await screen.findByRole('alert')).toHaveTextContent('Nitpilot answered 500. Try again in a moment.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Set up Nitpilot' })).toBeInTheDocument();
  });
});

describe('FirstRun: back from GitHub (?done=1)', () => {
  it('waits while the server restarts, asking every 2 seconds and through its downtime, then offers Install and Sign in', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const answers: Route[] = [
      // Not restarted yet, then down, then answering something that isn't the API (a proxy's error page), then ready.
      (): Answer => [200, FIRST_RUN],
      () => Promise.reject(new TypeError('Failed to fetch')),
      (): Answer => [502, 'Bad Gateway'],
      (): Answer => [200, READY],
    ];
    const fetch = serveFirstRun({ status: () => answers.shift()!() });
    renderApp('/first-run?done=1');

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Restarting the server…');
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
    for (const reads of [2, 3]) {
      await act(() => vi.advanceTimersByTimeAsync(2_000));
      expect(sent(fetch, '/api/first-run')).toHaveLength(reads);
      expect(screen.getByRole('status')).toHaveTextContent('Restarting the server…');
    }
    await act(() => vi.advanceTimersByTimeAsync(2_000));

    expect(await screen.findByRole('heading', { level: 1, name: 'Your GitHub App is ready' })).toBeInTheDocument();
    // The same live region says it, so a screen reader hears the change.
    expect(screen.getByRole('status')).toHaveTextContent('Your GitHub App is ready');
    expect(screen.getByRole('link', { name: 'Install the app on your repos' })).toHaveAttribute('href', READY.installUrl);
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/auth/github/login');

    // Ready means done: no more asking.
    await act(() => vi.advanceTimersByTimeAsync(6_000));
    expect(sent(fetch, '/api/first-run')).toHaveLength(4);
  });

  it('after a minute, says where to look if the server still has not come back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serveFirstRun({ status: () => Promise.reject(new TypeError('Failed to fetch')) });
    renderApp('/first-run?done=1');
    expect(await screen.findByRole('status')).toHaveTextContent('Restarting the server…');
    expect(screen.queryByText(/Taking a while\?/)).not.toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(screen.getByText(/Taking a while\? Check that the server restarted:/)).toHaveTextContent('docker compose ps');
  });
});

describe('FirstRun: back from GitHub with a problem (?error=)', () => {
  const DELETE_HINT = 'GitHub → Settings → Developer settings → GitHub Apps';

  it.each([
    ['expired', 'This setup link expired', 'Nothing was saved.'],
    ['github', "GitHub didn't finish the setup", 'Nothing was saved.'],
    ['exists', 'This server already has its GitHub App', "The app GitHub just made isn't used."],
    ['something-else', 'This setup link expired', 'Nothing was saved.'],
  ])('%s: says what happened and where to delete the app GitHub made', async (problem, title, body) => {
    serveFirstRun();
    renderApp(`/first-run?error=${problem}`);
    const heading = await screen.findByRole('heading', { level: 1, name: title });
    const card = heading.closest('section')!;
    expect(card).toHaveTextContent(body);
    expect(card).toHaveTextContent(DELETE_HINT);
  });

  it('Start again goes back to the form, without the problem in the address', async () => {
    serveFirstRun();
    renderApp('/first-run?error=github');
    await userEvent.click(await screen.findByRole('button', { name: 'Start again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Set up Nitpilot' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: "GitHub didn't finish the setup" })).not.toBeInTheDocument();
  });

  describe('GitHub did not finish: the server keeps the setup link and hands back its code and state', () => {
    const STATE = 'abc_DEF-123';
    const retryLink = () => screen.queryByRole('link', { name: 'Try again' });

    it('offers Try again, which opens the callback again with the same code and state, before Start again', async () => {
      serveFirstRun();
      renderApp(`/first-run?error=github&code=the-code&state=${STATE}`);
      const heading = await screen.findByRole('heading', { level: 1, name: "GitHub didn't finish the setup" });
      const card = heading.closest('section')!;
      expect(card).toHaveTextContent("GitHub didn't answer, or its answer was missing part of the new app. Nothing was saved.");
      expect(card).toHaveTextContent('Try again in a minute. If it keeps failing, delete the app GitHub may have made in GitHub → Settings → Developer settings → GitHub Apps, then start again.');
      expect(retryLink()).toHaveAttribute('href', `/first-run/callback?code=the-code&state=${STATE}`);
      // Try again comes first.
      const actions = [...card.querySelectorAll('a, button')];
      expect(actions.map((action) => action.textContent)).toEqual(['Try again', 'Start again']);
    });

    it('escapes what it puts in the retry link', async () => {
      serveFirstRun();
      renderApp('/first-run?error=github&code=a%26b%3Dc&state=s%2F1');
      await screen.findByRole('heading', { level: 1, name: "GitHub didn't finish the setup" });
      expect(retryLink()).toHaveAttribute('href', '/first-run/callback?code=a%26b%3Dc&state=s%2F1');
    });

    it('has no Try again without both the code and the state', async () => {
      for (const query of ['error=github', 'error=github&code=the-code', `error=github&state=${STATE}`]) {
        serveFirstRun();
        const { unmount } = renderApp(`/first-run?${query}`);
        const heading = await screen.findByRole('heading', { level: 1, name: "GitHub didn't finish the setup" });
        expect(retryLink(), query).not.toBeInTheDocument();
        expect(heading.closest('section'), query).toHaveTextContent('If GitHub made an app anyway, delete it in GitHub → Settings → Developer settings → GitHub Apps, then try again in a minute.');
        unmount();
      }
    });

    it("only the github problem offers it: the others don't, even with a code and state in the address", async () => {
      serveFirstRun();
      renderApp(`/first-run?error=expired&code=the-code&state=${STATE}`);
      await screen.findByRole('heading', { level: 1, name: 'This setup link expired' });
      expect(retryLink()).not.toBeInTheDocument();
    });

    it('Start again drops the code and state too: the form comes back and no retry link is left', async () => {
      serveFirstRun();
      renderApp(`/first-run?error=github&code=the-code&state=${STATE}`);
      await userEvent.click(await screen.findByRole('button', { name: 'Start again' }));
      expect(await screen.findByRole('heading', { level: 1, name: 'Set up Nitpilot' })).toBeInTheDocument();
      expect(retryLink()).not.toBeInTheDocument();
      expect(document.querySelector('a[href^="/first-run/callback"]')).toBeNull();
    });
  });
});

describe('FirstRun is a page of its own', () => {
  it("doesn't ask who is signed in: a server in first-run mode has nobody", async () => {
    const fetch = serveFirstRun();
    renderApp('/first-run');
    await screen.findByRole('heading', { level: 1, name: 'Set up Nitpilot' });
    expect(sent(fetch, '/api/me')).toEqual([]);
  });
});
