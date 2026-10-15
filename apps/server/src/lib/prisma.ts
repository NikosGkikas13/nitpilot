import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client';

/** A Prisma client inside `prisma.$transaction(async (tx) => …)`. */
export type Tx = Prisma.TransactionClient;

/** The client, able to tell listeners about each query it sends (tests count them: test/queries.ts). */
type Client = PrismaClient<'query'>;

function createPrisma(): Client {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'stdout', level: 'error' },
    ],
  });
}

// One client per process. In development, keep it on globalThis so hot reloads reuse it.
const globalForPrisma = globalThis as unknown as { prisma?: Client };
export const prisma = globalForPrisma.prisma ?? createPrisma();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/** True when a write broke a unique constraint (Prisma error P2002). */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
