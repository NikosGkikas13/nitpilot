import { BRAND, type DeviceView } from '@nitpilot/protocol';
import { useEffect, useRef } from 'react';
import { useDevices, useRevokeDevice } from '../../api/settings';
import { lastSeen, useNow } from '../../lib/time';
import { Section } from './Section';
import styles from './Settings.module.css';

/** Online first, then the most recently seen; a device that never connected last. */
export function sortDevices(devices: DeviceView[]): DeviceView[] {
  const seen = (d: DeviceView) => (d.lastSeenAt ? Date.parse(d.lastSeenAt) : -Infinity);
  return [...devices].sort((a, b) => Number(b.online) - Number(a.online) || seen(b) - seen(a));
}

/**
 * Your computers (handoff §7 "Devices"): each CLI that `nitpilot login` connected, online or when it was last seen,
 * with Revoke. The handoff's "This device" chip is about the browser's own computer, which the server can't know
 * (docs/why/revoking-devices.md), so an online device gets an "Online" chip instead.
 */
export function Devices() {
  const devices = useDevices();
  const now = useNow();
  // After a revoke, once the row is gone, focus goes to the next row's Revoke, else the previous one's, else the heading.
  const revokes = useRef(new Map<string, HTMLButtonElement>());
  const after = useRef<{ gone: string; next: string | null; previous: string | null } | null>(null);

  function revoked(id: string) {
    const ids = sortDevices(devices.data ?? []).map((d) => d.id);
    const at = ids.indexOf(id);
    after.current = { gone: id, next: ids[at + 1] ?? null, previous: ids[at - 1] ?? null };
  }

  useEffect(() => {
    const pending = after.current;
    if (!pending || !devices.data || devices.data.some((d) => d.id === pending.gone)) return;
    after.current = null;
    const target = [pending.next, pending.previous].map((id) => (id ? revokes.current.get(id) : undefined)).find(Boolean);
    (target ?? document.getElementById('devices-heading'))?.focus();
  }, [devices.data]);

  let body;
  if (devices.isPending) {
    body = <p className={styles.line}>Loading your computers…</p>;
  } else if (devices.isError) {
    body = (
      <div className={styles.row}>
        <p className={styles.rowText}>
          <span className={styles.hint}>{devices.error.message}</span>
        </p>
        <button type="button" className={styles.button} onClick={() => void devices.refetch()}>
          Try again
        </button>
      </div>
    );
  } else if (devices.data.length === 0) {
    body = (
      <p className={styles.line}>
        No computers yet. Run <span className={styles.mono}>npx {BRAND.npmPackage} login</span> on one to connect it.
      </p>
    );
  } else {
    body = (
      <ul className={styles.list}>
        {sortDevices(devices.data).map((device) => (
          <DeviceRow
            key={device.id}
            device={device}
            now={now}
            onRevoked={() => revoked(device.id)}
            buttonRef={(button) => {
              if (button) revokes.current.set(device.id, button);
              else revokes.current.delete(device.id);
            }}
          />
        ))}
      </ul>
    );
  }
  return (
    <Section id="devices" title="Devices">
      {body}
    </Section>
  );
}

function DeviceRow({ device, now, onRevoked, buttonRef }: { device: DeviceView; now: Date; onRevoked: () => void; buttonRef: (button: HTMLButtonElement | null) => void }) {
  const revoke = useRevokeDevice();
  const busy = revoke.isPending;
  return (
    <li className={styles.row}>
      <span className={styles.laptop} data-online={device.online || undefined} aria-hidden="true" />
      <div className={styles.rowText}>
        <span className={styles.rowTitle}>
          <span data-testid="device-name">{device.name}</span>
          {device.online && (
            <span className={`${styles.smallChip} ${styles.ok}`}>
              <span className={styles.dot} aria-hidden="true" />
              <span>Online</span>
            </span>
          )}
        </span>
        {!device.online && <span className={styles.hint}>{device.lastSeenAt ? `Last seen ${lastSeen(device.lastSeenAt, now)}` : 'Never connected'}</span>}
      </div>
      <button
        type="button"
        className={`${styles.button} ${styles.revoke}`}
        aria-label={`Revoke ${device.name}`}
        ref={buttonRef}
        aria-disabled={busy || undefined}
        aria-busy={busy || undefined}
        onClick={() => {
          // aria-disabled keeps the focus on the button while it works, so a press has to be ignored here.
          if (!busy) revoke.mutate(device.id, { onSuccess: onRevoked });
        }}
      >
        Revoke
      </button>
    </li>
  );
}
