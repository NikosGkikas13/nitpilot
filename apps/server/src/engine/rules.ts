import { BRAND, DEFAULT_RULES, TeamRulesSchema, type TeamRules } from '@nitpilot/protocol';
import { parse as parseYaml } from 'yaml';

export type ParsedRules = { rules: TeamRules; error: string | null };

/**
 * Turn the text of `.nitpilot.yml` (null when the file is missing) into team rules.
 * Never throws: on any problem the defaults apply and `error` explains why (spec §13).
 */
export function parseTeamRules(text: string | null): ParsedRules {
  if (text === null) return { rules: DEFAULT_RULES, error: null };

  let data: unknown;
  try {
    data = parseYaml(text) ?? {};
  } catch (err) {
    return { rules: DEFAULT_RULES, error: `${BRAND.teamConfigFile} is not valid YAML: ${(err as Error).message}` };
  }

  const parsed = TeamRulesSchema.safeParse(data);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.') || '(file)'}: ${i.message}`).join('; ');
    return { rules: DEFAULT_RULES, error: `${BRAND.teamConfigFile}: ${problems}` };
  }
  return { rules: parsed.data, error: null };
}
