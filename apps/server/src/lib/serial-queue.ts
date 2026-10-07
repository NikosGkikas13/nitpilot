/** Runs async jobs one after another, in the order they were pushed. A failing job doesn't stop the queue. */
export class SerialQueue {
  private tail: Promise<void> = Promise.resolve();

  push(job: () => Promise<void>): void {
    this.tail = this.tail.then(job).catch((err) => console.error('[queue] job failed:', err));
  }

  /** Resolves once every job pushed so far has finished. */
  idle(): Promise<void> {
    return this.tail;
  }
}
