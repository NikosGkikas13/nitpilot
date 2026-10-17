import type { AgentJobType } from '@nitpilot/protocol';

/**
 * Which tools each job type gets (spec §11, the tool table). A review only reads and raises points; a
 * re-review can also decide on its own earlier points; only an address job answers points and runs checks.
 */
export const TOOL_SETS = {
  review: ['get_job', 'list_changed_files', 'get_diff', 'get_file', 'add_point', 'finish'],
  re_review: ['get_job', 'list_changed_files', 'get_diff', 'get_file', 'add_point', 'decide_point', 'finish'],
  address: ['get_job', 'list_changed_files', 'get_diff', 'get_file', 'reply_to_point', 'run_check', 'finish'],
} as const satisfies Record<AgentJobType, readonly string[]>;

export type ToolName = (typeof TOOL_SETS)[AgentJobType][number];

export function toolsFor(type: AgentJobType): readonly ToolName[] {
  return TOOL_SETS[type];
}
