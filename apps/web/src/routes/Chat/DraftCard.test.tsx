import type { ChatView, DraftView, TimelineItem, WebMe } from '@nitpilot/protocol';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authorDraft, chatResponse, chatView, item, point, reviewerDraft } from '../../test/chat';
import { fakeApi, renderApp, type Answer } from '../../test/render';

const me = (githubId: string, login: string): WebMe => ({ id: `u_${login}`, githubId, login, avatarUrl: null, githubAuth: 'ok', agentOnline: true, settings: { autoReview: true, autoAddress: false, dailyJobCap: 40 }, usedToday: 0, push: { vapidPublicKey: null, subscribed: false } });
const maya = me('1001', 'maya');
const leo = me('1002', 'leo');
const PATH = '/c/acme/shop-api/142';
const points = [point({ number: 1 }), point({ number: 2, title: 'Rename cursor to after' })];

/** The chat as `who` reads it, with `draft` waiting, its "waits as drafts" line, and a note after it. */
function serve(who: WebMe, draft: DraftView, view: Partial<ChatView> = {}, routes: Record<string, () => Answer | Promise<Answer>> = {}) {
  const items: TimelineItem[] = [
    item(4, { body: 'Pull request opened by maya' }),
    item(5, { body: `${draft.owner}'s agent finished; its work waits as drafts`, data: { jobId: draft.jobId } }),
    item(6, { kind: 'human', author: { githubId: '1002', login: 'leo' }, body: 'Looking now' }),
  ];
  const mine = draft.owner === who.login;
  const base = chatView();
  return fakeApi({
    'GET /api/me': (): Answer => [200, who],
    'GET /api/inbox': (): Answer => [200, { rows: [] }],
    'GET /api/chats/acme/shop-api/142': (): Answer => [
      200,
      chatResponse({
        items,
        view: {
          points,
          drafts: [draft],
          viewer: { role: who.login === 'maya' ? 'author' : 'reviewer', attention: mine ? 'drafts' : 'none', failure: null },
          permissions: { ...base.permissions, auto: [who.login === 'maya' ? 'author' : 'reviewer'], drafts: mine ? [draft.jobId] : [] },
          ...view,
        },
      }),
    ],
    ...routes,
  });
}

const card = (name: RegExp | string) => screen.findByRole('region', { name });

afterEach(() => vi.unstubAllGlobals());

