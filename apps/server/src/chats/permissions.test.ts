import { describe, expect, it } from 'vitest';
import { can, permissionsFor, type ChatAction, type PermissionFacts } from './permissions';

// maya's PR, reviewed by leo (requested) and nina (no longer requested). P1 is leo's agent's point, P2 a GitHub
// comment of leo's, both escalated. leo's agent's re-review waits as a draft (job_7). sam can read the repo but isn't
// in the chat.
const maya = { githubId: 'gh-maya' };
const leo = { githubId: 'gh-leo' };
const nina = { githubId: 'gh-nina' };
const sam = { githubId: 'gh-sam' };

function facts(over: Partial<PermissionFacts> = {}): PermissionFacts {
  return {
    closed: false,
    trusted: true,
    authorGithubId: maya.githubId,
    participants: [
      { githubId: maya.githubId, role: 'author', requested: false, attention: 'decision', agentFailed: false },
      { githubId: leo.githubId, role: 'reviewer', requested: true, attention: 'decision', agentFailed: false },
      { githubId: nina.githubId, role: 'reviewer', requested: false, attention: 'none', agentFailed: false },
    ],
    points: [
      { number: 1, raisedBy: leo.githubId, origin: 'agent', status: 'escalated' },
      { number: 2, raisedBy: leo.githubId, origin: 'github', status: 'escalated' },
      { number: 3, raisedBy: leo.githubId, origin: 'agent', status: 'open' },
    ],
    drafts: [{ jobId: 'job_7', owner: leo.githubId }],
    ...over,
  };
}

const untrusted = (attention: 'manual_review' | 'none' = 'manual_review') =>
  facts({
    trusted: false,
    participants: [
      { githubId: maya.githubId, role: 'author', requested: false, attention: 'none', agentFailed: false },
      { githubId: leo.githubId, role: 'reviewer', requested: true, attention, agentFailed: false },
      { githubId: nina.githubId, role: 'reviewer', requested: false, attention: 'none', agentFailed: false },
    ],
  });

const failed = facts({
  participants: [
    { githubId: maya.githubId, role: 'author', requested: false, attention: 'none', agentFailed: false },
    { githubId: leo.githubId, role: 'reviewer', requested: true, attention: 'failed', agentFailed: true },
  ],
});

// A flagged person whose agent didn't fail: posting to GitHub did (Retry can't help; signing in again does).
const failedPosting = facts({
  participants: [
    { githubId: maya.githubId, role: 'author', requested: false, attention: 'none', agentFailed: false },
    { githubId: leo.githubId, role: 'reviewer', requested: true, attention: 'failed', agentFailed: false },
  ],
});
// nina's review failed, then she was removed from the reviewers: the engine no longer runs it.
const failedAndRemoved = facts({
  participants: [
    { githubId: maya.githubId, role: 'author', requested: false, attention: 'none', agentFailed: false },
    { githubId: nina.githubId, role: 'reviewer', requested: false, attention: 'failed', agentFailed: true },
  ],
});
// maya's own agent failed while fixing.
const authorFailed = facts({
  participants: [
    { githubId: maya.githubId, role: 'author', requested: false, attention: 'failed', agentFailed: true },
    { githubId: leo.githubId, role: 'reviewer', requested: true, attention: 'none', agentFailed: false },
  ],
});

