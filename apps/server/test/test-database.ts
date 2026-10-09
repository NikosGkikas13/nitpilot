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