describe('DraftCard: an author draft', () => {
  it("shows maya's drafted fixes where her agent finished: each reply with its outcome, and the diff", async () => {
    serve(maya, authorDraft());
    renderApp(PATH);
    const draft = await card('Draft: Your agent wants to push fixes for P1 and reply on P2');
    // In the feed right after the line that says it's waiting, before what came later.
    const feed = [...document.querySelector('[aria-label="Timeline"] ol')!.children];
    const at = feed.findIndex((li) => li.contains(draft));
    expect(feed[at - 1]).toHaveTextContent('waits as drafts');
    expect(feed[at + 1]).toHaveTextContent('Looking now');
    const inside = within(draft);
    expect(inside.getByText('Not pushed')).toBeInTheDocument();
    expect(inside.getByText('Fixed the empty cursor, answered the naming point.')).toBeInTheDocument();
    const replies = inside.getAllByRole('listitem').filter((li) => li.dataset.reply !== undefined);
    expect(replies[0]).toHaveTextContent('P1parseCursor throws on an empty cursorFixed');
    expect(replies[0]).toHaveTextContent('Return null for empty cursors.');
    expect(replies[1]).toHaveTextContent('P2Rename cursor to afterAnswered');
    expect(inside.getByRole('button', { name: 'src/orders/cursor.ts, 1 added, 1 removed' })).toHaveAttribute('aria-expanded', 'true');
    expect(inside.getByText("if (raw === '') return null;")).toBeInTheDocument();
  });

  it("shows the file list and the git show command when the diff was too big to send, and only the owner gets the command", async () => {
    const big = authorDraft();
    big.result.draft = { ...big.result.draft!, diff: null };
    serve(maya, big);
    renderApp(PATH);
    const inside = within(await card(/^Draft: /));
    expect(inside.getByText('src/orders/cursor.ts')).toBeInTheDocument();
    expect(inside.getByText('test/cursor.test.ts')).toBeInTheDocument();
    expect(inside.getByRole('button', { name: 'Copy git show refs/nitpilot/drafts/job_9' })).toBeInTheDocument();
    expect(inside.queryByRole('button', { name: /added/ })).not.toBeInTheDocument();
  });

  it("shows leo maya's draft without buttons, and no command for a commit that is only on her computer", async () => {
    const big = authorDraft();
    big.result.draft = { ...big.result.draft!, diff: null };
    serve(leo, big);
    renderApp(PATH);
    const inside = within(await card("Draft: maya's agent wants to push fixes for P1 and reply on P2"));
    expect(inside.queryAllByRole('button')).toEqual([]);
    expect(inside.getByText("The whole diff is on maya's computer.")).toBeInTheDocument();
  });

  it('sends it: the server queues the push, and the card says Sending… once chat.state does', async () => {
    let answer: (a: Answer) => void = () => {};
    const fetch = serve(maya, authorDraft(), {}, { 'POST /api/chats/chat_142/drafts/job_9/send': () => new Promise<Answer>((resolve) => (answer = resolve)) });
    const { sockets } = renderApp(PATH);
    const inside = within(await card(/^Draft: /));
    act(() => sockets.last().open());
    await userEvent.click(inside.getByRole('button', { name: 'Send' }));
    // A second press while the first is on its way sends nothing (Review Focus 3); Discard waits too.
    await userEvent.click(inside.getByRole('button', { name: 'Sending…' }));
    expect(inside.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    expect(inside.getByRole('button', { name: 'Discard' })).toBeDisabled();
    answer([200, { ok: true }]);
    expect(await screen.findByText("Sending your agent's fixes.")).toBeInTheDocument();
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/drafts/job_9/send'))).toHaveLength(1);
    // The publish job is queued: the card says so while it runs, and Send waits.
    act(() => sockets.last().receive({ v: 1, t: 'chat.state', d: { chatId: 'chat_142', view: chatView({ points, drafts: [authorDraft({ sending: true })], permissions: { ...chatView().permissions, drafts: ['job_9'] }, lastSeq: 6 }) } }));
    expect(await inside.findByText('Sending…', { selector: '[data-state]' })).toBeInTheDocument();
    expect(inside.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    // Pushed (or out of date): the server takes the draft out of the chat, and the card goes.
    act(() => sockets.last().receive({ v: 1, t: 'chat.state', d: { chatId: 'chat_142', view: chatView({ points, drafts: [], lastSeq: 6 }) } }));
    await waitFor(() => expect(screen.queryByRole('region', { name: /^Draft: / })).not.toBeInTheDocument());
  });

  it('keeps Send and Discard disabled when the card goes and comes back while the request is still on its way', async () => {
    const fetch = serve(maya, authorDraft(), {}, { 'POST /api/chats/chat_142/drafts/job_9/send': () => new Promise<Answer>(() => {}) });
    const { sockets } = renderApp(PATH);
    const first = within(await card(/^Draft: /));
    act(() => sockets.last().open());
    await userEvent.click(first.getByRole('button', { name: 'Send' }));
    // The card leaves the chat (unmounts), then the same draft is shown again (a new card), with the request still open.
    const mayaDrafts = { ...chatView().permissions, drafts: ['job_9'] };
    act(() => sockets.last().receive({ v: 1, t: 'chat.state', d: { chatId: 'chat_142', view: chatView({ points, drafts: [], lastSeq: 6 }) } }));
    await waitFor(() => expect(screen.queryByRole('region', { name: /^Draft: / })).not.toBeInTheDocument());
    act(() => sockets.last().receive({ v: 1, t: 'chat.state', d: { chatId: 'chat_142', view: chatView({ points, drafts: [authorDraft()], permissions: mayaDrafts, lastSeq: 6 }) } }));
    const again = within(await card(/^Draft: /));
    expect(again.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    expect(again.getByRole('button', { name: 'Discard' })).toBeDisabled();
    await userEvent.click(again.getByRole('button', { name: 'Discard' }));
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/discard'))).toHaveLength(0);
  });

  it('lets the owner Discard while the push is running, but not Send again', async () => {
    serve(maya, authorDraft({ sending: true }));
    renderApp(PATH);
    const inside = within(await card(/^Draft: /));
    expect(inside.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    expect(inside.getByRole('button', { name: 'Discard' })).toBeEnabled();
  });

  it("discards it, and shows the server's words when it refuses", async () => {
    serve(maya, authorDraft(), {}, {
      'POST /api/chats/chat_142/drafts/job_9/discard': (): Answer => [200, { ok: true }],
      'POST /api/chats/chat_142/drafts/job_9/send': (): Answer => [409, { error: { code: 'conflict', message: 'That draft was already discarded.' } }],
    });
    renderApp(PATH);
    const inside = within(await card(/^Draft: /));
    await userEvent.click(inside.getByRole('button', { name: 'Discard' }));
    expect(await screen.findByText('Discarded. The points are yours to handle by hand.')).toBeInTheDocument();
    await userEvent.click(inside.getByRole('button', { name: 'Send' }));
    expect((await screen.findByText('That draft was already discarded.')).closest('[data-error]')).not.toBeNull();
  });

  it("says what Send does for a draft that only replies (no commit): it's sent at once", async () => {
    const replies = authorDraft();
    replies.result.draft = null;
    serve(maya, replies, {}, { 'POST /api/chats/chat_142/drafts/job_9/send': (): Answer => [200, { ok: true }] });
    renderApp(PATH);
    const inside = within(await card('Draft: Your agent wants to reply on P1 and P2'));
    expect(inside.getByText('Not sent')).toBeInTheDocument();
    await userEvent.click(inside.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText("Sent. Your agent's replies are on their way to GitHub.")).toBeInTheDocument();
  });
});

describe('DraftCard: a reviewer draft', () => {
  it("shows leo's drafted points as point cards marked Draft, with the summary, and his buttons", async () => {
    serve(leo, reviewerDraft(), { viewer: { role: 'reviewer', attention: 'drafts', failure: null } }, { 'POST /api/chats/chat_142/drafts/job_8/send': (): Answer => [200, { ok: true }] });
    renderApp(PATH);
    const inside = within(await card('Draft: Your agent wants to raise 2 points'));
    expect(inside.getByText('Two points: the retry delay and a magic number.')).toBeInTheDocument();
    const first = inside.getByRole('article', { name: 'Draft, Major bug point: Retry delay ignores Retry-After' });
    expect(within(first).getByText('Draft')).toBeInTheDocument();
    expect(within(first).getByRole('link', { name: 'src/retry.ts:31' })).toHaveAttribute('href', 'https://github.com/acme/shop-api/blob/abc1234def/src/retry.ts#L31');
    expect(inside.getByRole('article', { name: 'Draft, Nit style point: Magic number 5 for max attempts' })).toBeInTheDocument();
    await userEvent.click(inside.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText("Sent. Your agent's review is on its way to GitHub.")).toBeInTheDocument();
  });

  it("shows a re-review's decisions on the points it settles", async () => {
    const reReview = reviewerDraft({
      jobType: 're_review',
      result: { ...reviewerDraft().result, points: [], summary: 'P1 is fixed; P2 is not.', decisions: [{ point: 1, decision: 'resolve', comment: 'Fixed.' }, { point: 2, decision: 'keep_open', comment: 'Still named cursor.' }] },
    });
    serve(leo, reReview);
    renderApp(PATH);
    const inside = within(await card('Draft: Your agent wants to settle P1 and P2'));
    const rows = inside.getAllByRole('listitem').filter((li) => li.dataset.reply !== undefined);
    expect(rows[0]).toHaveTextContent('P1parseCursor throws on an empty cursorResolve');
    expect(rows[1]).toHaveTextContent('P2Rename cursor to afterKeep open');
    expect(rows[1]).toHaveTextContent('Still named cursor.');
  });

  it("shows maya leo's draft with no buttons", async () => {
    serve(maya, reviewerDraft());
    renderApp(PATH);
    const inside = within(await card("Draft: leo's agent wants to raise 2 points"));
    expect(inside.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    expect(inside.queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument();
  });

  it("shows a draft whose line is on an older page at the end of the feed, so it's never lost", async () => {
    const draft = reviewerDraft();
    fakeApi({
      'GET /api/me': (): Answer => [200, leo],
      'GET /api/inbox': (): Answer => [200, { rows: [] }],
      'GET /api/chats/acme/shop-api/142': (): Answer => [200, chatResponse({ items: [item(40, { kind: 'human', body: 'hi' })], hasOlder: true, view: { drafts: [draft], permissions: { ...chatView().permissions, drafts: ['job_8'] } } })],
    });
    renderApp(PATH);
    expect(await card(/^Draft: /)).toBeInTheDocument();
  });
});
