import { DEFAULT_RULES } from '@nitpilot/protocol';
import { describe, expect, it } from 'vitest';
import { fakeAgentOnly } from './jobs';

describe('fakeAgentOnly', () => {
  const trustAll = { ...DEFAULT_RULES, trust_all_authors: true };

  it("holds an outside contributor's review for the fake agent when the team trusts all authors", () => {
    expect(fakeAgentOnly('review', false, trustAll)).toBe(true);
    expect(fakeAgentOnly('re_review', false, trustAll)).toBe(true);
  });

  it('leaves trusted PRs, author-side jobs and teams without the rule alone', () => {
    expect(fakeAgentOnly('review', true, trustAll)).toBe(false);
    expect(fakeAgentOnly('address', false, trustAll)).toBe(false);
    expect(fakeAgentOnly('publish', false, trustAll)).toBe(false);
    expect(fakeAgentOnly('review', false, DEFAULT_RULES)).toBe(false);
  });
});
