import { z } from 'zod';
import { Category } from './enums';

/**
 * `.nitpilot.yml`, always read from the repo's default branch (spec §13).
 * `strictObject` rejects unknown keys, so a typo like `max_round` becomes a visible
 * error instead of being silently ignored.
 */
export const TeamRulesSchema = z.strictObject({
  version: z.literal(1).default(1),
  max_rounds: z.number().int().min(1).max(10).default(3),
  always_escalate: z.array(Category).default(['security']),
  auto: z
    .strictObject({
      review: z.boolean().default(true),
      address: z.boolean().default(true),
    })
    .default({ review: true, address: true }),
  ignore_paths: z.array(z.string().min(1)).default(['**/*.lock', 'dist/**']),
  trusted_bots: z.array(z.string().min(1)).default(['coderabbitai[bot]']),
  debounce_seconds: z.number().int().min(0).max(600).default(30),
  max_points_per_review: z.number().int().min(1).max(20).default(20),
});
export type TeamRules = z.infer<typeof TeamRulesSchema>;

/** The rules a repo gets when it has no `.nitpilot.yml`, or an invalid one. */
export const DEFAULT_RULES: TeamRules = TeamRulesSchema.parse({});
