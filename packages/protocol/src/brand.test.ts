import { describe, expect, it } from 'vitest';
import { BRAND } from './brand';

describe('BRAND', () => {
  it('holds the name-bearing strings the spec fixes', () => {
    expect(BRAND.cli).toBe('nitpilot');
    expect(BRAND.tokenPrefix).toBe('nit_');
    expect(BRAND.teamConfigFile).toBe('.nitpilot.yml');
    expect(BRAND.commentMarker).toBe('nitpilot:v1');
    expect(BRAND.gitRefNamespace).toBe('refs/nitpilot');
    expect(BRAND.commitTrailer).toBe('Nitpilot-Job');
  });

  it('has no empty values', () => {
    for (const value of Object.values(BRAND)) expect(value).not.toBe('');
  });
});
