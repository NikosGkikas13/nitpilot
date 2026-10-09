import { getEnv } from '../lib/env';
import { prisma } from '../lib/prisma';
import type { AppAuth } from '../platform/github/app-auth';
import type { GithubClient } from '../platform/github/client';
import { toRepoInfo } from '../platform/github/normalize/installation';
import type { GhRepo } from '../platform/github/payloads';
import type { NormalizedEvent, RepoInfo } from '../platform/types';

type InstallationScoped = Exclude<NormalizedEvent, { scope: 'pr' }>;

/** Keep Installation and Repo rows in step with what GitHub tells us. */
export async function syncFromEvent(ne: InstallationScoped): Promise<void> {
  switch (ne.scope) {
    case 'installation': {
      if (ne.action === 'deleted') {
        // Cascades to repos, chats, jobs, tasks.
        await prisma.installation.deleteMany({ where: { id: ne.installationId } });
        return;
      }
      const suspendedAt = ne.action === 'suspend' ? new Date() : ne.action === 'unsuspend' ? null : undefined;
      await prisma.installation.upsert({
        where: { id: ne.installationId },
        create: { id: ne.installationId, accountLogin: ne.accountLogin },
        update: { accountLogin: ne.accountLogin, suspendedAt },
      });
      await upsertRepos(ne.installationId, ne.repos);
      return;
    }
    case 'installation_repos': {
      await prisma.installation.upsert({ where: { id: ne.installationId }, create: { id: ne.installationId, accountLogin: ne.accountLogin }, update: {} });
      await upsertRepos(ne.installationId, ne.added);
      await prisma.repo.deleteMany({ where: { installationId: ne.installationId, id: { in: ne.removed } } });
      return;
    }
    case 'repo': {
      if (ne.action === 'deleted') {
        await prisma.repo.deleteMany({ where: { id: ne.repo.id } });
        return;
      }
      if (ne.action === 'privatized' && getEnv().PUBLIC_REPOS_ONLY) {
        // The hosted instance keeps no data about private repos (spec §14.9).
        await prisma.prChat.deleteMany({ where: { repoId: ne.repo.id } });
      }
      await upsertRepos(ne.installationId, [ne.repo]);
      return;
    }
  }
}

async function upsertRepos(installationId: string, repos: RepoInfo[]): Promise<void> {
  for (const r of repos) {
    await prisma.repo.upsert({
      where: { id: r.id },
      create: { id: r.id, installationId, fullName: r.fullName, private: r.private, defaultBranch: r.defaultBranch },
      update: { installationId, fullName: r.fullName, private: r.private, defaultBranch: r.defaultBranch },
    });
  }
}

/** After someone installs the app, read the installation and its repos straight from the API. */
export async function syncInstallationFromApi(installationId: string, github: GithubClient, appAuth: AppAuth): Promise<void> {
  const { data: inst } = await github.api<{ id: number; account: { login: string } }>('GET', `/app/installations/${installationId}`, { token: appAuth.jwt() });
  const token = await appAuth.installationToken(installationId);
  const { data } = await github.api<{ repositories: GhRepo[] }>('GET', '/installation/repositories?per_page=100', { token });
  await syncFromEvent({ scope: 'installation', action: 'created', installationId, accountLogin: inst.account.login, repos: data.repositories.map(toRepoInfo) });
}
