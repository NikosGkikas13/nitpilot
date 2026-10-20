import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// The live acceptance run (docs/acceptance/plan-1.md) points CLI B's fake agent at these scenario files and
// opens a PR that adds this seed. If a line number drifts, B would comment on the wrong line and nobody would
// notice until the live run. This keeps the two together.

const ACCEPTANCE = fileURLToPath(new URL('../../../../../docs/acceptance/', import.meta.url));
const SEED = `${ACCEPTANCE}seed/`;

type AddPoint = { add_point: { path: string; line: number; severity: string; category: string; title: string } };
type Scenario = { review: ({ finish: string } | AddPoint)[]; re_review: ({ finish: string } | { decide: { point: number; decision: string } } | AddPoint)[] };

const scenario = (name: string) => JSON.parse(readFileSync(`${ACCEPTANCE}scenarios/${name}.json`, 'utf8')) as Scenario;
const pointsOf = (s: Scenario) => s.review.filter((step): step is AddPoint => 'add_point' in step).map((step) => step.add_point);
/** The points a scenario raises when it reviews again. */
const raisedAgain = (s: Scenario) => s.re_review.filter((step): step is AddPoint => 'add_point' in step).map((step) => step.add_point);
const lineOf = (path: string, line: number) => readFileSync(`${SEED}${path}`, 'utf8').split('\n')[line - 1];
const seedModule = (file: string) => import(pathToFileURL(`${SEED}orders-demo/src/${file}`).href);

describe('the sandbox scenarios and the seed', () => {
  it('B comments on the three planted lines of orders.js', () => {
    const points = pointsOf(scenario('sandbox-happy'));
    expect(points.map((p) => [p.path, lineOf(p.path, p.line)?.trim()])).toEqual([
      ['orders-demo/src/orders.js', 'const start = page * size;'],
      ['orders-demo/src/orders.js', 'return sum / totals.length;'],
      ['orders-demo/src/orders.js', 'return `Order #${order.id} for ${order.customer}: ${order.total} cents`;'],
    ]);
    expect(points.every((p) => p.category !== 'security')).toBe(true);
  });

  it('settles every point it raised when it reviews again', () => {
    const s = scenario('sandbox-happy');
    const decided = s.re_review.filter((step) => 'decide' in step).map((step) => (step as { decide: { point: number } }).decide.point);
    expect(decided).toEqual(pointsOf(s).map((_, i) => i + 1));
  });

  it('the security scenario raises one security point on the SQL line', () => {
    const [point] = pointsOf(scenario('sandbox-security'));
    expect(point).toMatchObject({ path: 'orders-demo/src/search.js', category: 'security' });
    expect(lineOf(point!.path, point!.line)).toContain('SELECT * FROM orders WHERE customer =');
  });

  it('the escalation scenario raises the SQL point, then settles it and escalates a second security point (Plan 2)', () => {
    // docs/acceptance/plan-2.md section 6: Continue on P1, a round runs, and the re-review escalates again for Resolve.
    const s = scenario('sandbox-escalation');
    const [first] = pointsOf(s);
    expect(first).toMatchObject({ path: 'orders-demo/src/search.js', category: 'security' });
    expect(lineOf(first!.path, first!.line)).toContain('SELECT * FROM orders WHERE customer =');
    expect(s.re_review[0]).toMatchObject({ decide: { point: 1, decision: 'resolve' } });
    const [second] = raisedAgain(s);
    expect(second).toMatchObject({ path: 'orders-demo/src/search.js', category: 'security' });
    // The file's first line, a comment: fixing the SQL line doesn't move it, so the point still lands where it says.
    expect(lineOf(second!.path, second!.line)).toBe('// Looks orders up by customer name.');
  });

  it('the planted bugs are real, and the seed passes its own tests anyway', async () => {
    const { paginate, averageTotal, describeOrder } = await seedModule('orders.js');
    expect(paginate(['a', 'b', 'c', 'd'], 1, 2)).toEqual(['c', 'd']); // page 1 should be ['a', 'b']
    expect(averageTotal([])).toBeNaN();
    expect(() => describeOrder([], 1)).toThrow(TypeError);
    // `node --test` exits 0 only when every test passes.
    expect(() => execFileSync(process.execPath, ['--test'], { cwd: `${SEED}orders-demo`, stdio: 'pipe' })).not.toThrow();
  });

  it('search.js builds its SQL by joining strings', async () => {
    const { ordersOfCustomer } = await seedModule('search.js');
    const queries: string[] = [];
    ordersOfCustomer({ query: (sql: string) => queries.push(sql) }, "x' OR '1'='1");
    expect(queries).toEqual(["SELECT * FROM orders WHERE customer = 'x' OR '1'='1'"]);
  });
});
