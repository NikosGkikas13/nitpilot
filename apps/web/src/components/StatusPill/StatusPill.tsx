import type { InboxStatus } from '@nitpilot/protocol';
import { Ping } from '../Ping/Ping';
import styles from './StatusPill.module.css';

type Tone = 'muted' | 'accent' | 'red' | 'ok' | 'done';
type Glyph = 'ping' | 'ring' | 'dot' | 'diamond' | 'check' | null;

/** How each status looks (handoff §1 "Status pills"). Every live status is a glyph and a word, never colour alone. */
const LOOK: Record<Exclude<InboxStatus['kind'], 'quiet'>, { tone: Tone; glyph: Glyph; word: string }> = {
  working: { tone: 'muted', glyph: 'ping', word: 'Agent working' },
  waiting: { tone: 'muted', glyph: 'ring', word: 'Waiting' },
  their_turn: { tone: 'muted', glyph: 'ring', word: 'Their turn' },
  needs_you: { tone: 'accent', glyph: 'dot', word: 'Needs you' },
  // Red is for escalations only.
  escalated: { tone: 'red', glyph: 'diamond', word: 'Needs you' },
  ready: { tone: 'ok', glyph: 'check', word: 'Ready' },
  merged: { tone: 'done', glyph: null, word: 'Merged' },
  closed: { tone: 'done', glyph: null, word: 'Closed' },
};

/** An inbox row's status. A quiet chat has none. */
export function StatusPill({ status, viewerLogin }: { status: InboxStatus; viewerLogin: string }) {
  if (status.kind === 'quiet') return null;
  const look = LOOK[status.kind];
  return (
    <span className={`${styles.pill} ${styles[look.tone]} ${status.kind === 'merged' ? styles.struck : ''}`} data-tone={look.tone}>
      {look.glyph && <GlyphMark glyph={look.glyph} />}
      {status.kind === 'working' ? workingWords(status.who, viewerLogin) : look.word}
    </span>
  );
}

/** "leo's agent working", or "Your agent working" when it's yours. */
function workingWords(who: string | null, viewerLogin: string): string {
  if (who === null) return 'Agent working';
  return who === viewerLogin ? 'Your agent working' : `${who}'s agent working`;
}

function GlyphMark({ glyph }: { glyph: Exclude<Glyph, null> }) {
  if (glyph === 'ping') {
    return (
      <span data-glyph="ping" className={styles.glyphBox}>
        <Ping />
      </span>
    );
  }
  if (glyph === 'check') {
    return (
      <span data-glyph="check" className={styles.check} aria-hidden="true">
        ✓
      </span>
    );
  }
  return <span data-glyph={glyph} className={styles[glyph]} aria-hidden="true" />;
}
