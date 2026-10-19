import { BRAND, type DeviceView } from '@nitpilot/protocol';
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
          <DeviceRow key={device.id} device={device} now={now} />
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

function DeviceRow({ device, now }: { device: DeviceView; now: Date }) {
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
        disabled={busy}
        aria-busy={busy || undefined}
        onClick={() => revoke.mutate(device.id)}
      >
        Revoke
      </button>
    </li>
  );
}
