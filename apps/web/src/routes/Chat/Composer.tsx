import type { ChatView, WebMe } from '@nitpilot/protocol';
import { useIsMutating } from '@tanstack/react-query';
import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { useNote } from '../../api/actions';
import { useDraft } from '../Shell/UiState';
import styles from './Composer.module.css';

/** The tallest the field grows as you add lines, before it scrolls. */
const MAX_HEIGHT = 160;

/**
 * Notes to the agents (handoff §2 "Composer"): ↵ sends, ⇧↵ adds a line, and the note goes into the agents' next
 * round. Read-only, with a line saying why, for a closed PR, an expired GitHub sign-in (a note is sent as you), and
 * someone who only reads along.
 */
export function Composer({ view, me }: { view: ChatView; me: WebMe }) {
  const why = readOnly(view, me);
  return <div className={styles.composer}>{why ? <p className={styles.readOnly}>{why}</p> : <Field chatId={view.id} />}</div>;
}

function readOnly(view: ChatView, me: WebMe): string | null {
  if (view.closed) return view.merged ? 'This PR was merged. The chat is read-only.' : 'This PR was closed. The chat is read-only.';
  if (me.githubAuth === 'needs_reauth') return 'Reconnect GitHub to send notes as yourself.';
  if (!view.permissions.note) return "You're reading along. Only the author and the reviewers can message the agents.";
  return null;
}

function Field({ chatId }: { chatId: string }) {
  const [draft, setDraft] = useDraft(chatId);
  const note = useNote(chatId);
  // Counted by the write's key, not by this field's own state: open another chat and come back while a note is still
  // on its way, and this new field still waits for it. (The draft is cleared by the write itself, api/actions.ts.)
  const sending = useIsMutating({ mutationKey: ['note', chatId] }) > 0;
  const box = useRef<HTMLTextAreaElement>(null);
  const text = draft.trim();
  const canSend = text !== '' && !sending;

  // The field grows with its lines, up to MAX_HEIGHT.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 32), MAX_HEIGHT)}px`;
  }, [draft]);

  function send(): void {
    if (!canSend) return;
    // A failure needs no handling here: the toast says why, and the text stays.
    note.mutate(text);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    send();
  }

  return (
    <div className={styles.inner}>
      <div className={styles.field}>
        <textarea
          ref={box}
          className={styles.input}
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Message the agents…"
          aria-label="Message the agents"
        />
        <button type="button" className={`${styles.send} ${text ? styles.ready : ''}`} onClick={send} disabled={!canSend}>
          Send
        </button>
      </div>
      <p className={styles.hint}>Notes are included in the agents' next round</p>
    </div>
  );
}
