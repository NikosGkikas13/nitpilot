import type { AgentJobBundle, PublishBundle } from './job-bundle';
import type { JobResult } from './job-result';
import type { Settings } from './web-api';

// Realistic sample values for tests in every workspace. Each call returns a fresh copy.

export function jobResult(): JobResult {
  return {
    summary: 'Found a crash on empty input and a missing test.',
    points: [
      {
        path: 'src/orders/list.ts',
        line: 48,
        side: 'RIGHT',
        severity: 'major',
        category: 'bug',
        title: '`parseOrder` crashes on empty input',
        body: 'When `items` is empty, `items[0].id` throws.',
        snippet: { startLine: 43, lines: ['export function parseOrder(items) {', '  return items[0].id;', '}'] },
      },
    ],
    decisions: [],
    replies: [],
    push: null,
    draft: null,
  };
}

export function jobBundle(): AgentJobBundle {
  return {
    jobId: 'job_1',
    attempt: 1,
    type: 'review',
    round: 1,
    maxRounds: 3,
    apply: 'auto',
    you: { login: 'leo', role: 'reviewer' },
    pr: {
      repoFullName: 'acme/shop-api',
      number: 142,
      title: 'Cursor pagination for orders',
      body: 'Replaces offset pagination.',
      url: 'https://github.com/acme/shop-api/pull/142',
      authorLogin: 'maya',
      baseRef: 'main',
      headRef: 'feature/cursor-pagination',
      baseSha: 'b'.repeat(40),
      headSha: 'a'.repeat(40),
    },
    git: {
      baseCloneUrl: 'https://github.com/acme/shop-api.git',
      fetchRef: 'refs/pull/142/head',
      headRepoPath: 'acme/shop-api',
      headBranch: 'feature/cursor-pagination',
    },
    sinceSha: null,
    points: [],
    notes: [],
    rules: { ignorePaths: ['**/*.lock'], alwaysEscalate: ['security'], maxPoints: 20 },
  };
}

/** A publish job: push the draft commit that address job `job_7` left on this laptop (spec §11 "Publish jobs"). */
export function publishBundle(): PublishBundle {
  return {
    jobId: 'job_9',
    attempt: 1,
    type: 'publish',
    pr: { repoFullName: 'acme/shop-api', number: 142, headRef: 'feature/cursor-pagination', url: 'https://github.com/acme/shop-api/pull/142' },
    git: {
      baseCloneUrl: 'https://github.com/acme/shop-api.git',
      fetchRef: 'refs/pull/142/head',
      headRepoPath: 'acme/shop-api',
      headBranch: 'feature/cursor-pagination',
    },
    draft: { jobId: 'job_7', sha: 'c'.repeat(40), from: 'a'.repeat(40) },
  };
}

/** A person's settings as they are by default (spec §8 `User`). */
export function settings(): Settings {
  return { autoReview: true, autoAddress: true, dailyJobCap: 40 };
}
