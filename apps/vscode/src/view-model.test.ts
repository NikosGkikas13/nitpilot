import type { MyChat } from '@nitpilot/protocol';
import { describe, expect, it } from 'vitest';
import type { Poll } from './poll';
import { needYouCount, nextLastGood, retryMessage, statusBar, tree, type LastGood } from './view-model';

const SERVER = 'https://np.test';

const chat = (over: Partial<MyChat> = {}): MyChat => ({
  id: 'chat_1',
  repo: 'acme/shop-api',
  number: 142,
  title: 'Cursor pagination for orders',
  role: 'reviewer',
  phase: 'reviewing',
  round: 1,
  attention: 'none',
  url: 'https://np.test/c/acme/shop-api/142',
  updatedAt: '2026-10-10T08:00:00.000Z',
  ...over,
});

/** Two that need you (decision, failed) between two that don't, in the server's order. */
const four = [
  chat({ id: 'a', number: 1 }),
  chat({ id: 'b', number: 2, attention: 'decision' }),
  chat({ id: 'c', number: 3, attention: 'failed' }),
  chat({ id: 'd', number: 4 }),
];
const ok = (chats: MyChat[]): Poll => ({ state: 'ok', server: SERVER, chats });
const at1402 = new Date(2026, 9, 30, 14, 2);
const lastGood: LastGood = { server: SERVER, chats: four, at: at1402 };

describe('needYouCount', () => {
  it('counts every chat whose attention is not none, like `nitpilot status --line`', () => {
    expect(needYouCount(four)).toBe(2);
  });
});

describe('statusBar', () => {
  it('shows how many need you, on the warning background', () => {
    expect(statusBar(ok([...four, chat({ id: 'e' })]))).toEqual({
      text: '$(bell-dot) 2 need you',
      tooltip: '2 PRs need you · 5 open on np.test',
      warning: true,
      command: 'nitpilot.showPrs',
    });
  });

  it('says "needs" for one', () => {
    expect(statusBar(ok([chat({ attention: 'drafts' })])).text).toBe('$(bell-dot) 1 needs you');
  });

  it('shows the open count when nothing needs you', () => {
    const chats = [chat(), chat({ id: 'b' }), chat({ id: 'c' }), chat({ id: 'd' }), chat({ id: 'e' })];
    expect(statusBar(ok(chats))).toMatchObject({ text: '$(check) 5 open', warning: false, command: 'nitpilot.showPrs' });
  });

  it('shows just the name with no open PRs', () => {
    expect(statusBar(ok([]))).toMatchObject({ text: '$(check) Nitpilot', warning: false });
  });

  it('asks you to log in when logged out, and logs in on click', () => {
    expect(statusBar({ state: 'logged_out', server: SERVER })).toMatchObject({ text: '$(account) Nitpilot: log in', warning: false, command: 'nitpilot.login' });
  });

  it("shows the offline icon with the error as tooltip when the server can't be reached", () => {
    expect(statusBar({ state: 'unreachable', server: SERVER, message: "Can't reach https://np.test: fetch failed" })).toEqual({
      text: '$(cloud-offline) Nitpilot',
      tooltip: "Can't reach https://np.test: fetch failed",
      warning: false,
      command: 'nitpilot.showPrs',
    });
  });

  it('asks you to sign in again when GitHub sign-in expired, and opens the server on click', () => {
    expect(statusBar({ state: 'needs_reauth', server: SERVER, chats: null })).toMatchObject({
      text: '$(warning) Nitpilot: sign in again',
      warning: true,
      command: 'nitpilot.openServer',
    });
  });

  it('shows a plain warning with the message for anything else', () => {
    expect(statusBar({ state: 'error', server: null, message: 'config.json is not valid JSON' })).toMatchObject({
      text: '$(warning) Nitpilot',
      tooltip: 'config.json is not valid JSON',
      warning: false,
    });
  });
});

