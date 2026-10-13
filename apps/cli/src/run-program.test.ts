import { describe, expect, it } from 'vitest';
import { runProgram } from './run-program';

describe('runProgram', () => {
  it('runs a real program and gives what it printed', async () => {
    expect(await runProgram(process.execPath, ['-e', "process.stdout.write('hi')"])).toMatchObject({ code: 0, stdout: 'hi' });
  });

  it('gives the exit code of a program that ran and failed', async () => {
    expect(await runProgram(process.execPath, ['-e', 'process.exit(3)'])).toMatchObject({ code: 3 });
  });

  it('gives code null, not an exception, when the program does not exist', async () => {
    const r = await runProgram('nitpilot-no-such-program', []);
    expect(r.code).toBeNull();
    expect(r.stderr).toContain('ENOENT');
  });
});
