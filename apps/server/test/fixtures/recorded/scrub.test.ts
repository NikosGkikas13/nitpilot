import { describe, expect, it } from 'vitest';
import { buildFixture, deliveryFacts, findSecrets, fixtureFileName, scrubPayload } from './scrub';

describe('scrubPayload', () => {
  // A fresh object each time, so a scrub that changed its input can't hide behind an earlier test.
  const makePayload = () => ({
    action: 'opened',
    number: 2,
    pull_request: {
      id: 99,
      node_id: 'PR_kwDOabc',
      url: 'https://api.github.com/repos/o/r/pulls/2',
      html_url: 'https://github.com/o/r/pull/2',
      diff_url: 'https://github.com/o/r/pull/2.diff',
      title: 'Cursor pagination',
      user: { login: 'maya', id: 1001, type: 'User', node_id: 'U_1', gravatar_id: '', avatar_url: 'https://avatars.githubusercontent.com/u/1001?v=4' },
      requested_reviewers: [{ login: 'leo', id: 1002, repos_url: 'https://api.github.com/users/leo/repos' }],
      _links: { self: { href: 'https://api.github.com/repos/o/r/pulls/2' } },
    },
  });

  it('drops node ids, gravatar ids, _links and every link except html_url, at any depth', () => {
    expect(scrubPayload(makePayload())).toEqual({
      action: 'opened',
      number: 2,
      pull_request: {
        id: 99,
        html_url: 'https://github.com/o/r/pull/2',
        title: 'Cursor pagination',
        user: { login: 'maya', id: 1001, type: 'User' },
        requested_reviewers: [{ login: 'leo', id: 1002 }],
      },
    });
  });

  it('keeps what Nitpilot reads: ids, logins, shas, branch names and text', () => {
    const kept = { head: { sha: 'a'.repeat(40), ref: 'acc/happy' }, body: 'Replaces offset pagination. See https://example.com/doc', merged: false, line: null };
    expect(scrubPayload(kept)).toEqual(kept);
  });

  it('does not change what it was given', () => {
    const payload = makePayload();
    scrubPayload(payload);
    expect(payload).toEqual(makePayload());
  });

  it('is idempotent: scrubbing a scrubbed payload changes nothing', () => {
    const once = scrubPayload(makePayload());
    expect(scrubPayload(once)).toEqual(once);
  });
});

describe('findSecrets', () => {
  const samples: [string, string][] = [
    ['a GitHub token', `token ghs_${'a1B2'.repeat(9)}`],
    ['a fine-grained GitHub token', `github_pat_${'A1b2C3d4E5'.repeat(4)}`],
    ['a Nitpilot token', `nit_${'x9Y8z7'.repeat(5)}`],
    ['a private key', '-----BEGIN RSA PRIVATE KEY-----\nMIIE'],
    ['a signed JWT', `eyJ${'a'.repeat(20)}.${'b'.repeat(20)}.${'c'.repeat(20)}`],
    ['a bearer token', `Authorization: Bearer ${'k3y'.repeat(8)}`],
    ['a webhook signature', `sha256=${'0f'.repeat(32)}`],
  ];

  it.each(samples)('finds %s', (name, text) => {
    expect(findSecrets(text)).toContain(name);
  });

  it('finds an exact secret you hand it, such as the webhook secret', () => {
    expect(findSecrets('the secret is hunter2-hunter2', ['hunter2-hunter2'])).toEqual(['a secret you asked about']);
  });

  it('ignores an empty extra secret, which would match everything', () => {
    expect(findSecrets('ordinary text', [''])).toEqual([]);
  });

  it('finds nothing in an ordinary payload', () => {
    expect(findSecrets(JSON.stringify({ title: 'Add nit_pick helper', sha: 'a'.repeat(40), body: 'bearer of bad news' }))).toEqual([]);
  });
});

describe('buildFixture', () => {
  const row = { event: 'pull_request', action: 'opened', createdAt: new Date('2026-10-10T06:20:58.000Z'), body: JSON.stringify({ action: 'opened', pull_request: { node_id: 'x', title: 't' } }) };

  it('keeps the event, the action and the note, and scrubs the payload', () => {
    expect(buildFixture(row, 'PR opened with a reviewer')).toEqual({
      event: 'pull_request',
      action: 'opened',
      note: 'PR opened with a reviewer',
      recordedAt: '2026-10-10',
      payload: { action: 'opened', pull_request: { title: 't' } },
    });
  });

  it('refuses a payload that holds a secret, and does not repeat the secret in the error', () => {
    const leaky = { ...row, body: JSON.stringify({ body: `my token is ghs_${'a1B2'.repeat(9)}` }) };
    expect(() => buildFixture(leaky, '')).toThrow(/a GitHub token/);
    expect(() => buildFixture(leaky, '')).not.toThrow(/a1B2a1B2/);
  });
});

describe('fixtureFileName', () => {
  it('accepts dotted lowercase names', () => {
    expect(fixtureFileName('pull_request.review_requested.again')).toBe('pull_request.review_requested.again.json');
  });

  it.each(['../escape', 'a/b', 'Upper', '', '.hidden', 'x y'])('rejects %j', (name) => {
    expect(() => fixtureFileName(name)).toThrow(/name/);
  });
});

describe('deliveryFacts', () => {
  it('reads the PR number and the sender for the listing', () => {
    expect(deliveryFacts({ pull_request: { number: 2 }, sender: { login: 'maya' } })).toMatchObject({ pr: 2, sender: 'maya' });
    expect(deliveryFacts({ issue: { number: 7 }, sender: { login: 'leo' } })).toMatchObject({ pr: 7, sender: 'leo' });
    expect(deliveryFacts({ installation: { id: 1 } })).toEqual({ pr: null, sender: null, detail: '' });
  });

  it('adds a few words that tell two deliveries of the same kind apart', () => {
    const detail = (payload: object) => deliveryFacts(payload).detail;
    expect(detail({ requested_reviewer: { login: 'leo' } })).toBe('reviewer leo');
    expect(detail({ changes: { base: { ref: { from: 'main' } } } })).toBe('changed: base');
    expect(detail({ changes: { title: { from: 'old' }, body: { from: 'x' } } })).toBe('changed: title, body');
    expect(detail({ comment: { body: 'probe: first comment' } })).toBe('comment "probe: first comment"');
    expect(detail({ comment: { body: 'probe: a reply', in_reply_to_id: 5 } })).toBe('reply "probe: a reply"');
    expect(detail({ comment: { body: 'x'.repeat(60) } })).toBe(`comment "${'x'.repeat(30)}…"`);
    expect(detail({ review: { state: 'commented' } })).toBe('review commented');
    expect(detail({ action: 'synchronize', after: 'abcdef1234567890' })).toBe('head abcdef1');
  });
});
