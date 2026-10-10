/** A problem to show the person as a plain message (no stack trace). The CLI then exits with 1. */
export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}
