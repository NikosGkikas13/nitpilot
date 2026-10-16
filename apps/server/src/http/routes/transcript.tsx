/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import type { RepoAccess } from '../../auth/repo-access';
import { currentUser } from '../../auth/session';
import { loadActivity, type LiveClis } from '../../chats/activity';
import { rulesFromJson } from '../../chats/rules';
import { prisma } from '../../lib/prisma';
import { renderPage } from '../pages/layout';
import { GithubUnavailable, SignInAgain, TranscriptNotFound, TranscriptPage } from '../pages/transcript';

/** GitHub owner and repo names: letters, digits, `-`, `_` and `.`. They go into a GitHub API path, so nothing else is let through. */
const isGithubName = (s: string) => /^[A-Za-z0-9_.-]+$/.test(s) && s !== '.' && s !== '..';

/**
 * The read-only chat transcript (spec §10), linked from the summary comment. Only for people signed in
 * to Nitpilot whose GitHub account can read the repo (spec §16 "Who can see a chat").
 */
export function transcriptRoutes(deps: { access: RepoAccess; clis: LiveClis }): Hono {
  const app = new Hono();
  const { access } = deps;

  app.get('/c/:owner/:repo/:number', async (c) => {
    const path = new URL(c.req.url).pathname;
    const user = await currentUser(c);
    if (!user) return c.redirect(`/auth/github/login?next=${encodeURIComponent(path)}`);

    // "No such chat" and "you can't see it" must look the same to everyone, including someone whose
    // GitHub sign-in expired (spec §10). So ask GitHub about the repo in the URL before looking for the chat.
    const owner = c.req.param('owner');
    const repo = c.req.param('repo');
    if (!isGithubName(owner) || !isGithubName(repo)) return renderPage(c, <TranscriptNotFound />, 404);
    const fullName = `${owner}/${repo}`;
    let allowed: Awaited<ReturnType<RepoAccess['check']>>;
    try {
      allowed = await access.check(user.id, fullName);
    } catch (err) {
      // GitHub is down, or rate limiting us: say so, rather than a bare 500.
      console.error('[transcript] could not check repo access:', err);
      return renderPage(c, <GithubUnavailable />, 502);
    }
    if (allowed === 'reauth') return renderPage(c, <SignInAgain next={path} />, 401);
    if (allowed === 'none') return renderPage(c, <TranscriptNotFound />, 404);

    const number = Number(c.req.param('number'));
    const chat = Number.isSafeInteger(number) ? await prisma.prChat.findFirst({ where: { number, repo: { fullName } }, include: { repo: true } }) : null;
    if (!chat) return renderPage(c, <TranscriptNotFound />, 404);

    const [messages, points, activity] = await Promise.all([
      prisma.message.findMany({ where: { chatId: chat.id }, orderBy: { seq: 'asc' } }),
      prisma.point.findMany({ where: { chatId: chat.id }, orderBy: { number: 'asc' } }),
      loadActivity(chat.id, deps.clis),
    ]);
    const maxRounds = rulesFromJson(chat.repo.rulesJson).max_rounds;
    return renderPage(c, <TranscriptPage chat={chat} maxRounds={maxRounds} activity={activity} messages={messages} points={points} />);
  });

  return app;
}
