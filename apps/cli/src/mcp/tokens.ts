import { randomBytes, timingSafeEqual } from 'node:crypto';

/** A job's MCP token: 32 random bytes, written as 43 URL-safe characters (spec §11). */
export function newJobToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * The jobs the MCP server is serving right now, each found by its bearer token. A token is compared
 * with `timingSafeEqual`, so how long a wrong guess takes says nothing about how close it was.
 * See docs/why/local-mcp-server.md.
 */
export class JobTokens<Job> {
  private readonly jobs = new Map<string, Job>();

  add(token: string, job: Job): void {
    this.jobs.set(token, job);
  }

  remove(token: string): void {
    this.jobs.delete(token);
  }

  /** The job an `Authorization: Bearer <token>` header names, or null for a missing, wrong or retired token. */
  find(authorization: string | undefined): Job | null {
    const given = /^Bearer (\S+)$/.exec(authorization ?? '')?.[1];
    if (!given) return null;
    const givenBytes = Buffer.from(given);
    for (const [token, job] of this.jobs) {
      const bytes = Buffer.from(token);
      // timingSafeEqual needs two buffers of the same length. Every token has the same length, so checking it gives nothing away.
      if (bytes.length === givenBytes.length && timingSafeEqual(bytes, givenBytes)) return job;
    }
    return null;
  }
}
