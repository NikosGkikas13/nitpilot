import { BRAND, type Role } from '@nitpilot/protocol';
import { useId, useState } from 'react';
import { AUTO_LABEL, type AutoDisabledReason } from '../../lib/auto';
import styles from './AutoSwitch.module.css';

/** One tooltip per reason (spec §16), never both. */
const WHY_DISABLED: Record<AutoDisabledReason, string> = {
  outside_contributor: 'Off for PRs from outside contributors.',
  team_review: `Your team turned off auto-review in ${BRAND.teamConfigFile}.`,
  team_address: `Your team turned off auto-fix in ${BRAND.teamConfigFile}.`,
};

/** What the switch does now, for a switch you can flip. */
function hint(role: Role, on: boolean): string {
  if (!on) return "Your agent's work waits as a draft for you to send.";
  return role === 'reviewer' ? "Your agent's review goes to GitHub as soon as it's done." : 'Your agent pushes its fixes as soon as they are done.';
}

/**
 * The Auto switch in the chat header (handoff §2): a pill button with its label and a 30×18 track (34×20 on a phone),
 * `role=switch`. Disabled, it stays focusable (`aria-disabled`, not `disabled`) so its tooltip can say why, on hover,
 * on focus, or on a tap where there's no hover. It shows `on` as the server last said; pressing asks for the other
 * value (`onToggle`) and the switch moves when `/ws/web` says it did.
 */
export function AutoSwitch(props: { role: Role; on: boolean; disabledReason: AutoDisabledReason | null; busy?: boolean; onToggle: (on: boolean) => void }) {
  const { role, on, disabledReason } = props;
  const tipId = useId();
  const [tip, setTip] = useState(false);
  const disabled = disabledReason !== null;
  function press(): void {
    if (disabled) return setTip(true);
    if (!props.busy) props.onToggle(!on);
  }
  return (
    <span className={styles.wrap} onMouseEnter={() => setTip(true)} onMouseLeave={() => setTip(false)}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-disabled={disabled || undefined}
        aria-busy={props.busy || undefined}
        aria-describedby={tipId}
        className={`${styles.switch} ${disabled ? styles.disabled : ''}`}
        onClick={press}
        onFocus={() => setTip(true)}
        onBlur={() => setTip(false)}
        onKeyDown={(e) => e.key === 'Escape' && setTip(false)}
      >
        {AUTO_LABEL[role]}
        <span className={`${styles.track} ${on ? styles.on : ''}`} aria-hidden="true">
          <span className={styles.thumb} />
        </span>
      </button>
      {/* Always in the page, so it describes the switch even while hidden; shown on hover and focus. */}
      <span role="tooltip" id={tipId} className={styles.tip} hidden={!tip}>
        {disabledReason ? WHY_DISABLED[disabledReason] : hint(role, on)}
      </span>
    </span>
  );
}
