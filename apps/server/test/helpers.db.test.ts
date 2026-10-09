import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { ghId } from './db';
import { testDatabaseUrl } from './test-database';

describe('ghId', () => {
  it('makes ids that survive a trip through a JSON number, like real GitHub ids', () => {
    for (let i = 0; i < 1000; i++) {
      const id = ghId();
      expect(String(JSON.parse(JSON.stringify(Number(id))))).toBe(id);
    }
  });

  it('never repeats', () => {
    const ids = Array.from({ length: 1000 }, () => ghId());
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the test database', () => {
  it('is a separate database, so test runs never wipe the dev one', async () => {
    const [row] = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
    expect(row?.name).toMatch(/_test$/);
  });
});

describe('testDatabaseUrl', () => {
  it('points at the same server with "_test" added to the database name', () => {
    expect(testDatabaseUrl('postgresql://nitpilot:nitpilot@localhost:5433/nitpilot')).toBe(
      'postgresql://nitpilot:nitpilot@localhost:5433/nitpilot_test',
    );
  });

  it('keeps the query string', () => {
    expect(testDatabaseUrl('postgresql://u:p@db:5432/app?schema=public')).toBe('postgresql://u:p@db:5432/app_test?schema=public');
  });

  it('leaves a test database url as it is', () => {
    expect(testDatabaseUrl('postgresql://u:p@db:5432/app_test')).toBe('postgresql://u:p@db:5432/app_test');
  });
});
