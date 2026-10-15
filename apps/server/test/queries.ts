import { prisma } from '../src/lib/prisma';

// Counts the SQL queries Prisma sends, for "no N+1" tests: reading 30 chats must take as many queries as
// reading 1. See docs/why/n-plus-one-queries.md.

let sent = 0;
let listening = false;

/** How many queries `run` sent to the database. */
export async function countQueries(run: () => Promise<unknown>): Promise<number> {
  if (!listening) {
    prisma.$on('query', () => (sent += 1));
    listening = true;
  }
  const before = sent;
  await run();
  return sent - before;
}
