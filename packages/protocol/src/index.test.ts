import { describe, expect, it } from 'vitest';
import * as protocol from './index';

describe('the package entry', () => {
  it("doesn't export the test samples: they have their own entry, @nitpilot/protocol/test-samples", () => {
    expect(Object.keys(protocol)).not.toContain('samples');
  });
});
