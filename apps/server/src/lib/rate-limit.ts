/**
 * Counts requests per key (a client address, say) and says no once `limit` of them came in during the
 * last `windowMs`. In memory, which is enough for one server process (spec §7). See docs/why/cli-login.md.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Count one request for `key`. False means too many: refuse it. */
  allow(key: string): boolean {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((at) => at > now - this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    this.forgetIdle(now);
    return true;
  }

  /** Forget keys with nothing recent, so addresses seen once don't pile up forever. */
  private forgetIdle(now: number): void {
    if (this.hits.size < 1_000) return;
    for (const [key, times] of this.hits) {
      if (times.every((at) => at <= now - this.windowMs)) this.hits.delete(key);
    }
  }
}
