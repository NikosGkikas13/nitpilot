import { describe, expect, it } from 'vitest';
import { parseGithubRemote } from './remotes';

describe('parseGithubRemote', () => {
  it.each([
    ['https://github.com/octo/sandbox.git', 'octo/sandbox'],
    ['https://github.com/octo/sandbox', 'octo/sandbox'],
    ['https://github.com/octo/sandbox/', 'octo/sandbox'],
    ['https://maya:secret@github.com/octo/sandbox.git', 'octo/sandbox'],
    ['git@github.com:octo/sandbox.git', 'octo/sandbox'],
    ['git@github.com:octo-org/my.repo.git', 'octo-org/my.repo'],
    ['ssh://git@github.com/octo/sandbox.git', 'octo/sandbox'],
    ['ssh://git@github.com:22/octo/sandbox.git', 'octo/sandbox'],
    // An SSH host alias from ~/.ssh/config, used to run two GitHub accounts on one machine (spec §17).
    ['git@github-a:octo/sandbox.git', 'octo/sandbox'],
    ['git@github.com-work:octo/sandbox.git', 'octo/sandbox'],
    ['ssh://git@github.com-work/octo/sandbox.git', 'octo/sandbox'],
    ['git@github.com.example.org:octo/sandbox.git', null],
    ['git@gitlab.com:octo/sandbox.git', null],
    ['https://gitlab.com/octo/sandbox.git', null],
    ['https://localhost/octo/sandbox', null],
    ['/srv/git/sandbox.git', null],
    ['https://github.com/octo', null],
  ])('%s → %s', (url, expected) => {
    expect(parseGithubRemote(url)).toBe(expected);
  });
});
