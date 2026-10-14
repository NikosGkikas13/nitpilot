/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { RepoAccess } from '../../auth/repo-access';
import { currentUser } from '../../auth/session';
import { loadActivity, type LiveClis } from '../../chats/activity';
import { rulesFromJson } from '../../chats/rules';
import { prisma } from '../../lib/prisma';
import type { GithubClient } from '../../platform/github/client';
import { renderPage } from '../pages/layout';
import { SignInAgain, TranscriptNotFound, TranscriptPage } from '../pages/transcript';

/**
 * The read-only chat transcript (spec §10), linked from the summary comment. Only for people signed in
 * to Nitpilot whose GitHub account can read the repo (spec §16 "Who can see a chat").
 */
export function transcriptRoutes(deps: { github: GithubClient; clis: LiveClis }): Hono {
  const app = new Hono();
  const access = new RepoAccess(deps.github);

  app.get('/c/:owner/:repo/:number', async (c) => {
    const path = new URL(c.req.url).pathname;
    const user = await currentUser(c);
    if (!user) return c.redirect(`/auth/github/login?next=${encodeURIComponent(path)}`);

    const number = Number(c.req.param('number'));
    const fullName = `${c.req.param('owner')}/${c.req.param('repo')}`;
    const chat = Number.isSafeInteger(number) ? await prisma.prChat.findFirst({ where: { number, repo: { fullName } }, include: { repo: true } }) : null;
    if (!chat) return renderPage(c, <TranscriptNotFound />, 404);
    const allowed = await access.check(user.id, chat.repo.fullName);
    if (allowed === 'reauth') return renderPage(c, <SignInAgain next={path} />, 401);
    if (allowed === 'none') return renderPage(c, <TranscriptNotFound />, 404);

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
