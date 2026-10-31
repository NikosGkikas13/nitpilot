import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, TeamRulesSchema } from './rules';

describe('TeamRulesSchema', () => {
  it('fills in the spec defaults when the file is empty', () => {
    expect(DEFAULT_RULES).toEqual({
      version: 1,
      max_rounds: 3,
      always_escalate: ['security'],
      auto: { review: true, address: true },
      ignore_paths: ['**/*.lock', 'dist/**'],
      trusted_bots: ['coderabbitai[bot]'],
      debounce_seconds: 30,
      max_points_per_review: 20,
      public_chats: true,
      footer: true,
      trust_all_authors: false,
      guidelines: [],
    });
  });

  it('trims guidelines', () => {
    expect(TeamRulesSchema.parse({ guidelines: ['  Prefer early returns.  '] }).guidelines).toEqual(['Prefer early returns.']);
  });

  it('keeps defaults for the keys a team leaves out', () => {
    const rules = TeamRulesSchema.parse({ max_rounds: 5, auto: { address: false } });
    expect(rules.max_rounds).toBe(5);
    expect(rules.auto).toEqual({ review: true, address: false });
    expect(rules.always_escalate).toEqual(['security']);
  });

  it.each([
    [{ max_rounds: 0 }],
    [{ max_rounds: 11 }],
    [{ always_escalate: ['vibes'] }],
    [{ max_points_per_review: 21 }],
    [{ max_round: 3 }],
    [{ version: 2 }],
    [{ guidelines: Array.from({ length: 21 }, (_, i) => `Rule ${i}`) }],
    [{ guidelines: ['x'.repeat(301)] }],
    [{ guidelines: ['   '] }],
  ])('rejects %j', (input) => {
    expect(TeamRulesSchema.safeParse(input).success).toBe(false);
  });
});
