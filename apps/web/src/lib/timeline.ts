import type { DraftView, PointView, Severity, TimelineItem } from '@nitpilot/protocol';

/** What a system line starts with (handoff §2 "Timeline"): a dot, ✓ for ready or merged, a ring for waiting, the red diamond for an escalation. */
export type Glyph = 'dot' | 'check' | 'ring' | 'diamond';

/** One row of the chat's feed. A point's card collects its thread: the replies and decisions about it. */
export type TimelineRow =
  | { kind: 'system'; item: TimelineItem; glyph: Glyph }
  | { kind: 'summary'; item: TimelineItem }
  | { kind: 'human'; item: TimelineItem }
  | { kind: 'point'; point: PointView; thread: TimelineItem[] }
  | { kind: 'draft'; draft: DraftView };

/**
 * The feed, in order (handoff §2): each point's card sits where it was raised, holding every later item about it
 * (agents' replies and decisions, people's replies in its GitHub thread). When the item that raised it is on an
 * older page that isn't loaded, the card sits where its thread starts. A waiting draft's card sits right after the
 * line that says its job's work waits as drafts (the first item whose `data.jobId` is the draft's job); when that line
 * is on an older page, at the end, so a draft waiting for you is never out of sight.
 */
export function timelineRows(items: TimelineItem[], points: PointView[], drafts: DraftView[] = []): TimelineRow[] {
  const byNumber = new Map(points.map((p) => [p.number, p]));
  const threads = new Map<number, TimelineItem[]>();
  for (const item of items) {
    if (item.pointNumber === null || item.kind === 'point_raised' || !byNumber.has(item.pointNumber)) continue;
    threads.set(item.pointNumber, [...(threads.get(item.pointNumber) ?? []), item]);
  }
  const placed = new Set<number>();
  const unplaced = new Map(drafts.map((d) => [d.jobId, d]));
  const rows: TimelineRow[] = [];
  for (const item of items) {
    const point = item.pointNumber === null ? undefined : byNumber.get(item.pointNumber);
    // chat.items can arrive before the chat.state that brings the point: its card appears with that state.
    if (item.pointNumber !== null && !point) continue;
    if (point) {
      if (!placed.has(point.number)) rows.push({ kind: 'point', point, thread: threads.get(point.number) ?? [] });
      placed.add(point.number);
    } else if (item.kind === 'system') {
      rows.push({ kind: 'system', item, glyph: systemGlyph(item.body) });
      const draft = typeof item.data?.jobId === 'string' ? unplaced.get(item.data.jobId) : undefined;
      if (draft) {
        rows.push({ kind: 'draft', draft });
        unplaced.delete(draft.jobId);
      }
    } else if (item.kind === 'job_summary') {
      rows.push({ kind: 'summary', item });
    } else {
      rows.push({ kind: 'human', item });
    }
  }
  for (const draft of unplaced.values()) rows.push({ kind: 'draft', draft });
  return rows;
}

/** The glyph for a system line, from what the engine says (apps/server/src/engine: "Ready for approval", "leo resolved P1", "… a human decision", "… is waiting"). */
export function systemGlyph(body: string): Glyph {
  if (/a human decision/.test(body)) return 'diamond';
  if (/^(Ready for approval|Merged)$|approved on GitHub$|resolved on GitHub$| resolved P\d+$/.test(body)) return 'check';
  if (/is waiting|^Waiting for|offline/.test(body)) return 'ring';
  return 'dot';
}

const SEVERITIES: Severity[] = ['blocker', 'major', 'minor', 'nit'];

/** A review summary's counts, "1 major · 1 minor · 1 nit", from its `data.counts`; empty when it raised nothing. */
export function severityCounts(data: TimelineItem['data']): string {
  const counts = (data?.counts ?? {}) as Partial<Record<Severity, number>>;
  return SEVERITIES.filter((s) => (counts[s] ?? 0) > 0)
    .map((s) => `${counts[s]} ${s}`)
    .join(' · ');
}

/** Text cut where it names a commit (7 to 40 hex characters), so the hash can be set in mono (handoff §2). */
export function withCommitHashes(text: string): { text: string; hash: boolean }[] {
  return text
    .split(/\b([0-9a-f]{7,40})\b/)
    .map((part, i) => ({ text: part, hash: i % 2 === 1 }))
    .filter((part) => part.text !== '');
}
