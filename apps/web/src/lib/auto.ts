import type { ChatView, Role } from '@nitpilot/protocol';

/** The switch's name on each side (handoff §2 "Header"): the reviewer's agent reviews, the author's fixes. */
export const AUTO_LABEL: Record<Role, string> = { reviewer: 'Auto-review', author: 'Auto-fix' };

/**
 * Why the switch is off and can't be flipped. One reason at a time, each with its own tooltip (spec §16's fix of
 * the mockup, which mixed two): the built-in trust gate (§6.1), or a team rule in `.nitpilot.yml` (§13).
 */
export type AutoDisabledReason = 'outside_contributor' | 'team_review' | 'team_address';

export type AutoSwitchState = { role: Role; on: boolean; disabledReason: AutoDisabledReason | null };

/**
 * Your Auto switch in this chat (spec §9 "Auto"), or null when there's none to show: you only read along, or the
 * PR is closed (nobody can act then, spec §16, so `permissions.auto` is empty). It's off and disabled on a
 * reviewer's side of a PR from an outside contributor, or on either side when the team turned that auto mode off;
 * the trust gate wins when both apply, since it holds whatever the team says. Otherwise it's your switch as you set
 * it (`ParticipantView.auto`).
 */
export function autoSwitchFor(view: ChatView, you: string): AutoSwitchState | null {
  const role = view.viewer.role;
  if (!role || !view.permissions.auto.includes(role)) return null;
  const yours = view.participants.find((p) => p.login === you && p.role === role);
  if (!yours) return null;
  const disabledReason = whyDisabled(view, role);
  return { role, on: disabledReason === null && yours.auto, disabledReason };
}

function whyDisabled(view: ChatView, role: Role): AutoDisabledReason | null {
  if (role === 'reviewer' && !view.trusted) return 'outside_contributor';
  if (role === 'reviewer' && !view.rules.autoReview) return 'team_review';
  if (role === 'author' && !view.rules.autoAddress) return 'team_address';
  return null;
}
