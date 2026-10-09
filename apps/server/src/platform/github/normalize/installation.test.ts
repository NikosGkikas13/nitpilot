import { describe, expect, it } from 'vitest';
import { installationEvent, installationReposEvent, repository, repositoryEvent } from '../../../../test/fixtures/github';
import { parseGithubWebhook } from './index';

const repo = { id: '501', fullName: 'octo/sandbox', private: false, defaultBranch: 'main' };

describe('installation events', () => {
  it('maps a new installation with its repos', async () => {
    expect(await parseGithubWebhook('installation', JSON.stringify(installationEvent('created')), async () => [])).toEqual([
      { scope: 'installation', action: 'created', installationId: '77', accountLogin: 'octo', repos: [repo] },
    ]);
  });

  it('maps repos added to and removed from an installation', async () => {
    const other = { ...repository, id: 502, full_name: 'octo/other' };
    expect(await parseGithubWebhook('installation_repositories', JSON.stringify(installationReposEvent([other], [repository])), async () => [])).toEqual([
      { scope: 'installation_repos', installationId: '77', accountLogin: 'octo', added: [{ id: '502', fullName: 'octo/other', private: false, defaultBranch: 'main' }], removed: ['501'] },
    ]);
  });

  it.each(['privatized', 'publicized', 'deleted', 'renamed'])('maps repository.%s', async (action) => {
    expect(await parseGithubWebhook('repository', JSON.stringify(repositoryEvent(action)), async () => [])).toEqual([{ scope: 'repo', action, installationId: '77', repo }]);
  });

  it('ignores other repository actions', async () => {
    expect(await parseGithubWebhook('repository', JSON.stringify(repositoryEvent('edited')), async () => [])).toEqual([]);
  });
});
