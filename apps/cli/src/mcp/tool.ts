import type { z } from 'zod';

/** One MCP tool as one job sees it: its name, what the agent may send, and what it does with it. */
export type McpTool = {
  name: string;
  description: string;
  input: z.ZodObject;
  /** Resolves with what the agent reads (text, or an object sent as JSON). Throw ToolError for a mistake the agent can fix. */
  run(args: unknown): Promise<unknown>;
};

/** A mistake the agent can fix (a path that isn't in the PR, one point too many): it gets the message as a tool error and can try again. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

/** Define a tool with typed arguments. The MCP server has already checked them against `input`; parsing again gives `run` their type. */
export function defineTool<Input extends z.ZodObject>(def: {
  name: string;
  description: string;
  input: Input;
  run(args: z.infer<Input>): Promise<unknown>;
}): McpTool {
  return { name: def.name, description: def.description, input: def.input, run: (args) => def.run(def.input.parse(args)) };
}
