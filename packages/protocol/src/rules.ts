import { z } from 'zod';
import { Category } from './enums';

/**
 * `.nitpilot.yml`, always read from the repo's default branch (spec §13).
 * `strictObject` rejects unknown keys, so a typo like `max_round` becomes a visible
 * error instead of being silently ignored.
 */
/** One `.nitpilot.yml` guideline, and how many a repo may have. `nitpilot rules suggest` checks its proposals against these too. */
export const Guideline = z.string().trim().min(1).max(300);
export const MAX_GUIDELINES = 20;

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
  /** A public repo's chats can be read without signing in, trimmed (spec §16 "Who can see a chat"). False turns that off. */
  public_chats: z.boolean().default(true),
  /** The summary comment ends with who reviewed and a link to get your own (spec §15). False removes that line. */
  footer: z.boolean().default(true),
  /**
   * Jobs start on their own for every PR author, not only trusted ones (spec §14 "Trust all authors"). Meant for the
   * public playground: a review job this starts for an outside contributor may only run on the fake agent.
   */
  trust_all_authors: z.boolean().default(false),
  /**
   * The team's own review notes, in plain words, given to every agent that reviews or fixes a PR here (spec §13).
   * Not wrapped as untrusted: like `CLAUDE.md`, they come from the default branch, so only people who can push
   * there can change them, never a PR's author.
   */
  guidelines: z.array(Guideline).max(MAX_GUIDELINES).default([]),
});
export type TeamRules = z.infer<typeof TeamRulesSchema>;

/** The rules a repo gets when it has no `.nitpilot.yml`, or an invalid one. */
export const DEFAULT_RULES: TeamRules = TeamRulesSchema.parse({});
