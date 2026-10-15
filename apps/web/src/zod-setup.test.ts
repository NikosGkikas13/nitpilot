import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import './zod-setup';

describe('zod setup', () => {
  it("turns off zod's eval-based fast path, which the server's Content-Security-Policy forbids", () => {
    expect(z.config().jitless).toBe(true);
  });
});
