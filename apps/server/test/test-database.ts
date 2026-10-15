// Tests get their own database on the same Postgres server as the dev one: same user and
// password, with "_test" added to the name (nitpilot → nitpilot_test). A test run can then empty
// every table without touching your dev data (sign-ins, installations, chats).
// See docs/why/database-and-migrations.md.

/** The dev DATABASE_URL with "_test" added to the database name. A test url stays as it is. */
export function testDatabaseUrl(devUrl: string): string {
  const url = new URL(devUrl);
  const name = url.pathname.slice(1);
  if (!name.endsWith('_test')) url.pathname = `/${name}_test`;
  return url.toString();
}

/**
 * `resetDb` deletes every row in every table. Tests point at nitpilot_test, but if some import connects before
 * the test URL is set (as test/e2e/web-server.ts has to be careful about), it would be the dev database that
 * gets emptied. So resetDb asks the database its name and calls this first: anything not ending in _test is refused.
 */
export function assertTestDatabase(name: string): void {
  if (!name.endsWith('_test')) {
    throw new Error(`resetDb refused to empty "${name}": tests only ever empty a database whose name ends in _test (test/test-database.ts).`);
  }
}
