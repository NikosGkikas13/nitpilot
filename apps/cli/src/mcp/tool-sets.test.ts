import { describe, expect, it } from 'vitest';
import { toolsFor } from './tool-sets';

describe('toolsFor', () => {
  it('gives each job type the tools in the spec, and no others', () => {
    expect(toolsFor('review')).toEqual(['get_job', 'list_changed_files', 'get_diff', 'get_file', 'add_point', 'finish']);
    expect(toolsFor('re_review')).toEqual(['get_job', 'list_changed_files', 'get_diff', 'get_file', 'add_point', 'decide_point', 'finish']);
    expect(toolsFor('address')).toEqual(['get_job', 'list_changed_files', 'get_diff', 'get_file', 'reply_to_point', 'run_check', 'finish']);
  });
});