// Spec §16 "Who can act in a chat", one row per case.
const rows: [string, { githubId: string }, PermissionFacts, ChatAction, boolean][] = [
  ['the author sends a note', maya, facts(), { kind: 'note' }, true],
  ['a requested reviewer sends a note', leo, facts(), { kind: 'note' }, true],
  ['a reviewer who is no longer requested sends a note', nina, facts(), { kind: 'note' }, true],
  ['someone who only reads along sends a note', sam, facts(), { kind: 'note' }, false],
  ['the reviewer who raised it resolves P1', leo, facts(), { kind: 'resolve', point: 1 }, true],
  ['the author resolves P1', maya, facts(), { kind: 'resolve', point: 1 }, false],
  ['another reviewer resolves P1', nina, facts(), { kind: 'resolve', point: 1 }, false],
  ['the raiser resolves a GitHub point (resolved on GitHub)', leo, facts(), { kind: 'resolve', point: 2 }, false],
  ['anyone resolves a point that does not exist', leo, facts(), { kind: 'resolve', point: 9 }, false],
  ['the author continues P1', maya, facts(), { kind: 'continue', point: 1 }, true],
  ['the reviewer who raised it continues P1', leo, facts(), { kind: 'continue', point: 1 }, true],
  ['the author continues a GitHub point', maya, facts(), { kind: 'continue', point: 2 }, true],
  ['another reviewer continues P1', nina, facts(), { kind: 'continue', point: 1 }, false],
  ['someone who only reads along continues P1', sam, facts(), { kind: 'continue', point: 1 }, false],
  ["a requested reviewer starts the review of an outside contributor's PR", leo, untrusted(), { kind: 'review' }, true],
  ['a reviewer who is no longer requested starts it', nina, untrusted(), { kind: 'review' }, false],
  ['the author starts it', maya, untrusted(), { kind: 'review' }, false],
  ['a requested reviewer starts a review on a trusted PR (agents start there by themselves)', leo, facts(), { kind: 'review' }, false],
  ['the person whose job failed retries', leo, failed, { kind: 'retry' }, true],
  ['the author whose agent failed retries', maya, authorFailed, { kind: 'retry' }, true],
  ['someone else retries their job', maya, failed, { kind: 'retry' }, false],
  ["the person whose GitHub post failed (not their agent) retries: it wouldn't help", leo, failedPosting, { kind: 'retry' }, false],
  ['a reviewer who is no longer requested retries their failed job: the engine would not run it', nina, failedAndRemoved, { kind: 'retry' }, false],
  ['someone with nothing failed retries', leo, facts(), { kind: 'retry' }, false],
  ['the author switches Auto-fix', maya, facts(), { kind: 'auto', role: 'author' }, true],
  ['a reviewer switches Auto-review', leo, facts(), { kind: 'auto', role: 'reviewer' }, true],
  ['a reviewer who is no longer requested switches their own Auto-review', nina, facts(), { kind: 'auto', role: 'reviewer' }, true],
  ['a reviewer switches Auto-fix (a role they do not have)', leo, facts(), { kind: 'auto', role: 'author' }, false],
  ['the author switches Auto-review (a role she does not have)', maya, facts(), { kind: 'auto', role: 'reviewer' }, false],
  ['someone who only reads along switches Auto', sam, facts(), { kind: 'auto', role: 'reviewer' }, false],
  ["the owner sends or discards their agent's draft", leo, facts(), { kind: 'draft', owner: leo.githubId }, true],
  ["the author sends or discards leo's draft", maya, facts(), { kind: 'draft', owner: leo.githubId }, false],
  ["someone who only reads along sends or discards leo's draft", sam, facts(), { kind: 'draft', owner: leo.githubId }, false],
  ['the author sends a note on a closed PR', maya, facts({ closed: true }), { kind: 'note' }, false],
  ['the raiser resolves P1 on a closed PR', leo, facts({ closed: true }), { kind: 'resolve', point: 1 }, false],
  ['the author continues P1 on a closed PR', maya, facts({ closed: true }), { kind: 'continue', point: 1 }, false],
  ['a requested reviewer starts a review on a closed PR', leo, { ...untrusted(), closed: true }, { kind: 'review' }, false],
  ['the person whose job failed retries on a closed PR', leo, { ...failed, closed: true }, { kind: 'retry' }, false],
  ['the author switches Auto-fix on a closed PR', maya, facts({ closed: true }), { kind: 'auto', role: 'author' }, false],
  ['the owner sends their draft on a closed PR', leo, facts({ closed: true }), { kind: 'draft', owner: leo.githubId }, false],
];

describe('can (spec §16 "Who can act in a chat")', () => {
  it.each(rows)('%s: %s', (_case, viewer, f, action, allowed) => {
    expect(can(viewer, f, action)).toBe(allowed);
  });
});

describe('permissionsFor', () => {
  it('lists what each person may do now: Resolve and Continue only on escalated points', () => {
    expect(permissionsFor(leo, facts())).toEqual({ note: true, resolve: [1], continue: [1, 2], review: false, retry: false, auto: ['reviewer'], drafts: ['job_7'] });
    expect(permissionsFor(maya, facts())).toEqual({ note: true, resolve: [], continue: [1, 2], review: false, retry: false, auto: ['author'], drafts: [] });
    expect(permissionsFor(sam, facts())).toEqual({ note: false, resolve: [], continue: [], review: false, retry: false, auto: [], drafts: [] });
  });

  it('offers the Auto switch for each role you have, and Send / Discard only on your own waiting drafts', () => {
    const both = facts({
      participants: [
        { githubId: maya.githubId, role: 'author', requested: false, attention: 'drafts', agentFailed: false },
        { githubId: maya.githubId, role: 'reviewer', requested: true, attention: 'none', agentFailed: false },
      ],
      drafts: [{ jobId: 'job_8', owner: maya.githubId }, { jobId: 'job_7', owner: leo.githubId }],
    });
    expect(permissionsFor(maya, both)).toMatchObject({ auto: ['author', 'reviewer'], drafts: ['job_8'] });
  });

  it('offers Review while the reviewer still has to start it, and Retry to the person whose job failed', () => {
    expect(permissionsFor(leo, untrusted()).review).toBe(true);
    expect(permissionsFor(leo, untrusted('none')).review).toBe(false);
    expect(permissionsFor(leo, failed).retry).toBe(true);
    expect(permissionsFor(leo, failedPosting).retry).toBe(false);
    expect(permissionsFor(nina, failedAndRemoved).retry).toBe(false);
  });

  it('offers nothing on a closed PR', () => {
    expect(permissionsFor(leo, facts({ closed: true }))).toEqual({ note: false, resolve: [], continue: [], review: false, retry: false, auto: [], drafts: [] });
  });
});
