import { useEffect, useState } from 'react';

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

/**
 * When a timeline item happened, the way the chat writes it: "16:20" today, "Yesterday 11:18", then
 * "Mon 09:02" within the last week, then "Oct 3 09:02". In the reader's own time zone.
 */
export function itemTime(iso: string, now = new Date()): string {
  const at = new Date(iso);
  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);
  if (days <= 0) return clock;
  if (days === 1) return `Yesterday ${clock}`;
  if (days < 7) return `${at.toLocaleDateString('en-US', { weekday: 'short' })} ${clock}`;
  return `${at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${clock}`;
}

/**
 * When a device last said anything, for "Last seen …" on the Settings page: "18:04" today, "yesterday", "3 days ago"
 * within a month, then "Sep 3". In the reader's own time zone.
 */
export function lastSeen(iso: string, now = new Date()): string {
  const at = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);
  if (days <= 0) return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** The time now, moving on every minute, so times like "now" and "16:40" stay true while the page is open. */
export function useNow(everyMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
