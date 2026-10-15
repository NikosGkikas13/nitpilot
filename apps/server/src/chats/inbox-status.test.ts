import type { InboxStatus } from '@nitpilot/protocol';
import { describe, expect, it } from 'vitest';
import type { Activity } from './activity';
import { inboxStatus, type InboxStatusFacts } from './inbox-status';

const working: Activity = { kind: 'agent_working', who: 'leo' };

function facts(over: Partial<InboxStatusFacts> = {}): InboxStatusFacts {
  return { phase: 'reviewing', merged: false, activity: { kind: 'none' }, attention: 'none', role: 'author', you: 'maya', ...over };
}

const status = (kind: InboxStatus['kind'], who: string | null = null, reason: InboxStatus['reason'] = null): InboxStatus => ({ kind, who, reason });

describe('inboxStatus (spec §16 "Inbox", handoff §1 status pills)', () => {
  it('is merged or closed once the PR is', () => {
    expect(inboxStatus(facts({ phase: 'closed', merged: true }))).toEqual(status('merged'));
    expect(inboxStatus(facts({ phase: 'closed' }))).toEqual(status('closed'));
  });

  it('is merged even when an escalation was still waiting for you', () => {
    expect(inboxStatus(facts({ phase: 'closed', merged: true, attention: 'decision' }))).toEqual(status('merged'));
  });

  it('is escalated (the red pill) when a decision waits for you', () => {
    expect(inboxStatus(facts({ phase: 'escalated', attention: 'decision' }))).toEqual(status('escalated', null, 'decision'));
  });

  it('is needs_you, with the reason, for a manual review, a failure or drafts', () => {
    for (const attention of ['manual_review', 'failed', 'drafts'] as const) {
      expect(inboxStatus(facts({ attention }))).toEqual(status('needs_you', null, attention));
    }
  });

  it('puts what you have to do before an agent at work', () => {
    expect(inboxStatus(facts({ attention: 'failed', activity: working }))).toEqual(status('needs_you', null, 'failed'));
  });

  it('is ready for a reviewer, and their turn (approving) for the author, once nothing is open', () => {
    expect(inboxStatus(facts({ phase: 'ready', role: 'reviewer' }))).toEqual(status('ready'));
    expect(inboxStatus(facts({ phase: 'ready', role: 'author' }))).toEqual(status('their_turn'));
  });

  it('is waiting, with who and why, when an agent can not start', () => {
    expect(inboxStatus(facts({ activity: { kind: 'agent_waiting', who: 'leo', why: 'offline', offlineSince: null } }))).toEqual(status('waiting', 'leo', 'offline'));
    expect(inboxStatus(facts({ activity: { kind: 'agent_waiting', who: 'leo', why: 'repo_not_linked' } }))).toEqual(status('waiting', 'leo', 'repo_not_linked'));
    expect(inboxStatus(facts({ activity: { kind: 'agent_waiting', who: 'leo', why: 'cap_reached' } }))).toEqual(status('waiting', 'leo', 'cap_reached'));
  });

  it("is working, with whose agent, while one works", () => {
    expect(inboxStatus(facts({ activity: working }))).toEqual(status('working', 'leo'));
  });

  it("is their turn when a person is up, and needs_you when that person is you", () => {
    expect(inboxStatus(facts({ phase: 'addressing', activity: { kind: 'human_turn', who: 'leo' } }))).toEqual(status('their_turn', 'leo'));
    expect(inboxStatus(facts({ phase: 'addressing', activity: { kind: 'human_turn', who: 'maya' } }))).toEqual(status('needs_you'));
  });

  it("tells you from them whatever the case of the login (GitHub logins ignore case)", () => {
    expect(inboxStatus(facts({ phase: 'addressing', activity: { kind: 'human_turn', who: 'Maya' }, you: 'maya' }))).toEqual(status('needs_you'));
  });

  it("is quiet in an escalated chat when the decision isn't yours (spec §16: with nothing pending the row shows no pill)", () => {
    expect(inboxStatus(facts({ phase: 'escalated', attention: 'none' }))).toEqual(status('quiet'));
  });

  it('is quiet when nothing is pending', () => {
    expect(inboxStatus(facts())).toEqual(status('quiet'));
    expect(inboxStatus(facts({ phase: 'idle' }))).toEqual(status('quiet'));
  });
});
