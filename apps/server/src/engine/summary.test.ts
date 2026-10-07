import { describe, expect, it } from 'vitest';
import { renderSummary, SUMMARY_MAX, type SummaryPoint, type SummaryView } from './summary';

function point(number: number, over: Partial<SummaryPoint> = {}): SummaryPoint {
  return { number, title: `Point ${number}`, status: 'resolved', authorResolution: 'fixed', escalationReason: null, fixedIn: 'a1b2c3d4e5', authorComment: null, ...over };
}

const view = (over: Partial<SummaryView> = {}): SummaryView => ({
  chatId: 'chat_1',
  phase: 'ready',
  merged: false,
  round: 2,
  transcriptUrl: 'https://nitpilot.dev/c/octo/sandbox/42',
  points: [
    point(1, { title: '`parseOrder` crashes on empty input' }),
    point(2, { title: 'Rename `fetchAll` → `fetchPage`', authorResolution: 'declined', fixedIn: null, authorComment: 'Kept for API compatibility.' }),
    point(3, { title: 'Missing pagination test', fixedIn: 'd4e5f6a7b8' }),
  ],
  ...over,
});

describe('renderSummary', () => {
  it('renders the spec format', () => {
    expect(renderSummary(view()).body).toBe(
      [
        '<!-- nitpilot:v1 chat=chat_1 -->',
        '🤖 **Nitpilot** · ready for approval · 2 rounds',
        'Fixed: `parseOrder` crashes on empty input (P1), Missing pagination test (P3)',
        'Declined, reviewer agreed: Rename `fetchAll` → `fetchPage` (P2, Kept for API compatibility.)',
        'Needs a human: none',
        '<details><summary>Review log (3 points)</summary>',
        '',
        '| # | Point | Outcome |',
        '|---|---|---|',
        '| P1 | `parseOrder` crashes on empty input | fixed in a1b2c3d |',
        '| P2 | Rename `fetchAll` → `fetchPage` | declined, resolved by reviewer |',
        '| P3 | Missing pagination test | fixed in d4e5f6a |',
        '</details>',
        '',
        '[Open the conversation →](https://nitpilot.dev/c/octo/sandbox/42)',
      ].join('\n'),
    );
  });

  it('names escalated points and labels a merged PR', () => {
    const body = renderSummary(view({ phase: 'closed', merged: true, points: [point(1, { status: 'escalated', escalationReason: 'category', title: 'SQL injection', authorResolution: null })] })).body;
    expect(body).toContain('🤖 **Nitpilot** · merged · 2 rounds');
    expect(body).toContain('Needs a human: SQL injection (P1)');
    expect(body).toContain('| P1 | SQL injection | needs a human (always escalated) |');
  });

  it('keeps table cells on one line and escapes pipes', () => {
    const body = renderSummary(view({ points: [point(1, { title: 'a | b\nc' })] })).body;
    expect(body).toContain('| P1 | a \\| b c |');
  });

  it(`stays under ${SUMMARY_MAX} characters and points to the chat for the rest`, () => {
    const many = Array.from({ length: 600 }, (_, i) => point(i + 1, { title: 'x'.repeat(150), status: 'open', authorResolution: null }));
    const body = renderSummary(view({ points: many })).body;
    expect(body.length).toBeLessThanOrEqual(SUMMARY_MAX);
    expect(body).toMatch(/\| … \| \+\d+ more in chat \| \|/);
    expect(body.endsWith('[Open the conversation →](https://nitpilot.dev/c/octo/sandbox/42)')).toBe(true);
  });

  it('passes titles through the clean function', () => {
    const body = renderSummary(view({ points: [point(1, { title: 'ping @everyone' })] }), (t) => t.replace('@', '@​')).body;
    expect(body).toContain('ping @​everyone');
  });

  it('gives the same hash for the same content, and a new one when it changes', () => {
    expect(renderSummary(view()).hash).toBe(renderSummary(view()).hash);
    expect(renderSummary(view()).hash).not.toBe(renderSummary(view({ round: 3 })).hash);
  });
});
