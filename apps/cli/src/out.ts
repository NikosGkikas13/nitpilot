/** Where commands print. The real one is the terminal; tests pass one that records the lines. */
export type Out = { log(text: string): void; error(text: string): void };

export const terminal: Out = {
  log: (text) => console.log(text),
  error: (text) => console.error(text),
};
