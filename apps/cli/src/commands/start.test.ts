import { describe, expect, it } from 'vitest';
import { recordOut } from '../../test/out';
import { tempDir } from '../../test/temp';
import { start } from './start';

describe('nitpilot start', () => {
  it('asks you to log in first', async () => {
    await expect(start({ env: { NITPILOT_CONFIG_DIR: tempDir() }, out: recordOut() })).rejects.toThrow('Not logged in. Run `nitpilot login` first.');
  });
});
