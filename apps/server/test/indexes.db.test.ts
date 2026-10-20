import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';

/** The indexes Postgres has on a table, as their definitions. */
async function indexesOf(table: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ indexdef: string }[]>`SELECT indexdef FROM pg_indexes WHERE tablename = ${table}`;
  return rows.map((r) => r.indexdef);
}

describe('indexes', () => {
  it('finds the publish job of a draft without reading every job (Job.draftOfId, routes/chat-drafts.ts)', async () => {
    expect(await indexesOf('Job')).toContainEqual(expect.stringMatching(/\("draftOfId"\)/));
  });
});
