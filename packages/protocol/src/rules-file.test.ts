import { DEFAULT_RULES } from './rules';
import { describe, expect, it } from 'vitest';
import { parseTeamRules } from './rules-file';

describe('parseTeamRules', () => {
  it('uses the defaults when the file is missing', () => {
    expect(parseTeamRules(null)).toEqual({ rules: DEFAULT_RULES, error: null });
  });

  it('uses the defaults for an empty file', () => {
    expect(parseTeamRules('')).toEqual({ rules: DEFAULT_RULES, error: null });
  });

  it('reads a valid file', () => {
    const { rules, error } = parseTeamRules('version: 1\nmax_rounds: 5\nalways_escalate: [security, bug]\n');
    expect(error).toBeNull();
    expect(rules.max_rounds).toBe(5);
    expect(rules.always_escalate).toEqual(['security', 'bug']);
  });

  it('falls back to the defaults and explains invalid YAML', () => {
    const { rules, error } = parseTeamRules('max_rounds: [unclosed');
    expect(rules).toEqual(DEFAULT_RULES);
    expect(error).toMatch(/^\.nitpilot\.yml is not valid YAML/);
  });

  it('falls back to the defaults and names the bad key', () => {
    const { rules, error } = parseTeamRules('max_rounds: 99\n');
    expect(rules).toEqual(DEFAULT_RULES);
    expect(error).toMatch(/max_rounds/);
  });
});
