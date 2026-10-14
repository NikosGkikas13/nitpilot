import 'dotenv/config';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { prisma } from '../src/lib/prisma';
import { buildFixture, deliveryFacts, fixtureFileName } from '../test/fixtures/recorded/scrub';

// Turn real webhook deliveries from the database into fixture files (spec §19, docs/why/recorded-fixtures.md).
// Every delivery GitHub sends is stored as a RawEvent for 14 days, so a live run records itself: look at what
// arrived, then keep the ones worth replaying in tests.
//   npm run record:fixtures -w apps/server -- list [--since 2026-10-10T06:00:00Z] [--event pull_request]
//   npm run record:fixtures -w apps/server -- write <deliveryId> <name> [--note "what you did"] [--force]
// It reads the database named by DATABASE_URL (apps/server/.env, or the environment, which wins).

const DIR = fileURLToPath(new URL('../test/fixtures/recorded/', import.meta.url));
const USAGE = 'Usage: record-fixtures list [--since <ISO time>] [--event <name>]\n       record-fixtures write <deliveryId> <name> [--note <text>] [--force]';

async function list(opts: { since?: string; event?: string }): Promise<void> {
  const since = opts.since ? new Date(opts.since) : undefined;
  if (since && Number.isNaN(since.getTime())) throw new Error(`--since ${opts.since} is not a time. Try 2026-10-10T06:00:00Z.`);
  const rows = await prisma.rawEvent.findMany({
    where: { ...(since ? { createdAt: { gte: since } } : {}), ...(opts.event ? { event: opts.event } : {}) },
    orderBy: { createdAt: 'asc' },
  });
  for (const row of rows) {
    const { pr, sender, detail } = deliveryFacts(JSON.parse(row.body));
    const when = row.createdAt.toISOString().replace('T', ' ').slice(0, 19);
    const what = `${row.event}${row.action ? `.${row.action}` : ''}`;
    console.log([row.deliveryId, `${when}Z`, what.padEnd(38), (pr === null ? '-' : `#${pr}`).padEnd(4), (sender ?? '-').padEnd(18), row.status.padEnd(9), detail].join('  ').trimEnd());
  }
  console.log(`${rows.length} deliveries (times are UTC).`);
}

async function write(deliveryId: string, name: string, opts: { note?: string; force?: boolean }): Promise<void> {
  const file = `${DIR}${fixtureFileName(name)}`;
  if (existsSync(file) && !opts.force) throw new Error(`${name} already exists. Pick another name, or pass --force to replace it.`);
  const row = await prisma.rawEvent.findUnique({ where: { deliveryId } });
  if (!row) throw new Error(`No delivery ${deliveryId}. Run "list" to see what is stored (deliveries are kept 14 days).`);
  const fixture = buildFixture(row, opts.note ?? '', [process.env.GITHUB_WEBHOOK_SECRET ?? '']);
  mkdirSync(DIR, { recursive: true });
  writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`Wrote ${file} (${row.event}.${row.action ?? '-'}, ${(JSON.stringify(fixture).length / 1024).toFixed(1)} KB)`);
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { since: { type: 'string' }, event: { type: 'string' }, note: { type: 'string' }, force: { type: 'boolean' } },
  });
  const [command, deliveryId, name] = positionals;
  if (command === 'list') await list(values);
  else if (command === 'write' && deliveryId && name) await write(deliveryId, name, values);
  else throw new Error(USAGE);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
