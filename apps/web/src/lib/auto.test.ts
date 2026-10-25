import { describe, expect, it } from 'vitest';
import { chatView } from '../test/chat';
import { autoSwitchFor } from './auto';

const rules = chatView().rules;
const asLeo = { viewer: { role: 'reviewer' as const, attention: 'none' as const, failure: null, failureReason: null }, permissions: { ...chatView().permissions, auto: ['reviewer' as const] } };

describe('autoSwitchFor (spec §16: one tooltip per reason)', () => {
  it("is your own switch for your role here, as you set it", () => {
    expect(autoSwitchFor(chatView(), 'maya')).toEqual({ role: 'author', on: true, disabledReason: null });
    const off = chatView({ ...asLeo, participants: chatView().participants.map((p) => (p.login === 'leo' ? { ...p, auto: false } : p)) });
    expect(autoSwitchFor(off, 'leo')).toEqual({ role: 'reviewer', on: false, disabledReason: null });
  });

  it('is not there for someone who only reads along, or on a closed PR where nobody can act', () => {
    expect(autoSwitchFor(chatView({ viewer: { role: null, attention: 'none', failure: null, failureReason: null }, permissions: { ...chatView().permissions, auto: [] } }), 'sam')).toBeNull();
    expect(autoSwitchFor(chatView({ closed: true, phase: 'closed', permissions: { ...chatView().permissions, auto: [] } }), 'maya')).toBeNull();
  });

  it("is off and can't be flipped on a reviewer's side of a PR from an outside contributor (the trust gate)", () => {
    expect(autoSwitchFor(chatView({ ...asLeo, trusted: false }), 'leo')).toEqual({ role: 'reviewer', on: false, disabledReason: 'outside_contributor' });
    // The author's side has no trust gate.
    expect(autoSwitchFor(chatView({ trusted: false }), 'maya')).toEqual({ role: 'author', on: true, disabledReason: null });
  });

  it('is off when the team turned that auto mode off in .nitpilot.yml, and only that side', () => {
    expect(autoSwitchFor(chatView({ ...asLeo, rules: { ...rules, autoReview: false } }), 'leo')).toMatchObject({ on: false, disabledReason: 'team_review' });
    expect(autoSwitchFor(chatView({ rules: { ...rules, autoAddress: false } }), 'maya')).toMatchObject({ on: false, disabledReason: 'team_address' });
    expect(autoSwitchFor(chatView({ rules: { ...rules, autoReview: false } }), 'maya')).toMatchObject({ on: true, disabledReason: null });
  });

  it('gives one reason, never two: the trust gate first', () => {
    expect(autoSwitchFor(chatView({ ...asLeo, trusted: false, rules: { ...rules, autoReview: false } }), 'leo')).toMatchObject({ disabledReason: 'outside_contributor' });
  });
});
