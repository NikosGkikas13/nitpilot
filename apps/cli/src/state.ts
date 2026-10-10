import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const State = z.object({ day: z.string(), jobs: z.number().int().min(0) });

/**
 * Counts the jobs this CLI ran today, so `dailyJobCap` limits how much of your agent quota others can
 * spend by requesting your review (spec §14, budget protection). Kept in <config dir>/state.json.
 */
export class DailyJobCounter {
  constructor(
    private readonly dir: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Count one more job, unless `cap` jobs already ran today. False means: over the cap, turn it down. */
  take(cap: number): boolean {
    const today = localDay(this.now());
    const saved = this.read();
    const ran = saved?.day === today ? saved.jobs : 0;
    if (ran >= cap) return false;
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    writeFileSync(this.file(), `${JSON.stringify({ day: today, jobs: ran + 1 })}\n`, { mode: 0o600 });
    return true;
  }

  private file(): string {
    return join(this.dir, 'state.json');
  }

  /** What was saved, or null when there's no file yet or it can't be read (then the count starts at zero). */
  private read(): z.infer<typeof State> | null {
    try {
      return State.parse(JSON.parse(readFileSync(this.file(), 'utf8')));
    } catch {
      return null;
    }
  }
}

/** YYYY-MM-DD in this machine's time zone: the cap resets at your midnight, not UTC's. */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
