import type { PrChat, Repo } from '../generated/prisma/client';
import type { PrRef } from '../platform/types';

export function prRefOf(chat: PrChat & { repo: Repo }): PrRef {
  return { installationId: chat.repo.installationId, repoId: chat.repoId, repoFullName: chat.repo.fullName, number: chat.number };
}
