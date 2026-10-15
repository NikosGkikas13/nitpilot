import { describe, expect, it } from 'vitest';
import { assertTestDatabase } from './test-database';

describe('assertTestDatabase', () => {
  it('accepts the test database', () => {
    expect(() => assertTestDatabase('nitpilot_test')).not.toThrow();
  });

  it('refuses the dev database and look-alikes, saying which one', () => {
    expect(() => assertTestDatabase('nitpilot')).toThrow('resetDb refused to empty "nitpilot"');
    expect(() => assertTestDatabase('nitpilot_testing')).toThrow(/refused/);
    expect(() => assertTestDatabase('')).toThrow(/refused/);
  });
});
