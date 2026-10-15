import type { InboxStatus } from '@nitpilot/protocol';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusPill } from './StatusPill';

const pill = (kind: InboxStatus['kind'], who: string | null = null) => render(<StatusPill status={{ kind, who, reason: null }} viewerLogin="maya" />);

describe('StatusPill (handoff §1 "Status pills")', () => {
  it.each([
    ['working', 'leo', "leo's agent working"],
    ['working', 'maya', 'Your agent working'],
    ['waiting', 'leo', 'Waiting'],
    ['their_turn', 'leo', 'Their turn'],
    ['needs_you', null, 'Needs you'],
    ['escalated', null, 'Needs you'],
    ['ready', null, 'Ready'],
    ['merged', null, 'Merged'],
    ['closed', null, 'Closed'],
  ] as const)('%s (%s) reads "%s"', (kind, who, words) => {
    pill(kind, who);
    expect(screen.getByText(words)).toBeInTheDocument();
  });

  it('gives every live status a glyph next to its word, and Merged and Closed none', () => {
    for (const kind of ['working', 'waiting', 'their_turn', 'needs_you', 'escalated', 'ready'] as const) {
      const { container, unmount } = pill(kind, 'leo');
      expect(container.querySelector('[data-glyph]'), kind).not.toBeNull();
      unmount();
    }
    for (const kind of ['merged', 'closed'] as const) {
      const { container, unmount } = pill(kind);
      expect(container.querySelector('[data-glyph]'), kind).toBeNull();
      unmount();
    }
  });

  it('is red only for an escalation', () => {
    const { container, unmount } = pill('escalated');
    expect(container.firstElementChild).toHaveAttribute('data-tone', 'red');
    expect(container.querySelector('[data-glyph]')).toHaveAttribute('data-glyph', 'diamond');
    unmount();
    expect(pill('needs_you').container.firstElementChild).toHaveAttribute('data-tone', 'accent');
  });

  it('shows nothing for a quiet chat', () => {
    expect(pill('quiet').container).toBeEmptyDOMElement();
  });
});
