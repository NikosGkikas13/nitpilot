import type { NormalizedEvent, RepoInfo } from '../../types';
import type { GhInstallationEvent, GhInstallationReposEvent, GhRepo, GhRepositoryEvent } from '../payloads';

export function toRepoInfo(r: GhRepo): RepoInfo {
  // Installation payloads leave out default_branch. We never need it to read files:
  // GitHub's contents API reads the default branch when no ref is given.
  return { id: String(r.id), fullName: r.full_name, private: r.private, defaultBranch: r.default_branch ?? 'main' };
}

const INSTALLATION_ACTIONS = ['created', 'deleted', 'suspend', 'unsuspend'] as const;
const REPO_ACTIONS = ['privatized', 'publicized', 'deleted', 'renamed'] as const;

export function normalizeInstallation(p: GhInstallationEvent): NormalizedEvent[] {
  const action = INSTALLATION_ACTIONS.find((a) => a === p.action);
  if (!action) return [];
  return [{ scope: 'installation', action, installationId: String(p.installation.id), accountLogin: p.installation.account.login, repos: (p.repositories ?? []).map(toRepoInfo) }];
}

export function normalizeInstallationRepos(p: GhInstallationReposEvent): NormalizedEvent[] {
  return [
    {
      scope: 'installation_repos',
      installationId: String(p.installation.id),
      accountLogin: p.installation.account.login,
      added: p.repositories_added.map(toRepoInfo),
      removed: p.repositories_removed.map((r) => String(r.id)),
    },
  ];
}

export function normalizeRepository(p: GhRepositoryEvent): NormalizedEvent[] {
  const action = REPO_ACTIONS.find((a) => a === p.action);
  if (!action) return [];
  return [{ scope: 'repo', action, installationId: String(p.installation.id), repo: toRepoInfo(p.repository) }];
}
