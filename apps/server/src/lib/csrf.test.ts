import { describe, expect, it } from 'vitest';
import { isAllowedOrigin } from './csrf';

const PUBLIC = 'https://nitpilot.dev';
const req = (headers: Record<string, string>) => new Request('http://10.0.0.5:8787/cli/approve', { method: 'POST', headers });

describe('isAllowedOrigin', () => {
  it('accepts the public origin', () => expect(isAllowedOrigin(req({ origin: PUBLIC }), PUBLIC)).toBe(true));
  it("accepts the request's own origin", () => expect(isAllowedOrigin(req({ origin: 'http://10.0.0.5:8787' }), PUBLIC)).toBe(true));
  it('falls back to the referer', () => expect(isAllowedOrigin(req({ referer: `${PUBLIC}/cli/approve?code=X` }), PUBLIC)).toBe(true));
  it('rejects another site', () => expect(isAllowedOrigin(req({ origin: 'https://evil.example' }), PUBLIC)).toBe(false));
  it('rejects a request with neither header', () => expect(isAllowedOrigin(req({}), PUBLIC)).toBe(false));
});
