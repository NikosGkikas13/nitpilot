import { execFile } from 'node:child_process';

export type RunResult = { code: number | null; stdout: string; stderr: string };
/** Runs a program without a shell, and never throws: a missing program gives code null. `env` replaces your environment. */
export type RunProgram = (file: string, args: string[], opts?: { env?: Record<string, string> }) => Promise<RunResult>;

/** A quick check gets 10 s, so a hung program can't hang `nitpilot doctor` or `start`. */
export const RUN_TIMEOUT_MS = 10_000;

/** Run a program without a shell. Never throws: a missing program, or one past the timeout, gives code null. */
export const runProgram: RunProgram = (file, args, opts = {}) =>
  new Promise((resolve) =>
    execFile(file, args, { timeout: RUN_TIMEOUT_MS, env: opts.env }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : null) : 0, stdout, stderr: stderr || (err?.message ?? '') }),
    ),
  );