describe('tree', () => {
  it('groups Needs you first, then Open, keeping the server order', () => {
    const { groups, reauthRow, message } = tree(ok(four), null);
    expect(groups.map((g) => [g.id, g.label, g.rows.map((r) => r.chat.id)])).toEqual([
      ['needs', 'Needs you (2)', ['b', 'c']],
      ['open', 'Open (2)', ['a', 'd']],
    ]);
    expect(reauthRow).toBe(false);
    expect(message).toBeUndefined();
  });

  it('leaves out an empty group', () => {
    expect(tree(ok([chat()]), null).groups.map((g) => g.id)).toEqual(['open']);
  });

  it('makes a row with the NEEDS words, icon, menu and GitHub link', () => {
    const failed = chat({ repo: 'acme/web', number: 88, title: 'Add dark mode', attention: 'failed', phase: 'reviewing', round: 2, role: 'author' });
    const row = tree(ok([failed]), null).groups[0]!.rows[0]!;
    expect(row).toMatchObject({
      label: 'acme/web#88',
      description: 'Add dark mode · agent failed',
      icon: 'error',
      contextValue: 'chat.failed',
      githubUrl: 'https://github.com/acme/web/pull/88',
    });
    expect(row.tooltip).toContain('Add dark mode');
    expect(row.tooltip).toContain('author');
    expect(row.tooltip).toContain('reviewing');
    expect(row.tooltip).toContain('round 2');
  });

  it.each([
    ['decision', 'question', 'a decision'],
    ['manual_review', 'eye', 'start review'],
    ['drafts', 'edit', 'drafts'],
  ] as const)('marks %s with the %s icon and "%s"', (attention, icon, words) => {
    const row = tree(ok([chat({ attention })]), null).groups[0]!.rows[0]!;
    expect(row).toMatchObject({ icon, description: `Cursor pagination for orders · ${words}`, contextValue: 'chat' });
  });

  it('describes an Open row by phase and round', () => {
    const row = tree(ok([chat({ phase: 'addressing', round: 3 })]), null).groups[0]!.rows[0]!;
    expect(row).toMatchObject({ icon: 'git-pull-request', description: 'Cursor pagination for orders · addressing · round 3' });
  });

  it('keeps the last good list, marked stale, while the server is unreachable', () => {
    const model = tree({ state: 'unreachable', server: SERVER, message: "Can't reach" }, lastGood);
    expect(model.groups.map((g) => g.rows.length)).toEqual([2, 2]);
    expect(model.message).toContain(`as of ${at1402.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
  });

  it('shows no list once you are logged out, even with an old one', () => {
    expect(tree({ state: 'logged_out', server: SERVER }, lastGood)).toMatchObject({ groups: [], reauthRow: false });
  });

  it("never shows another server's list as stale data", () => {
    expect(tree({ state: 'unreachable', server: 'https://other.test', message: "Can't reach" }, lastGood).groups).toEqual([]);
  });

  it('leaves an expired GitHub sign-in with no list to the welcome view', () => {
    expect(tree({ state: 'needs_reauth', server: SERVER, chats: null }, null)).toMatchObject({ reauthRow: false, groups: [] });
  });

  it('shows the sign-in-again row above the list when there is one', () => {
    const model = tree({ state: 'needs_reauth', server: SERVER, chats: four }, null);
    expect(model.reauthRow).toBe(true);
    expect(model.groups.map((g) => g.id)).toEqual(['needs', 'open']);
  });

  it('shows the last good list, stale, under the sign-in-again row when the chats call failed', () => {
    const model = tree({ state: 'needs_reauth', server: SERVER, chats: null }, lastGood);
    expect(model.reauthRow).toBe(true);
    expect(model.groups).toHaveLength(2);
    expect(model.message).toContain('as of');
  });

  it("shows the error's message and no list", () => {
    expect(tree({ state: 'error', server: SERVER, message: 'Unknown setting "foo"' }, lastGood)).toEqual({
      reauthRow: false,
      groups: [],
      message: 'Unknown setting "foo"',
    });
  });
});

describe('nextLastGood', () => {
  const later = new Date(2026, 9, 30, 15, 0);

  it('replaces it with every fresh list', () => {
    expect(nextLastGood(ok([chat()]), lastGood, later)).toEqual({ server: SERVER, chats: [chat()], at: later });
    expect(nextLastGood({ state: 'needs_reauth', server: SERVER, chats: [chat()] }, lastGood, later)).toEqual({ server: SERVER, chats: [chat()], at: later });
  });

  it('keeps the previous one through a blip or a list-less reauth', () => {
    expect(nextLastGood({ state: 'unreachable', server: SERVER, message: 'x' }, lastGood, later)).toBe(lastGood);
    expect(nextLastGood({ state: 'needs_reauth', server: SERVER, chats: null }, lastGood, later)).toBe(lastGood);
  });

  it('forgets it when logged out or broken', () => {
    expect(nextLastGood({ state: 'logged_out', server: SERVER }, lastGood, later)).toBeNull();
    expect(nextLastGood({ state: 'error', server: null, message: 'x' }, lastGood, later)).toBeNull();
  });
});

describe('retryMessage', () => {
  it('says what the retry did, in the CLI\'s words', () => {
    const pr = { repo: 'acme/web', number: 88 };
    expect(retryMessage(pr, 'queued')).toBe('Queued your agent again on acme/web#88.');
    expect(retryMessage(pr, 'waiting')).toBe("Cleared the failure on acme/web#88. Your agent runs again once the PR's current step is done.");
  });
});
