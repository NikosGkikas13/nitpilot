import { z } from 'zod';
import { Attention, Phase, Role } from './enums';

// `nitpilot login` (spec §10, "CLI login")
export const CliLoginStartRequest = z.object({ deviceName: z.string().min(1).max(100) });
export const CliLoginStartResponse = z.object({
  deviceCode: z.string(),
  userCode: z.string(),
  verifyUrl: z.string(),
  interval: z.number().int().positive(),
  expiresIn: z.number().int().positive(),
});
export const CliLoginPollRequest = z.object({ deviceCode: z.string().min(1) });
export const CliLoginPollResponse = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }),
  z.object({ status: z.literal('approved'), token: z.string() }),
  z.object({ status: z.literal('denied') }),
  z.object({ status: z.literal('expired') }),
]);
export type CliLoginPollResponse = z.infer<typeof CliLoginPollResponse>;

// `nitpilot status`
export const MeResponse = z.object({
  login: z.string(),
  avatarUrl: z.string().nullable(),
  githubAuth: z.enum(['ok', 'needs_reauth']),
});
export type MeResponse = z.infer<typeof MeResponse>;

export const MyChat = z.object({
  id: z.string(),
  repo: z.string(),
  number: z.number().int().positive(),
  title: z.string(),
  role: Role,
  phase: Phase,
  round: z.number().int().positive(),
  attention: Attention,
  url: z.string(),
  updatedAt: z.string(),
});
export type MyChat = z.infer<typeof MyChat>;
export const MyChatsResponse = z.object({ chats: z.array(MyChat) });
export type MyChatsResponse = z.infer<typeof MyChatsResponse>;

// `nitpilot retry`
// `queued`: the job is queued now. `waiting`: the failure is cleared, and the job starts once the PR's current step is done.
export const RetryResponse = z.object({ status: z.enum(['queued', 'waiting']) });
export type RetryResponse = z.infer<typeof RetryResponse>;
