import type { CliLoginPollResponse } from '@nitpilot/protocol';
import { isUniqueViolation, prisma } from '../lib/prisma';
import { generateToken, generateUserCode, hashToken, randomSecret } from '../lib/tokens';

export const LOGIN_TTL_MS = 10 * 60_000;
export const POLL_INTERVAL_SEC = 2;

/** Step 1 of `nitpilot login`: a secret device code for the CLI, and a short code for the person. */
export async function startCliLogin(deviceName: string, now = new Date()) {
  const deviceCode = randomSecret();
  const expiresAt = new Date(now.getTime() + LOGIN_TTL_MS);
  for (let attempt = 0; ; attempt++) {
    const userCode = generateUserCode();
    try {
      await prisma.cliLoginRequest.create({ data: { deviceCodeHash: hashToken(deviceCode), userCode, deviceName, expiresAt } });
      return { deviceCode, userCode, expiresAt };
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 5) continue; // two identical user codes: pick another
      throw err;
    }
  }
}

/** The CLI polls this. The token is created on the first poll after approval and never stored in plain form. */
export async function pollCliLogin(deviceCode: string, now = new Date()): Promise<CliLoginPollResponse> {
  const req = await prisma.cliLoginRequest.findUnique({ where: { deviceCodeHash: hashToken(deviceCode) } });
  if (!req) return { status: 'expired' };
  if (req.status === 'pending' && req.expiresAt <= now) {
    await prisma.cliLoginRequest.update({ where: { id: req.id }, data: { status: 'expired' } });
    return { status: 'expired' };
  }
  if (req.status === 'pending') return { status: 'pending' };
  if (req.status === 'denied') return { status: 'denied' };
  if (req.status !== 'approved' || !req.userId) return { status: 'expired' };

  const userId = req.userId;
  return prisma.$transaction(async (tx) => {
    // Compare-and-swap: only the first poll after approval wins a token.
    const { count } = await tx.cliLoginRequest.updateMany({ where: { id: req.id, status: 'approved' }, data: { status: 'consumed' } });
    if (count === 0) return { status: 'expired' } as const;
    const token = generateToken();
    await tx.cliToken.create({ data: { userId, name: req.deviceName, tokenHash: token.hash, prefix: token.prefix } });
    return { status: 'approved', token: token.raw } as const;
  });
}

export async function findCliLogin(userCode: string) {
  return prisma.cliLoginRequest.findUnique({ where: { userCode: userCode.trim().toUpperCase() } });
}

/** The person pressed Approve or Deny on /cli/approve. */
export async function decideCliLogin(userCode: string, userId: string, decision: 'approve' | 'deny', now = new Date()) {
  const req = await findCliLogin(userCode);
  if (!req) return 'not_found' as const;
  if (req.expiresAt <= now) return 'expired' as const;
  const { count } = await prisma.cliLoginRequest.updateMany({
    where: { id: req.id, status: 'pending' },
    data: { status: decision === 'approve' ? 'approved' : 'denied', userId },
  });
  if (count === 0) return 'expired' as const;
  return decision === 'approve' ? ('approved' as const) : ('denied' as const);
}
