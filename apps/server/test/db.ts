import type { Prisma } from '../src/generated/prisma/client';
import { prisma } from '../src/lib/prisma';
import { generateToken } from '../src/lib/tokens';

// Tests share one database, so every row they create uses values no other test uses.

let counter = 0;

export function uid(prefix = 'id'): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}-${Math.random().toString(36).slice(2, 7)}`;
}

let lastGhId = 0;

/**
 * A unique numeric id, like GitHub's. GitHub sends ids as JSON numbers, so this stays below
 * Number.MAX_SAFE_INTEGER: milliseconds × 1000 plus a random 0–999 (16 digits), and always
 * higher than the last one this file handed out.
 */
export function ghId(): string {
  lastGhId = Math.max(lastGhId + 1, Date.now() * 1000 + Math.floor(Math.random() * 1000));
  return String(lastGhId);
}

export async function makeUser(over: { login?: string; githubId?: string } = {}) {
  return prisma.user.create({ data: { githubId: over.githubId ?? ghId(), login: over.login ?? uid('user') } });
}

/** A CLI token for `userId`, as `nitpilot login` creates one. `raw` is what the CLI sends. */
export async function makeCliToken(userId: string, over: { revoked?: boolean } = {}) {
  const token = generateToken();
  const row = await prisma.cliToken.create({
    data: { userId, name: 'test laptop', tokenHash: token.hash, prefix: token.prefix, revokedAt: over.revoked ? new Date() : null },
  });
  return { id: row.id, raw: token.raw };
}

export async function makeRepo(over: { private?: boolean; rulesJson?: Prisma.InputJsonValue } = {}) {
  const installation = await prisma.installation.create({ data: { id: ghId(), accountLogin: uid('org') } });
  return prisma.repo.create({
    data: {
      id: ghId(),
      installationId: installation.id,
      fullName: `${installation.accountLogin}/${uid('repo')}`,
      private: over.private ?? false,
      defaultBranch: 'main',
      ...(over.rulesJson !== undefined ? { rulesJson: over.rulesJson } : {}),
    },
  });
}

let prNumber = 0;

export async function makeChat(repoId: string, over: { number?: number; authorGithubId?: string; headSha?: string; trusted?: boolean } = {}) {
  prNumber += 1;
  const number = over.number ?? prNumber;
  const repo = await prisma.repo.findUniqueOrThrow({ where: { id: repoId } });
  return prisma.prChat.create({
    data: {
      repoId,
      number,
      title: `PR ${number}`,
      url: `https://github.com/${repo.fullName}/pull/${number}`,
      authorGithubId: over.authorGithubId ?? ghId(),
      headSha: over.headSha ?? 'a'.repeat(40),
      baseSha: 'b'.repeat(40),
      baseRef: 'main',
      headRef: `feature-${number}`,
      headRepoFullName: repo.fullName,
      trusted: over.trusted ?? true,
    },
  });
}

/** Empty every table. Only for tests of sweeps over all rows (task runner, replay, purge). */
export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "Task", "RawEvent", "SeenComment", "GithubWrite", "Message", "Point", "Job", "Participant", "PrChat", "Repo", "Installation", "CliLoginRequest", "CliToken", "WebSession", "GithubAuth", "User" CASCADE',
  );
}
