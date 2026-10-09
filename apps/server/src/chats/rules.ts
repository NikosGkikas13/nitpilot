import { BRAND, DEFAULT_RULES, TeamRulesSchema, type TeamRules } from '@nitpilot/protocol';
import { parseTeamRules } from '../engine/rules';
import { Prisma, type Repo } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import type { PlatformReads, RepoRef } from '../platform/types';

export function repoRef(repo: Pick<Repo, 'id' | 'installationId' | 'fullName'>): RepoRef {
  return { installationId: repo.installationId, repoId: repo.id, repoFullName: repo.fullName };
}

/** The rules stored on a repo; anything missing or broken means the defaults. */
export function rulesFromJson(json: unknown): TeamRules {
  const parsed = TeamRulesSchema.safeParse(json ?? {});
  return parsed.success ? parsed.data : DEFAULT_RULES;
}

/**
 * Re-read `.nitpilot.yml` from the default branch when a round may start (spec §13). The ETag
 * makes an unchanged file cost nothing. GitHub trouble keeps the rules we already have.
 */
export async function ensureFreshRules(repo: Repo, platform: PlatformReads): Promise<Repo> {
  let file: Awaited<ReturnType<PlatformReads['readDefaultBranchFile']>>;
  try {
    file = await platform.readDefaultBranchFile(repoRef(repo), BRAND.teamConfigFile, repo.rulesEtag ?? undefined);
  } catch (err) {
    console.warn(`[rules] could not read ${BRAND.teamConfigFile} for ${repo.fullName}; keeping the cached rules`, err);
    return repo;
  }
  if (file === 'not_modified') return repo;
  if (file === null) {
    return prisma.repo.update({ where: { id: repo.id }, data: { rulesJson: Prisma.DbNull, rulesEtag: null, rulesError: null } });
  }
  const { rules, error } = parseTeamRules(file.text);
  return prisma.repo.update({
    where: { id: repo.id },
    data: { rulesJson: error ? Prisma.DbNull : rules, rulesEtag: file.etag, rulesError: error },
  });
}
