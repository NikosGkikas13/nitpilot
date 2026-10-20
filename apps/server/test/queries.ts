import { prisma } from '../src/lib/prisma';

// Counts the SQL queries Prisma sends, for "no N+1" tests: reading 30 chats must take as many queries as
// reading 1. See docs/why/n-plus-one-queries.md.

let sent = 0;
let listening = false;
let recording: string[] | null = null;

function listen(): void {
  if (listening) return;
  prisma.$on('query', (e) => {
    sent += 1;
    recording?.push(e.query);
  });
  listening = true;
}

/** How many queries `run` sent to the database. */
export async function countQueries(run: () => Promise<unknown>): Promise<number> {
  listen();
  const before = sent;
  await run();
  return sent - before;
}

/** The SQL of each query `run` sent, in order (to check how a write is made, e.g. that it can't fail on a duplicate). */
export async function recordQueries(run: () => Promise<unknown>): Promise<string[]> {
  listen();
  const seen: string[] = [];
  recording = seen;
  try {
    await run();
  } finally {
    recording = null;
  }
  return seen;
}
