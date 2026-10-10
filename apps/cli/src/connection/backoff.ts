/** Reconnect waits (spec §10): 1 s, doubling up to 30 s. */
export const BACKOFF_START_MS = 1_000;
export const BACKOFF_MAX_MS = 30_000;
/** Each wait is nudged up to 20% either way, so CLIs that lost the server together don't all return at once. */
const JITTER = 0.2;

export class Backoff {
  private readonly startMs: number;
  private readonly maxMs: number;
  private readonly random: () => number;
  private base: number;

  constructor(opts: { startMs?: number; maxMs?: number; random?: () => number } = {}) {
    this.startMs = opts.startMs ?? BACKOFF_START_MS;
    this.maxMs = opts.maxMs ?? BACKOFF_MAX_MS;
    this.random = opts.random ?? Math.random;
    this.base = this.startMs;
  }

  /** How long to wait before the next try. Each call doubles the wait, up to the maximum. */
  next(): number {
    const wait = Math.round(this.base * (1 - JITTER + 2 * JITTER * this.random()));
    this.base = Math.min(this.base * 2, this.maxMs);
    return wait;
  }

  /** After a good connection (`welcome`), start again from the shortest wait. */
  reset(): void {
    this.base = this.startMs;
  }
}
