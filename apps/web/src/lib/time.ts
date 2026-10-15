const DAY_MS = 86_400_000;

/**
 * When a row last changed, the way the handoff writes it: "now", "16:40" today, "Yesterday", "Mon" within the
 * last week, then "Oct 3". In the reader's own time zone.
 */
export function rowTime(iso: string, now = new Date()): string {
  const at = new Date(iso);
  if (now.getTime() - at.getTime() < 60_000) return 'now';
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);
  if (days === 0) return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return at.toLocaleDateString('en-US', { weekday: 'short' });
  return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
